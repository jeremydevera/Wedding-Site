import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { Store } from "@/lib/store.jsx";

// An approved request maps to a live client (by subdomain). The Approved tab's
// Note column must mirror the Clients tab — the client's PRIVATE note
// (client_notes, edited via Edit → Access), NOT the request's original
// content.note. Clients + notes now load from Neon via the bridge.
const CLIENTS = [
  { id: "c1", subdomain: "demo", event_type: "wedding", template_key: "classic", is_active: true, owner_email: "o@x.com", created_at: "2026-07-01T00:00:00Z", content: { partnerA: "Jeremy", partnerB: "Irish" } },
];
const NOTES = [{ client_id: "c1", note: "PRIVATE CLIENT NOTE" }];

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: () => ({ select: () => ({ order: async () => ({ data: [] }) }) }), auth: {}, channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: () => {} } }));
vi.mock("@/lib/auth.js", async (orig) => ({ ...(await orig()), adminBridgeToken: async () => "fb" }));

vi.mock("@/lib/api.js", async (orig) => ({
  ...(await orig()),
  listSiteRequests: async () => ([
    { id: "r1", status: "approved", subdomain: "demo", partner_a: "Jeremy", partner_b: "Irish", email: "o@x.com", created_at: "2026-07-01T00:00:00Z", content: { note: "ORIGINAL REQUEST NOTE" } },
  ]),
  listMedia: async () => [],
}));

// Bridge: list_clients → CLIENTS, list_client_notes → NOTES, everything else empty.
function bridgeFetch() {
  globalThis.fetch = vi.fn(async (url, opts) => {
    const action = JSON.parse(opts?.body || "{}").action;
    const rows = action === "list_clients" ? CLIENTS : action === "list_client_notes" ? NOTES : [];
    return { ok: true, json: async () => ({ ok: true, rows, stats: { clients: 0, active: 0, logins: 0, rsvps: 0, guestbook: 0, quiz: 0 }, byType: [], recent: [] }) };
  });
}

import { ClientsAdmin } from "@/admin/superadmin.jsx";

describe("Approved tab Note column = client's private note", () => {
  beforeEach(() => {
    cleanup();
    bridgeFetch();
    Store.set({ clientId: null, loading: false });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
  });

  it("prefers the client_notes private note over the request's content.note", async () => {
    const { container, getByText } = render(<ClientsAdmin />);
    await waitFor(() => expect(container.textContent).toContain("Approved"));
    fireEvent.click(getByText((t) => /^Approved/.test(t)));
    await waitFor(() => expect(container.textContent).toContain("PRIVATE CLIENT NOTE"));
    expect(container.textContent).not.toContain("ORIGINAL REQUEST NOTE");
  });
});
