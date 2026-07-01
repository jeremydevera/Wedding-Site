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
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
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
});
