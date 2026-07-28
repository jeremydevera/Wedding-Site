// src/lib/__tests__/mediaEndpoint.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// media.js + upload.js authenticate the caller via a FIREBASE ID token
// (accounts:lookup, one fetch) and read role/client_id + clients content from
// NEON via @neondatabase/serverless. Query-aware neon() stub: route by the SQL
// text to the configured profile / clients rows.
const { neonState } = vi.hoisted(() => ({ neonState: { profile: [], clients: [] } }));
vi.mock("@neondatabase/serverless", () => ({
  neon: () => ((strings) => {
    const sql = Array.isArray(strings) ? strings.join(" ") : String(strings);
    if (/role = 'superadmin'/.test(sql)) return Promise.resolve(neonState.profile.filter((p) => p.role === "superadmin"));
    if (/from profiles/.test(sql)) return Promise.resolve(neonState.profile);
    if (/from clients/.test(sql)) return Promise.resolve(neonState.clients);
    return Promise.resolve([]);
  }),
}));

import { onRequestGet, onRequestDelete } from "../../../functions/api/media.js";
import { onRequestPost } from "../../../functions/api/upload.js";

function req(url, headers = {}) { return new Request(url, { headers }); }
function delReq(url, key, headers = {}) {
  return new Request(url, { method: "DELETE", headers, body: JSON.stringify({ key }) });
}
const AUTH = { authorization: "Bearer good-token" };
const NEON = "postgres://x";

// MEDIA.list honors `prefix` so owner-scoping is testable; no prefix => whole bucket.
function envWith(objects, extra = {}) {
  return {
    NEON_DATABASE_URL: NEON,
    MEDIA: {
      list: vi.fn().mockImplementation((opts = {}) => ({
        objects: opts.prefix ? objects.filter((o) => o.key.startsWith(opts.prefix)) : objects,
        truncated: false,
        cursor: undefined,
      })),
    },
    ...extra,
  };
}

// Firebase-authed caller: accounts:lookup returns a uid; Neon profiles returns
// the role + client_id.
function fbLookup() {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ users: [{ localId: "uid-1" }] }) });
}
function mockCaller(role, clientId = null) {
  neonState.profile = role ? [{ role, client_id: clientId }] : [];
  neonState.clients = [];
  fbLookup();
}

beforeEach(() => {
  mockCaller("superadmin");
});
afterEach(() => { vi.restoreAllMocks(); neonState.profile = []; neonState.clients = []; });

