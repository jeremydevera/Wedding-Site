import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { Store } from "@/lib/store.jsx";

// The owner's Support notifications must fire on a SUPERADMIN REPLY (a message),
// NOT on the ticket's status. Regression: the first cut keyed the bell + nav
// badge off status === "waiting_reply", so a support reply that left the ticket
// "open" notified nobody. Here the ticket stays "open" and a superadmin reply
// exists — the badge MUST still appear.
vi.mock("@/lib/api.js", async (orig) => ({
  ...(await orig()),
  loadAdminData: async () => {},
  subscribeAdminRealtime: () => () => {},
  listTickets: async () => ([{ id: "t1", client_id: "c1", subject: "Help with map", status: "open", created_at: "2026-07-01T00:00:00Z" }]),
  // one superadmin reply, on the OPEN ticket
  listRecentSupportReplies: async () => ([{ id: "m1", ticket_id: "t1", sender_role: "superadmin", body: "Fixed it", created_at: "2026-07-09T00:00:00Z" }]),
  listRecentClientReplies: async () => [],
  listSiteRequests: async () => [],
  subscribeTicketsRealtime: () => () => {},
  subscribeSiteRequestsRealtime: () => () => {},
  subscribeAllTicketMessagesRealtime: () => () => {},
}));

import { AdminApp } from "@/admin/manage.jsx";

function navLabels(container) {
  return [...container.querySelectorAll("nav.admin__nav button")].map((b) => b.textContent.trim());
}

describe("owner Support notifications — driven by superadmin replies", () => {
  beforeEach(() => {
    cleanup();
    try { localStorage.clear(); } catch (_) {}
    Store.set({ clientId: "c1", loading: false });
    Store.setAuth({ session: { user: { email: "o@x" } }, role: "owner", clientId: "c1", email: "o@x" });
  });

  it("badges the Support nav tab when the superadmin replied, even on an OPEN ticket", async () => {
    const { container } = render(<AdminApp />);
    // owner default tab is Dashboard, so the badge is NOT auto-cleared
    await waitFor(() => {
      // red count pill on the Support tab (replaces the old "Support (1)" text)
      const supportTab = [...container.querySelectorAll(".admin__navlink")].find((b) => /Support/.test(b.textContent));
      expect(supportTab).toBeTruthy();
      expect(supportTab.querySelector(".admin__navbadge")?.textContent).toBe("1");
    });
  });
});
