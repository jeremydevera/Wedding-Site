// functions/api/_site-ready-email.js
// "Your site is live" email — the ONE place this message is built and sent.
//
// Why shared: a site goes live down two different paths and the owner needs the
// same email either way —
//   1. auto-approve ON  → register_site creates the client during registration,
//      so the browser (Register.jsx) asks /api/site-ready to send it;
//   2. auto-approve OFF → the superadmin approves later, when the owner isn't in
//      a browser at all, so neon-admin.js sends it server-side from
//      approve_request.
// Before this existed neither path emailed anything: approveSiteRequest dropped
// the old setup email when owners started setting their own password at signup,
// so a client's site went live and nobody told them the address.
//
// 🔴 The recipient ALWAYS comes from the clients row, never from a request body.
// /api/site-ready is reachable by any signed-in user, so accepting a caller's
// address would make it an open relay for sending Celebrately-branded mail.

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function siteUrl(subdomain) { return `https://${subdomain}.celebrately.us`; }

// Plain, factual, and mobile-first: a big link to the site, a second link to the
// admin, and the three things they'll want to do first. No images — an image-only
// email is what gets filtered, and this one has to arrive.
export function siteReadyHtml({ subdomain, names }) {
  const url = siteUrl(subdomain);
  const who = names ? `${esc(names)}, ` : "";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f5f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f2;padding:28px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #e8e5dd;border-radius:14px;padding:28px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif;color:#1f2937">
<tr><td>
<p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8b8578">Celebrately</p>
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#111827">Your website is live 🎉</h1>
<p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#374151">${who}your site is ready to share with your guests:</p>
<p style="margin:0 0 22px"><a href="${url}" style="display:inline-block;font-size:17px;font-weight:700;color:#1E5BD6;text-decoration:none;word-break:break-all">${esc(subdomain)}.celebrately.us</a></p>
<p style="margin:0 0 22px"><a href="${url}/admin" style="display:inline-block;background:#1E5BD6;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px">Open your dashboard</a></p>
<p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#111827">What to do first</p>
<ul style="margin:0 0 20px;padding-left:20px;font-size:14px;line-height:1.7;color:#374151">
<li>Add your photos and your story</li>
<li>Check the date, venue and schedule</li>
<li>Send the link to your guests — RSVPs land in your dashboard</li>
</ul>
<p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280">Keep this email — it has your site address and dashboard link. Just reply if you need a hand.</p>
</td></tr></table></td></tr></table></body></html>`;
}

// Claim-then-send. The marker is written FIRST, and only if it isn't already
// there, so two concurrent calls (a double-tap on the browser path racing the
// superadmin path) can't both win — the second update matches no row and skips.
// If the send then fails, the marker is cleared so a later retry can send.
// The marker lives in clients.content rather than its own column so this needs no
// migration on any shard.
const MARK = "sysSiteEmailAt";

export async function sendSiteReadyEmail(env, sql, client) {
  const { id, email, subdomain } = client || {};
  if (!id || !subdomain) return { skipped: "no client" };
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { skipped: "no email on file" };
  if (!env.RESEND_API_KEY) return { skipped: "RESEND_API_KEY not configured" };

  const claimed = await sql`
    update clients
       set content = jsonb_set(coalesce(content, '{}'::jsonb), ${"{" + MARK + "}"}, to_jsonb(now()::text))
     where id = ${id} and (content->>${MARK}) is null
    returning id`;
  if (!claimed || !claimed.length) return { skipped: "already sent" };

  const names = [client.partner_a, client.partner_b].filter(Boolean).join(" & ");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.RESEND_FROM || "Celebrately <noreply@send.celebrately.us>",
        to: [email],
        subject: "Your Celebrately website is live",
        html: siteReadyHtml({ subdomain, names }),
      }),
    });
    if (!res.ok) {
      let msg = `resend ${res.status}`;
      try { const e = await res.json(); if (e && e.message) msg = e.message; } catch (_) {}
      throw new Error(msg);
    }
    return { sent: true, to: email };
  } catch (e) {
    // Release the claim so this isn't permanently marked as sent after a failure.
    try { await sql`update clients set content = content - ${MARK} where id = ${id}`; } catch (_) { /* ignore */ }
    return { error: String((e && e.message) || e) };
  }
}
