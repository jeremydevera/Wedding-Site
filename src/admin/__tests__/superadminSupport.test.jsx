import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { Store } from "@/lib/store.jsx";

// One ticket row so the Support table actually renders its cells (the crash
// was inside a row cell — an empty table dodges it).
vi.mock("@/lib/api.js", async (orig) => ({
  ...(await orig()),
  listTickets: async () => ([{ id: "t1", created_at: "2026-07-09T01:00:00Z", client_id: "c1", submitter_name: "Jeremy & Irish", submitter_email: "j@x.com", subject: "Help with map", category: "Bug", urgency: "High", message: "Pin resets", context_url: "demo / home", status: "open", admin_note: null }]),
  listSiteRequests: async () => [],
  subscribeTicketsRealtime: () => () => {},
  subscribeSiteRequestsRealtime: () => () => {},
}));

import { SupportAdmin } from "@/admin/superadmin.jsx";

// Regression (DEFECT-2026-07-09-A): the superadmin Support view/modal once used
// fmtDate without importing it — a render-time ReferenceError unmounts the whole
// React tree (white console). Mount the Support tab and open a ticket so any
// such crash fails CI instead of prod. (Support is now its own top-level tab —
// SupportAdmin — not a folder inside Clients.)
describe("superadmin console — Support tab", () => {
  beforeEach(() => {
    cleanup();
    Store.set({ clientId: null, loading: false });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
  });

  it("mounts the Support tab and opens a ticket without crashing", async () => {
    const { container, getByText, findByText } = render(<SupportAdmin />);
    expect(container.textContent).toContain("Support tickets");
    // the seeded row must render (this is where the fmtDate crash lived)
    await findByText("Help with map");
    // and its detail modal (reply thread) must open
    fireEvent.click(getByText("Open"));
    expect(document.body.textContent).toContain("Pin resets");
  });
});
