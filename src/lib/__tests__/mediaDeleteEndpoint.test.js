// src/lib/__tests__/mediaDeleteEndpoint.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { onRequestDelete } from "../../../functions/api/media.js";

function req(url, body, headers = {}) {
  return new Request(url, {
    method: "DELETE",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
const AUTH = { authorization: "Bearer good-token" };

function envWith(extra = {}) {
  return { MEDIA: { delete: vi.fn().mockResolvedValue(undefined) }, ...extra };
}

beforeEach(() => {
  globalThis.fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "u1" }) })            // auth/v1/user
    .mockResolvedValueOnce({ ok: true, json: async () => [{ role: "superadmin" }] })  // profiles role
    .mockResolvedValueOnce({ ok: true, json: async () => [{ id: "c1", subdomain: "demo", content: {} }] }); // clients content (empty → not in use)
});
afterEach(() => { vi.restoreAllMocks(); });

describe("DELETE /api/media", () => {
  it("401 when no bearer token", async () => {
    const res = await onRequestDelete({ request: req("https://x/api/media", { key: "a/b/c" }), env: envWith() });
    expect(res.status).toBe(401);
  });

  it("503 when MEDIA binding is missing", async () => {
    const res = await onRequestDelete({ request: req("https://x/api/media", { key: "a/b/c" }, AUTH), env: {} });
    expect(res.status).toBe(503);
  });

  it("400 when key is missing or empty", async () => {
    const res = await onRequestDelete({ request: req("https://x/api/media", {}, AUTH), env: envWith() });
    expect(res.status).toBe(400);
  });

  it("deletes the key and returns { ok: true }", async () => {
    const env = envWith();
    const res = await onRequestDelete({
      request: req("https://x/api/media", { key: "c1/owner/image/hero/aaaaaaaa-photo.jpg" }, AUTH),
      env,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(env.MEDIA.delete).toHaveBeenCalledWith("c1/owner/image/hero/aaaaaaaa-photo.jpg");
  });

  it("403 when the caller is not a superadmin", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "u2" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ role: "owner" }] });
    const env = envWith();
    const res = await onRequestDelete({
      request: req("https://x/api/media", { key: "c1/owner/image/hero/aaaaaaaa-photo.jpg" }, AUTH),
      env,
    });
    expect(res.status).toBe(403);
    expect(env.MEDIA.delete).not.toHaveBeenCalled();
  });

  it("500 when env.MEDIA.delete throws", async () => {
    // c1/... owner is non-UUID → clients lookup skipped; still needs auth+role mocks
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "u1" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ role: "superadmin" }] });
    const env = { MEDIA: { delete: vi.fn().mockRejectedValue(new Error("r2 down")) } };
    const res = await onRequestDelete({
      request: req("https://x/api/media", { key: "c1/owner/image/hero/aaaaaaaa-photo.jpg" }, AUTH),
      env,
    });
    expect(res.status).toBe(500);
  });

  it("409 when the file is referenced by its client's content", async () => {
    const uuid = "87e215c5-5c92-4bbf-aa83-875d8f728c3f";
    const key = `${uuid}/owner/image/hero/aaaaaaaa-photo.jpg`;
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "u1" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ role: "superadmin" }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: uuid, subdomain: "demo", content: { heroImage: key } }] });
    const env = envWith();
    const res = await onRequestDelete({ request: req("https://x/api/media", { key }, AUTH), env });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ error: "in_use", usedBy: "demo" });
    expect(env.MEDIA.delete).not.toHaveBeenCalled();
  });

  it("deletes a UUID-owned file when it is NOT referenced", async () => {
    const uuid = "87e215c5-5c92-4bbf-aa83-875d8f728c3f";
    const key = `${uuid}/owner/image/hero/aaaaaaaa-photo.jpg`;
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "u1" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ role: "superadmin" }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: uuid, subdomain: "demo", content: { heroImage: "some/other/key.jpg" } }] });
    const env = envWith();
    const res = await onRequestDelete({ request: req("https://x/api/media", { key }, AUTH), env });
    expect(res.status).toBe(200);
    expect(env.MEDIA.delete).toHaveBeenCalledWith(key);
  });
});
