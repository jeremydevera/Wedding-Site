// src/lib/__tests__/mediaEndpoint.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { onRequestGet, onRequestDelete } from "../../../functions/api/media.js";
import { onRequestPost } from "../../../functions/api/upload.js";

function req(url, headers = {}) { return new Request(url, { headers }); }
function delReq(url, key, headers = {}) {
  return new Request(url, { method: "DELETE", headers, body: JSON.stringify({ key }) });
}
const AUTH = { authorization: "Bearer good-token" };

// MEDIA.list honors `prefix` so owner-scoping is testable; no prefix => whole bucket.
function envWith(objects, extra = {}) {
  return {
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

// Mock the two resolveCaller fetches: /auth/v1/user then profiles(role,client_id).
function mockCaller(role, clientId = null) {
  globalThis.fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "uid-1" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => [{ role, client_id: clientId }] });
}

beforeEach(() => {
  // default caller = superadmin (sees the whole library)
  mockCaller("superadmin");
});
afterEach(() => { vi.restoreAllMocks(); });

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
    // superadmin lists the whole bucket — no prefix constraint
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
    // the other tenant's file must never appear
    expect(body.items.some((i) => i.key.startsWith("c2/"))).toBe(false);
    // and the listing was constrained to the owner's prefix
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
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "u1" }) })            // auth/v1/user
      .mockResolvedValueOnce({ ok: true, json: async () => [{ role: "superadmin" }] })  // profiles role
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: uuid, subdomain: "demo", content: { heroImage: usedKey } }] }); // clients
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
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "u2" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ role: "owner" }] });
    const res = await onRequestGet({ request: req("https://x/api/media?type=image&usage=1", AUTH), env: envWith([]) });
    expect(res.status).toBe(403);
  });

  it("follows the cursor when the listing is truncated (superadmin)", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ objects: [{ key: "c1/owner/image/a/xxxxxxxx-1.jpg", size: 1, uploaded: "2026-01-01T00:00:00Z" }], truncated: true, cursor: "C1" })
      .mockResolvedValueOnce({ objects: [{ key: "c2/owner/image/a/yyyyyyyy-2.jpg", size: 1, uploaded: "2026-02-01T00:00:00Z" }], truncated: false });
    const env = { MEDIA: { list } };
    const res = await onRequestGet({ request: req("https://x/api/media?type=image", AUTH), env });
    const body = await res.json();
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "C1" }));
    expect(body.items).toHaveLength(2);
  });

  // Regression (#8): the library is cross-tenant, so a key owned by client A but
  // referenced by client B must be flagged in-use by B, not just checked against A.
  it("usage=1 flags a key referenced by a DIFFERENT client than its owner-prefix", async () => {
    const A = "11111111-1111-1111-1111-111111111111";
    const B = "22222222-2222-2222-2222-222222222222";
    const key = `${A}/owner/image/hero/aaaaaaaa-venue.jpg`;
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "u1" }) })            // auth/v1/user
      .mockResolvedValueOnce({ ok: true, json: async () => [{ role: "superadmin" }] })  // profiles role
      .mockResolvedValueOnce({ ok: true, json: async () => [                            // ALL clients
        { id: A, subdomain: "alpha", content: {} },                 // owner A no longer uses it
        { id: B, subdomain: "bravo", content: { heroImage: key } }, // client B references it
      ] });
    const env = envWith([{ key, size: 10, uploaded: "2026-06-01T00:00:00Z" }]);
    const res = await onRequestGet({ request: req("https://x/api/media?type=image&usage=1", AUTH), env });
    expect(res.status).toBe(200);
    const body = await res.json();
    const it = body.items.find((i) => i.key === key);
    expect(it.inUse).toBe(true);
    expect(it.usedBy).toBe("bravo"); // reported against the actual referrer, not owner A
  });
});