describe("GET /api/media", () => {
  it("401 when no bearer token", async () => {
    const res = await onRequestGet({ request: req("https://x/api/media?type=image"), env: envWith([]) });
    expect(res.status).toBe(401);
  });

  it("503 when the R2 binding is missing", async () => {
    const res = await onRequestGet({ request: req("https://x/api/media?type=image", AUTH), env: {} });
    expect(res.status).toBe(503);
  });

  it("superadmin lists images from ALL clients, newest-first", async () => {
    const env = envWith([
      { key: "c1/owner/image/hero/aaaaaaaa-old.jpg", size: 10, uploaded: "2026-01-01T00:00:00Z" },
      { key: "c2/owner/image/story/bbbbbbbb-new.jpg", size: 20, uploaded: "2026-06-01T00:00:00Z" },
      { key: "c1/owner/audio/playlist/cccccccc-song.mp3", size: 5, uploaded: "2026-03-01T00:00:00Z" },
    ]);
    const res = await onRequestGet({ request: req("https://x/api/media?type=image", AUTH), env });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2); // audio excluded
    expect(body.items.map((i) => i.name)).toEqual(["new.jpg", "old.jpg"]); // newest first
    expect(body.items[0]).toMatchObject({ key: "c2/owner/image/story/bbbbbbbb-new.jpg", size: 20 });
    expect(env.MEDIA.list).toHaveBeenCalledWith(expect.objectContaining({ prefix: undefined }));
  });

  it("owner sees ONLY their own client's images (scoped by prefix)", async () => {
    mockCaller("owner", "c1");
    const env = envWith([
      { key: "c1/owner/image/hero/aaaaaaaa-mine.jpg", size: 10, uploaded: "2026-01-01T00:00:00Z" },
      { key: "c2/owner/image/story/bbbbbbbb-theirs.jpg", size: 20, uploaded: "2026-06-01T00:00:00Z" },
    ]);
    const res = await onRequestGet({ request: req("https://x/api/media?type=image", AUTH), env });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].key).toBe("c1/owner/image/hero/aaaaaaaa-mine.jpg");
    expect(body.items.some((i) => i.key.startsWith("c2/"))).toBe(false);
    expect(env.MEDIA.list).toHaveBeenCalledWith(expect.objectContaining({ prefix: "c1/" }));
  });

  it("403 when a non-superadmin caller has no client_id (bare guest account)", async () => {
    mockCaller("guest", null);
    const res = await onRequestGet({ request: req("https://x/api/media?type=image", AUTH), env: envWith([]) });
    expect(res.status).toBe(403);
  });

  it("403 when an owner role has a null client_id", async () => {
    mockCaller("owner", null);
    const res = await onRequestGet({ request: req("https://x/api/media?type=image", AUTH), env: envWith([]) });
    expect(res.status).toBe(403);
  });

  it("returns audio from all clients when type=audio (superadmin)", async () => {
    const env = envWith([
      { key: "c1/owner/audio/playlist/aaaaaaaa-song.mp3", size: 5, uploaded: "2026-01-01T00:00:00Z" },
      { key: "c2/owner/audio/playlist/bbbbbbbb-track.mp3", size: 8, uploaded: "2026-06-01T00:00:00Z" },
      { key: "c1/owner/image/hero/cccccccc-photo.jpg", size: 10, uploaded: "2026-03-01T00:00:00Z" },
    ]);
    const res = await onRequestGet({ request: req("https://x/api/media?type=audio", AUTH), env });
    const body = await res.json();
    expect(body.items).toHaveLength(2); // image excluded
    expect(body.items.map((i) => i.name)).toEqual(["track.mp3", "song.mp3"]);
  });

  it("defaults an unknown type to image (superadmin)", async () => {
    const env = envWith([
      { key: "c1/owner/image/hero/aaaaaaaa-photo.jpg", size: 10, uploaded: "2026-01-01T00:00:00Z" },
      { key: "c1/owner/audio/playlist/bbbbbbbb-song.mp3", size: 5, uploaded: "2026-02-01T00:00:00Z" },
    ]);
    const res = await onRequestGet({ request: req("https://x/api/media?type=video", AUTH), env });
    const body = await res.json();
    expect(body.items).toHaveLength(1); // video → defaults to image
    expect(body.items[0].name).toBe("photo.jpg");
  });

  it("annotates inUse/usedBy when usage=1 (superadmin)", async () => {
    const uuid = "87e215c5-5c92-4bbf-aa83-875d8f728c3f";
    const usedKey = `${uuid}/owner/image/hero/aaaaaaaa-used.jpg`;
    const freeKey = `${uuid}/owner/image/story/bbbbbbbb-free.jpg`;
    mockCaller("superadmin");
    neonState.clients = [{ id: uuid, subdomain: "demo", content: { heroImage: usedKey } }];
    const env = envWith([
      { key: usedKey, size: 10, uploaded: "2026-06-01T00:00:00Z" },
      { key: freeKey, size: 20, uploaded: "2026-05-01T00:00:00Z" },
    ]);
    const res = await onRequestGet({ request: req("https://x/api/media?type=image&usage=1", AUTH), env });
    expect(res.status).toBe(200);
    const body = await res.json();
    const used = body.items.find((i) => i.key === usedKey);
    const free = body.items.find((i) => i.key === freeKey);
    expect(used.inUse).toBe(true);
    expect(used.usedBy).toBe("demo");
    expect(free.inUse).toBe(false);
  });

  it("403 when usage=1 requested by a non-superadmin", async () => {
    mockCaller("owner", "c1");
    const res = await onRequestGet({ request: req("https://x/api/media?type=image&usage=1", AUTH), env: envWith([]) });
    expect(res.status).toBe(403);
  });

  it("follows the cursor when the listing is truncated (superadmin)", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ objects: [{ key: "c1/owner/image/a/xxxxxxxx-1.jpg", size: 1, uploaded: "2026-01-01T00:00:00Z" }], truncated: true, cursor: "C1" })
      .mockResolvedValueOnce({ objects: [{ key: "c2/owner/image/a/yyyyyyyy-2.jpg", size: 1, uploaded: "2026-02-01T00:00:00Z" }], truncated: false });
    const env = { NEON_DATABASE_URL: NEON, MEDIA: { list } };
    const res = await onRequestGet({ request: req("https://x/api/media?type=image", AUTH), env });
    const body = await res.json();
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "C1" }));
    expect(body.items).toHaveLength(2);
  });

  // Regression (#8): cross-tenant — a key owned by client A but referenced by B
  // must be flagged in-use by B.
  it("usage=1 flags a key referenced by a DIFFERENT client than its owner-prefix", async () => {
    const A = "11111111-1111-1111-1111-111111111111";
    const B = "22222222-2222-2222-2222-222222222222";
    const key = `${A}/owner/image/hero/aaaaaaaa-venue.jpg`;
    mockCaller("superadmin");
    neonState.clients = [
      { id: A, subdomain: "alpha", content: {} },
      { id: B, subdomain: "bravo", content: { heroImage: key } },
    ];
    const env = envWith([{ key, size: 10, uploaded: "2026-06-01T00:00:00Z" }]);
    const res = await onRequestGet({ request: req("https://x/api/media?type=image&usage=1", AUTH), env });
    expect(res.status).toBe(200);
    const body = await res.json();
    const it = body.items.find((i) => i.key === key);
    expect(it.inUse).toBe(true);
    expect(it.usedBy).toBe("bravo");
  });
});

