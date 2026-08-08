// functions/api/client-email.js — Cloudflare Pages Function — /api/client-email
//
// Superadmin <-> client email, kept as a THREAD per client.
//   GET  /api/client-email?clientId=...   -> { messages: [...] } oldest first
//   POST /api/client-email {clientId, subject, body}  -> sends via Resend and
//        records it, so the conversation is visible in the superadmin console.
//
// Every message is stored in public.client_emails with direction 'out' | 'in'.
// Inbound replies are not wired yet — the domain has NO MX records, so replies
// currently go nowhere; see the note in the superadmin UI. When inbound lands,
// it writes rows with direction 'in' and this endpoint needs no change.
//
// Gated to superadmins exactly like /api/cf-health: a Firebase ID token is
// resolved to a uid, and the role is read from Neon profiles. Fails closed.
import { neon } from "@neondatabase/serverless";

const FIREBASE_API_KEY = "AIzaSyC4zUcZH06Te0CQLwn9r3VdAeb3Rcf4K0k";
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function requireSuperadmin(env, request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401 };
  const uid = await firebaseUid(env.FIREBASE_API_KEY || FIREBASE_API_KEY, token);
  if (!uid) return { ok: false, status: 401 };
  try {
    const sql = neon(env.NEON_DATABASE_URL);
    const rows = await sql`select 1 from profiles where id = ${uid} and role = 'superadmin' limit 1`;
    if (!rows || !rows[0]) return { ok: false, status: 403 };
  } catch { return { ok: false, status: 502 }; }
  return { ok: true, uid };
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.NEON_DATABASE_URL) return json({ error: "server not configured" }, 500);
  const gate = await requireSuperadmin(env, request);
  if (!gate.ok) return json({ error: "unauthorized" }, gate.status);

  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  if (!UUID.test(clientId)) return json({ error: "bad clientId" }, 400);
  const sql = neon(env.NEON_DATABASE_URL);
  const messages = await sql`
    select id, direction, from_email, to_email, subject, body, created_at
    from client_emails where client_id = ${clientId}
    order by created_at asc limit 200`;
  return json({ messages });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.NEON_DATABASE_URL) return json({ error: "server not configured" }, 500);
  const gate = await requireSuperadmin(env, request);
  if (!gate.ok) return json({ error: "unauthorized" }, gate.status);
  if (!env.RESEND_API_KEY) return json({ error: "Email isn't configured yet (missing RESEND_API_KEY)." }, 503);

  let b;
  try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const clientId = String(b.clientId || "");
  if (!UUID.test(clientId)) return json({ error: "bad clientId" }, 400);
  const subject = String(b.subject || "").trim().slice(0, 200) || "A message about your Celebrately site";
  const body = String(b.body || "").trim().slice(0, 20000);
  if (!body) return json({ error: "Write a message first." }, 400);

  const sql = neon(env.NEON_DATABASE_URL);
  const [client] = await sql`select subdomain, owner_email from clients where id = ${clientId}`;
  if (!client) return json({ error: "client not found" }, 404);
  const to = String(client.owner_email || "").trim();
  if (!EMAIL_RE.test(to)) return json({ error: "This client has no login email on file." }, 400);

  const from = env.RESEND_FROM || "Celebrately <noreply@send.celebrately.us>";
  // Replies should reach a human even though threading isn't wired: point them
  // at the platform inbox when one is configured, else the sender.
  const replyTo = env.SUPPORT_REPLY_TO || "";
  const html = `<div style="font:15px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#24201c">
    ${esc(body).replace(/\n/g, "<br>")}
    <hr style="border:0;border-top:1px solid #eee;margin:22px 0 10px">
    <p style="font-size:12px;color:#8a8178;margin:0">Celebrately · ${esc(client.subdomain)}.celebrately.us</p>
  </div>`;

  let providerId = null;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return json({ error: out?.message || `Send failed (${res.status})` }, 502);
    providerId = out?.id || null;
  } catch (e) {
    return json({ error: "Couldn't reach the email service." }, 502);
  }

  // Record only AFTER the provider accepted it, so the thread never shows a
  // message that was never actually sent.
  const [row] = await sql`
    insert into client_emails (client_id, direction, from_email, to_email, subject, body, provider_id, sent_by)
    values (${clientId}, 'out', ${from}, ${to}, ${subject}, ${body}, ${providerId}, ${gate.uid})
    returning id, direction, from_email, to_email, subject, body, created_at`;
  return json({ ok: true, message: row });
}
