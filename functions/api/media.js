// functions/api/media.js
// Cloudflare Pages Function — GET /api/media?clientId=<id>&type=image|audio
// Auth-gated listing of the client's existing R2 media (binding: env.MEDIA).
// Mirrors functions/api/upload.js auth + key conventions. Returns bare keys the
// caller renders via mediaUrl(); no file bodies. Scoped to /api/* via _routes.json.

const TYPES = new Set(["image", "audio"]);

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

// Mirror of src/lib/mediaLibrary.js (kept inline so the Function stays
// self-contained, matching upload.js). Change both together.
function fileNameFromKey(key) {
  const seg = String(key || "").split("/").pop() || "";
  return seg.replace(/^([0-9a-f]{8}|[0-9]{9,})-/i, "");
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.MEDIA) return json({ error: "storage not configured" }, 503);

  const SUPABASE_URL = env.SUPABASE_URL || "https://xprynknppsehuzqqdvue.supabase.co";
  const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwcnlua25wcHNlaHV6cXFkdnVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwODg1OTUsImV4cCI6MjA5NzY2NDU5NX0._S3xdNXBm6d4SI8MO0MNoZ3bT8uspEd8lrdVm29Efgo";

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

  const url = new URL(request.url);
  const clientId = String(url.searchParams.get("clientId") || "shared").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) || "shared";
  const typeParam = String(url.searchParams.get("type") || "image");
  const type = TYPES.has(typeParam) ? typeParam : "image";
  const prefix = `${clientId}/owner/${type}/`;

  const objects = [];
  try {
    let cursor;
    do {
      const page = await env.MEDIA.list({ prefix, cursor });
      for (const o of page.objects || []) objects.push(o);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  } catch (e) {
    return json({ error: "list failed", detail: String(e && e.message || e) }, 500);
  }

  const items = objects
    .map((o) => ({ key: o.key, name: fileNameFromKey(o.key), size: o.size, uploaded: o.uploaded }))
    .sort((a, b) => new Date(b.uploaded).getTime() - new Date(a.uploaded).getTime());

  return json({ items });
}