describe("DELETE /api/media", () => {
  it("503 when the R2 binding is missing", async () => {
    const key = "11111111-1111-1111-1111-111111111111/owner/image/hero/aaaaaaaa-x.jpg";
    const res = await onRequestDelete({ request: delReq("https://x/api/media", key, AUTH), env: {} });
    expect(res.status).toBe(503);
  });

  it("403 when the caller is not a superadmin (no delete)", async () => {
    mockCaller("owner", "c1");
    const del = vi.fn();
    const key = "11111111-1111-1111-1111-111111111111/owner/image/hero/aaaaaaaa-x.jpg";
    const res = await onRequestDelete({ request: delReq("https://x/api/media", key, AUTH), env: { NEON_DATABASE_URL: NEON, MEDIA: { delete: del } } });
    expect(res.status).toBe(403);
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes a key that no client references", async () => {
    mockCaller("superadmin");
    neonState.clients = [{ id: "11111111-1111-1111-1111-111111111111", subdomain: "alpha", content: {} }];
    const del = vi.fn().mockResolvedValue(undefined);
    const key = "11111111-1111-1111-1111-111111111111/owner/image/hero/aaaaaaaa-free.jpg";
    const res = await onRequestDelete({ request: delReq("https://x/api/media", key, AUTH), env: { NEON_DATABASE_URL: NEON, MEDIA: { delete: del } } });
    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledWith(key);
  });

  it("409 blocks deleting a key referenced by a DIFFERENT client (cross-tenant)", async () => {
    const A = "11111111-1111-1111-1111-111111111111";
    const B = "22222222-2222-2222-2222-222222222222";
    const key = `${A}/owner/image/hero/aaaaaaaa-venue.jpg`;
    mockCaller("superadmin");
    neonState.clients = [
      { id: A, subdomain: "alpha", content: {} },
      { id: B, subdomain: "bravo", content: { heroImage: key } },
    ];
    const del = vi.fn();
    const res = await onRequestDelete({ request: delReq("https://x/api/media", key, AUTH), env: { NEON_DATABASE_URL: NEON, MEDIA: { delete: del } } });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("in_use");
    expect(body.usedBy).toBe("bravo");
    expect(del).not.toHaveBeenCalled();
  });
});

