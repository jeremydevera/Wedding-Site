import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { Store } from "@/lib/store.jsx";
import { AdminApp } from "@/admin/manage.jsx";

const navLabels = (c) => [...c.querySelectorAll("nav.admin__nav button")].map((b) => b.textContent.trim());
const folderLabels = (c) => [...c.querySelectorAll(".folders .folder")].map((b) => b.textContent.trim());
const clickByText = (c, sel, text) => {
  const el = [...c.querySelectorAll(sel)].find((b) => b.textContent.trim() === text);
  if (!el) throw new Error(`no ${sel} with text "${text}" — found: ${[...c.querySelectorAll(sel)].map((b) => b.textContent.trim()).join(", ")}`);
  fireEvent.click(el);
  return el;
};
const hasButton = (c, text) => [...c.querySelectorAll("button")].some((b) => b.textContent.trim() === text);
const hasSwitch = (c, label) => !!c.querySelector(`button[aria-label="${label}"]`);

describe("Home tab — folder sub-tabs", () => {
  beforeEach(() => cleanup());

  it("Entourage is no longer a top-level nav tab", () => {
    Store.set({ clientId: "c1", loading: false });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
    const { container } = render(<AdminApp />);
    expect(navLabels(container)).toContain("Home");
    expect(navLabels(container)).not.toContain("Entourage");
  });

  it("superadmin-on-client: Home has all four folders, each with a working save", () => {
    Store.set({ clientId: "c1", loading: false });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
    const { container } = render(<AdminApp />);
    clickByText(container, "nav.admin__nav button", "Home");

    expect(folderLabels(container)).toEqual([
      "Couple & Event", "Invitation", "Google Maps", "Timeline", "Attire", "Music playlist", "Entourage",
    ]);

    // Couple & Event (default) → explicit Save button
    expect(hasButton(container, "Save changes")).toBe(true);

    // Invitation → explicit Save button
    clickByText(container, ".folders .folder", "Invitation");
    expect(hasButton(container, "Save changes")).toBe(true);

    // Music playlist → show toggle + upload (save) action present
    clickByText(container, ".folders .folder", "Music playlist");
    expect(hasSwitch(container, "Show music player on the home page")).toBe(true);
    expect(container.textContent).toMatch(/Autoplay music on load/);
    expect(container.textContent).toMatch(/Music Playlist/);
    expect(hasButton(container, "+ Add music")).toBe(true);

    // Entourage → show toggle + add-group (save) action present
    clickByText(container, ".folders .folder", "Entourage");
    expect(hasSwitch(container, "Show entourage on the home page")).toBe(true);
    expect(hasButton(container, "+ Add group")).toBe(true);

    // Attire → show toggle + add-group (save) action present
    clickByText(container, ".folders .folder", "Attire");
    expect(hasSwitch(container, "Show attire guide on the home page")).toBe(true);
    expect(container.textContent).toMatch(/Attire guide/);
    expect(hasButton(container, "+ Add group")).toBe(true);

    // Google Maps → show toggle + home-map picker (no editor list here) + Save
    clickByText(container, ".folders .folder", "Google Maps");
    expect(hasSwitch(container, "Show map on the home page")).toBe(true);
    expect(container.textContent).toMatch(/Home page map/);
    expect(container.textContent).toMatch(/Map to show on home/);
    expect(hasButton(container, "Save changes")).toBe(true);

    // Timeline → vertical/horizontal layout picker
    clickByText(container, ".folders .folder", "Timeline");
    expect(hasSwitch(container, "Show timeline on the home page")).toBe(true);
    expect(container.textContent).toMatch(/Home timeline/);
    expect(container.textContent).toMatch(/Vertical/);
    expect(container.textContent).toMatch(/Horizontal/);
  });

  it("owner: does not see the Home tab (superadmin-only)", () => {
    Store.set({ clientId: "c1", loading: false });
    Store.setAuth({ session: { user: { email: "o@x" } }, role: "owner", clientId: "c1", email: "o@x" });
    const { container } = render(<AdminApp />);
    expect(navLabels(container)).not.toContain("Home");
    // still gets the guest-response tabs
    expect(navLabels(container)).toEqual(expect.arrayContaining(["Dashboard", "Guestbook"]));
  });
});
