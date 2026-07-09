import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { Store } from "@/lib/store.jsx";

// An approved request maps to a live client (by subdomain). The Approved tab's
// Note column must mirror the Clients tab — the client's PRIVATE note
// (client_notes, edited via Edit → Access), NOT the request's original
// content.note. Regression: the column read r.content.note, so a private note
// set on the client never appeared here.
const CLIENTS = [
  { id: "c1", subdomain: "demo", event_type: "wedding", template_key: "classic", is_active: true, owner_email: "o@x.com", created_at: "2026-07-01T00:00:00Z", content: { partnerA: "Jeremy", partnerB: "Irish" } },
];
const NOTES = [{ client_id: "c1", note: "PRIVATE CLIENT NOTE" }];

vi.mock("@/lib/supabase.js", () => {
  const chain = (result) => {
    const o = {
      select: () => o, order: () => Promise.resolve(result), eq: () => o,
      maybeSingle: () => Promise.resolve({ data: null }), single: () => Promise.resolve({ data: null }),
      insert: () => o, update: () => o, delete: () => o, upsert: () => Promise.resolve({ data: null }),
      then: (res) => Promise.resolve(result).then(res),
    };
    return o;
  };
  const dataFor = (table) => table === "clients" ? CLIENTS : table === "client_notes" ? NOTES : [];
  return {
    supabase: {
      from: (table) => chain({ data: dataFor(table) }),
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => {},
      auth: { getSession: async () => ({ data: { session: null } }) },
      functions: { invoke: async () => ({ data: null }) },
    },
  };
});

vi.mock("@/lib/api.js", async (orig) => ({
  ...(await orig()),
  listSiteRequests: async () => ([
    { id: "r1", status: "approved", subdomain: "demo", partner_a: "Jeremy", partner_b: "Irish", email: "o@x.com", created_at: "2026-07-01T00:00:00Z", content: { note: "ORIGINAL REQUEST NOTE" } },
  ]),
  listMedia: async () => [],
}));

import { ClientsAdmin } from "@/admin/superadmin.jsx";

describe("Approved tab Note column = client's private note", () => {
  beforeEach(() => {
    cleanup();
    Store.set({ clientId: null, loading: false });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
  });

  it("prefers the client_notes private note over the request's content.note", async () => {
    const { container, getByText } = render(<ClientsAdmin />);
    await waitFor(() => expect(container.textContent).toContain("Approved"));
    // switch to the Approved view
    fireEvent.click(getByText((t) => /^Approved/.test(t)));
    await waitFor(() => expect(container.textContent).toContain("PRIVATE CLIENT NOTE"));
    // the request's own note must NOT be what's shown for a live client
    expect(container.textContent).not.toContain("ORIGINAL REQUEST NOTE");
  });
});
