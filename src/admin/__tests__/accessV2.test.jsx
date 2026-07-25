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

  it("accessV2 Settings drops the legacy Access folder; superadmin gets Admin + Moderation", () => {
    Store.set({ clientId: "c1", loading: false });
    Store.updateSettings({ accessV2: true, features: {} });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
    const { container } = render(<AdminApp />);
    fireEvent.click([...container.querySelectorAll("nav.admin__nav button")].find((b) => b.textContent.trim() === "Settings"));
    const folders = [...container.querySelectorAll(".folders .folder")].map((b) => b.textContent.trim());
    expect(folders).toContain("Moderation");
    expect(folders).toContain("Admin");      // superadmin-only folder (holds the feature toggles)
    expect(folders).not.toContain("Access"); // legacy owner-grant folder is gone under v2
    expect(folders).not.toContain("Features"); // no standalone Features folder — lives under Admin
  });

  it("accessV2 owner does NOT see the superadmin-only Admin folder", () => {
    Store.set({ clientId: "c1", loading: false });
    // themeToClient lets the owner open more of Settings; Admin must still hide.
    Store.updateSettings({ accessV2: true, features: {}, showSettingsToClient: true });
    Store.setAuth({ session: { user: { email: "o@x" } }, role: "owner", clientId: "c1", email: "o@x" });
    const { container } = render(<AdminApp />);
    fireEvent.click([...container.querySelectorAll("nav.admin__nav button")].find((b) => b.textContent.trim() === "Settings"));
    const folders = [...container.querySelectorAll(".folders .folder")].map((b) => b.textContent.trim());
    expect(folders).toContain("Moderation");
    expect(folders).not.toContain("Admin");
  });

  it("superadmin Admin-folder Features & permissions set None/View/Edit levels", () => {
    Store.set({ clientId: "c1", loading: false });
    Store.updateSettings({ accessV2: true, features: {} });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
    const { container } = render(<AdminApp />);
    fireEvent.click([...container.querySelectorAll("nav.admin__nav button")].find((b) => b.textContent.trim() === "Settings"));
    fireEvent.click([...container.querySelectorAll(".folders .folder")].find((b) => b.textContent.trim() === "Admin"));
    // find a feature row by its label, then its None/View/Edit segmented button
    const seg = (label, level) => {
      const row = [...container.querySelectorAll("table.tbl tr")].find((tr) => tr.querySelector("strong")?.textContent === label);
      return [...row.querySelectorAll(".seg button")].find((b) => b.textContent.trim() === level);
    };
    // Our Story defaults to None -> set it to Edit
    fireEvent.click(seg("Our Story", "Edit"));
    expect(Store.get().settings.features.story).toBe("edit");
    // Guestbook -> View (superadmin manages content, owner can't edit)
    fireEvent.click(seg("Guestbook", "View"));
    expect(Store.get().settings.features.guestbook).toBe("view");
    // Guestbook -> None (off the site)
    fireEvent.click(seg("Guestbook", "None"));
    expect(Store.get().settings.features.guestbook).toBe("none");
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
    expect(folders).not.toContain("Moderation");
  });

  it("Show-to-Home preview falls back to SAMPLE data with a tag when the module is empty", () => {
    Store.set({ clientId: "c1", loading: false, schedule: [] });
    Store.updateSettings({ accessV2: true, features: {}, showTimeline: true });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
    const { container } = render(<AdminApp />);
    fireEvent.click([...container.querySelectorAll("nav.admin__nav button")].find((b) => b.textContent.trim() === "Schedule"));
    fireEvent.click(container.querySelector(".panel__title a"));
    // the preview itself lives in an iframe; the parent overlays the tag
    expect(document.body.textContent).toMatch(/Sample data/);
    expect(document.body.querySelector('iframe[title="Section preview"]')).toBeTruthy();
  });

  it("Show-to-Home preview uses REAL data (no tag) when the module has items", () => {
    Store.set({ clientId: "c1", loading: false, schedule: [{ time: "1:00 PM", title: "Real Thing", desc: "", loc: "" }] });
    Store.updateSettings({ accessV2: true, features: {}, showTimeline: true });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
    const { container } = render(<AdminApp />);
    fireEvent.click([...container.querySelectorAll("nav.admin__nav button")].find((b) => b.textContent.trim() === "Schedule"));
    fireEvent.click(container.querySelector(".panel__title a"));
    expect(document.body.textContent).not.toMatch(/Sample data/);
    expect(document.body.querySelector('iframe[title="Section preview"]')).toBeTruthy();
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
