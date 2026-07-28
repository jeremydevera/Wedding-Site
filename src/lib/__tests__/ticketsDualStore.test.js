import { describe, it, expect, vi, beforeEach } from "vitest";

// Tickets live in BOTH stores after the Neon migration: Neon clients file into
// Neon (Firebase-authed, RLS-scoped), legacy Supabase clients into Supabase.
// These guard the routing — a ticket must be mutated in the store it came from,
// and the superadmin console must see BOTH.

const neonCalls = [];   // { kind, table|action, arg }
const supaCalls = [];

vi.mock("@/lib/neon.js", () => ({
  neonSelect: vi.fn(), neonInsert: vi.fn(), neonRpc: vi.fn(),
  neonAuthedSelect: (table, q) => { neonCalls.push({ kind: "select", table, q }); return Promise.resolve([{ id: "n1", created_at: "2026-07-02T00:00:00Z" }]); },
  neonAuthedInsert: (table, row) => { neonCalls.push({ kind: "insert", table, row }); return Promise.resolve([row]); },
  neonAuthedUpdate: vi.fn(), neonAuthedDelete: vi.fn(),
  NEON_FLAG_KEY: "use_neon_db", NEON_SHARDS_KEY: "neon_shards", FB_AUTH_FLAG_KEY: "use_firebase_auth",
  setFbAuthMode: vi.fn(), setNeonRegistry: vi.fn(), resolveShardId: () => "s1", setActiveShard: vi.fn(),
}));

vi.mock("@/lib/supabase.js", () => {
  const chain = (table) => {
    const o = {
      select: () => o, eq: () => o, order: () => Promise.resolve({ data: [{ id: "s1", created_at: "2026-07-01T00:00:00Z" }], error: null }),
      limit: () => Promise.resolve({ data: [], error: null }),
      insert: (row) => { supaCalls.push({ kind: "insert", table, row }); return Promise.resolve({ error: null }); },
      update: (patch) => { supaCalls.push({ kind: "update", table, patch }); return { eq: () => Promise.resolve({ error: null }) }; },
      delete: () => { supaCalls.push({ kind: "delete", table }); return { eq: () => Promise.resolve({ error: null }) }; },
    };
    return o;
  };
  return {
    supabase: {
      from: (table) => chain(table),
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => {},
      auth: { getSession: async () => ({ data: { session: { access_token: "sa-jwt" } } }) },
    },
  };
});

import { Store } from "@/lib/store.jsx";
import { submitTicket, listTickets, setTicketStatus, deleteTicket, postTicketMessage } from "@/lib/api.js";

// the apex bridge (/api/neon-admin) — record what the console asks Neon for
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

describe("ticket routing — superadmin console (apex, Supabase JWT)", () => {
  beforeEach(() => {
    Store.set({ clientId: null, neonMode: false, loading: false });
    Store.setAuth({ session: {}, role: "superadmin", clientId: null, email: "su@x" });
  });

  it("merges BOTH stores, newest first", async () => {
    const rows = await listTickets();
    expect(bridge).toContain("list_tickets");
    expect(rows.map((r) => r._src).sort()).toEqual(["neon", "supabase"]);
    expect(new Date(rows[0].created_at) >= new Date(rows[1].created_at)).toBe(true);
  });

  it("routes a NEON ticket's status change through the bridge (not Supabase)", async () => {
    await setTicketStatus("n9", "resolved", { _src: "neon" });
    expect(bridge).toContain("set_ticket_status");
    expect(supaCalls.length).toBe(0);
  });

  it("routes a SUPABASE ticket's status change to Supabase (not the bridge)", async () => {
    await setTicketStatus("s1", "resolved", { _src: "supabase" });
    expect(supaCalls.some((c) => c.kind === "update" && c.table === "support_tickets")).toBe(true);
    expect(bridge).not.toContain("set_ticket_status");
  });

  it("deletes each ticket in its own store", async () => {
    await deleteTicket("n9", { _src: "neon" });
    expect(bridge).toContain("delete_ticket");
    expect(supaCalls.length).toBe(0);
    await deleteTicket("s1", { _src: "supabase" });
    expect(supaCalls.some((c) => c.kind === "delete")).toBe(true);
  });

  it("superadmin reply to a Neon ticket goes through the bridge", async () => {
    await postTicketMessage("n9", "on it", null, { _src: "neon" });
    expect(bridge).toContain("post_ticket_message");
    expect(supaCalls.length).toBe(0);
  });
});
