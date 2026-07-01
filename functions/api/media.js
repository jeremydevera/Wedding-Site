// functions/api/media.js
// Cloudflare Pages Function — GET /api/media?type=image|audio
// Auth-gated global listing of R2 media by type across all clients (binding: env.MEDIA).
// Returns bare keys the caller renders via mediaUrl(). Scoped to /api/* via _routes.json.

const TYPES = new Set(["image", "audio"]);

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

// Mirror of src/lib/mediaLibrary.js (kept inline so the Function stays
// self-contained, matching upload.js). Change both together.
function fileNameFromKey(key) {
  const seg = String(key || "").split("/").pop() || "";
  return seg.replace(/^([0-9a-f]{8}|[0-9]{9,})-/i, "");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Verify the bearer token belongs to a superadmin. Returns { ok, status } —
// ok:true when the caller is a superadmin; otherwise ok:false with an HTTP status
// (401 no/invalid token, 403 not superadmin, 502 role lookup failed).
async function requireSuperadmin(SUPABASE_URL, SUPABASE_ANON_KEY, token) {
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
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}&select=role`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    });
    if (!pr.ok) return { ok: false, status: 502 };
    const rows = await pr.json();
    const role = Array.isArray(rows) && rows[0] && rows[0].role;
    if (role !== "superadmin") return { ok: false, status: 403 };
  } catch { return { ok: false, status: 502 }; }
  return { ok: true, uid };
}

// Fetch the stringified content of the given client UUIDs. Returns
// Map<clientId, { subdomain, content }> where content is JSON.stringify of the
// client's content column (so callers can substring-match a key). Non-UUID ids
// (e.g. "shared") are skipped. Throws on a failed lookup.
async function fetchClientsContent(SUPABASE_URL, SUPABASE_ANON_KEY, token, clientIds) {
  const ids = [...new Set((clientIds || []).filter((c) => UUID_RE.test(c)))];
  if (!ids.length) return new Map();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/clients?id=in.(${ids.join(",")})&select=id,subdomain,content`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("clients lookup failed");
  const rows = await res.json();
  const m = new Map();
  for (const r of (Array.isArray(rows) ? rows : [])) {
    m.set(r.id, { subdomain: r.subdomain, content: JSON.stringify(r.content || {}) });
  }
  return m;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.MEDIA) return json({ error: "storage not configured" }, 503);

  const SUPABASE_URL = env.SUPABASE_URL || "https://xprynknppsehuzqqdvue.supabase.co";
  const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwcnlua25wcHNlaHV6cXFkdnVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwODg1OTUsImV4cCI6MjA5NzY2NDU5NX0._S3xdNXBm6d4SI8MO0MNoZ3bT8uspEd8lrdVm29Efgo";

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "unauthorized" }, 401);

  const url = new URL(request.url);
  const usage = url.searchParams.get("usage") === "1";

  if (usage) {
    // Usage annotation reveals which client references each file, so it is
    // superadmin-only (owners using the MediaPicker never pass usage=1).
    const chk = await requireSuperadmin(SUPABASE_URL, SUPABASE_ANON_KEY, token);
    if (!chk.ok) return json({ error: chk.status === 403 ? "forbidden" : "unauthorized" }, chk.status);
  } else {
    try {
      const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
      });
      if (!who.ok) return json({ error: "unauthorized" }, 401);
    } catch {
      return json({ error: "auth check failed" }, 502);
    }
  }

  const typeParam = String(url.searchParams.get("type") || "image");
  const type = TYPES.has(typeParam) ? typeParam : "image";

  const objects = [];
  try {
    let cursor;
    do {
      const page = await env.MEDIA.list({ cursor });
      for (const o of page.objects || []) {
        if (o.key.split("/")[2] === type) objects.push(o);
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  } catch (e) {
    return json({ error: "list failed", detail: String(e && e.message || e) }, 500);
  }

  const items = objects
    .map((o) => ({ key: o.key, name: fileNameFromKey(o.key), size: o.size, uploaded: o.uploaded }))
    .sort((a, b) => new Date(b.uploaded).getTime() - new Date(a.uploaded).getTime());

  if (usage) {
    let map;
    try {
      map = await fetchClientsContent(SUPABASE_URL, SUPABASE_ANON_KEY, token, items.map((i) => i.key.split("/")[0]));
    } catch (e) {
      return json({ error: "usage lookup failed", detail: String((e && e.message) || e) }, 502);
    }
    for (const it of items) {
      const owner = it.key.split("/")[0];
      const e = map.get(owner);
      it.inUse = !!(e && e.content.includes(it.key));
      it.usedBy = it.inUse ? e.subdomain : null;
    }
  }

  return json({ items });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!env.MEDIA) return json({ error: "storage not configured" }, 503);

  const SUPABASE_URL = env.SUPABASE_URL || "https://xprynknppsehuzqqdvue.supabase.co";
  const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwcnlua25wcHNlaHV6cXFkdnVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwODg1OTUsImV4cCI6MjA5NzY2NDU5NX0._S3xdNXBm6d4SI8MO0MNoZ3bT8uspEd8lrdVm29Efgo";

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();

  // Delete is destructive and platform-wide (any client's key), so gate it to
  // superadmin — unlike GET/upload, "any valid session" is not enough here.
  const chk = await requireSuperadmin(SUPABASE_URL, SUPABASE_ANON_KEY, token);
  if (!chk.ok) {
    return json(
      { error: chk.status === 403 ? "forbidden" : chk.status === 502 ? "role check failed" : "unauthorized" },
      chk.status,
    );
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad JSON" }, 400); }
  const key = String((body && body.key) || "").trim();
  if (!key) return json({ error: "key is required" }, 400);

  // Hard-block deleting a file that a client still references in its content.
  const owner = key.split("/")[0];
  let usedBy = null;
  try {
    const map = await fetchClientsContent(SUPABASE_URL, SUPABASE_ANON_KEY, token, [owner]);
    const e = map.get(owner);
    if (e && e.content.includes(key)) usedBy = e.subdomain;
  } catch (e) {
    return json({ error: "usage check failed", detail: String((e && e.message) || e) }, 502);
  }
  if (usedBy) return json({ error: "in_use", usedBy }, 409);

  try {
    await env.MEDIA.delete(key);
  } catch (e) {
    return json({ error: "delete failed", detail: String((e && e.message) || e) }, 500);
  }

  return json({ ok: true });
}
