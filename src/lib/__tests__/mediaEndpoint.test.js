// src/lib/__tests__/mediaEndpoint.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { onRequestGet } from "../../../functions/api/media.js";

function req(url, headers = {}) { return new Request(url, { headers }); }
const AUTH = { authorization: "Bearer good-token" };

function envWith(objects, extra = {}) {
  return { MEDIA: { list: vi.fn().mockResolvedValue({ objects, truncated: false, cursor: undefined }) }, ...extra };
}

beforeEach(() => {
  // auth verify → Supabase /auth/v1/user returns ok
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
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

  it("lists images from all clients and returns shaped, newest-first items", async () => {
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
  });

  it("returns audio from all clients when type=audio", async () => {
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

  it("defaults an unknown type to image", async () => {
    const env = envWith([
      { key: "c1/owner/image/hero/aaaaaaaa-photo.jpg", size: 10, uploaded: "2026-01-01T00:00:00Z" },
      { key: "c1/owner/audio/playlist/bbbbbbbb-song.mp3", size: 5, uploaded: "2026-02-01T00:00:00Z" },
    ]);
    const res = await onRequestGet({ request: req("https://x/api/media?type=video", AUTH), env });
    const body = await res.json();
    expect(body.items).toHaveLength(1); // video → defaults to image
    expect(body.items[0].name).toBe("photo.jpg");
  });

  it("follows the cursor when the listing is truncated", async () => {
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
