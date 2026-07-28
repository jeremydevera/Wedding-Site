import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { Store } from "@/lib/store.jsx";

// Regression for the "white console" class of bug: mount the Clients list WITH
// real rows (empty tables hide per-row crashes — lesson from Bug 0008). Clients
// now load from Neon via the /api/neon-admin bridge (list_clients).
const CLIENTS = [
  { id: "c1", subdomain: "demo", event_type: "wedding", template_key: "classic", is_active: true, owner_email: "o@x.com", created_at: "2026-07-01T00:00:00Z", content: { partnerA: "Jeremy", partnerB: "Irish", phone: "0917", weddingDate: "2026-09-19T15:00", venueName: "Villa" } },
  { id: "c2", subdomain: "leo-7", event_type: "birthday", template_key: "blush", is_active: true, owner_email: null, created_at: "2026-07-02T00:00:00Z", content: { partnerA: "Leo's 7th Birthday", partnerB: "" } },
  { id: "c3", subdomain: "bare", event_type: "wedding", template_key: "classic", is_active: false, owner_email: null, created_at: "2026-07-03T00:00:00Z", content: null },
  // the signed-in superadmin's OWN account — must be hidden from the list
  { id: "cme", subdomain: "my-own-site", event_type: "wedding", template_key: "classic", is_active: true, owner_email: "su@x", created_at: "2026-07-04T00:00:00Z", content: { partnerA: "Me", partnerB: "" } },
];

// api.js still imports the supabase client (dead legacy branches) — stub it.
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: () => ({ select: () => ({ order: async () => ({ data: [] }) }) }), auth: {}, channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: () => {} } }));
vi.mock("@/lib/auth.js", async (orig) => ({ ...(await orig()), adminBridgeToken: async () => "fb" }));

// Route the console → /api/neon-admin bridge by action.
function bridgeFetch() {
  globalThis.fetch = vi.fn(async (url, opts) => {
    const action = JSON.parse(opts?.body || "{}").action;
    const rows = action === "list_clients" ? CLIENTS : [];
    return { ok: true, json: async () => ({ ok: true, rows, stats: { clients: 0, active: 0, logins: 0, rsvps: 0, guestbook: 0, quiz: 0 }, byType: [], recent: [] }) };
  });
}

import { ClientsAdmin } from "@/admin/superadmin.jsx";

describe("superadmin Clients list with real rows", () => {
  beforeEach(() => {
    cleanup();
    bridgeFetch();
    Store.set({ clientId: null, loading: false });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
  });

  it("renders wedding, birthday (no partner B), and content-less rows without crashing", async () => {
    const { container } = render(<ClientsAdmin />);
    await waitFor(() => expect(container.textContent).toContain("demo"));
    expect(container.textContent).toContain("leo-7");
    expect(container.textContent).toContain("bare");
  });

  it("hides the signed-in superadmin's own account from the list", async () => {
    const { container } = render(<ClientsAdmin />);
    await waitFor(() => expect(container.textContent).toContain("demo"));
    expect(container.textContent).not.toContain("my-own-site");
    expect(container.textContent).not.toContain("su@x");
  });

  it("site address is a link that opens the live site in a new tab", async () => {
    const { container } = render(<ClientsAdmin />);
    await waitFor(() => expect(container.textContent).toContain("demo"));
    const link = [...container.querySelectorAll("a.client-domain--link")]
      .find((a) => a.textContent.includes("demo.celebrately.us"));
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("https://demo.celebrately.us");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });
});
