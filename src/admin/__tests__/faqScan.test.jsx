import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { Store } from "@/lib/store.jsx";
import { AdminApp } from "@/admin/manage.jsx";

describe("home-FAQ scan probes", () => {
  beforeEach(() => cleanup());

  it("owner granted ONLY homeFaq: sees Home tab + FAQ folder with checkboxes, no header fields", () => {
    Store.set({ clientId: "c1", loading: false, faq: [{ q: "Q1", a: "A1" }, { q: "Q2", a: "A2", home: false }] });
    Store.updateSettings({ ownerEdit: { homeFaq: true } });
    Store.setAuth({ session: { user: { email: "o@x" } }, role: "owner", clientId: "c1", email: "o@x" });
    const { container } = render(<AdminApp />);
    const nav = [...container.querySelectorAll("nav.admin__nav button")].map((b) => b.textContent.trim());
    expect(nav).toContain("Home");
    const home = [...container.querySelectorAll("nav.admin__nav button")].find((b) => b.textContent.trim() === "Home");
    fireEvent.click(home);
    const folders = [...container.querySelectorAll(".folders .folder")].map((b) => b.textContent.trim());
    expect(folders).toEqual(["FAQ"]); // only granted folder
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(2);
    expect(container.textContent).not.toContain("Small Header"); // superadmin-only fields hidden
    expect(container.textContent).toContain("Enable all"); // Q2 is off -> enable-all offered
  });

  it("enable-all flips every item; turn-all-off flips back", () => {
    Store.set({ clientId: "c1", loading: false, faq: [{ q: "Q1", a: "A1" }, { q: "Q2", a: "A2", home: false }] });
    Store.updateSettings({ ownerEdit: { homeFaq: true } });
    Store.setAuth({ session: { user: { email: "o@x" } }, role: "owner", clientId: "c1", email: "o@x" });
    const { container, getByText } = render(<AdminApp />);
    fireEvent.click([...container.querySelectorAll("nav.admin__nav button")].find((b) => b.textContent.trim() === "Home"));
    fireEvent.click(getByText("Enable all"));
    expect(Store.get().faq.every((f) => f.home !== false)).toBe(true);
    fireEvent.click(getByText("Turn all off"));
    expect(Store.get().faq.every((f) => f.home === false)).toBe(true);
  });
});
