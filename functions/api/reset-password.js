// Cloudflare Pages Function — POST /api/reset-password  { email }
// Sends the password-reset email from OUR authenticated domain (Resend /
// send.celebrately.us) instead of Firebase's default noreply@firebaseapp.com
// sender (which lands in spam). Flow: use the Firebase Admin service account to
// GENERATE the reset link (accounts:sendOobCode returnOobLink:true — no Firebase
// email is sent), then deliver that link via Resend with a branded template.
// Returns { sent } | { notFound } | { error }. A per-email cooldown (Neon
// reset_throttle) blocks resend loops so this isn't an open mail relay.
import { neon } from "@neondatabase/serverless";

const FIREBASE_PROJECT = "wedding-dc35d";
const COOLDOWN_SECONDS = 60;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Mint a Google access token from the scoped service-account key (Web Crypto).
async function saToken(env) {
  if (!env.FIREBASE_SA_KEY) return null;
  const sa = JSON.parse(atob(env.FIREBASE_SA_KEY));
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const signingInput = enc({ alg: "RS256", typ: "JWT" }) + "." + enc({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const tr = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signingInput + "." + b64url(sig) }) });
  if (!tr.ok) return null;
  return (await tr.json()).access_token || null;
}

function emailHtml(link) {
  return `<!doctype html><html><body style="margin:0;background:#f6f5f2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2b2b2b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f2;padding:32px 0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid #eceae4">
      <tr><td style="padding:30px 34px 6px">
        <div style="font-weight:800;font-size:20px;letter-spacing:-.01em;color:#1b1b1b">Celebrately<span style="color:#e97c5d">.</span></div>
      </td></tr>
      <tr><td style="padding:14px 34px 4px">
        <h1 style="margin:0 0 8px;font-size:22px;color:#1b1b1b">Reset your password</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#555">We received a request to reset your Celebrately password. Tap the button below to choose a new one. This link expires in about an hour.</p>
        <a href="${link}" style="display:inline-block;background:#e97c5d;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:10px">Reset my password</a>
        <p style="margin:22px 0 0;font-size:13px;line-height:1.5;color:#8a8577">If the button doesn't work, copy this link into your browser:<br><a href="${link}" style="color:#e97c5d;word-break:break-all">${link}</a></p>
      </td></tr>
      <tr><td style="padding:22px 34px 30px">
        <p style="margin:0;font-size:12.5px;line-height:1.5;color:#a7a297;border-top:1px solid #eceae4;padding-top:16px">Didn't request this? You can safely ignore this email — your password won't change.</p>
      </td></tr>
    </table>
    <p style="margin:16px 0 0;font-size:11.5px;color:#b4afa4">Celebrately · celebrately.us</p>
  </td></tr></table></body></html>`;
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const addr = String(body.email || "").trim().toLowerCase();
  if (!addr || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return json({ error: "Enter a valid email address." }, 400);

  const at = await saToken(env);
  if (!at) return json({ error: "reset service unavailable" }, 503);

  // 1. Generate the reset link via Firebase Admin (no Firebase email is sent).
  //    A missing account returns EMAIL_NOT_FOUND → surface { notFound }.
  const gen = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT}/accounts:sendOobCode`, {
    method: "POST",
    headers: { authorization: "Bearer " + at, "content-type": "application/json" },
    body: JSON.stringify({ requestType: "PASSWORD_RESET", email: addr, returnOobLink: true }),
  });
  if (!gen.ok) {
    let msg = ""; try { msg = (await gen.json())?.error?.message || ""; } catch { /* ignore */ }
    if (/EMAIL_NOT_FOUND/i.test(msg)) return json({ notFound: true });
    return json({ error: "Couldn't start the reset. Please try again." }, 502);
  }
  const link = (await gen.json()).oobLink;
  if (!link) return json({ error: "Couldn't start the reset. Please try again." }, 502);

  // 2. Per-email cooldown (only real accounts reach here) — skip the send if one
  //    went out within COOLDOWN_SECONDS, but still report success (no resend spam).
  if (env.NEON_DATABASE_URL) {
    try {
      const sql = neon(env.NEON_DATABASE_URL);
      const rows = await sql`
        insert into reset_throttle (email, last_sent) values (${addr}, now())
        on conflict (email) do update set last_sent = now()
        where reset_throttle.last_sent < now() - (${COOLDOWN_SECONDS} || ' seconds')::interval
        returning email`;
      if (rows.length === 0) return json({ sent: true }); // within cooldown — don't resend
    } catch { /* throttle store down → still send (fail open) */ }
  }

  // 3. Deliver the link from our authenticated domain via Resend.
  if (!env.RESEND_API_KEY) return json({ error: "email service unavailable" }, 503);
  const from = "Celebrately <noreply@send.celebrately.us>";
  const send = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [addr], subject: "Reset your Celebrately password", html: emailHtml(link) }),
  });
  if (!send.ok) return json({ error: "Couldn't send the reset email. Please try again." }, 502);
  return json({ sent: true });
}
