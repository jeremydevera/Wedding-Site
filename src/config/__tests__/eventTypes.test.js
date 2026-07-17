import { describe, it, expect } from "vitest";
import { EVENT_TYPES, hasSection, themesForEvent } from "@/config/eventTypes.js";
import { THEMES } from "@/themes";

describe("event type sections", () => {
  it("birthday has full section parity — guests can RSVP / quiz / read the story", () => {
    for (const s of ["story", "details", "schedule", "venue", "gallery", "guestbook", "quiz", "rsvp"]) {
      expect(hasSection("birthday", s), `birthday should include ${s}`).toBe(true);
    }
  });
  it("every referenced theme key exists and defaults are self-consistent", () => {
    for (const [key, t] of Object.entries(EVENT_TYPES)) {
      expect(t.themes.filter((k) => !THEMES[k]), `${key} unknown themes`).toEqual([]);
      expect(t.themes.includes(t.defaultTheme), `${key} defaultTheme in list`).toBe(true);
    }
  });
  it("Olive Envelope is retired from every picker (kept in THEMES for existing clients)", () => {
    expect(themesForEvent("wedding")).not.toContain("envelope");
    expect(themesForEvent("birthday")).not.toContain("envelope");
    expect(themesForEvent("corporate")).not.toContain("envelope");
  });
  it("Velvet Envelope (envelope2) is wedding-only", () => {
    expect(themesForEvent("wedding")).toContain("envelope2");
    expect(themesForEvent("birthday")).not.toContain("envelope2");
  });
});
