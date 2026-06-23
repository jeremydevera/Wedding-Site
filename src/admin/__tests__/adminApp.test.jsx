import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { Store } from "@/lib/store.jsx";
import { AdminApp } from "@/admin/manage.jsx";

// nav tab buttons live inside <nav class="admin__nav"> (the "View website"/"Sign out"
// buttons are siblings outside it, so this selector returns only the tab buttons).
function navLabels(container) {
  return [...container.querySelectorAll("nav.admin__nav button")].map((b) => b.textContent.trim());
}

describe("AdminApp rendered tab gating", () => {
  beforeEach(() => cleanup());

  it("superadmin on a client site: platform tabs + the client's full admin", () => {
    Store.set({ clientId: "c1", loading: false });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
    const { container } = render(<AdminApp />);
    const labels = navLabels(container);
    // platform console first, then the current client's full admin (incl. Settings)
    expect(labels.slice(0, 2)).toEqual(["Overview", "Clients"]);
    expect(labels).toEqual(expect.arrayContaining(["Dashboard", "Settings", "Guestbook"]));
  });

  it("superadmin with no client loaded: platform console only", () => {
    Store.set({ clientId: null, loading: false });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
    const { container } = render(<AdminApp />);
    expect(navLabels(container)).toEqual(["Overview", "Clients"]);
  });

  it("owner: shows operational tabs, hides Settings/Media/Clients", () => {
    Store.set({ clientId: "c1", loading: false });
    Store.setAuth({ session: { user: { email: "o@x" } }, role: "owner", clientId: "c1", email: "o@x" });
    const { container } = render(<AdminApp />);
    const labels = navLabels(container).join(" | ");
    expect(labels).toMatch(/Guestbook/);
    expect(labels).not.toMatch(/Settings|Clients/);
  });
});
