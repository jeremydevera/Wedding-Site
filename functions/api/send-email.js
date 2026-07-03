// Cloudflare Pages Function — POST /api/send-email
// Sends an HTML email via Resend. Body: { to, subject, html }. Needs
// RESEND_API_KEY (Pages secret); from address is RESEND_FROM or
// noreply@send.celebrately.us. Scoped to /api/* in public/_routes.json.
//
// Locked down: the caller must be a real owner or superadmin (a valid session is
// NOT enough — self-signups get role 'guest' and are refused), and each account
// is capped to RATE_LIMIT sends per rolling hour as a backstop against a stolen
// account. Together these stop the "anyone can send mail from our domain" abuse.

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RATE_LIMIT = 40;             // max sends per caller...
const RATE_WINDOW_MS = 60 * 60 * 1000; // ...per rolling hour

export async function onRequestPost(context) {
  const { request, env } = context;

  // 1. Require a valid Supabase session.
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "unauthorized" }, 401);
  const SUPABASE_URL = env.SUPABASE_URL || "https://xprynknppsehuzqqdvue.supabase.co";
  const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwcnlua25wcHNlaHV6cXFkdnVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwODg1OTUsImV4cCI6MjA5NzY2NDU5NX0._S3xdNXBm6d4SI8MO0MNoZ3bT8uspEd8lrdVm29Efgo";
  const authHeaders = { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` };
  let uid;
  try {
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: authHeaders });
    if (!who.ok) return json({ error: "unauthorized" }, 401);
    const user = await who.json();
    uid = user && user.id;
  } catch { return json({ error: "auth check failed" }, 502); }
  if (!uid) return json({ error: "unauthorized" }, 401);

  // 1b. Require an owner/superadmin role — a plain signed-in account is NOT enough.
  //     New self-signups get role 'guest', so this blocks the open-relay abuse.
  let role = null;
  try {
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}&select=role`, { headers: authHeaders });
    const rows = await pr.json();
    if (Array.isArray(rows) && rows[0]) role = rows[0].role;
  } catch { return json({ error: "permission check failed" }, 502); }
  if (role !== "owner" && role !== "superadmin") return json({ error: "You don't have permission to send email." }, 403);

  // 1c. Rate limit: refuse if this account already sent RATE_LIMIT in the last hour.
  //     Best-effort — a counting failure must not block a legitimate send.
  try {
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const cr = await fetch(`${SUPABASE_URL}/rest/v1/email_send_log?user_id=eq.${uid}&sent_at=gte.${since}&select=id`,
      { headers: { ...authHeaders, Prefer: "count=exact", Range: "0-0" } });
    const total = parseInt(((cr.headers.get("content-range") || "").split("/")[1] || "0"), 10) || 0;
    if (total >= RATE_LIMIT) return json({ error: "You've sent a lot of email in the last hour. Please wait a bit and try again." }, 429);
  } catch { /* counting unavailable — allow the send rather than block the owner */ }

  if (!env.RESEND_API_KEY) return json({ error: "Email isn't configured yet (missing RESEND_API_KEY)." }, 503);

  // 2. Validate the payload.
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const to = String(b.to || "").trim();
  if (!EMAIL_RE.test(to)) return json({ error: "Enter a valid email address." }, 400);
  const subject = String(b.subject || "RSVP results").slice(0, 200);
  const html = String(b.html || "");
  if (!html) return json({ error: "empty body" }, 400);
  const from = env.RESEND_FROM || "Celebrately <noreply@send.celebrately.us>";
  // Optional file attachments: [{ filename, content(base64) }]. Cap count/name.
  const attachments = Array.isArray(b.attachments)
    ? b.attachments.filter((a) => a && a.filename && a.content).slice(0, 5)
        .map((a) => ({ filename: String(a.filename).slice(0, 200), content: String(a.content) }))
    : [];

  // 3. Send via Resend.
  let res;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html, ...(attachments.length ? { attachments } : {}) }),
    });
  } catch (e) { return json({ error: "send failed: " + String(e && e.message || e) }, 502); }
  if (!res.ok) {
    let msg = `send failed (${res.status})`;
    try { const e = await res.json(); if (e && e.message) msg = e.message; } catch (_) {}
    return json({ error: msg }, 502);
  }
  const data = await res.json().catch(() => ({}));
  // Record the send for the rate limit (best-effort; never fail the response on this).
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/email_send_log`, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: uid }),
    });
  } catch { /* ignore */ }
  return json({ ok: true, id: data && data.id });
}
