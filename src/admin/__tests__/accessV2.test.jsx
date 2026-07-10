import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { Store } from "@/lib/store.jsx";
import { AdminApp } from "@/admin/manage.jsx";

const navLabels = (c) => [...c.querySelectorAll("nav.admin__nav button")].map((b) => b.textContent.trim());

describe("accessV2 — owner tabs from featureLevel", () => {
  beforeEach(() => cleanup());

  const ownerAuth = () => Store.setAuth({ session: { user: { email: "o@x" } }, role: "owner", clientId: "c1", email: "o@x" });

  it("edit shows the tab; view/none hide it; music+entourage promoted", () => {
    Store.set({ clientId: "c1", loading: false });
    Store.updateSettings({ accessV2: true, features: { story: "view", quiz: "none", music: "edit", entourage: "edit" } });
    ownerAuth();
    const { container } = render(<AdminApp />);
    const tabs = navLabels(container);
    expect(tabs).not.toContain("Our Story");   // view -> no tab
    expect(tabs).not.toContain("Quiz");        // none -> no tab
    expect(tabs).toContain("Music playlist");  // promoted, edit
    expect(tabs).toContain("Entourage");       // promoted, edit
    expect(tabs).toContain("RSVPs");           // core, always
    expect(tabs).toContain("Details");         // default edit
  });

  it("default map (absent keys): music none -> no Music tab for the owner", () => {
    Store.set({ clientId: "c1", loading: false });
    Store.updateSettings({ accessV2: true, features: {} });
    ownerAuth();
    const { container } = render(<AdminApp />);
    const tabs = navLabels(container);
    expect(tabs).not.toContain("Music playlist"); // default none
    expect(tabs).not.toContain("Our Story");      // default none
    expect(tabs).toContain("Entourage");          // default edit
  });

  it("legacy client (no flag): tab set unchanged, nothing promoted", () => {
    Store.set({ clientId: "c1", loading: false });
    Store.updateSettings({ accessV2: false, features: null, modules: {}, ownerEdit: {} });
    ownerAuth();
    const { container } = render(<AdminApp />);
    const tabs = navLabels(container);
    expect(tabs).not.toContain("Music playlist");
    expect(tabs).not.toContain("Entourage");
    expect(tabs).toContain("Guestbook");
  });

  it("accessV2 Settings loses Features/Access folders, gains RSVP & moderation", () => {
    Store.set({ clientId: "c1", loading: false });
    Store.updateSettings({ accessV2: true, features: {} });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
    const { container } = render(<AdminApp />);
    fireEvent.click([...container.querySelectorAll("nav.admin__nav button")].find((b) => b.textContent.trim() === "Settings"));
    const folders = [...container.querySelectorAll(".folders .folder")].map((b) => b.textContent.trim());
    expect(folders).toContain("RSVP & moderation");
    expect(folders).not.toContain("Features");
    expect(folders).not.toContain("Access");
  });

  it("legacy Settings folders unchanged", () => {
    Store.set({ clientId: "c1", loading: false });
    Store.updateSettings({ accessV2: false, features: null });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
    const { container } = render(<AdminApp />);
    fireEvent.click([...container.querySelectorAll("nav.admin__nav button")].find((b) => b.textContent.trim() === "Settings"));
    const folders = [...container.querySelectorAll(".folders .folder")].map((b) => b.textContent.trim());
    expect(folders).toContain("Features");
    expect(folders).toContain("Access");
    expect(folders).not.toContain("RSVP & moderation");
  });

  it("superadmin on an accessV2 client sees every feature tab", () => {
    Store.set({ clientId: "c1", loading: false });
    Store.updateSettings({ accessV2: true, features: { quiz: "none", music: "none" } });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
    const { container } = render(<AdminApp />);
    const tabs = navLabels(container);
    expect(tabs).toContain("Quiz");
    expect(tabs).toContain("Music playlist");
    expect(tabs).toContain("Entourage");
  });
});
