import { describe, it, expect, vi, beforeEach } from "vitest";

// Tickets live on Neon now (Supabase retired). Owners file into Neon directly
// (Firebase-authed, RLS-scoped); the apex superadmin console reads/writes every
// ticket through the /api/neon-admin bridge. These guard that routing.

const neonCalls = [];

vi.mock("@/lib/neon.js", () => ({
  neonSelect: vi.fn(), neonInsert: vi.fn(), neonRpc: vi.fn(),
  neonAuthedSelect: (table, q) => { neonCalls.push({ kind: "select", table, q }); return Promise.resolve([{ id: "n1", created_at: "2026-07-02T00:00:00Z" }]); },
  neonAuthedInsert: (table, row) => { neonCalls.push({ kind: "insert", table, row }); return Promise.resolve([row]); },
  neonAuthedUpdate: vi.fn(), neonAuthedDelete: vi.fn(),
  NEON_FLAG_KEY: "use_neon_db", NEON_SHARDS_KEY: "neon_shards", FB_AUTH_FLAG_KEY: "use_firebase_auth",
  setFbAuthMode: vi.fn(), setNeonRegistry: vi.fn(), resolveShardId: () => "s1", setActiveShard: vi.fn(),
}));

// api.js still imports the supabase client (dead legacy branches). Provide a
// minimal stub; it must never be CALLED on the Neon paths (asserted below).
const supaCalls = [];
vi.mock("@/lib/supabase.js", () => {
  const chain = () => new Proxy({}, { get: () => (...a) => { supaCalls.push(a); return chain(); } });
  return { supabase: { from: () => { supaCalls.push("from"); return chain(); }, auth: {}, channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: () => {} } };
});

// The console bridge sends the Firebase ID token; stub it.
vi.mock("@/lib/auth.js", () => ({ loadSession: async () => {}, createOwner: async () => {}, sendSetupEmail: async () => {}, adminBridgeToken: async () => "fb-token" }));

import { Store } from "@/lib/store.jsx";
import { submitTicket, listTickets, setTicketStatus, deleteTicket, postTicketMessage } from "@/lib/api.js";

let bridge = [];
beforeEach(() => {
  neonCalls.length = 0; supaCalls.length = 0; bridge = [];
  globalThis.fetch = vi.fn(async (url, opts) => {
    const body = JSON.parse(opts?.body || "{}");
    bridge.push(body.action);
    return { ok: true, json: async () => ({ ok: true, rows: [{ id: "n9", created_at: "2026-07-03T00:00:00Z" }] }) };
  });
});

describe("ticket routing — Neon client (owner on their own site)", () => {
  beforeEach(() => {
    Store.set({ clientId: "c1", neonMode: true, loading: false });
    Store.setAuth({ session: {}, role: "owner", clientId: "c1", email: "o@x" });
  });

  it("files the ticket into NEON, never Supabase", async () => {
    await submitTicket({ subject: "help", message: "hi" }, "rsvps");
    expect(neonCalls.some((c) => c.kind === "insert" && c.table === "support_tickets")).toBe(true);
    expect(supaCalls.length).toBe(0);
  });

  it("lists the owner's own tickets from Neon, tagged _src=neon", async () => {
    const rows = await listTickets();
    expect(neonCalls.some((c) => c.table === "support_tickets")).toBe(true);
    expect(rows[0]._src).toBe("neon");
  });

  it("posts a reply into Neon", async () => {
    await postTicketMessage("t1", "thanks", null);
    expect(neonCalls.some((c) => c.kind === "insert" && c.table === "support_ticket_messages")).toBe(true);
    expect(supaCalls.length).toBe(0);
  });
});

describe("ticket routing — superadmin console (apex, Firebase bridge)", () => {
  beforeEach(() => {
    Store.set({ clientId: null, neonMode: false, loading: false });
    Store.setAuth({ session: {}, role: "superadmin", clientId: null, email: "su@x" });
  });

  it("lists every ticket via the bridge, all tagged _src=neon", async () => {
    const rows = await listTickets();
    expect(bridge).toContain("list_tickets");
    expect(rows.every((r) => r._src === "neon")).toBe(true);
    expect(supaCalls.length).toBe(0);
  });

  it("routes a status change through the bridge (not Supabase)", async () => {
    await setTicketStatus("n9", "resolved", { _src: "neon" });
    expect(bridge).toContain("set_ticket_status");
    expect(supaCalls.length).toBe(0);
  });

  it("deletes through the bridge", async () => {
    await deleteTicket("n9", { _src: "neon" });
    expect(bridge).toContain("delete_ticket");
    expect(supaCalls.length).toBe(0);
  });

  it("superadmin reply goes through the bridge", async () => {
    await postTicketMessage("n9", "on it", null, { _src: "neon" });
    expect(bridge).toContain("post_ticket_message");
    expect(supaCalls.length).toBe(0);
  });
});
