// Cloudflare Pages Function — POST /api/send-email
// Sends an HTML email via Resend. Body: { to, subject, html }. Needs
// RESEND_API_KEY (Pages secret); from address is RESEND_FROM or
// noreply@send.celebrately.us. Scoped to /api/* in public/_routes.json.
//
// Locked down: the caller must be a real owner or superadmin. Accepts EITHER a
// Supabase session OR a Firebase ID token (Neon clients, post-cutover) — role is
// read from the matching backend. Each account is capped to RATE_LIMIT sends per
// rolling hour (logged in Supabase or Neon email_send_log per backend) as a
// backstop against a stolen account.
import { neon } from "@neondatabase/serverless";

const FIREBASE_API_KEY = "AIzaSyC4zUcZH06Te0CQLwn9r3VdAeb3Rcf4K0k";
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RATE_LIMIT = 40;             // max sends per caller...
const RATE_WINDOW_MS = 60 * 60 * 1000; // ...per rolling hour

async function firebaseUid(apiKey, token) {
  try {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: token }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return (d && d.users && d.users[0] && d.users[0].localId) || null;
  } catch { return null; }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "unauthorized" }, 401);
  const SUPABASE_URL = env.SUPABASE_URL || "https://xprynknppsehuzqqdvue.supabase.co";
  const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwcnlua25wcHNlaHV6cXFkdnVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwODg1OTUsImV4cCI6MjA5NzY2NDU5NX0._S3xdNXBm6d4SI8MO0MNoZ3bT8uspEd8lrdVm29Efgo";
  const authHeaders = { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` };

  // 1. Identify the caller + role. Try Supabase first; a confirmed Supabase user's
  //    profile is authoritative (fail closed). Otherwise verify a Firebase token
  //    and read the role from Neon. backend picks where the rate-limit log lives.
  let uid = null, role = null, backend = null;
  try {
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: authHeaders });
    if (who.ok) { const user = await who.json(); uid = (user && user.id) || null; }
  } catch { return json({ error: "auth check failed" }, 502); }
  if (uid) {
    backend = "supabase";
    try {
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}&select=role`, { headers: authHeaders });
      const rows = await pr.json();
      if (Array.isArray(rows) && rows[0]) role = rows[0].role;
    } catch { return json({ error: "permission check failed" }, 502); }
  } else if (env.NEON_DATABASE_URL) {
    const fb = await firebaseUid(env.FIREBASE_API_KEY || FIREBASE_API_KEY, token);
    if (fb) {
      backend = "firebase"; uid = fb;
      try {
        const sql = neon(env.NEON_DATABASE_URL);
        const rows = await sql`select role from profiles where id = ${fb}`;
        role = rows && rows[0] ? rows[0].role : null;
      } catch { return json({ error: "permission check failed" }, 502); }
    }
  }
  if (!uid) return json({ error: "unauthorized" }, 401);
  if (role !== "owner" && role !== "superadmin") return json({ error: "You don't have permission to send email." }, 403);

  // 1c. Rate limit (best-effort) — count this hour's sends in the caller's backend.
  try {
    if (backend === "firebase") {
      const sql = neon(env.NEON_DATABASE_URL);
      const rows = await sql`select count(*)::int as n from email_send_log where user_id = ${uid} and sent_at > now() - interval '1 hour'`;
      if ((rows[0]?.n || 0) >= RATE_LIMIT) return json({ error: "You've sent a lot of email in the last hour. Please wait a bit and try again." }, 429);
    } else {
      const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
      const cr = await fetch(`${SUPABASE_URL}/rest/v1/email_send_log?user_id=eq.${uid}&sent_at=gte.${since}&select=id`,
        { headers: { ...authHeaders, Prefer: "count=exact", Range: "0-0" } });
      const total = parseInt(((cr.headers.get("content-range") || "").split("/")[1] || "0"), 10) || 0;
      if (total >= RATE_LIMIT) return json({ error: "You've sent a lot of email in the last hour. Please wait a bit and try again." }, 429);
    }
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
    if (backend === "firebase") {
      const sql = neon(env.NEON_DATABASE_URL);
      await sql`insert into email_send_log (user_id) values (${uid})`;
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/email_send_log`, {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ user_id: uid }),
      });
    }
  } catch { /* ignore */ }
  return json({ ok: true, id: data && data.id });
}