describe("POST /api/upload", () => {
  function uploadReq(fields, headers = AUTH) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (k === "file" && v) form.append("file", v);
      else if (v != null) form.append(k, String(v));
    }
    return new Request("https://x/api/upload", { method: "POST", headers, body: form });
  }
  const imgFile = (bytes = 10, name = "pic.jpg", type = "image/jpeg") =>
    new File([new Uint8Array(bytes)], name, { type });

  function envMedia(extra = {}) {
    return { NEON_DATABASE_URL: NEON, MEDIA: { put: vi.fn().mockResolvedValue(undefined) }, ...extra };
  }

  it("401 when no bearer token", async () => {
    globalThis.fetch = vi.fn();
    const res = await onRequestPost({ request: uploadReq({ file: imgFile() }, {}), env: envMedia() });
    expect(res.status).toBe(401);
  });

  it("503 when the R2 binding is missing", async () => {
    const res = await onRequestPost({ request: uploadReq({ file: imgFile() }), env: { NEON_DATABASE_URL: NEON } });
    expect(res.status).toBe(503);
  });

  it("403 when an owner uploads to a clientId they do not own (cross-tenant write)", async () => {
    mockCaller("owner", "c1");
    const env = envMedia();
    const res = await onRequestPost({ request: uploadReq({ file: imgFile(), clientId: "c2-victim" }), env });
    expect(res.status).toBe(403);
    expect(env.MEDIA.put).not.toHaveBeenCalled();
  });

  it("403 when a bare guest (no client_id) tries to upload", async () => {
    mockCaller("guest", null);
    const env = envMedia();
    const res = await onRequestPost({ request: uploadReq({ file: imgFile(), clientId: "c1" }), env });
    expect(res.status).toBe(403);
    expect(env.MEDIA.put).not.toHaveBeenCalled();
  });

  it("owner CAN upload to their own clientId", async () => {
    mockCaller("owner", "c1");
    const env = envMedia();
    const res = await onRequestPost({ request: uploadReq({ file: imgFile(), clientId: "c1" }), env });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key.startsWith("c1/")).toBe(true);
    expect(env.MEDIA.put).toHaveBeenCalledTimes(1);
  });

  it("superadmin CAN upload to any clientId", async () => {
    mockCaller("superadmin", null);
    const env = envMedia();
    const res = await onRequestPost({ request: uploadReq({ file: imgFile(), clientId: "any-tenant" }), env });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key.startsWith("any-tenant/")).toBe(true);
  });

  it("Firebase token with no Neon profile is rejected (403)", async () => {
    neonState.profile = [];
    fbLookup();
    const env = envMedia();
    const res = await onRequestPost({ request: uploadReq({ file: imgFile(), clientId: "c1" }), env });
    expect(res.status).toBe(403);
    expect(env.MEDIA.put).not.toHaveBeenCalled();
  });

  it("401 when the Firebase token is invalid (accounts:lookup !ok)", async () => {
    neonState.profile = [{ role: "owner", client_id: "c1" }];
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    const env = envMedia();
    const res = await onRequestPost({ request: uploadReq({ file: imgFile(), clientId: "c1" }), env });
    expect(res.status).toBe(401);
    expect(env.MEDIA.put).not.toHaveBeenCalled();
  });

  // SSRF: sourceUrl must be an allowlisted host.
  it("403 when sourceUrl host is not on the allowlist (SSRF blocked)", async () => {
    mockCaller("superadmin", null);
    const env = envMedia();
    const res = await onRequestPost({
      request: uploadReq({ sourceUrl: "https://169.254.169.254/latest/meta-data/", clientId: "c1" }),
      env,
    });
    expect(res.status).toBe(403);
    expect(env.MEDIA.put).not.toHaveBeenCalled();
    // only the single Firebase auth fetch happened — never egressed to the host
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("502 when an allowlisted sourceUrl responds with a redirect (SSRF via redirect blocked)", async () => {
    neonState.profile = [{ role: "superadmin" }];
    const srcFetch = vi.fn().mockResolvedValue({
      status: 302, ok: false,
      headers: new Headers({ location: "http://169.254.169.254/latest/meta-data/" }),
      body: null,
    });
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ users: [{ localId: "u1" }] }) }) // firebase lookup
      .mockImplementationOnce((...args) => srcFetch(...args));                                  // source fetch
    const env = envMedia();
    const res = await onRequestPost({
      request: uploadReq({ sourceUrl: "https://media.celebrately.us/redirect-me", clientId: "c1" }),
      env,
    });
    expect(res.status).toBe(502);
    expect(env.MEDIA.put).not.toHaveBeenCalled();
    expect(srcFetch).toHaveBeenCalledWith(
      "https://media.celebrately.us/redirect-me",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("allows sourceUrl on an allowlisted media host", async () => {
    neonState.profile = [{ role: "superadmin" }];
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ users: [{ localId: "u1" }] }) }) // firebase lookup
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-length": "10", "content-type": "audio/mpeg" }),
        body: new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(10)); c.close(); } }),
      });
    const env = envMedia();
    const res = await onRequestPost({
      request: uploadReq({ sourceUrl: "https://media.celebrately.us/x.mp3", clientId: "c1", purpose: "playlist" }),
      env,
    });
    expect(res.status).toBe(200);
    expect(env.MEDIA.put).toHaveBeenCalledTimes(1);
  });

  it("413 when an allowlisted source omits Content-Length and streams past the cap", async () => {
    const OVER = 25 * 1024 * 1024 + 1;
    const bigStream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(OVER)); controller.close(); } });
    neonState.profile = [{ role: "superadmin" }];
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ users: [{ localId: "u1" }] }) })
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), body: bigStream });
    const put = vi.fn().mockImplementation(async (_key, body) => {
      const reader = body.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) { const { done } = await reader.read(); if (done) break; }
    });
    const res = await onRequestPost({
      request: uploadReq({ sourceUrl: "https://media.celebrately.us/huge.mp4", clientId: "c1" }, AUTH),
      env: { NEON_DATABASE_URL: NEON, MEDIA: { put } },
    });
    expect(res.status).toBe(413);
  });
});
