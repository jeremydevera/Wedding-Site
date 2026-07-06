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

// Resolve the caller's identity for library scoping. Verifies the bearer token,
// then reads their role + client_id from profiles. Returns { ok, status } on
// failure, or { ok:true, uid, role, clientId } — clientId is null for anyone
// not bound to a client (e.g. a bare 'guest' account). Superadmin sees the whole
// library; an owner is scoped to their own client's prefix so they can never see
// another tenant's media.
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

// Fetch EVERY client's stringified content. Returns the same shape as
// fetchClientsContent (Map<clientId, { subdomain, content }>). Because the media
// library is cross-tenant (client B can reference client A's key), a file's
// in-use status must be checked against ALL clients, not just the key's
// owner-prefix client — otherwise deleting a file still referenced by a
// different tenant would orphan that reference. Throws on a failed lookup so
// callers fail CLOSED (treat a lookup error as "can't prove it's free").
async function fetchAllClientsContent(SUPABASE_URL, SUPABASE_ANON_KEY, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/clients?select=id,subdomain,content`, {
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

// Scan all client contents for a key; return the subdomains of every client
// whose content references it (cross-tenant aware). `all` is the Map returned by
// fetchAllClientsContent.
function usersOfKey(all, key) {
  const subs = [];
  for (const e of all.values()) {
    if (e.content.includes(key)) subs.push(e.subdomain);
  }
  return subs;
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

  // Decide the R2 listing scope from the caller's role. listPrefix === undefined
  // means "list the whole bucket" and is reachable ONLY by a superadmin; an owner
  // is always constrained to `${clientId}/` so the MediaPicker can never surface
  // another tenant's files.
  let listPrefix;
  if (usage) {
    // Usage annotation reveals which client references each file, so it is
    // superadmin-only (owners using the MediaPicker never pass usage=1).
    const chk = await requireSuperadmin(SUPABASE_URL, SUPABASE_ANON_KEY, token);
    if (!chk.ok) return json({ error: chk.status === 403 ? "forbidden" : "unauthorized" }, chk.status);
  } else {
    const who = await resolveCaller(SUPABASE_URL, SUPABASE_ANON_KEY, token);
    if (!who.ok) return json({ error: who.status === 403 ? "forbidden" : "unauthorized" }, who.status);
    if (who.role !== "superadmin") {
      // Non-superadmin must be an owner bound to a client; scope to that prefix.
      if (!who.clientId) return json({ error: "forbidden" }, 403);
      listPrefix = `${who.clientId}/`;
    }
  }

  const typeParam = String(url.searchParams.get("type") || "image");
  const type = TYPES.has(typeParam) ? typeParam : "image";

  const objects = [];
  try {
    let cursor;
    do {
      const page = await env.MEDIA.list({ cursor, prefix: listPrefix });
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
    // Cross-tenant: a file may be referenced by ANY client, not just its
    // owner-prefix client, so scan every client's content (superadmin-only path).
    let all;
    try {
      all = await fetchAllClientsContent(SUPABASE_URL, SUPABASE_ANON_KEY, token);
    } catch (e) {
      return json({ error: "usage lookup failed", detail: String((e && e.message) || e) }, 502);
    }
    for (const it of items) {
      const subs = usersOfKey(all, it.key);
      it.inUse = subs.length > 0;
      // Preserve the single-subdomain contract other code depends on: report the
      // first referencing client (owner-prefix preferred when it is among them).
      const ownerSub = all.get(it.key.split("/")[0])?.subdomain;
      it.usedBy = it.inUse ? (subs.includes(ownerSub) ? ownerSub : subs[0]) : null;
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

  // Hard-block deleting a file that ANY client still references in its content.
  // The library is cross-tenant (client B can pick client A's key into B's site),
  // so checking only the key's owner-prefix client would miss a foreign reference
  // and orphan it. Scan every client and fail CLOSED on a lookup error.
  let usedBy = null;
  try {
    const all = await fetchAllClientsContent(SUPABASE_URL, SUPABASE_ANON_KEY, token);
    const subs = usersOfKey(all, key);
    if (subs.length) {
      // Prefer the owner-prefix client's subdomain when it is among the referrers.
      const ownerSub = all.get(key.split("/")[0])?.subdomain;
      usedBy = subs.includes(ownerSub) ? ownerSub : subs[0];
    }
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
