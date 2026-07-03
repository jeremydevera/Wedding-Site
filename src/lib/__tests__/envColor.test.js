import { describe, it, expect } from "vitest";
import { ENV_COLORS, envColorFilter } from "@/themes";
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
  });
});
