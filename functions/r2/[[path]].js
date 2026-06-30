// Cloudflare Pages Function — GET /r2/<key>
// Serves objects back from the R2 bucket (binding: env.MEDIA) on the same
// origin, so we don't need a public bucket or a custom media domain. Long
// immutable cache since keys are timestamped (content never changes per key).

export async function onRequestGet(context) {
  const { params, env } = context;
  if (!env.MEDIA) return new Response("storage not configured", { status: 503 });

  const key = Array.isArray(params.path) ? params.path.join("/") : String(params.path || "");
  if (!key) return new Response("not found", { status: 404 });

  const obj = await env.MEDIA.get(key);
  if (!obj || !obj.body) return new Response("not found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
}
