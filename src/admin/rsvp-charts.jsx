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
      if (stray) stray.style.opacity = "0";
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Tooltip body for one slice: "Label: N" plus every guest behind it — ALL of
// them (owner request: hovering must show everyone in the slice, not a capped
// preview). Pure + exported so the "does it list all N names, safely escaped"
// risk is unit-tested without a browser. The DOM host that positions this HTML
// lives in externalTooltip below; a plain Chart.js canvas tooltip can't do this
// because its content is drawn onto the canvas itself — a list of 20+ names is
// taller than the chart, and canvas pixels outside the element are simply not
// there (the excess would be invisible, not scrollable).
export function buildTooltipHtml(label, value, names) {
  const head = `<div class="rsvp-tip__head">${escapeHtml(label)}: <strong>${value}</strong></div>`;
  if (!names || !names.length) return head;
  const items = names.map((n) => `<li>${escapeHtml(n)}</li>`).join("");
  return `${head}<ul class="rsvp-tip__list">${items}</ul>`;
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
function tooltipEl() {
  let el = document.getElementById("rsvp-tip-global");
  if (!el) {
    el = document.createElement("div");
    el.id = "rsvp-tip-global";
    el.className = "rsvp-tip";
    document.body.appendChild(el);
  }
  return el;
}

// Chart.js "external" tooltip: instead of Chart.js drawing on the canvas, it
// calls us with the current tooltip model and we position the shared DOM node
// (scrollable — see .rsvp-tip in styles.css) using fixed, viewport-relative
// coordinates. `names` is optional and parallel to labels/values.
function externalTooltip(labels, values, names) {
  return (context) => {
    const { chart, tooltip } = context;
    const el = tooltipEl();
    const dp = tooltip && tooltip.dataPoints;
    if (!tooltip || tooltip.opacity === 0 || !dp || !dp.length) {
      el.style.opacity = "0";
      return;
    }
    const idx = dp[0].dataIndex;
    el.innerHTML = buildTooltipHtml(labels[idx], values[idx], names ? names[idx] : null);
    el.style.opacity = "1";
    // caretX/Y are canvas-local; add the canvas's own viewport position to get
    // fixed-positioning (viewport-relative) coordinates, then clamp against the
    // actual window — not just the canvas — so it can't run off either side of
    // the screen on a narrow phone.
    const rect = chart.canvas.getBoundingClientRect();
    const x = rect.left + tooltip.caretX;
    const y = rect.top + tooltip.caretY;
    const half = el.offsetWidth / 2;
    const pad = 8;
    const left = Math.max(half + pad, Math.min(window.innerWidth - half - pad, x));
    const fitsAbove = y - el.offsetHeight - 10 > 0;
    el.style.left = `${left}px`;
    el.style.top = `${y}px`;
    el.style.transform = fitsAbove ? "translate(-50%, calc(-100% - 10px))" : "translate(-50%, 10px)";
  };
}

// Adminator-style doughnut: big hole, white gaps + rounded slice ends, and the
// legend as labelled dots on the right side of the chart. `names` (optional,
// parallel to labels/values) lists the guests behind each slice, shown in full
// on hover via externalTooltip.
export function donutConfig(labels, values, colors, names) {
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
        tooltip: { enabled: false, external: externalTooltip(labels, values, names) },
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

export function RsvpCharts({ rsvps }) {
  const stats = useMemo(() => rsvpStats(rsvps), [rsvps]);
  const dietEntries = useMemo(
    () => Object.entries(stats.diets).sort((a, b) => b[1] - a[1]).slice(0, 8),
    [stats.diets],
  );

  const statusRef = useRef(null);
  const dietRef   = useRef(null);

  useChart(statusRef, () => donutConfig(
    ["Attending", "Maybe", "Declined"],
    [stats.attendingParties, stats.maybe, stats.declined],
    STATUS_COLORS,
    [stats.statusNames.attending, stats.statusNames.maybe, stats.statusNames.declined],
  ), [stats.attendingParties, stats.maybe, stats.declined, stats.statusNames]);

  useChart(dietRef, () => donutConfig(
    dietEntries.map(([k]) => k),
    dietEntries.map(([, v]) => v),
    dietEntries.map((_, i) => DIET_COLORS[i % DIET_COLORS.length]),
    dietEntries.map(([k]) => stats.dietNames[k] || []),
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
