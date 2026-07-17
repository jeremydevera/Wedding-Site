import { describe, it, expect } from "vitest";
import { THEMES, THEME_FONTS, THEME_BTN, isEnvelopeTheme, isPremiumTheme, PREMIUM_THEMES } from "@/themes";
import { themesForEvent } from "@/config/eventTypes.js";

// "Envelope 2" is a duplicate of Olive Envelope: its own theme key that behaves
// identically (same vars, fonts, button shape, premium arrange, envelope art)
// via the isEnvelopeTheme() predicate.
describe("Envelope 2 theme (duplicate of Olive Envelope)", () => {
  it("exists in THEMES labelled 'Velvet Envelope' with the envelope vars", () => {
    expect(THEMES.envelope2).toBeTruthy();
    expect(THEMES.envelope2.label).toBe("Velvet Envelope");
    // identical palette to the original (this is a duplicate, not a re-theme)
    expect(THEMES.envelope2.vars).toEqual(THEMES.envelope.vars);
  });

  it("carries the same fonts + button radius as Olive Envelope", () => {
    expect(THEME_FONTS.envelope2).toEqual(THEME_FONTS.envelope);
    expect(THEME_BTN.envelope2).toBe(THEME_BTN.envelope);
  });

  it("is treated as an envelope-family theme (art, hero replacement, color system)", () => {
    expect(isEnvelopeTheme("envelope2")).toBe(true);
    expect(isEnvelopeTheme("envelope")).toBe(true);
    expect(isEnvelopeTheme("classic")).toBe(false);
  });

  it("is a premium theme (arrange tool, decor gating)", () => {
    expect(isPremiumTheme("envelope2")).toBe(true);
    expect(PREMIUM_THEMES).toContain("envelope2");
  });

  it("is offered on weddings only (matching Olive Envelope)", () => {
    expect(themesForEvent("wedding")).toContain("envelope2");
    expect(themesForEvent("birthday")).not.toContain("envelope2");
    expect(themesForEvent("corporate")).not.toContain("envelope2");
  });
});
