import { describe, it, expect } from "vitest";
import { donutConfig } from "@/admin/rsvp-charts.jsx";

// Dashboard > Guests > Dietary needs: hovering a slice should name the guests
// behind it. donutConfig is also used by the Attendance-split chart (no
// `names` arg there) — that path must keep behaving exactly as before.
describe("donutConfig tooltip", () => {
  const ctx = (dataIndex) => ({ dataIndex, label: "Vegetarian", parsed: 2 });

  it("lists the guests behind a slice", () => {
    const cfg = donutConfig(["Vegetarian"], [2], ["#000"], [["Ana Cruz", "Cara Santos"]]);
    const lines = cfg.options.plugins.tooltip.callbacks.afterLabel(ctx(0));
    expect(lines).toEqual(["• Ana Cruz", "• Cara Santos"]);
  });

  it("caps long name lists with a '+N more' line", () => {
    const names = Array.from({ length: 9 }, (_, i) => `Guest ${i + 1}`);
    const cfg = donutConfig(["Vegan"], [9], ["#000"], [names]);
    const lines = cfg.options.plugins.tooltip.callbacks.afterLabel(ctx(0));
    expect(lines).toHaveLength(7); // 6 names + 1 "more" line
    expect(lines.slice(0, 6)).toEqual(names.slice(0, 6).map((n) => `• ${n}`));
    expect(lines[6]).toBe("+3 more");
  });

  it("omits afterLabel entirely when no names are passed (Attendance-split chart)", () => {
    const cfg = donutConfig(["Attending"], [5], ["#000"]);
    expect(cfg.options.plugins.tooltip.callbacks.afterLabel).toBeUndefined();
  });

  it("returns undefined for a slice with no recorded names", () => {
    const cfg = donutConfig(["A", "B"], [1, 1], ["#000", "#111"], [["Solo Guest"], []]);
    expect(cfg.options.plugins.tooltip.callbacks.afterLabel(ctx(1))).toBeUndefined();
  });
});
