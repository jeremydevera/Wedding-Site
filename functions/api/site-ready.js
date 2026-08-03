// functions/api/site-ready.js
// POST /api/site-ready — "my site just went live, email me the link".
// Used by the AUTO-APPROVE path only: register_site creates the client inside
// Postgres during registration, so there is no server-side JS moment to hook —
// the browser asks for the email instead. The superadmin-approval path doesn't
// come through here; neon-admin.js sends it directly (the owner isn't present).
//
// Gate: a valid Firebase ID token, and the email goes to the address on the
// caller's OWN client row — the body is ignored entirely. So the worst a signed-in
// user can do is re-request their own email, which the idempotency marker in
// _site-ready-email.js already collapses to one send.
import { neon } from "@neondatabase/serverless";
import { sendSiteReadyEmail } from "./_site-ready-email.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

const FIREBASE_API_KEY = "AIzaSyC4zUcZH06Te0CQLwn9r3VdAeb3Rcf4K0k";
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
  if (!env.NEON_DATABASE_URL) return json({ error: "NEON_DATABASE_URL not configured" }, 500);

  const uid = await firebaseUid(env.FIREBASE_API_KEY || FIREBASE_API_KEY, token);
  if (!uid) return json({ error: "unauthorized" }, 401);

  const sql = neon(env.NEON_DATABASE_URL);
  let rows;
  try {
    // The caller's own client, via their profile — nothing here is caller-supplied.
    rows = await sql`
      select c.id, c.subdomain, c.owner_email as email,
             c.content->>'partnerA' as partner_a, c.content->>'partnerB' as partner_b
        from profiles p join clients c on c.id = p.client_id
       where p.id = ${uid} limit 1`;
  } catch (e) {
    return json({ error: "lookup failed" }, 502);
  }
  if (!rows || !rows.length) return json({ error: "no site for this account" }, 404);

  const out = await sendSiteReadyEmail(env, sql, rows[0]);
  // A failed send must not read as a failed registration — the caller fires this
  // best-effort and the site is already live either way.
  return json({ ok: true, ...out });
}
