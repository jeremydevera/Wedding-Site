import { describe, it, expect, vi, afterEach } from "vitest";
import { buildTooltipHtml, donutConfig, TIP_MAX_NAMES } from "@/admin/rsvp-charts.jsx";

// Dashboard > Guests > Dietary needs (and Attendance split). Clicking/hovering a
// slice lists at most TIP_MAX_NAMES guests and then a "See more" row that opens
// the RSVPs page (owner request, replacing the earlier uncapped list: a 22-name
// tower was taller than the card it sprang from). A native Chart.js tooltip
// draws onto the chart's own canvas, where neither a clickable row nor a
// scrollbar can exist — donutConfig disables it and hands rendering to an
// external DOM node (rsvp-tip in styles.css) built from this pure HTML string.
describe("buildTooltipHtml", () => {
  it("shows the label/count with no list when there are no names", () => {
    expect(buildTooltipHtml("Attending", 5, undefined)).toBe(
      '<div class="rsvp-tip__head">Attending: <strong>5</strong></div>',
    );
    expect(buildTooltipHtml("Attending", 5, [])).toBe(
      '<div class="rsvp-tip__head">Attending: <strong>5</strong></div>',
    );
  });

  it("caps the list at 5 names and ends with a See more row carrying the remainder", () => {
    const names = Array.from({ length: 22 }, (_, i) => `Guest ${i + 1}`);
    const html = buildTooltipHtml("Seafood allergy", 22, names);
    expect(html).toContain("Seafood allergy: <strong>22</strong>");
    expect((html.match(/<li/g) || []).length).toBe(TIP_MAX_NAMES + 1); // 5 names + See more
    names.slice(0, 5).forEach((n) => expect(html).toContain(`<li>${n}</li>`));
    expect(html).not.toContain("Guest 6");     // capped
    expect(html).toContain("See more (+17)");  // 22 - 5
    expect(html).toContain('class="rsvp-tip__more"');
  });

  it("adds NO See more row when the slice fits (<= 5 names)", () => {
    const html = buildTooltipHtml("Maybe", 5, ["A", "B", "C", "D", "E"]);
    expect((html.match(/<li/g) || []).length).toBe(5);
    expect(html).not.toContain("See more");
    expect(html).not.toContain("rsvp-tip__more");
  });

  it("escapes guest-supplied names before they reach innerHTML", () => {
    const html = buildTooltipHtml("Attending", 1, ['<img src=x onerror="alert(1)">Mallory & co']);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;Mallory &amp; co");
  });
});

// Drive the external renderer the way Chart.js does, then click the row. A REAL
// canvas element: the renderer attaches pointer listeners to it (that's how the
// tooltip anchors on the cursor instead of the arc's centroid).
function fakeChart() {
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 });
  return { canvas };
}
const CHART = fakeChart();
function showTooltip(cfg, dataIndex = 0) {
  cfg.options.plugins.tooltip.external({
    chart: CHART,
    tooltip: { opacity: 1, dataPoints: [{ dataIndex }], caretX: 20, caretY: 20 },
  });
  return document.getElementById("rsvp-tip-global");
}
function hideTooltip(cfg) {
  cfg.options.plugins.tooltip.external({ chart: CHART, tooltip: { opacity: 0, dataPoints: [] } });
}

describe("donutConfig", () => {
  afterEach(() => {
    const el = document.getElementById("rsvp-tip-global");
    if (el) el.remove();
    vi.useRealTimers();
  });

  it("disables the canvas tooltip and delegates to an external renderer", () => {
    const cfg = donutConfig(["Attending"], [5], ["#000"], [["Ana Cruz"]]);
    expect(cfg.options.plugins.tooltip.enabled).toBe(false);
    expect(typeof cfg.options.plugins.tooltip.external).toBe("function");
  });

  it("still returns a usable external callback when no names are passed", () => {
    const cfg = donutConfig(["Attending"], [5], ["#000"]);
    expect(typeof cfg.options.plugins.tooltip.external).toBe("function");
  });

  it("clicking See more calls onSeeMore (the dashboard's jump to the RSVPs page)", () => {
    const onSeeMore = vi.fn();
    const names = Array.from({ length: 9 }, (_, i) => `G${i}`);
    const cfg = donutConfig(["Attending"], [9], ["#000"], [names], onSeeMore);
    const el = showTooltip(cfg);
    const more = el.querySelector(".rsvp-tip__more");
    expect(more).toBeTruthy();
    more.click();
    expect(onSeeMore).toHaveBeenCalledTimes(1);
    expect(el.style.opacity).toBe("0"); // and it closes itself
  });

  it("a click anywhere else in the tooltip does NOT navigate", () => {
    const onSeeMore = vi.fn();
    const cfg = donutConfig(["Attending"], [9], ["#000"], [Array.from({ length: 9 }, (_, i) => `G${i}`)], onSeeMore);
    const el = showTooltip(cfg);
    el.querySelector(".rsvp-tip__list li").click();
    el.querySelector(".rsvp-tip__head").click();
    expect(onSeeMore).not.toHaveBeenCalled();
  });

  // Regression: an invisible pointer-events:auto box would swallow clicks meant
  // for whatever sits under its last position.
  it("is only clickable while visible (is-on tracks opacity)", () => {
    vi.useFakeTimers();
    const cfg = donutConfig(["Attending"], [9], ["#000"], [Array.from({ length: 9 }, (_, i) => `G${i}`)], () => {});
    const el = showTooltip(cfg);
    expect(el.classList.contains("is-on")).toBe(true);
    hideTooltip(cfg);
    expect(el.classList.contains("is-on")).toBe(true); // hide is delayed, not instant…
    vi.advanceTimersByTime(300);
    expect(el.classList.contains("is-on")).toBe(false); // …then released
    expect(el.style.opacity).toBe("0");
  });

  // The delay is what makes the row reachable: the pointer has to cross a gap to
  // get from the canvas onto the tooltip.
  it("keeps the tooltip open when the pointer enters it after leaving the chart", () => {
    vi.useFakeTimers();
    const cfg = donutConfig(["Attending"], [9], ["#000"], [Array.from({ length: 9 }, (_, i) => `G${i}`)], () => {});
    const el = showTooltip(cfg);
    hideTooltip(cfg);                                   // cursor left the canvas
    el.dispatchEvent(new Event("mouseenter"));          // …and landed on the tooltip
    vi.advanceTimersByTime(1000);
    expect(el.style.opacity).toBe("1");                 // still there to be clicked
    el.dispatchEvent(new Event("mouseleave"));
    expect(el.style.opacity).toBe("0");                 // and gone as soon as it's left
  });
});