describe("DELETE /api/media", () => {
  // Delete gates to superadmin: requireSuperadmin makes auth+profiles(role) fetches.
  function mockSuperadmin() {
    return vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "sa-1" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ role: "superadmin" }] });
  }

  it("503 when the R2 binding is missing", async () => {
    const key = "11111111-1111-1111-1111-111111111111/owner/image/hero/aaaaaaaa-x.jpg";
    const res = await onRequestDelete({ request: delReq("https://x/api/media", key, AUTH), env: {} });
    expect(res.status).toBe(503);
  });

  it("403 when the caller is not a superadmin (no delete)", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "o1" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ role: "owner" }] });
    const del = vi.fn();
    const key = "11111111-1111-1111-1111-111111111111/owner/image/hero/aaaaaaaa-x.jpg";
    const res = await onRequestDelete({ request: delReq("https://x/api/media", key, AUTH), env: { MEDIA: { delete: del } } });
    expect(res.status).toBe(403);
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes a key that no client references", async () => {
    globalThis.fetch = mockSuperadmin()
      .mockResolvedValueOnce({ ok: true, json: async () => [
        { id: "11111111-1111-1111-1111-111111111111", subdomain: "alpha", content: {} },
      ] });
    const del = vi.fn().mockResolvedValue(undefined);
    const key = "11111111-1111-1111-1111-111111111111/owner/image/hero/aaaaaaaa-free.jpg";
    const res = await onRequestDelete({ request: delReq("https://x/api/media", key, AUTH), env: { MEDIA: { delete: del } } });
    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledWith(key);
  });

  // Regression (#8): a key owned by client A but referenced by client B must be
  // blocked from deletion — the old owner-only guard let this through and orphaned
  // B's reference.
  it("409 blocks deleting a key referenced by a DIFFERENT client (cross-tenant)", async () => {
    const A = "11111111-1111-1111-1111-111111111111";
    const B = "22222222-2222-2222-2222-222222222222";
    const key = `${A}/owner/image/hero/aaaaaaaa-venue.jpg`;
    globalThis.fetch = mockSuperadmin()
      .mockResolvedValueOnce({ ok: true, json: async () => [
        { id: A, subdomain: "alpha", content: {} },                 // owner A no longer uses it
        { id: B, subdomain: "bravo", content: { heroImage: key } }, // client B still references it
      ] });
    const del = vi.fn();
    const res = await onRequestDelete({ request: delReq("https://x/api/media", key, AUTH), env: { MEDIA: { delete: del } } });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("in_use");
    expect(body.usedBy).toBe("bravo");
    expect(del).not.toHaveBeenCalled(); // must NOT delete
  });

  it("fails CLOSED (502, no delete) when the clients lookup errors", async () => {
    globalThis.fetch = mockSuperadmin()
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) }); // clients lookup fails
    const del = vi.fn();
    const key = "11111111-1111-1111-1111-111111111111/owner/image/hero/aaaaaaaa-x.jpg";
    const res = await onRequestDelete({ request: delReq("https://x/api/media", key, AUTH), env: { MEDIA: { delete: del } } });
    expect(res.status).toBe(502);
    expect(del).not.toHaveBeenCalled();
  });
});

