import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Public prospect intake from the apex /apply wizard. Writes a pending
// site_requests row (service role) for the superadmin to approve. Also serves
// the wizard's live subdomain availability probe (checks live clients AND
// pending requests). verify_jwt is off — this is a public form by design.
//
// AUTO-APPROVE: when the platform flag app_config('auto_approve_requests').enabled
// is true, a submission is approved server-side immediately and unattended — the
// client site is created, an owner login is provisioned, and the customer is
// emailed a "set your password" link + their new site link (via Resend). This
// mirrors the superadmin's manual approveSiteRequest() in src/lib/api.js — keep
// the seed content in sync with that function.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUB_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
const RESERVED = new Set([
  "www", "demo", "admin", "api", "app", "mail", "media", "assets", "static",
  "help", "support", "blog", "docs", "status", "celebrately", "staging", "test",
]);

// Mirror of DEFAULT_CLIENT_MODULES (src/lib/roles.js).
const DEFAULT_CLIENT_MODULES = { details: true, schedule: true, venue: true, rsvp: true, story: false, guestbook: false, quiz: false, gallery: false };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  const subdomain = String(body.subdomain || "").trim().toLowerCase();
  const isFree = async () => {
    const { data: c } = await admin.from("clients").select("id").eq("subdomain", subdomain).maybeSingle();
    if (c) return false;
    const { data: r } = await admin.from("site_requests").select("id").eq("subdomain", subdomain).eq("status", "pending").maybeSingle();
    return !r;
  };

  if (body.action === "check_subdomain") {
    if (!SUB_RE.test(subdomain) || RESERVED.has(subdomain)) return json({ available: false, reason: "invalid" });
    return json({ available: await isFree() });
  }

  // submit
  const email = String(body.email || "").trim().toLowerCase();
  const partnerA = String(body.partnerA || "").trim();
  const partnerB = String(body.partnerB || "").trim();
  const templateKey = String(body.templateKey || "classic").trim();
  const content = (body.content && typeof body.content === "object") ? body.content as Record<string, unknown> : {};

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Please enter a valid email." }, 400);
  if (!partnerA || !partnerB) return json({ error: "Please enter both names." }, 400);
  if (!SUB_RE.test(subdomain)) return json({ error: "Site address must be 3–30 characters: letters, numbers, hyphens." }, 400);
  if (RESERVED.has(subdomain)) return json({ error: "That site address is reserved — try another." }, 400);
  if (!(await isFree())) return json({ error: "That site address is already taken or requested." }, 409);
  if (JSON.stringify(content).length > 60000) return json({ error: "Request too large." }, 400);

  const { data, error } = await admin.from("site_requests")
    .insert({ email, partner_a: partnerA, partner_b: partnerB, subdomain, template_key: templateKey, content })
    .select("id").single();
  // The isFree() pre-check above is advisory only — it and this INSERT are not
  // atomic, so two concurrent /apply submissions for the same subdomain can both
  // pass isFree() and both reach this INSERT. The authoritative guard is a partial
  // unique index on site_requests(subdomain) WHERE status='pending' (DB migration,
  // outside this file). When that index exists, a colliding insert fails closed
  // with a unique_violation (Postgres 23505); map it to the same "already taken"
  // 409 the pre-check returns rather than a generic error.
  if (error && (error as { code?: string }).code === "23505") {
    return json({ error: "That site address is already taken or requested." }, 409);
  }
  if (error || !data) return json({ error: "Could not submit — please try again." }, 400);

  // Auto-approve when the platform flag is on. A failure here must NOT fail the
  // submit — the request simply stays pending for manual approval.
  let approved = false;
  try {
    const { data: cfg } = await admin.from("app_config").select("value").eq("key", "auto_approve_requests").maybeSingle();
    const enabled = (cfg?.value as { enabled?: boolean } | null)?.enabled === true;
    if (enabled) {
      await autoApprove(admin, { id: data.id as string, email, partner_a: partnerA, partner_b: partnerB, subdomain, template_key: templateKey, content });
      approved = true;
    }
  } catch (e) {
    console.error("auto-approve failed (request left pending):", (e as Error)?.message || e);
  }

  return json({ ok: true, id: data.id, approved });
});

type ReqRow = { id: string; email: string; partner_a: string; partner_b: string; subdomain: string; template_key: string; content: Record<string, unknown> };

