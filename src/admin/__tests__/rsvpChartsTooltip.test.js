import { describe, it, expect } from "vitest";
import { buildTooltipHtml, donutConfig } from "@/admin/rsvp-charts.jsx";

// Dashboard > Guests > Dietary needs (and Attendance split) — hovering a slice
// must list EVERY guest in it, not a capped preview (owner request). A native
// Chart.js tooltip draws onto the chart's own canvas, so a long list would
// silently clip past the ~240px-tall chart — donutConfig instead disables the
// canvas tooltip and hands rendering to an external DOM node (rsvp-tip in
// styles.css) built from this pure, unit-testable HTML string.
describe("buildTooltipHtml", () => {
  it("shows the label/count with no list when there are no names", () => {
    expect(buildTooltipHtml("Attending", 5, undefined)).toBe(
      '<div class="rsvp-tip__head">Attending: <strong>5</strong></div>',
    );
    expect(buildTooltipHtml("Attending", 5, [])).toBe(
      '<div class="rsvp-tip__head">Attending: <strong>5</strong></div>',
    );
  });

  it("lists every name, in order — no cap, however long the list", () => {
    const names = Array.from({ length: 22 }, (_, i) => `Guest ${i + 1}`);
    const html = buildTooltipHtml("Seafood allergy", 22, names);
    expect(html).toContain("Seafood allergy: <strong>22</strong>");
    names.forEach((n) => expect(html).toContain(`<li>${n}</li>`));
    expect((html.match(/<li>/g) || []).length).toBe(22);
  });

  it("escapes guest-supplied names before they reach innerHTML", () => {
    const html = buildTooltipHtml("Attending", 1, ['<img src=x onerror="alert(1)">Mallory & co']);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;Mallory &amp; co");
  });
});

describe("donutConfig", () => {
  it("disables the canvas tooltip and delegates to an external renderer", () => {
    const cfg = donutConfig(["Attending"], [5], ["#000"], [["Ana Cruz"]]);
    expect(cfg.options.plugins.tooltip.enabled).toBe(false);
    expect(typeof cfg.options.plugins.tooltip.external).toBe("function");
  });

  it("still returns a usable external callback when no names are passed", () => {
    const cfg = donutConfig(["Attending"], [5], ["#000"]);
    expect(typeof cfg.options.plugins.tooltip.external).toBe("function");
  });
});
