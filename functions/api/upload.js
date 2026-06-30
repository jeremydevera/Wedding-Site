// Cloudflare Pages Function — POST /api/upload
// Auth-gated upload to the R2 bucket (binding: env.MEDIA). Only a logged-in
// admin (valid Supabase session) may upload; guests are anonymous (no token),
// so this also blocks the public. Returns a same-origin URL ("/r2/<key>")
// served back by functions/r2/[[path]].js — no public bucket / custom domain
// needed. Scoped to /api/* via public/_routes.json so the SPA is untouched.

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file
const TYPE_OK = /^(audio\/|image\/)/;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.MEDIA) return json({ error: "storage not configured" }, 503);

  // 1. Require a valid Supabase session (verify the bearer token with Supabase).
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "unauthorized" }, 401);
  try {
    const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
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
  const kind = String(form.get("kind") || "misc").replace(/[^a-z0-9]/gi, "").slice(0, 24) || "misc";

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

  // 3. Build a safe key: <clientId>/<kind>/<ts>-<name>.
  const safeName = String(name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const key = `${clientId}/${kind}/${Date.now()}-${safeName}`;

  // 4. Store in R2.
  try {
    await env.MEDIA.put(key, body, { httpMetadata: { contentType: type } });
  } catch (e) {
    return json({ error: "upload failed", detail: String(e && e.message || e) }, 500);
  }

  return json({ url: `/r2/${key}`, key });
}
