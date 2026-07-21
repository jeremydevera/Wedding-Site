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
      // Permanently remove a Neon client site: unlink/remove owner profiles first
      // (profiles.client_id references the client), then the client row. Guest
      // rows (rsvps/guestbook/quiz) cascade via their client_id FKs where defined;
      // delete explicitly to be safe. The owner's AUTH account is kept — they
      // could register a new site later.
      case "delete_client": {
        if (!body.id) return json({ error: "id required" }, 400);
        await sql`delete from rsvps where client_id = ${body.id}`;
        await sql`delete from guestbook where client_id = ${body.id}`;
        await sql`delete from quiz_answers where client_id = ${body.id}`;
        await sql`delete from guests where client_id = ${body.id}`.catch(() => {});
        await sql`delete from profiles where client_id = ${body.id} and role = 'owner'`;
        const del = await sql`delete from clients where id = ${body.id} returning subdomain`;
        return json({ ok: true, deleted: del[0]?.subdomain || null });
      }
      // Registered accounts that never finished the wizard: no client, no pending
      // request. Surfaced in the console so signups aren't invisible.
      case "list_signups": {
        const rows = await sql`select u.id, u.email, u.name, u."createdAt" as created_at
          from neon_auth."user" u
          left join profiles p on p.id = u.id
          left join site_requests r on r.requested_by = u.id and r.status = 'pending'
          where (p.id is null or (p.client_id is null and p.role <> 'superadmin')) and r.id is null
          order by u."createdAt" desc`;
        return json({ rows });
      }
      // Remove an unfinished signup's auth account (never one with a client or
      // the superadmin).
      case "delete_signup": {
        if (!body.user_id) return json({ error: "user_id required" }, 400);
        const [p] = await sql`select role, client_id from profiles where id = ${body.user_id}`;
        if (p && (p.role === "superadmin" || p.client_id)) return json({ error: "refusing: account has a site or is the admin" }, 400);
        await sql`delete from profiles where id = ${body.user_id}`.catch(() => {});
        await sql`delete from neon_auth."user" where id = ${body.user_id}`;
        return json({ ok: true });
      }
      case "set_config":
        await sql`insert into app_config (key, value) values (${body.key}, ${JSON.stringify(body.value)}::jsonb)
          on conflict (key) do update set value = excluded.value, updated_at = now()`;
        return json({ ok: true });
      // One-time per shard: link the (already signed-up) Neon Auth account for
      // `email` to a superadmin profile row, so the platform owner can sign in
      // to ANY Neon client's /admin with the same credentials (plan: "superadmin
      // will need an account per shard"). Returns RLS diagnostics so we can
      // verify the ported superadmin policies actually cover admin writes.
      // Read-only: current definition of register_site (fixed identifier — used to
      // build the superadmin-demote guard patch against the LIVE body, not the
      // stale plan-doc copy).
      case "inspect_register_site": {
        const [r] = await sql`select pg_get_functiondef('public.register_site(text,text,text,text,text,text,jsonb)'::regprocedure) as def`;
        return json({ ok: true, def: r?.def || null });
      }
      // Read-only: live subdomain_free definition (same always-inspect-live rule).
      case "inspect_subdomain_free": {
        const [r] = await sql`select pg_get_functiondef('public.subdomain_free(text)'::regprocedure) as def`;
        return json({ ok: true, def: r?.def || null });
      }
      // Idempotent hardening batch (fixed statements):
      //  1. clients column grants — ANONYMOUS loses owner_email (guests could
      //     harvest client login emails via the public Data API). The explicit
      //     column list matches NEON_CLIENT_COLS in src/lib/api.js.
      //  2. reserved_subdomains TABLE seeded from the canonical union
      //     (src/config/site.js RESERVED_SUBDOMAINS) + subdomain_free reads the
      //     table — reserving a name becomes a data write, not three code edits.
      case "harden_minors": {
        await sql`revoke select on public.clients from anonymous`;
        await sql`grant select (id, subdomain, event_type, template_key, theme, content, is_active, created_at, status) on public.clients to anonymous`;
        await sql`create table if not exists public.reserved_subdomains (name text primary key)`;
        await sql`insert into public.reserved_subdomains (name) values
          ('www'),('app'),('admin'),('api'),('demo'),('mail'),('media'),('static'),('assets'),('cdn'),
          ('help'),('support'),('blog'),('docs'),('status'),('celebrately'),('staging'),('test'),
          ('sandbox'),('register'),('apply')
          on conflict (name) do nothing`;
        await sql`CREATE OR REPLACE FUNCTION public.subdomain_free(p_sub text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare s text := lower(btrim(coalesce(p_sub,''))); begin if s !~ '^[a-z0-9](?:[a-z0-9-]{1,61})?[a-z0-9]$' then return false; end if; if exists (select 1 from public.reserved_subdomains r where r.name = s) then return false; end if; if exists (select 1 from public.clients c where lower(c.subdomain) = s) then return false; end if; if exists (select 1 from public.site_requests r where lower(r.subdomain) = s and r.status = 'pending') then return false; end if; return true; end $function$`;
        const [chk] = await sql`select
          (select count(*) from public.reserved_subdomains) as reserved_count,
          has_column_privilege('anonymous','public.clients','owner_email','select') as anon_sees_owner_email,
          has_column_privilege('anonymous','public.clients','content','select') as anon_sees_content`;
        return json({ ok: true, ...chk });
      }
      // Fixed DDL patch (idempotent): register_site refuses a SUPERADMIN caller —
      // its on-conflict profile upsert would demote the platform admin to 'owner'.
      // Body = the LIVE definition (fetched via inspect_register_site) + the guard;
      // everything else byte-identical (_enrich_site_content path preserved).
      case "apply_register_site_guard": {
        await sql`CREATE OR REPLACE FUNCTION public.register_site(p_subdomain text, p_event_type text, p_template_key text, p_email text, p_partner_a text, p_partner_b text, p_content jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v_uid text; v_sub text := lower(btrim(coalesce(p_subdomain,''))); v_auto boolean; v_client uuid; v_etype text := case when coalesce(nullif(p_event_type,''),'wedding') = 'birthday' then 'birthday' else 'wedding' end; begin begin v_uid := auth.user_id(); exception when others then v_uid := null; end; if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if; if exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'superadmin') then raise exception 'platform admin account cannot register a client site' using errcode = '42501'; end if; if exists (select 1 from public.profiles p where p.id = v_uid and p.client_id is not null) or exists (select 1 from public.site_requests r where r.requested_by = v_uid and r.status = 'pending') then raise exception 'you already have a site or a pending request' using errcode = '23505'; end if; if not public.subdomain_free(v_sub) then raise exception 'that site address is taken or not allowed' using errcode = '23505'; end if; if pg_column_size(coalesce(p_content, '{}'::jsonb)) > 200000 then raise exception 'content too large' using errcode = '22001'; end if; select coalesce((value->>'enabled')::boolean, false) into v_auto from public.app_config where key = 'auto_approve_requests'; if coalesce(v_auto, false) then insert into public.clients (subdomain, event_type, template_key, content, is_active, owner_email, status) values (v_sub, v_etype, coalesce(nullif(p_template_key,''),'classic'), public._enrich_site_content(p_content, p_event_type, p_partner_a, p_partner_b), true, nullif(btrim(coalesce(p_email,'')),''), 'not_paid') returning id into v_client; insert into public.profiles (id, role, client_id) values (v_uid, 'owner', v_client) on conflict (id) do update set role = 'owner', client_id = excluded.client_id; return jsonb_build_object('result','created','subdomain',v_sub); else insert into public.site_requests (status, email, partner_a, partner_b, subdomain, template_key, content, requested_by) values ('pending', coalesce(nullif(btrim(p_email),''),'unknown@unknown'), coalesce(p_partner_a,''), coalesce(p_partner_b,''), v_sub, coalesce(nullif(p_template_key,''),'classic'), coalesce(p_content,'{}'::jsonb), v_uid); return jsonb_build_object('result','pending','subdomain',v_sub); end if; end $function$`;
        const [r] = await sql`select pg_get_functiondef('public.register_site(text,text,text,text,text,text,jsonb)'::regprocedure) as def`;
        return json({ ok: true, guarded: /superadmin/.test(r?.def || "") });
      }
      // Fixed DDL patch (idempotent): register_site with BOTH the superadmin
      // guard AND an hourly registration cap — new clients + new pending
      // requests in the last hour must stay under app_config
      // ('registration_limits').perHour (default 5). Blunt global throttle: a
      // bot burst can't mass-create sites even with valid CAPTCHA tokens; legit
      // volume never comes close. Body pinned from the LIVE guarded definition.
      case "apply_register_rate_limit": {
        await sql`CREATE OR REPLACE FUNCTION public.register_site(p_subdomain text, p_event_type text, p_template_key text, p_email text, p_partner_a text, p_partner_b text, p_content jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v_uid text; v_sub text := lower(btrim(coalesce(p_subdomain,''))); v_auto boolean; v_client uuid; v_cap int; v_etype text := case when coalesce(nullif(p_event_type,''),'wedding') = 'birthday' then 'birthday' else 'wedding' end; begin begin v_uid := auth.user_id(); exception when others then v_uid := null; end; if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if; if exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'superadmin') then raise exception 'platform admin account cannot register a client site' using errcode = '42501'; end if; select coalesce((select (value->>'perHour')::int from public.app_config where key = 'registration_limits'), 5) into v_cap; if v_cap >= 0 and ((select count(*) from public.clients c where c.created_at > now() - interval '1 hour') + (select count(*) from public.site_requests r where r.created_at > now() - interval '1 hour')) >= v_cap then raise exception 'registration is busy right now — please try again shortly' using errcode = '53400'; end if; if exists (select 1 from public.profiles p where p.id = v_uid and p.client_id is not null) or exists (select 1 from public.site_requests r where r.requested_by = v_uid and r.status = 'pending') then raise exception 'you already have a site or a pending request' using errcode = '23505'; end if; if not public.subdomain_free(v_sub) then raise exception 'that site address is taken or not allowed' using errcode = '23505'; end if; if pg_column_size(coalesce(p_content, '{}'::jsonb)) > 200000 then raise exception 'content too large' using errcode = '22001'; end if; select coalesce((value->>'enabled')::boolean, false) into v_auto from public.app_config where key = 'auto_approve_requests'; if coalesce(v_auto, false) then insert into public.clients (subdomain, event_type, template_key, content, is_active, owner_email, status) values (v_sub, v_etype, coalesce(nullif(p_template_key,''),'classic'), public._enrich_site_content(p_content, p_event_type, p_partner_a, p_partner_b), true, nullif(btrim(coalesce(p_email,'')),''), 'not_paid') returning id into v_client; insert into public.profiles (id, role, client_id) values (v_uid, 'owner', v_client) on conflict (id) do update set role = 'owner', client_id = excluded.client_id; return jsonb_build_object('result','created','subdomain',v_sub); else insert into public.site_requests (status, email, partner_a, partner_b, subdomain, template_key, content, requested_by) values ('pending', coalesce(nullif(btrim(p_email),''),'unknown@unknown'), coalesce(p_partner_a,''), coalesce(p_partner_b,''), v_sub, coalesce(nullif(p_template_key,''),'classic'), coalesce(p_content,'{}'::jsonb), v_uid); return jsonb_build_object('result','pending','subdomain',v_sub); end if; end $function$`;
        const [r] = await sql`select pg_get_functiondef('public.register_site(text,text,text,text,text,text,jsonb)'::regprocedure) as def`;
        return json({ ok: true, hasGuard: /superadmin/.test(r?.def || ""), hasCap: /registration_limits/.test(r?.def || "") });
      }
      case "ensure_superadmin": {
        const email = String(body.email || "").trim().toLowerCase();
        if (!email) return json({ error: "email required" }, 400);
        let u;
        try { [u] = await sql`select id, email from neon_auth.users where lower(email) = ${email} limit 1`; }
        catch { [u] = await sql`select id, email from neon_auth."user" where lower(email) = ${email} limit 1`; } // Better Auth names it "user" on some versions
        if (!u) return json({ error: "no Neon Auth account with that email on this shard — sign up first" }, 404);
        await sql`insert into profiles (id, role, client_id) values (${u.id}, 'superadmin', null)
          on conflict (id) do update set role = 'superadmin'`;
        const policies = await sql`select tablename, policyname, cmd from pg_policies
          where schemaname = 'public' and tablename in ('clients','rsvps','guestbook','guests','profiles','quiz_answers') order by tablename, policyname`;
        return json({ ok: true, userId: u.id, policies });
      }
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: e.message || "neon error" }, 500);
  }
}
