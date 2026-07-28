// src/lib/__tests__/mediaDeleteEndpoint.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// media.js authenticates via a Firebase ID token (accounts:lookup) and reads
// role + clients content from Neon. Query-aware neon() stub.
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

import { onRequestDelete } from "../../../functions/api/media.js";

function req(url, body, headers = {}) {
  return new Request(url, { method: "DELETE", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
const AUTH = { authorization: "Bearer good-token" };
const NEON = "postgres://x";

function envWith(extra = {}) {
  return { NEON_DATABASE_URL: NEON, MEDIA: { delete: vi.fn().mockResolvedValue(undefined) }, ...extra };
}
function caller(role) {
  neonState.profile = role ? [{ role }] : [];
  neonState.clients = [{ id: "c1", subdomain: "demo", content: {} }];
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ users: [{ localId: "u1" }] }) });
}

beforeEach(() => { caller("superadmin"); });
afterEach(() => { vi.restoreAllMocks(); neonState.profile = []; neonState.clients = []; });

describe("DELETE /api/media", () => {
  it("401 when no bearer token", async () => {
    const res = await onRequestDelete({ request: req("https://x/api/media", { key: "a/b/c" }), env: envWith() });
    expect(res.status).toBe(401);
  });

  it("503 when MEDIA binding is missing", async () => {
    const res = await onRequestDelete({ request: req("https://x/api/media", { key: "a/b/c" }, AUTH), env: { NEON_DATABASE_URL: NEON } });
    expect(res.status).toBe(503);
  });

  it("400 when key is missing or empty", async () => {
    const res = await onRequestDelete({ request: req("https://x/api/media", {}, AUTH), env: envWith() });
    expect(res.status).toBe(400);
  });

  it("deletes the key and returns { ok: true }", async () => {
    const env = envWith();
    const res = await onRequestDelete({ request: req("https://x/api/media", { key: "c1/owner/image/hero/aaaaaaaa-photo.jpg" }, AUTH), env });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(env.MEDIA.delete).toHaveBeenCalledWith("c1/owner/image/hero/aaaaaaaa-photo.jpg");
  });

  it("403 when the caller is not a superadmin", async () => {
    caller("owner");
    const env = envWith();
    const res = await onRequestDelete({ request: req("https://x/api/media", { key: "c1/owner/image/hero/aaaaaaaa-photo.jpg" }, AUTH), env });
    expect(res.status).toBe(403);
    expect(env.MEDIA.delete).not.toHaveBeenCalled();
  });

  it("500 when env.MEDIA.delete throws", async () => {
    caller("superadmin");
    neonState.clients = [{ id: "c9", subdomain: "other", content: {} }];
    const env = { NEON_DATABASE_URL: NEON, MEDIA: { delete: vi.fn().mockRejectedValue(new Error("r2 down")) } };
    const res = await onRequestDelete({ request: req("https://x/api/media", { key: "c1/owner/image/hero/aaaaaaaa-photo.jpg" }, AUTH), env });
    expect(res.status).toBe(500);
  });

  it("409 when the file is referenced by its client's content", async () => {
    const uuid = "87e215c5-5c92-4bbf-aa83-875d8f728c3f";
    const key = `${uuid}/owner/image/hero/aaaaaaaa-photo.jpg`;
    caller("superadmin");
    neonState.clients = [{ id: uuid, subdomain: "demo", content: { heroImage: key } }];
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
    caller("superadmin");
    neonState.clients = [{ id: uuid, subdomain: "demo", content: { heroImage: "some/other/key.jpg" } }];
    const env = envWith();
    const res = await onRequestDelete({ request: req("https://x/api/media", { key }, AUTH), env });
    expect(res.status).toBe(200);
    expect(env.MEDIA.delete).toHaveBeenCalledWith(key);
  });
});
