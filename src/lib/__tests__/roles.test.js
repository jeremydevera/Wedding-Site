import { describe, it, expect } from "vitest";
import { visibleAdminTabs, canEnterAdmin, moduleEnabled } from "@/lib/roles.js";

const TABS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "guestbook", label: "Guestbook" },
  { key: "media", label: "Media" },
  { key: "settings", label: "Settings" },
];

describe("visibleAdminTabs", () => {
  it("superadmin sees Overview + Clients (no per-event tabs)", () => {
    const keys = visibleAdminTabs("superadmin", TABS).map((t) => t.key);
    expect(keys).toEqual(["overview", "clients"]);
  });
  it("owner loses settings, media, and never sees clients", () => {
    const keys = visibleAdminTabs("owner", TABS).map((t) => t.key);
    expect(keys).not.toContain("settings");
    expect(keys).not.toContain("media");
    expect(keys).not.toContain("clients");
    expect(keys).toContain("guestbook");
  });
});

describe("canEnterAdmin", () => {
  it("superadmin enters any client", () => {
    expect(canEnterAdmin({ role: "superadmin", clientId: null }, "c1")).toBe(true);
  });
  it("owner enters only their own client", () => {
    expect(canEnterAdmin({ role: "owner", clientId: "c1" }, "c1")).toBe(true);
    expect(canEnterAdmin({ role: "owner", clientId: "c2" }, "c1")).toBe(false);
  });
  it("guest/none cannot enter", () => {
    expect(canEnterAdmin({ role: "guest", clientId: null }, "c1")).toBe(false);
    expect(canEnterAdmin(null, "c1")).toBe(false);
  });
});

describe("moduleEnabled", () => {
  it("defaults to on when no modules map or key absent", () => {
    expect(moduleEnabled(undefined, "guestbook")).toBe(true);
    expect(moduleEnabled({}, "quiz")).toBe(true);
  });
  it("respects explicit flags", () => {
    expect(moduleEnabled({ quiz: false }, "quiz")).toBe(false);
    expect(moduleEnabled({ quiz: false, guestbook: true }, "guestbook")).toBe(true);
  });
});