describe("POST /api/upload", () => {
  // Build a multipart POST whose form fields come from `fields`. A `file` value
  // is turned into a File; everything else is appended as a string.
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

  // resolveCaller does the same two fetches as media.js: auth/v1/user then profiles(role,client_id).
  function envMedia() {
    return { MEDIA: { put: vi.fn().mockResolvedValue(undefined) } };
  }

  it("401 when no bearer token", async () => {
    globalThis.fetch = vi.fn(); // must never be called
    const res = await onRequestPost({ request: uploadReq({ file: imgFile() }, {}), env: envMedia() });
    expect(res.status).toBe(401);
  });

  it("503 when the R2 binding is missing", async () => {
    const res = await onRequestPost({ request: uploadReq({ file: imgFile() }), env: {} });
    expect(res.status).toBe(503);
  });

  // Bug (line 43): an owner must NOT be able to write into another tenant's prefix.
  it("403 when an owner uploads to a clientId they do not own (cross-tenant write)", async () => {
    mockCaller("owner", "c1");
    const env = envMedia();
    const res = await onRequestPost({ request: uploadReq({ file: imgFile(), clientId: "c2-victim" }), env });
    expect(res.status).toBe(403);
    expect(env.MEDIA.put).not.toHaveBeenCalled(); // nothing stored under the victim prefix
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

  it("fails CLOSED (502, no store) when the role lookup errors", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "u1" }) }) // auth ok
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) });          // profiles lookup fails
    const env = envMedia();
    const res = await onRequestPost({ request: uploadReq({ file: imgFile(), clientId: "c1" }), env });
    expect(res.status).toBe(502);
    expect(env.MEDIA.put).not.toHaveBeenCalled();
  });

  // Bug (line 55): sourceUrl must be restricted to an allowlisted host (SSRF).
  it("403 when sourceUrl host is not on the allowlist (SSRF blocked)", async () => {
    mockCaller("superadmin", null);
    const env = envMedia();
    const res = await onRequestPost({
      request: uploadReq({ sourceUrl: "https://169.254.169.254/latest/meta-data/", clientId: "c1" }),
      env,
    });
    expect(res.status).toBe(403);
    expect(env.MEDIA.put).not.toHaveBeenCalled();
    // and it never egressed to the attacker host (only the 2 auth fetches happened)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  // Regression (#47): an allowlisted host that 3xx-redirects must NOT be followed
  // to an unvalidated address — fetch runs with redirect:"manual" and a redirect
  // status fails CLOSED (502, no store), rather than egressing to the Location.
  it("502 when an allowlisted sourceUrl responds with a redirect (SSRF via redirect blocked)", async () => {
    const srcFetch = vi.fn().mockResolvedValue({
      status: 302,
      ok: false, // a 3xx is not ok; belt-and-suspenders with the explicit 3xx check
      headers: new Headers({ location: "http://169.254.169.254/latest/meta-data/" }),
      body: null,
    });
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "u1" }) })           // auth
      .mockResolvedValueOnce({ ok: true, json: async () => [{ role: "superadmin" }] }) // profiles
      .mockImplementationOnce((...args) => srcFetch(...args));                          // source fetch
    const env = envMedia();
    const res = await onRequestPost({
      request: uploadReq({ sourceUrl: "https://media.celebrately.us/redirect-me", clientId: "c1" }),
      env,
    });
    expect(res.status).toBe(502);
    expect(env.MEDIA.put).not.toHaveBeenCalled(); // never followed the redirect / stored
    // the source fetch was made with redirect:"manual" so the redirect is not auto-followed
    expect(srcFetch).toHaveBeenCalledWith(
      "https://media.celebrately.us/redirect-me",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("allows sourceUrl on an allowlisted Supabase host", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "u1" }) })          // auth
      .mockResolvedValueOnce({ ok: true, json: async () => [{ role: "superadmin" }] }) // profiles
      .mockResolvedValueOnce({                                                          // source fetch
        ok: true,
        headers: new Headers({ "content-length": "10", "content-type": "audio/mpeg" }),
        body: new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(10)); c.close(); } }),
      });
    const env = envMedia();
    const res = await onRequestPost({
      request: uploadReq({ sourceUrl: "https://xprynknppsehuzqqdvue.supabase.co/storage/v1/object/x.mp3", clientId: "c1", purpose: "playlist" }),
      env,
    });
    expect(res.status).toBe(200);
    expect(env.MEDIA.put).toHaveBeenCalledTimes(1);
  });

  // Bug (line 59): a source with NO Content-Length that streams past MAX_BYTES
  // must be aborted, not stored unbounded. capStream errors the put → 413.
  it("413 when an allowlisted source omits Content-Length and streams past the cap", async () => {
    const OVER = 25 * 1024 * 1024 + 1; // 1 byte over 25MB
    const bigStream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(OVER));
        controller.close();
      },
    });
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "u1" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ role: "superadmin" }] })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "video/mp4" }), // NO content-length
        body: bigStream,
      });
    // put must consume the stream so the cap can trip; return a rejected promise
    // when the piped stream errors (mirrors R2 rejecting on a stream error).
    const put = vi.fn().mockImplementation(async (_key, body) => {
      const reader = body.getReader();
      // reading drives the TransformStream; it errors past MAX_BYTES
      // eslint-disable-next-line no-constant-condition
      while (true) { const { done } = await reader.read(); if (done) break; }
    });
    const res = await onRequestPost({
      request: uploadReq({ sourceUrl: "https://media.celebrately.us/huge.mp4", clientId: "c1" }, AUTH),
      env: { MEDIA: { put } },
    });
    expect(res.status).toBe(413);
  });
});
