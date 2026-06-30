// Cloudflare Pages Function — POST /api/upload
// Auth-gated upload to the R2 bucket (binding: env.MEDIA). Only a logged-in
// admin (valid Supabase session) may upload; guests are anonymous (no token),
// so this also blocks the public. Returns a same-origin URL ("/r2/<key>")
// served back by functions/r2/[[path]].js — no public bucket / custom domain
// needed. Scoped to /api/* via public/_routes.json so the SPA is untouched.

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file
const TYPE_OK = /^(audio\/|image\/|video\/)/;
const SCOPES = new Set(["owner", "guest"]);
const PURPOSES = new Set(["hero", "attire", "story", "frame", "envbg", "playlist", "gallery", "message", "misc"]);

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.MEDIA) return json({ error: "storage not configured" }, 503);

  // Public anon values (already shipped in the client bundle) — fall back to
  // these so the Function's auth check works without runtime env vars set.
  const SUPABASE_URL = env.SUPABASE_URL || "https://xprynknppsehuzqqdvue.supabase.co";
  const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwcnlua25wcHNlaHV6cXFkdnVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwODg1OTUsImV4cCI6MjA5NzY2NDU5NX0._S3xdNXBm6d4SI8MO0MNoZ3bT8uspEd8lrdVm29Efgo";

  // 1. Require a valid Supabase session (verify the bearer token with Supabase).
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "unauthorized" }, 401);
  try {
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    });
    if (!who.ok) return json({ error: "unauthorized" }, 401);
  } catch {
    return json({ error: "auth check failed" }, 502);
  }

  // 2. Read the body. Either a multipart "file", or a "sourceUrl" to fetch
  //    server-side (used by the one-time migration to pull existing media in
  //    without hitting browser CORS).
  let form;
  try { form = await request.formData(); } catch { return json({ error: "bad form" }, 400); }
  const clientId = String(form.get("clientId") || "shared").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) || "shared";
  const scope = SCOPES.has(String(form.get("scope") || "")) ? String(form.get("scope")) : "owner";
  const purpose = PURPOSES.has(String(form.get("purpose") || "")) ? String(form.get("purpose")) : "misc";

  let body, type, name;
  const file = form.get("file");
  const sourceUrl = form.get("sourceUrl");
  if (file && typeof file !== "string") {
    if (file.size > MAX_BYTES) return json({ error: "file too large (max 25MB)" }, 413);
    type = file.type || "application/octet-stream";
    name = file.name || "file";
    body = file.stream();
  } else if (typeof sourceUrl === "string" && /^https:\/\//.test(sourceUrl)) {
    let src;
    try { src = await fetch(sourceUrl); } catch { return json({ error: "source fetch failed" }, 502); }
    if (!src.ok) return json({ error: "source not reachable" }, 502);
    const len = Number(src.headers.get("content-length") || 0);
    if (len && len > MAX_BYTES) return json({ error: "source too large (max 25MB)" }, 413);
    type = src.headers.get("content-type") || "application/octet-stream";
    name = (sourceUrl.split("/").pop() || "file").split("?")[0];
    body = src.body;
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
    return json({ error: "upload failed", detail: String(e && e.message || e) }, 500);
  }

  return json({ url: `/r2/${key}`, key });
}
