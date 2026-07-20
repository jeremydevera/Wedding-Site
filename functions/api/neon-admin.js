// functions/api/neon-admin.js
// Superadmin console ↔ Neon bridge. The console authenticates with SUPABASE
// (superadmin JWT — verified below, same pattern as cf-health); Neon rows are
// read/written via the NEON_DATABASE_URL secret. POST {action, ...params}.
import { neon } from "@neondatabase/serverless";

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

async function requireSuperadmin(env, request) {
  const SUPABASE_URL = env.SUPABASE_URL || "https://xprynknppsehuzqqdvue.supabase.co";
  const ANON = env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwcnlua25wcHNlaHV6cXFkdnVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwODg1OTUsImV4cCI6MjA5NzY2NDU5NX0._S3xdNXBm6d4SI8MO0MNoZ3bT8uspEd8lrdVm29Efgo";
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, authorization: `Bearer ${token}` } });
  if (!who.ok) return null;
  const uid = (await who.json())?.id;
  if (!uid) return null;
  const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}&select=role`, { headers: { apikey: ANON, authorization: `Bearer ${token}` } });
  const rows = pr.ok ? await pr.json() : [];
  return rows?.[0]?.role === "superadmin" ? uid : null;
}

export async function onRequestPost({ request, env }) {
  if (!(await requireSuperadmin(env, request))) return json({ error: "forbidden" }, 403);
  if (!env.NEON_DATABASE_URL) return json({ error: "NEON_DATABASE_URL not configured" }, 500);
  const sql = neon(env.NEON_DATABASE_URL);
  const body = await request.json().catch(() => ({}));
  try {
    switch (body.action) {
      case "list_requests":
        return json({ rows: await sql`select id, created_at, status, email, partner_a, partner_b, subdomain, template_key, requested_by from site_requests where status = 'pending' order by created_at desc` });
      case "list_clients":
        return json({ rows: await sql`select id, subdomain, event_type, is_active, owner_email, status, created_at, (content->>'hideDonateAd')::boolean as hide_donate from clients order by created_at desc` });
      case "approve_request": {
        // Single SECURITY DEFINER fn = one transaction + the same content
        // enrichment register_site uses (names, hashtag, modules, accessV2).
        const [row] = await sql`select public.approve_site_request(${body.id}) as res`;
        const res = row?.res || {};
        if (res.error) return json({ error: res.error }, res.error === "subdomain already taken" ? 409 : 404);
        return json({ ok: true, subdomain: res.subdomain });
      }
      case "reject_request":
        await sql`update site_requests set status = 'rejected' where id = ${body.id}`;
        return json({ ok: true });
      case "set_status":
        await sql`update clients set status = ${body.status} where id = ${body.id}`;
        return json({ ok: true });
      case "set_active":
        await sql`update clients set is_active = ${body.active === true} where id = ${body.id}`;
        return json({ ok: true });
      case "toggle_donate": {
        const [c] = await sql`select content from clients where id = ${body.id}`;
        if (!c) return json({ error: "client not found" }, 404);
        const hidden = !(c.content && c.content.hideDonateAd === true);
        await sql`update clients set content = content || ${JSON.stringify({ hideDonateAd: hidden })}::jsonb where id = ${body.id}`;
        return json({ ok: true, hidden });
      }
      case "set_config":
        await sql`insert into app_config (key, value) values (${body.key}, ${JSON.stringify(body.value)}::jsonb)
          on conflict (key) do update set value = excluded.value, updated_at = now()`;
        return json({ ok: true });
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: e.message || "neon error" }, 500);
  }
}
