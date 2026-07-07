import { describe, it, expect } from "vitest";
import { visibleAdminTabs, canEnterAdmin, moduleEnabled } from "@/lib/roles.js";

const TABS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "guestbook", label: "Guestbook" },
  { key: "media", label: "Media" },
  { key: "settings", label: "Settings" },
];

describe("visibleAdminTabs", () => {
  it("superadmin sees Overview, Clients, and Media (no per-event tabs)", () => {
    const keys = visibleAdminTabs("superadmin", TABS).map((t) => t.key);
    expect(keys).toContain("overview");
    expect(keys).toContain("clients");
    expect(keys).toContain("r2media");
    expect(keys).not.toContain("dashboard");
    expect(keys).not.toContain("guestbook");
  });
  it("owner loses settings, media, and never sees clients", () => {
    const keys = visibleAdminTabs("owner", TABS).map((t) => t.key);
    expect(keys).not.toContain("settings");
    expect(keys).not.toContain("media");
    expect(keys).not.toContain("clients");
    expect(keys).toContain("guestbook");
  });
  it("ownerEdit grants open individual content tabs to the owner", () => {
    const ALL = [...TABS, { key: "home" }, { key: "schedule" }, { key: "venue" }, { key: "details" }, { key: "story" }];
    const keys = (g) => visibleAdminTabs("owner", ALL, g).map((t) => t.key);
    expect(keys(undefined)).not.toContain("home");
    expect(keys(undefined)).not.toContain("details");
    expect(keys({ home: true })).toContain("home");
    expect(keys({ home: true })).not.toContain("schedule");
    expect(keys({ schedule: true })).toContain("schedule");
    expect(keys({ venue: true })).toContain("venue");
    expect(keys({ details: true })).toContain("details");
    expect(keys({ details: true })).not.toContain("home");
    expect(keys({ story: true })).toContain("story");
    expect(keys(undefined)).not.toContain("story");
    // any Home-folder grant (entourage/maps/timeline/attire/music) exposes Home
    expect(keys({ entourage: true })).toContain("home");
    expect(keys({ maps: true })).toContain("home");
    expect(keys({ timeline: true })).toContain("home");
    expect(keys({ attire: true })).toContain("home");
    expect(keys({ music: true })).toContain("home");
    // grants never open the superadmin-only Settings/Media tabs
    const all = { home: true, maps: true, timeline: true, attire: true, music: true, entourage: true, schedule: true, venue: true };
    expect(keys(all)).not.toContain("settings");
    expect(keys(all)).not.toContain("media");
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
