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

  // 2. Read the file from the multipart body.
  let form;
  try { form = await request.formData(); } catch { return json({ error: "bad form" }, 400); }
  const file = form.get("file");
  if (!file || typeof file === "string") return json({ error: "no file" }, 400);
  if (file.size > MAX_BYTES) return json({ error: "file too large (max 25MB)" }, 413);
  const type = file.type || "application/octet-stream";
  if (!TYPE_OK.test(type)) return json({ error: "unsupported file type" }, 415);

  // 3. Build a safe key: <clientId>/<kind>/<ts>-<name>.
  const clientId = String(form.get("clientId") || "shared").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) || "shared";
  const kind = String(form.get("kind") || "misc").replace(/[^a-z0-9]/gi, "").slice(0, 24) || "misc";
  const safeName = String(file.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const key = `${clientId}/${kind}/${Date.now()}-${safeName}`;

  // 4. Store in R2.
  try {
    await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: type } });
  } catch (e) {
    return json({ error: "upload failed", detail: String(e && e.message || e) }, 500);
  }

  return json({ url: `/r2/${key}`, key });
}
