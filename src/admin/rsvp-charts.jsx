import React from "react";
import { Chart as ChartJS, DoughnutController, ArcElement, Tooltip, Legend } from "chart.js";
import { rsvpStats } from "@/lib/rsvp.js";

const { useRef, useEffect, useMemo } = React;

ChartJS.register(DoughnutController, ArcElement, Tooltip, Legend);

// Adminator-style vibrant palette (matches the template's charts page).
const STATUS_COLORS = ["#2E5BFF", "#8C54FF", "#4D9FEC"]; // attending / maybe / declined (royal / purple / sky, like the reference)
const DIET_COLORS = ["#2E5BFF", "#8C54FF", "#4D9FEC", "#10B981", "#F59E0B", "#EC4899", "#64748B", "#FD7E14"];

// Mount a Chart.js instance on a ref'd canvas; destroy on unmount/deps change.
function useChart(ref, getConfig, deps) {
  const inst = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    if (inst.current) { inst.current.destroy(); inst.current = null; }
    inst.current = new ChartJS(ref.current, getConfig());
    return () => {
      if (inst.current) { inst.current.destroy(); inst.current = null; }
      // externalTooltip appends its DOM node to document.body (see below) —
      // Chart.js's own destroy() doesn't know about it, so a re-render while
      // mid-hover would otherwise leave a stale tooltip on screen.
      const stray = document.getElementById("rsvp-tip-global");
      if (stray) hideTip(stray);
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// At most this many names in a slice's tooltip; the rest live on the RSVPs page.
// (Owner request, superseding the earlier "show everyone": a 20+ name tower was
// taller than the dashboard card it sprang from.)
export const TIP_MAX_NAMES = 5;
// Class on the last row when the slice holds more than TIP_MAX_NAMES. The click
// handler in externalTooltip looks for exactly this, so keep them in sync.
const MORE_CLASS = "rsvp-tip__more";

// Tooltip body for one slice: "Label: N", the first TIP_MAX_NAMES guests, and —
// when the slice holds more — a final "See more" row that opens the RSVPs page.
// Pure + exported so the cap and the HTML-escaping are unit-tested without a
// browser. The DOM host that positions this HTML lives in externalTooltip below;
// a plain Chart.js canvas tooltip can't do this because its content is drawn
// onto the canvas itself, so neither a scrollbar nor a clickable row can exist
// there — those are DOM affordances, and canvas pixels outside the element are
// simply not there.
export function buildTooltipHtml(label, value, names) {
  const head = `<div class="rsvp-tip__head">${escapeHtml(label)}: <strong>${value}</strong></div>`;
  if (!names || !names.length) return head;
  const shown = names.slice(0, TIP_MAX_NAMES);
  const rest = names.length - shown.length;
  const items = shown.map((n) => `<li>${escapeHtml(n)}</li>`).join("");
  // role=button + tabindex: it behaves like a control, and it is one — but a real
  // <button> inside the tooltip would be reachable by Tab even while the tooltip
  // is invisible (opacity:0 does not remove focusability), which would strand
  // keyboard focus on a hidden target.
  const more = rest > 0
    ? `<li class="${MORE_CLASS}" role="button" tabindex="-1">See more (+${rest}) →</li>`
    : "";
  return `${head}<ul class="rsvp-tip__list">${items}${more}</ul>`;
}

// One shared tooltip node, appended directly to <body> (NOT a canvas sibling).
// 🔴 Positioning it inside .rsvp-donut-wrap (its old home) put it at the mercy
// of every ancestor's stacking context: on a real phone it rendered BEHIND the
// "Recent RSVPs" table further down the dashboard (owner-reported, screenshot).
// z-index alone couldn't fix that — .rsvp-donut-wrap's position:relative has no
// z-index of its own, so it never isolates a stacking context, meaning the tip's
// z-index was being compared against unrelated elements many levels up, not
// just its siblings. A body-level, position:fixed node sidesteps the whole
// question: nothing on the page can out-stack it short of another equally
// deliberate body-level overlay (there is none here). Only one can ever be
// visible at a time (a mouse hovers one chart at a time), so one shared node
// serving both charts is simpler than one each.
// The tooltip is now INTERACTIVE (its "See more" row is a click target), which
// it could not be while it was pointer-events:none. Two pieces make that safe:
//   1. hiding is DELAYED (HIDE_DELAY_MS) — Chart.js reports opacity 0 the moment
//      the cursor leaves the canvas, including while it crosses the 10px gap on
//      its way to the tooltip; hiding instantly would pull the row out from
//      under the pointer mid-travel.
//   2. entering the tooltip CANCELS that pending hide, and leaving it hides at
//      once. So the tooltip lives exactly as long as the pointer is on the chart
//      or on the tooltip itself, and never lingers after both.
const HIDE_DELAY_MS = 240;
let hideTimer = null;
// 🔴 Whether the pointer is currently INSIDE the tooltip. Clearing the timer on
// mouseenter is not enough on its own: the tooltip swallows the pointer events
// the canvas used to get, so Chart.js fires its "pointer left" callback AFTER
// mouseenter and re-arms the hide, closing the tooltip ~240ms later with the
// cursor still resting on it (traced in a real browser: mouseenter at t=94ms,
// canvas mouseout at t=94ms, hidden at t=336ms). This flag is what makes the
// hide request a no-op for as long as the pointer is on the tooltip.
let overTip = false;
function hideTip(el) {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  el.style.opacity = "0";
  el.classList.remove("is-on"); // back to pointer-events:none — see .rsvp-tip in styles.css
}
function tooltipEl() {
  let el = document.getElementById("rsvp-tip-global");
  if (!el) {
    el = document.createElement("div");
    el.id = "rsvp-tip-global";
    el.className = "rsvp-tip";
    // `onSeeMore` is re-attached on every render below, so the listener always
    // routes to whichever chart is currently showing.
    el.addEventListener("click", (e) => {
      if (!e.target || !e.target.closest || !e.target.closest(".rsvp-tip__more")) return;
      hideTip(el);
      if (typeof el.__onSeeMore === "function") el.__onSeeMore();
    });
    el.addEventListener("mouseenter", () => {
      overTip = true;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    });
    el.addEventListener("mouseleave", () => { overTip = false; hideTip(el); });
    document.body.appendChild(el);
  }
  return el;
}

// Last pointer position over a chart canvas, in viewport coordinates — Chart.js
// doesn't hand the pointer to an external tooltip, only the arc's caret (see the
// 🔴 note where this is used). Pointer events cover mouse AND touch, so a tap on
// a phone anchors the tooltip the same way a hover does on a desktop.
const lastPointer = { x: 0, y: 0, at: 0 };
function trackPointer(canvas) {
  if (canvas.__rsvpTipTracked || typeof canvas.addEventListener !== "function") return;
  canvas.__rsvpTipTracked = true;
  const upd = (e) => { lastPointer.x = e.clientX; lastPointer.y = e.clientY; lastPointer.at = Date.now(); };
  canvas.addEventListener("pointermove", upd);
  canvas.addEventListener("pointerdown", upd);
}
// Only trust the tracked pointer when it actually lies on this canvas — a chart
// shown without a pointer (keyboard, programmatic hover, a stale value from the
// other chart) must fall back to the caret rather than fly off somewhere.
function pointerIn(rect) {
  return lastPointer.at > 0
    && lastPointer.x >= rect.left && lastPointer.x <= rect.right
    && lastPointer.y >= rect.top && lastPointer.y <= rect.bottom;
}

// Chart.js "external" tooltip: instead of Chart.js drawing on the canvas, it
// calls us with the current tooltip model and we position the shared DOM node
// (scrollable — see .rsvp-tip in styles.css) using fixed, viewport-relative
// coordinates. `names` is optional and parallel to labels/values.
function externalTooltip(labels, values, names, onSeeMore) {
  return (context) => {
    const { chart, tooltip } = context;
    const el = tooltipEl();
    if (chart && chart.canvas) trackPointer(chart.canvas);
    const dp = tooltip && tooltip.dataPoints;
    if (!tooltip || tooltip.opacity === 0 || !dp || !dp.length) {
      // Delayed, cancellable — see HIDE_DELAY_MS above. Without this the "See
      // more" row vanishes the instant the pointer leaves the canvas, so it
      // could never be clicked.
      if (overTip) return; // pointer is on the tooltip itself — it stays open
      if (!hideTimer) hideTimer = setTimeout(() => { hideTimer = null; hideTip(el); }, HIDE_DELAY_MS);
      return;
    }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    const idx = dp[0].dataIndex;
    el.innerHTML = buildTooltipHtml(labels[idx], values[idx], names ? names[idx] : null);
    el.__onSeeMore = onSeeMore;
    el.style.opacity = "1";
    el.classList.add("is-on"); // clickable only while visible
    // 🔴 Anchor on the POINTER, not on tooltip.caretX/Y. The caret of a doughnut
    // sits at the hovered arc's centroid, which for a slice covering most of the
    // ring is nowhere near the cursor — measured in a real browser, a 9-of-12
    // slice hovered at 3 o'clock put the caret low enough that the tooltip box
    // (top 131 → bottom 330) swallowed the cursor at y=275. A tooltip under the
    // pointer is not a cosmetic problem now that it is clickable: it takes the
    // hover away from the canvas, so the chart drops its slice highlight and the
    // next slice can't be reached without leaving the tooltip first.
    // GAP is measured from the pointer, so the tooltip never contains it.
    const rect = chart.canvas.getBoundingClientRect();
    const p = pointerIn(rect) ? lastPointer : { x: rect.left + tooltip.caretX, y: rect.top + tooltip.caretY };
    const GAP = 14;
    const half = el.offsetWidth / 2;
    const pad = 8;
    // Clamp against the WINDOW (not the canvas) so it can't run off either side
    // of a narrow phone.
    const left = Math.max(half + pad, Math.min(window.innerWidth - half - pad, p.x));
    const fitsAbove = p.y - el.offsetHeight - GAP > 0;
    el.style.left = `${left}px`;
    el.style.top = `${p.y}px`;
    el.style.transform = fitsAbove
      ? `translate(-50%, calc(-100% - ${GAP}px))`
      : `translate(-50%, ${GAP}px)`;
  };
}

// Adminator-style doughnut: big hole, white gaps + rounded slice ends, and the
// legend as labelled dots on the right side of the chart. `names` (optional,
// parallel to labels/values) lists the guests behind each slice — the first
// TIP_MAX_NAMES show on hover via externalTooltip, with a "See more" row that
// calls `onSeeMore` (the dashboard passes a jump to the RSVPs tab).
export function donutConfig(labels, values, colors, names, onSeeMore) {
  return {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        // hairline white seams between slices, square ends (like the reference)
        borderWidth: 2,
        borderColor: "#ffffff",
        spacing: 0,
        borderRadius: 0,
        hoverOffset: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      layout: { padding: 6 }, // room for hoverOffset so slices don't clip
      plugins: {
        legend: { display: false }, // HTML legend beside the chart (aligned counts)
        tooltip: { enabled: false, external: externalTooltip(labels, values, names, onSeeMore) },
      },
      animation: { duration: 900, easing: "easeInOutQuart" },
    },
  };
}

function DonutCard({ eyebrow, title, badge, canvasRef, hasData, empty, legend }) {
  return (
    <div className="rsvp-chart-card">
      <div className="rsvp-chart-card__head">
        <div>
          <span className="rsvp-chart-card__eyebrow">{eyebrow}</span>
          <span className="rsvp-chart-card__title">{title}</span>
        </div>
        {badge && <span className="rsvp-chart-card__badge">{badge}</span>}
      </div>
      {hasData ? (
        <div className="rsvp-chart-body">
          <div className="rsvp-donut-wrap"><canvas ref={canvasRef} /></div>
          <div className="rsvp-chart-legend">
            {(legend || []).map(([l, c, v]) => (
              <div key={l} className="rsvp-legend-row">
                <span className="rsvp-legend-dot" style={{ background: c }} />
                <span className="rsvp-legend-label">{l}:</span>
                <span className="rsvp-legend-val">{v}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rsvp-chart-empty">{empty}</div>
      )}
    </div>
  );
}

export function RsvpCharts({ rsvps, onSeeMore }) {
  const stats = useMemo(() => rsvpStats(rsvps), [rsvps]);
  const dietEntries = useMemo(
    () => Object.entries(stats.diets).sort((a, b) => b[1] - a[1]).slice(0, 8),
    [stats.diets],
  );

  const statusRef = useRef(null);
  const dietRef   = useRef(null);

  // onSeeMore is read through a ref so a new callback identity from the parent's
  // re-render can't tear down and rebuild both Chart.js instances (which would
  // replay the 900ms sweep-in animation on every dashboard update).
  const seeMoreRef = useRef(onSeeMore);
  seeMoreRef.current = onSeeMore;
  const seeMore = () => { if (seeMoreRef.current) seeMoreRef.current(); };

  useChart(statusRef, () => donutConfig(
    ["Attending", "Maybe", "Declined"],
    [stats.attendingParties, stats.maybe, stats.declined],
    STATUS_COLORS,
    [stats.statusNames.attending, stats.statusNames.maybe, stats.statusNames.declined],
    seeMore,
  ), [stats.attendingParties, stats.maybe, stats.declined, stats.statusNames]);

  useChart(dietRef, () => donutConfig(
    dietEntries.map(([k]) => k),
    dietEntries.map(([, v]) => v),
    dietEntries.map((_, i) => DIET_COLORS[i % DIET_COLORS.length]),
    dietEntries.map(([k]) => stats.dietNames[k] || []),
    seeMore,
  ), [dietEntries, stats.dietNames]);

  if (!rsvps.length) return null;

  return (
    <div className="rsvp-charts">
      <div className="rsvp-charts__row">
        <DonutCard
          eyebrow="RSVPs" title="Attendance split"
          canvasRef={statusRef}
          hasData
          empty="No RSVPs yet"
          legend={[
            ["Attending", STATUS_COLORS[0], stats.attendingParties],
            ["Maybe", STATUS_COLORS[1], stats.maybe],
            ["Declined", STATUS_COLORS[2], stats.declined],
          ]}
        />
        <DonutCard
          eyebrow="Guests" title="Dietary needs"
          canvasRef={dietRef}
          hasData={dietEntries.length > 0}
          empty="No special requirements noted"
          legend={dietEntries.map(([k, v], i) => [k, DIET_COLORS[i % DIET_COLORS.length], v])}
        />
      </div>
    </div>
  );
}

export default RsvpCharts;
