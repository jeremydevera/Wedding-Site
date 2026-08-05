// functions/api/rsvp-match.js — Cloudflare Pages Function — POST /api/rsvp-match
//
// Strict-RSVP single-name lookup for the public form. Body is either:
//   { clientId, name }      -> match the typed name against the guest list
//   { clientId, guestId }   -> resolve the guest chosen in the ambiguity dialog
//
// WHY A FUNCTION AND NOT THE DATA API: these two SQL functions are new, and the
// Neon Data API (PostgREST) caches the schema PER INSTANCE behind a load
// balancer. After repeated `NOTIFY pgrst, 'reload schema'` the RPCs still
// answered 404 on roughly one request in three for many minutes, which would
// have failed that share of real guests. A direct Postgres connection has no
// schema cache, so it is deterministic from the first request.
//
// The SQL functions are SECURITY DEFINER, scoped to the given client AND gated
// on that client's strictRsvp flag, so a caller cannot read another client's
// guests, and the ambiguous branch returns names only — no seats, phone, email.
import { neon } from "@neondatabase/serverless";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.NEON_DATABASE_URL) return json({ status: "not_found", error: "server not configured" }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ status: "not_found", error: "bad request" }, 400); }

  const clientId = String(body?.clientId || "");
  if (!UUID.test(clientId)) return json({ status: "not_found" }, 400);

  const sql = neon(env.NEON_DATABASE_URL);
  try {
    if (body.guestId) {
      const guestId = String(body.guestId);
      if (!UUID.test(guestId)) return json({ status: "not_found" }, 400);
      const [row] = await sql.query("select public.rsvp_guest_pick($1::uuid, $2::uuid) as r", [clientId, guestId]);
      return json(row?.r || { status: "not_found" });
    }
    // Cap the length so a pathological input can't turn into a huge tokenise.
    const name = String(body?.name || "").slice(0, 120);
    if (!name.trim()) return json({ status: "too_vague" });
    const [row] = await sql.query("select public.rsvp_guest_match($1::uuid, $2::text) as r", [clientId, name]);
    return json(row?.r || { status: "not_found" });
  } catch (e) {
    // Fail CLOSED: the caller treats a non-ok status as "cannot verify" and
    // blocks the RSVP rather than letting an unverified guest through.
    return json({ status: "error" }, 502);
  }
}
