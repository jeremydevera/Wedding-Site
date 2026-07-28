import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// subscribeAdminRealtime no longer opens a Supabase channel — Neon has no
// realtime, so it POLLS loadAdminData (which reads the admin tables from the Neon
// Data API) on an interval while the tab is visible, and stops on cleanup.
const neonSelectMock = vi.fn(() => Promise.resolve([]));
vi.mock("@/lib/neon.js", () => ({
  neonSelect: vi.fn(), neonInsert: vi.fn(), neonRpc: vi.fn(),
  neonAuthedSelect: (...a) => neonSelectMock(...a),
  neonAuthedInsert: vi.fn(), neonAuthedUpdate: vi.fn(), neonAuthedDelete: vi.fn(),
  NEON_FLAG_KEY: "use_neon_db", NEON_SHARDS_KEY: "neon_shards", FB_AUTH_FLAG_KEY: "use_firebase_auth",
  setFbAuthMode: vi.fn(), setNeonRegistry: vi.fn(), resolveShardId: () => "s1", setActiveShard: vi.fn(),
}));
vi.mock("@/lib/auth.js", () => ({ loadSession: async () => {}, createOwner: async () => {}, sendSetupEmail: async () => {}, adminBridgeToken: async () => "fb" }));
vi.mock("@/lib/store.jsx", async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, Store: { ...mod.Store, get: () => ({ clientId: "c1", neonMode: true, settings: {} }), setSubmissions: vi.fn() } };
});

import { subscribeAdminRealtime } from "@/lib/api.js";

describe("subscribeAdminRealtime (poll-based, post-Supabase)", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it("returns an unsubscribe fn and polls the admin tables on an interval", async () => {
    const off = subscribeAdminRealtime();
    expect(typeof off).toBe("function");
    expect(neonSelectMock).not.toHaveBeenCalled(); // nothing until the first tick
    await vi.advanceTimersByTimeAsync(46000);
    expect(neonSelectMock).toHaveBeenCalled();     // polled loadAdminData
    off();
  });

  it("cleanup stops further polls", async () => {
    const off = subscribeAdminRealtime();
    await vi.advanceTimersByTimeAsync(46000);
    neonSelectMock.mockClear();
    off();
    await vi.advanceTimersByTimeAsync(200000);
    expect(neonSelectMock).not.toHaveBeenCalled();
  });
});
