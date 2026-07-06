// src/lib/__tests__/mediaEndpoint.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { onRequestGet } from "../../../functions/api/media.js";

function req(url, headers = {}) { return new Request(url, { headers }); }
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
});
