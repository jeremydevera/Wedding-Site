import { describe, it, expect } from "vitest";
import { ENV_COLORS, envColorFilter, envColorFilterFor, envCustomFilter, envSitePalette, rgbToOklchHue, hexToRgb } from "@/themes";
import { DEFAULT_SETTINGS } from "@/lib/store.jsx";
import { clientToState, stateToClientRow } from "@/lib/mappers.js";

describe("envelope paper color presets", () => {
  it("defaults to olive with an empty (no-op) filter", () => {
    expect(DEFAULT_SETTINGS.envColor).toBe("olive");
    expect(envColorFilter("olive")).toBe("");
    expect(envColorFilter(undefined)).toBe("");
    expect(envColorFilter("not-a-color")).toBe("");
  });

  it("every non-olive preset has a valid filter chain, label and swatch dot", () => {
    for (const [key, c] of Object.entries(ENV_COLORS)) {
      expect(c.label).toBeTruthy();
      expect(c.dot).toMatch(/^#[0-9a-f]{6}$/);
      if (key !== "olive") {
        expect(c.filter).toMatch(/^(hue-rotate\(-?\d+deg\) )?saturate\(\d*\.?\d+\) brightness\(\d*\.?\d+\)$/);
        expect(envColorFilter(key)).toBe(c.filter);
      }
    }
  });

  it("round-trips envColor through the client row mapping", () => {
    const state = { settings: { ...DEFAULT_SETTINGS, theme: "envelope", envColor: "wine" }, schedule: [], story: [], faq: [], quiz: [], venueCards: [], detailCards: [], entourage: [], attire: [], playlist: [] };
    const row = stateToClientRow(state);
    expect(row.content.envColor).toBe("wine");
    const back = clientToState({ id: "c1", template_key: "envelope", event_type: "wedding", theme: {}, content: row.content });
    expect(back.settings.envColor).toBe("wine");
  });

  it("legacy clients without envColor fall back to olive", () => {
    const back = clientToState({ id: "c1", template_key: "envelope", event_type: "wedding", theme: {}, content: {} });
    expect(back.settings.envColor).toBe("olive");
    expect(back.settings.envMatchSite).toBe(true);
  });

  it("includes a terracotta preset", () => {
    expect(ENV_COLORS.terracotta).toBeTruthy();
    expect(ENV_COLORS.terracotta.filter).toContain("hue-rotate(-50deg)");
  });
});

describe("custom envelope color", () => {
  it("solves a valid filter chain for any hex, cached and deterministic", () => {
    const f1 = envCustomFilter("#9e6243");
    expect(f1).toMatch(/^hue-rotate\(\d+deg\) saturate\(\d+\.\d+\) brightness\(\d+\.\d+\)$/);
    expect(envCustomFilter("#9e6243")).toBe(f1);
    expect(envCustomFilter("#9E6243")).toBe(f1); // case-insensitive cache key
  });

  it("returns empty filter for invalid hex", () => {
    expect(envCustomFilter("")).toBe("");
    expect(envCustomFilter("red")).toBe("");
    expect(envCustomFilter("#12")).toBe("");
  });

  it("envColorFilterFor dispatches preset vs custom", () => {
    expect(envColorFilterFor("wine", "")).toBe(ENV_COLORS.wine.filter);
    expect(envColorFilterFor("custom", "#404a68")).toMatch(/^hue-rotate/);
    expect(envColorFilterFor("custom", "")).toBe("");
    expect(envColorFilterFor(undefined, undefined)).toBe("");
  });

  it("a near-olive custom pick needs almost no rotation", () => {
    // base paper is #6f743e; solving for (nearly) itself should stay close to identity
    const m = /hue-rotate\((\d+)deg\) saturate\((\d+\.\d+)\) brightness\((\d+\.\d+)\)/.exec(envCustomFilter("#6f743e"));
    const deg = parseInt(m[1], 10);
    expect(deg < 15 || deg > 345).toBe(true);
    expect(parseFloat(m[2])).toBeGreaterThan(0.8);
    expect(parseFloat(m[2])).toBeLessThan(1.25);
    expect(parseFloat(m[3])).toBeGreaterThan(0.85);
    expect(parseFloat(m[3])).toBeLessThan(1.15);
  });
});

describe("envelope site palette", () => {
  it("stays native for olive / disabled / invalid custom", () => {
    expect(envSitePalette("olive", "", true)).toBeNull();
    expect(envSitePalette("navy", "", false)).toBeNull();
    expect(envSitePalette("custom", "nope", true)).toBeNull();
    expect(envSitePalette(undefined, undefined, undefined)).toBeNull();
  });

  it("re-hues the palette for a preset", () => {
    const pal = envSitePalette("navy", "", true);
    expect(pal["--accent"]).toBe("oklch(0.48 0.075 262)");
    expect(pal["--bg"]).toContain(" 262)");
    expect(pal["--hero-tint"]).toContain("/ 0.46)");
    // muted papers scale chroma down
    const sage = envSitePalette("sage", "", true);
    expect(sage["--accent"]).toContain("0.052");
  });

  it("derives the hue from a custom hex via oklch", () => {
    expect(Math.round(rgbToOklchHue(hexToRgb("#ff0000")))).toBe(29);
    expect(Math.round(rgbToOklchHue(hexToRgb("#0000ff")))).toBe(264);
    const pal = envSitePalette("custom", "#404a68", true); // navy-ish
    const h = parseInt(/ (\d+)\)$/.exec(pal["--accent"])[1], 10);
    expect(h).toBeGreaterThan(240);
    expect(h).toBeLessThan(290);
    // near-grey pick → near-neutral palette
    const grey = envSitePalette("custom", "#565655", true);
    expect(parseFloat(grey["--accent"].split(" ")[1])).toBeLessThan(0.02);
  });
});
