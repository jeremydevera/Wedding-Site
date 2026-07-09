// src/lib/__tests__/approveSiteRequest.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

// A chainable query-builder stub. `.select(...).eq(...).maybeSingle()/.single()`
// resolves to the configured lookup result; `.insert(...).select(...).single()`
// resolves to the configured insert result; `.update(...).eq(...)` resolves to
// the configured update result. Every call is recorded so tests can assert what
// ran.
function makeSupabase(cfg) {
  const calls = { lookups: 0, inserts: 0, updates: 0 };
  const state = {};
  const from = vi.fn((table) => {
    const builder = {
      _op: null,
      select() { return this; },
      eq() { return this; },
      insert() { this._op = "insert"; calls.inserts++; return this; },
      update(patch) { this._op = "update"; calls.updates++; state.updatePatch = patch; return this; },
      maybeSingle() { calls.lookups++; return Promise.resolve(cfg.lookup()); },
      single() {
        if (this._op === "insert") return Promise.resolve(cfg.insert());
        if (this._op === "update") return Promise.resolve(cfg.update ? cfg.update() : { error: null });
        calls.lookups++;
        return Promise.resolve(cfg.lookup());
      },
      then(resolve) { // `await builder` for update chains that don't call single()
        if (this._op === "update") return resolve(cfg.update ? cfg.update() : { error: null });
        return resolve({ error: null });
      },
    };
    return builder;
  });
  return { supabase: { from }, calls, state };
}

let current;
vi.mock("@/lib/supabase.js", () => ({
  get supabase() { return current.supabase; },
}));

// Approval auto-provisions the owner login (starter password) — mock the edge-fn
// wrapper so tests stay offline and can assert the call.
const createOwnerMock = vi.fn(async () => ({}));
vi.mock("@/lib/auth.js", () => ({
  loadSession: async () => {},
  createOwner: (...a) => createOwnerMock(...a),
  updateOwnerEmail: async () => {},
  deleteOwner: async () => {},
}));

import { approveSiteRequest } from "@/lib/api.js";

const REQ = { id: "req1", subdomain: "amy-and-ben", partner_a: "Amy", partner_b: "Ben", email: "a@b.com", template_key: "classic", content: {} };

beforeEach(() => { current = null; createOwnerMock.mockClear(); });

describe("approveSiteRequest", () => {
  it("inserts a new client then marks the request approved", async () => {
    const s = makeSupabase({
      lookup: () => ({ data: null, error: null }),          // no existing client
      insert: () => ({ data: { id: "cli1" }, error: null }),
    });
    current = s;
    const out = await approveSiteRequest(REQ);
    expect(out).toMatchObject({ id: "cli1", loginError: "" });
    // auto-provisioned owner login with the starter password
    expect(createOwnerMock).toHaveBeenCalledWith({ email: "a@b.com", password: "Password123+", client_id: "cli1" });
    expect(s.calls.inserts).toBe(1);
    expect(s.calls.updates).toBe(1);
    expect(s.state.updatePatch).toEqual({ status: "approved" });
  });

  it("skips the insert and still marks approved when the client already exists (partial prior approval)", async () => {
    const s = makeSupabase({
      lookup: () => ({ data: { id: "cli-existing" }, error: null }), // found from a prior run
      insert: () => { throw new Error("insert should not run"); },
    });
    current = s;
    const out = await approveSiteRequest(REQ);
    expect(out).toMatchObject({ id: "cli-existing", loginError: "" });
    expect(s.calls.inserts).toBe(0);      // did NOT re-insert
    expect(s.calls.updates).toBe(1);      // converged on approved
    expect(s.state.updatePatch).toEqual({ status: "approved" });
  });

  it("recovers from a duplicate-subdomain insert error (23505) and marks approved", async () => {
    let lookupCall = 0;
    const s = makeSupabase({
      lookup: () => {
        lookupCall++;
        // first pre-insert lookup: not found (race); post-error lookup: found
        return lookupCall === 1 ? { data: null, error: null } : { data: { id: "cli-dup" }, error: null };
      },
      insert: () => ({ data: null, error: { code: "23505", message: "duplicate key" } }),
    });
    current = s;
    const out = await approveSiteRequest(REQ);
    expect(out).toMatchObject({ id: "cli-dup", loginError: "" });
    expect(s.calls.inserts).toBe(1);
    expect(s.calls.updates).toBe(1);
    expect(s.state.updatePatch).toEqual({ status: "approved" });
  });

  it("throws (fails closed, no status flip) on a non-duplicate insert error", async () => {
    const s = makeSupabase({
      lookup: () => ({ data: null, error: null }),
      insert: () => ({ data: null, error: { code: "42501", message: "permission denied" } }),
    });
    current = s;
    await expect(approveSiteRequest(REQ)).rejects.toMatchObject({ code: "42501" });
    expect(s.calls.updates).toBe(0); // never marked approved
  });
});
