// src/lib/__tests__/deleteFromR2.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "tok", expires_at: 9999999999 } },
      }),
    },
  },
}));

import { deleteFromR2 } from "@/lib/api.js";

beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true }),
  });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("deleteFromR2", () => {
  it("sends DELETE to /api/media with the key in the JSON body", async () => {
    await deleteFromR2("c1/owner/image/hero/aaaaaaaa-photo.jpg");
    expect(fetch).toHaveBeenCalledWith(
      "/api/media",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ authorization: "Bearer tok" }),
        body: JSON.stringify({ key: "c1/owner/image/hero/aaaaaaaa-photo.jpg" }),
      })
    );
  });

  it("throws with the server error message on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "delete failed" }),
    });
    await expect(deleteFromR2("bad/key")).rejects.toThrow("delete failed");
  });
});
