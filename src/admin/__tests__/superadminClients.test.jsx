import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { Store } from "@/lib/store.jsx";

// Regression for the "white console" class of bug: mount the Clients list WITH
// real rows (empty tables hide per-row crashes — lesson from Bug 0008).
const CLIENTS = [
  { id: "c1", subdomain: "demo", event_type: "wedding", template_key: "classic", is_active: true, owner_email: "o@x.com", created_at: "2026-07-01T00:00:00Z", content: { partnerA: "Jeremy", partnerB: "Irish", phone: "0917", weddingDate: "2026-09-19T15:00", venueName: "Villa" } },
  { id: "c2", subdomain: "leo-7", event_type: "birthday", template_key: "blush", is_active: true, owner_email: null, created_at: "2026-07-02T00:00:00Z", content: { partnerA: "Leo's 7th Birthday", partnerB: "" } },
  { id: "c3", subdomain: "bare", event_type: "wedding", template_key: "classic", is_active: false, owner_email: null, created_at: "2026-07-03T00:00:00Z", content: null },
];

vi.mock("@/lib/supabase.js", () => {
  const chain = (result) => {
    const o = {
      select: () => o, order: () => Promise.resolve(result), eq: () => o,
      maybeSingle: () => Promise.resolve({ data: null }), single: () => Promise.resolve({ data: null }),
      insert: () => o, update: () => o, delete: () => o,
      then: (res) => Promise.resolve(result).then(res),
    };
    return o;
  };
  return {
    supabase: {
      from: (table) => chain({ data: table === "clients" ? CLIENTS : [] }),
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => {},
      auth: { getSession: async () => ({ data: { session: null } }) },
      functions: { invoke: async () => ({ data: null }) },
    },
  };
});

import { ClientsAdmin } from "@/admin/superadmin.jsx";

describe("superadmin Clients list with real rows", () => {
  beforeEach(() => {
    cleanup();
    Store.set({ clientId: null, loading: false });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
  });

  it("renders wedding, birthday (no partner B), and content-less rows without crashing", async () => {
    const { container } = render(<ClientsAdmin />);
    await waitFor(() => expect(container.textContent).toContain("demo"));
    expect(container.textContent).toContain("leo-7");
    expect(container.textContent).toContain("bare");
  });
});
