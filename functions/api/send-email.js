// Cloudflare Pages Function — POST /api/send-email
// Auth-gated (valid Supabase session — admins only). Sends an HTML email via
// Resend. Body: { to, subject, html }. Needs RESEND_API_KEY (Pages secret);
// from address is RESEND_FROM or noreply@send.celebrately.us. Scoped to /api/*
// in public/_routes.json so the SPA is untouched.

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function onRequestPost(context) {
  const { request, env } = context;

  // 1. Require a valid Supabase session.
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "unauthorized" }, 401);
  const SUPABASE_URL = env.SUPABASE_URL || "https://xprynknppsehuzqqdvue.supabase.co";
  const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwcnlua25wcHNlaHV6cXFkdnVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwODg1OTUsImV4cCI6MjA5NzY2NDU5NX0._S3xdNXBm6d4SI8MO0MNoZ3bT8uspEd8lrdVm29Efgo";
  try {
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
    if (!who.ok) return json({ error: "unauthorized" }, 401);
  } catch { return json({ error: "auth check failed" }, 502); }

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

  // 3. Send via Resend.
  let res;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
  } catch (e) { return json({ error: "send failed: " + String(e && e.message || e) }, 502); }
  if (!res.ok) {
    let msg = `send failed (${res.status})`;
    try { const e = await res.json(); if (e && e.message) msg = e.message; } catch (_) {}
    return json({ error: msg }, 502);
  }
  const data = await res.json().catch(() => ({}));
  return json({ ok: true, id: data && data.id });
}
