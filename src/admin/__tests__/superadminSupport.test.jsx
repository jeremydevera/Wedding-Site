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

import { ClientsAdmin } from "@/admin/superadmin.jsx";

// Regression (DEFECT-2026-07-09-A): the superadmin console went WHITE because
// the Support view/modal used fmtDate without importing it — a render-time
// ReferenceError unmounts the whole React tree. Mount the console and click
// into the Support folder so any such crash fails CI instead of prod.
describe("superadmin console — Support view", () => {
  beforeEach(() => {
    cleanup();
    Store.set({ clientId: null, loading: false });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
  });

  it("mounts the console and opens the Support folder without crashing", async () => {
    const { container, getByText, findByText } = render(<ClientsAdmin />);
    fireEvent.click(getByText(/^Support/));
    expect(container.textContent).toContain("Support tickets");
    // the seeded row must render (this is where the fmtDate crash lived)
    await findByText("Help with map");
    // and its detail modal must open
    fireEvent.click(getByText("Open"));
    expect(document.body.textContent).toContain("Pin resets");
  });
});