// Server-side twin of approveSiteRequest() (src/lib/api.js). Creates the client
// site, provisions the owner login (self-set password via a recovery link),
// emails the customer, then marks the request approved.
async function autoApprove(admin: SupabaseClient, req: ReqRow) {
  const c = req.content || {};
  const eventType = (c.eventType === "birthday") ? "birthday" : "wedding";
  const content: Record<string, unknown> = {
    partnerA: req.partner_a,
    partnerB: req.partner_b,
    ...(eventType === "wedding"
      ? { hashtag: `#${((req.partner_a || "") + "And" + (req.partner_b || "")).replace(/[^A-Za-z0-9]/g, "")}` }
      : {}),
    ...(c.phone ? { phone: c.phone } : {}),
    ...(c.weddingDate ? { weddingDate: c.weddingDate } : {}),
    ...(c.weddingDateLabel ? { weddingDateLabel: c.weddingDateLabel } : {}),
    ...(c.venueName ? { venueName: c.venueName } : {}),
    ...(c.venueAddress ? { venueAddress: c.venueAddress } : {}),
    ...(c.mapQuery ? { mapQuery: c.mapQuery } : {}),
    ...(c.mapLat != null ? { mapLat: c.mapLat } : {}),
    ...(c.mapLng != null ? { mapLng: c.mapLng } : {}),
    ...(Array.isArray(c.schedule) && c.schedule.length ? { schedule: c.schedule } : {}),
    ...(Array.isArray(c.entourage) && c.entourage.length ? { entourage: c.entourage } : {}),
    strictRsvp: c.strictRsvp === true,
    ...(eventType === "birthday" ? {
      welcome: "One big day, all our favorite people. Find everything you need below.",
      inviteTitle: "You're invited to the celebration",
      inviteBody: "We can't wait to celebrate with the people we love most. Here's everything you need for the big day.",
    } : {
      welcome: "Two families, one celebration. We would be honored to have you with us as we say “I do.” Find everything you need below.",
      inviteTitle: "You're invited to celebrate love",
      inviteBody: "We can't wait to celebrate the start of our forever, surrounded by the people we love most. Thank you for being part of our story — here's a little about how we got here, and what our wedding day will hold.",
    }),
    modules: (c.modules && typeof c.modules === "object") ? c.modules : { ...DEFAULT_CLIENT_MODULES },
    accessV2: true,
    decorOn: true,
    decorStyle: "petals",
    onboarded: true,
  };

  // Create (or reuse) the client — convergent on the unique-subdomain constraint.
  const { data: existing } = await admin.from("clients").select("id").eq("subdomain", req.subdomain).maybeSingle();
  let clientId = existing?.id as string | undefined;
  if (!clientId) {
    const { data: ins, error } = await admin.from("clients")
      .insert({ subdomain: req.subdomain, event_type: eventType, template_key: req.template_key || "classic", owner_email: req.email, content })
      .select("id").single();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        const { data: dup } = await admin.from("clients").select("id").eq("subdomain", req.subdomain).single();
        clientId = dup?.id as string | undefined;
      }
      if (!clientId) throw error;
    } else {
      clientId = ins!.id as string;
    }
  }

  // Provision the owner auth user (random throwaway password; they set their own
  // via the recovery link) + owner profile. Idempotent on re-run.
  let userId: string | undefined;
  const throwaway = crypto.randomUUID() + "Aa1!";
  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email: req.email, password: throwaway, email_confirm: true });
  if (cErr) {
    userId = await findUserByEmail(admin, req.email);
    if (!userId) throw new Error("could not create or find owner auth user: " + cErr.message);
  } else {
    userId = created!.user!.id;
  }
  const { error: pErr } = await admin.from("profiles").upsert({ id: userId, role: "owner", client_id: clientId });
  if (pErr) throw new Error("owner profile upsert failed: " + pErr.message);

  // Set-your-password link (recovery) that lands on the new site's /set-password.
  const siteUrl = `https://${req.subdomain}.celebrately.us`;
  const { data: link, error: lErr } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: req.email,
    options: { redirectTo: `${siteUrl}/set-password` },
  });
  if (lErr) throw new Error("could not generate set-password link: " + lErr.message);
  const actionLink = (link as { properties?: { action_link?: string } })?.properties?.action_link || `${siteUrl}/set-password`;

  await sendApprovalEmail(req.email, req.partner_a, siteUrl, actionLink);

  const { error: sErr } = await admin.from("site_requests").update({ status: "approved" }).eq("id", req.id);
  if (sErr) throw new Error("could not mark request approved: " + sErr.message);
}

async function findUserByEmail(admin: SupabaseClient, email: string): Promise<string | undefined> {
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data: list, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const hit = list.users.find((x) => x.email === email);
    if (hit) return hit.id;
    if (list.users.length < perPage) return undefined;
  }
}

async function sendApprovalEmail(to: string, name: string, siteUrl: string, actionLink: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY not set on the edge function");
  const from = Deno.env.get("RESEND_FROM") || "Celebrately <noreply@send.celebrately.us>";
  const first = (name || "there").split(/\s+/)[0];
  const html = `
  <div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#2a2a2a">
    <h1 style="font-size:22px;color:#4b5320;margin:0 0 8px">Your website is ready, ${escapeHtml(first)}! 🎉</h1>
    <p style="font-size:15px;line-height:1.6">Your Celebrately site has been approved and created. Two quick steps to get in:</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 6px"><strong>1. Set your password</strong></p>
    <p style="margin:0 0 20px"><a href="${actionLink}" style="display:inline-block;background:#4b5320;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;font-size:15px">Set your password</a></p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 6px"><strong>2. Visit your site</strong></p>
    <p style="margin:0 0 20px"><a href="${siteUrl}" style="color:#4b5320;font-weight:600">${siteUrl}</a></p>
    <p style="font-size:13px;color:#777;line-height:1.6">Sign in anytime at <a href="${siteUrl}/admin" style="color:#777">${siteUrl}/admin</a> with your email and the password you set. If you didn't request this, you can ignore this email.</p>
    <p style="font-size:13px;color:#aaa;margin-top:22px">— The Celebrately team</p>
  </div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: "Your Celebrately website is ready 🎉", html }),
  });
  if (!res.ok) {
    let msg = `resend ${res.status}`;
    try { const e = await res.json(); if (e?.message) msg = e.message; } catch (_) { /* ignore */ }
    throw new Error("email send failed: " + msg);
  }
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));
}
