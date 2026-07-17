// Cloudflare Pages Function — POST /api/upload
// Auth-gated upload to the R2 bucket (binding: env.MEDIA). Only a logged-in
// admin (valid Supabase session) may upload; guests are anonymous (no token),
// so this also blocks the public. Returns a same-origin URL ("/r2/<key>")
// served back by functions/r2/[[path]].js — no public bucket / custom domain
// needed. Scoped to /api/* via public/_routes.json so the SPA is untouched.

// One flat per-file cap for every media kind (owner decision 2026-07-10:
// keep storage + guest bandwidth predictable).
const CAP_ALL = 25 * 1024 * 1024; // 25 MB
const capFor = () => CAP_ALL;
const capLabel = (cap) => `${Math.round(cap / 1048576)}MB`;
const TYPE_OK = /^(audio\/|image\/|video\/)/;
const SCOPES = new Set(["owner", "guest"]);
const PURPOSES = new Set(["hero", "attire", "story", "frame", "envbg", "playlist", "trackart", "gallery", "message", "support", "donate", "misc"]);

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

// Resolve the caller's identity for tenant scoping. Verifies the bearer token,
// then reads their role + client_id from profiles. Returns { ok, status } on
// failure (fail CLOSED), or { ok:true, uid, role, clientId } — clientId is null
// for anyone not bound to a client (e.g. a bare 'guest' account). Mirror of
// functions/api/media.js resolveCaller — change both together.
async function resolveCaller(SUPABASE_URL, SUPABASE_ANON_KEY, token) {
  if (!token) return { ok: false, status: 401 };
  let uid;
  try {
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    });
    if (!who.ok) return { ok: false, status: 401 };
    const user = await who.json();
    uid = user && user.id;
  } catch { return { ok: false, status: 502 }; }
  if (!uid) return { ok: false, status: 401 };
  try {
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}&select=role,client_id`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    });
    if (!pr.ok) return { ok: false, status: 502 };
    const rows = await pr.json();
    const row = Array.isArray(rows) && rows[0];
    if (!row) return { ok: false, status: 403 };
    return { ok: true, uid, role: row.role, clientId: row.client_id || null };
  } catch { return { ok: false, status: 502 }; }
}

// SSRF allowlist for the server-side sourceUrl fetch. Only hosts we deliberately
// pull migration media from are permitted; everything else is denied (fail
// CLOSED). Covers the Supabase project + its storage subdomain and the media
// domain. Matches an exact host or a direct subdomain of an allowed suffix.
const SOURCE_HOST_SUFFIXES = [
  "xprynknppsehuzqqdvue.supabase.co", // Supabase project (auth/storage)
  "supabase.co",                      // *.supabase.co storage/render hosts
  "media.celebrately.us",             // our own media domain
];
function sourceHostAllowed(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h) return false;
  return SOURCE_HOST_SUFFIXES.some((suf) => h === suf || h.endsWith(`.${suf}`));
}

// Wrap a ReadableStream so it aborts (errors) once more than `max` bytes have
// flowed through — enforces the size cap even when the source omits a
// Content-Length. The R2 put() rejects when the stream errors, so no
// oversized object is committed.
function capStream(stream, max) {
  let total = 0;
  const ts = new TransformStream({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > max) {
        controller.error(new Error(`source too large (max ${capLabel(max)})`));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  return stream.pipeThrough(ts);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.MEDIA) return json({ error: "storage not configured" }, 503);

  // Public anon values (already shipped in the client bundle) — fall back to
  // these so the Function's auth check works without runtime env vars set.
  const SUPABASE_URL = env.SUPABASE_URL || "https://xprynknppsehuzqqdvue.supabase.co";
  const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwcnlua25wcHNlaHV6cXFkdnVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwODg1OTUsImV4cCI6MjA5NzY2NDU5NX0._S3xdNXBm6d4SI8MO0MNoZ3bT8uspEd8lrdVm29Efgo";

  // 1. Require a valid Supabase session AND resolve the caller's role + owned
  //    client so we can enforce tenant ownership below. Fail CLOSED on any
  //    unexpected state (no token / bad token / role lookup error).
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const who = await resolveCaller(SUPABASE_URL, SUPABASE_ANON_KEY, token);
  if (!who.ok) {
    return json(
      { error: who.status === 403 ? "forbidden" : who.status === 502 ? "auth check failed" : "unauthorized" },
      who.status,
    );
  }

  // 2. Read the body. Either a multipart "file", or a "sourceUrl" to fetch
  //    server-side (used by the one-time migration to pull existing media in
  //    without hitting browser CORS).
  let form;
  try { form = await request.formData(); } catch { return json({ error: "bad form" }, 400); }
  const clientId = String(form.get("clientId") || "shared").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) || "shared";
  const scope = SCOPES.has(String(form.get("scope") || "")) ? String(form.get("scope")) : "owner";
  const purpose = PURPOSES.has(String(form.get("purpose") || "")) ? String(form.get("purpose")) : "misc";

  // 2a. Caller must OWN the requested clientId — never trust the client-supplied
  //     value. Superadmin may write to any tenant (and to the "shared" prefix).
  //     An owner may only write under their own client id. Anyone else (a bare
  //     'guest' with no client_id, or a mismatched owner) is denied — fail CLOSED.
  if (who.role !== "superadmin") {
    if (!who.clientId) return json({ error: "forbidden" }, 403);
    if (clientId !== who.clientId) return json({ error: "forbidden" }, 403);
  }

  let body, type, name;
  const file = form.get("file");
  const sourceUrl = form.get("sourceUrl");
  if (file && typeof file !== "string") {
    const cap = capFor(file.type);
    if (file.size > cap) return json({ error: `file too large (max ${capLabel(cap)})` }, 413);
    type = file.type || "application/octet-stream";
    name = file.name || "file";
    body = file.stream();
  } else if (typeof sourceUrl === "string" && /^https:\/\//.test(sourceUrl)) {
    // SSRF guard: only fetch from an allowlisted host (fail CLOSED). Parse the
    // URL and reject anything not on the migration allowlist before egressing.
    let parsed;
    try { parsed = new URL(sourceUrl); } catch { return json({ error: "bad sourceUrl" }, 400); }
    if (parsed.protocol !== "https:" || !sourceHostAllowed(parsed.hostname)) {
      return json({ error: "source host not allowed" }, 403);
    }
    // Fetch with redirect:"manual" so a 3xx is NOT auto-followed — an allowlisted
    // host could redirect to an internal/arbitrary address, and the default
    // follower would egress there WITHOUT re-checking the allowlist (SSRF). Treat
    // any redirect as a failure; only a direct 2xx from an allowlisted host is
    // stored (fail CLOSED).
    let src;
    try { src = await fetch(sourceUrl, { redirect: "manual" }); } catch { return json({ error: "source fetch failed" }, 502); }
    if (src.status >= 300 && src.status < 400) return json({ error: "source redirect not allowed" }, 502);
    if (!src.ok) return json({ error: "source not reachable" }, 502);
    type = src.headers.get("content-type") || "application/octet-stream";
    const cap = capFor(type);
    const len = Number(src.headers.get("content-length") || 0);
    if (len && len > cap) return json({ error: `source too large (max ${capLabel(cap)})` }, 413);
    name = (sourceUrl.split("/").pop() || "file").split("?")[0];
    // Enforce the byte cap on the stream itself — a source that omits
    // Content-Length (len === 0) would otherwise bypass the check above and
    // stream unbounded into R2. capStream errors the put past the cap.
    body = src.body ? capStream(src.body, cap) : src.body;
  } else {
    return json({ error: "no file or sourceUrl" }, 400);
  }
  if (!TYPE_OK.test(type)) return json({ error: "unsupported file type" }, 415);

  // 3. Build a safe key: <clientId>/<scope>/<type>/<purpose>/<shortid>-<name>.
  //    Type segment is derived from the content type (never trusts the caller).
  const typeSeg = type.startsWith("audio/") ? "audio" : type.startsWith("video/") ? "video" : "image";
  const safeName = String(name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const shortid = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, "").slice(0, 8) : String(Date.now());
  const key = `${clientId}/${scope}/${typeSeg}/${purpose}/${shortid}-${safeName}`;

  // 4. Store in R2.
  try {
    await env.MEDIA.put(key, body, { httpMetadata: { contentType: type } });
  } catch (e) {
    const msg = String((e && e.message) || e);
    // capStream aborts the put once the source exceeds its cap; surface that
    // as 413 (payload too large) rather than a generic 500.
    if (/too large/i.test(msg)) return json({ error: msg }, 413);
    return json({ error: "upload failed", detail: msg }, 500);
  }

  return json({ url: `/r2/${key}`, key });
}
