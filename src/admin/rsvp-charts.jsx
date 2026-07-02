import React from "react";
import {
  Chart as ChartJS,
  ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, BarElement,
  PointElement, LineElement, Filler,
} from "chart.js";
import { useStore } from "@/lib/store.jsx";
import { rsvpStats } from "@/lib/rsvp.js";

const { useRef, useEffect, useMemo } = React;

ChartJS.register(
  ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, BarElement,
  PointElement, LineElement, Filler,
);

// Resolve a theme CSS variable (e.g. "--accent") to a hex color string. The
// vars hold oklch()/color-mix() values, so we let the browser compute the final
// rgb by reading it off a probe element. Falls back when unset/unparseable.
function cssColorHex(varName, fallback) {
  try {
    const el = document.createElement("span");
    el.style.color = `var(${varName}, ${fallback})`;
    document.body.appendChild(el);
    const rgb = getComputedStyle(el).color;
    document.body.removeChild(el);
    const m = rgb.match(/(\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)/);
    if (!m) return fallback;
    const h = (n) => Math.max(0, Math.min(255, Math.round(+n))).toString(16).padStart(2, "0");
    return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
  } catch (_) {
    return fallback;
  }
}

// Read the client theme's palette for the charts (after theme vars are applied).
function themePalette() {
  return {
    accent: cssColorHex("--accent", "#5f7a3a"),   // primary series + "attending"
    gold:   cssColorHex("--gold", "#c99a2e"),     // secondary line series
    muted:  cssColorHex("--muted", "#8a8578"),    // labels, grid
    ink:    cssColorHex("--ink", "#2a2722"),      // tooltip bg
  };
}

// Status colors for the attendance donut. Attending follows the theme accent;
// maybe/declined are fixed semantic hues (amber / terracotta) so the three
// stay clearly distinguishable on every theme.
const MAYBE_COLOR = "#c99a2e";
const DECLINED_COLOR = "#a24b3b";

// hex + alpha -> rgba() string (for gradients/soft fills)
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function tipStyle(pal) {
  return {
    backgroundColor: hexA(pal.ink, 0.92),
    titleColor: "#fff",
    bodyColor: "rgba(255,255,255,0.85)",
    padding: { x: 12, y: 8 },
    cornerRadius: 8,
    boxWidth: 8, boxHeight: 8, boxPadding: 4,
    displayColors: false,
  };
}

// Draws each bar's value just past its end (horizontal bars only).
const barValuePlugin = {
  id: "barValues",
  afterDatasetsDraw(chart) {
    const opts = chart.options.plugins.barValues;
    if (!opts) return;
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const ds = chart.data.datasets[0];
    ctx.save();
    ctx.font = "600 11px " + (opts.font || "sans-serif");
    ctx.fillStyle = opts.color;
    ctx.textBaseline = "middle";
    meta.data.forEach((bar, i) => {
      const v = ds.data[i];
      if (v != null) ctx.fillText(String(v), bar.x + 6, bar.y);
    });
    ctx.restore();
  },
};

// Mount a Chart.js instance on a ref'd canvas; destroy on unmount/deps change.
function useChart(ref, getConfig, deps) {
  const inst = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    if (inst.current) { inst.current.destroy(); inst.current = null; }
    inst.current = new ChartJS(ref.current, getConfig(themePalette()));
    return () => { if (inst.current) { inst.current.destroy(); inst.current = null; } };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

function buildTimeline(rsvps) {
  if (!rsvps.length) return { labels: [], total: [], attending: [] };
  const byDay = {};
  for (const r of rsvps) {
    const d = new Date(r.createdAt);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!byDay[k]) byDay[k] = { n: 0, h: 0 };
    byDay[k].n++;
    if (r.status === "attending") byDay[k].h += Number(r.count) || 1;
  }
  const keys = Object.keys(byDay).sort();
  if (keys.length < 2) return { labels: [], total: [], attending: [] };
  const labels = [], total = [], attending = [];
  let ct = 0, ca = 0;
  const start = new Date(keys[0] + "T12:00:00");
  const end   = new Date(keys[keys.length - 1] + "T12:00:00");
  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const k = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
    labels.push(cur.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    if (byDay[k]) { ct += byDay[k].n; ca += byDay[k].h; }
    total.push(ct);
    attending.push(ca);
  }
  return { labels, total, attending };
}

export function RsvpCharts({ rsvps }) {
  const { settings } = useStore();
  const theme = settings.theme; // charts re-key their colors when the site theme changes
  const stats    = useMemo(() => rsvpStats(rsvps), [rsvps]);
  const timeline = useMemo(() => buildTimeline(rsvps), [rsvps]);
  const dietEntries = useMemo(
    () => Object.entries(stats.diets).sort((a, b) => b[1] - a[1]).slice(0, 8),
    [stats.diets],
  );
  // Legend swatches (HTML side) — same palette the charts resolve on mount.
  const pal = useMemo(() => themePalette(), [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const donutRef = useRef(null);
  const barRef   = useRef(null);
  const lineRef  = useRef(null);

  // Attendance donut — thick ring (48% hole), borderless slices,
  // attending: theme accent, maybe: amber, declined: terracotta.
  useChart(donutRef, (p) => ({
    type: "doughnut",
    data: {
      labels: ["Attending", "Maybe", "Declined"],
      datasets: [{
        data: [stats.attendingParties, stats.maybe, stats.declined],
        backgroundColor: [p.accent, MAYBE_COLOR, DECLINED_COLOR],
        borderWidth: 0,
        borderRadius: 6,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "48%",
      layout: { padding: 8 }, // room for hoverOffset so slices don't clip
      plugins: {
        legend: { display: false },
        tooltip: { ...tipStyle(p), callbacks: { label: (c) => ` ${c.label}: ${c.parsed}` } },
      },
      animation: { duration: 900, easing: "easeInOutQuart" },
    },
  }), [stats.attendingParties, stats.maybe, stats.declined, theme]);

  // Dietary horizontal bar — accent opacity ramp, count labels past bar ends
  useChart(barRef, (p) => ({
    type: "bar",
    data: {
      labels: dietEntries.map(([k]) => k),
      datasets: [{
        data: dietEntries.map(([, v]) => v),
        backgroundColor: dietEntries.map((_, i) => hexA(p.accent, Math.max(0.35, 0.95 - i * 0.1))),
        borderRadius: 5,
        borderSkipped: false,
        barThickness: 18,
      }],
    },
    plugins: [barValuePlugin],
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 26 } }, // room for the count labels
      plugins: {
        legend: { display: false },
        tooltip: tipStyle(p),
        barValues: { color: p.muted },
      },
      scales: {
        x: {
          grid: { color: hexA(p.muted, 0.12) },
          ticks: { stepSize: 1, precision: 0, color: p.muted, font: { size: 11 } },
          border: { display: false },
          beginAtZero: true,
        },
        y: {
          grid: { display: false },
          ticks: { color: p.muted, font: { size: 12 } },
          border: { display: false },
        },
      },
      animation: { duration: 700, easing: "easeInOutQuart" },
    },
  }), [dietEntries, theme]);

  // RSVPs over time — cumulative smoothed areas with gradient fade fills
  useChart(lineRef, (p) => {
    const grad = (color, top) => (c) => {
      const { chartArea, ctx } = c.chart;
      if (!chartArea) return hexA(color, 0);
      const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      g.addColorStop(0, hexA(color, top));
      g.addColorStop(1, hexA(color, 0));
      return g;
    };
    return {
      type: "line",
      data: {
        labels: timeline.labels,
        datasets: [
          {
            label: "Responses",
            data: timeline.total,
            borderColor: p.accent,
            backgroundColor: grad(p.accent, 0.22),
            borderWidth: 2.25,
            pointRadius: timeline.labels.length > 20 ? 0 : 3,
            pointHoverRadius: 5,
            pointBackgroundColor: p.accent,
            fill: true,
            tension: 0.4,
          },
          {
            label: "Guests",
            data: timeline.attending,
            borderColor: p.gold,
            backgroundColor: grad(p.gold, 0.12),
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: true,
            tension: 0.4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: { boxWidth: 8, boxHeight: 8, padding: 14, color: p.muted, font: { size: 11 } },
          },
          tooltip: { ...tipStyle(p), mode: "index", intersect: false, displayColors: true },
        },
        scales: {
          x: {
            grid: { color: hexA(p.muted, 0.12) },
            ticks: { maxTicksLimit: 8, color: p.muted, font: { size: 11 } },
            border: { display: false },
          },
          y: {
            grid: { color: hexA(p.muted, 0.12) },
            ticks: { stepSize: 1, precision: 0, color: p.muted, font: { size: 11 } },
            border: { display: false },
            beginAtZero: true,
          },
        },
        animation: { duration: 800, easing: "easeInOutQuart" },
        interaction: { mode: "nearest", axis: "x", intersect: false },
      },
    };
  }, [timeline, theme]);

  if (!rsvps.length) return null;

  return (
    <div className="rsvp-charts">
      <div className="rsvp-charts__row">
        {/* Attendance donut */}
        <div className="rsvp-chart-card">
          <div className="rsvp-chart-card__head">
            <span className="rsvp-chart-card__title">Attendance</span>
            <span className="rsvp-chart-card__hint">by party</span>
          </div>
          <div className="rsvp-donut-wrap">
            <canvas ref={donutRef} />
            <div className="rsvp-donut-center">
              <span className="rsvp-donut-num">{stats.total}</span>
              <span className="rsvp-donut-lbl">parties</span>
            </div>
          </div>
          <div className="rsvp-chart-legend">
            {[["Attending", pal.accent, stats.attendingParties], ["Maybe", MAYBE_COLOR, stats.maybe], ["Declined", DECLINED_COLOR, stats.declined]].map(([l, c, v]) => (
              <div key={l} className="rsvp-legend-row">
                <span className="rsvp-legend-dot" style={{ background: c }} />
                <span className="rsvp-legend-label">{l}</span>
                <span className="rsvp-legend-val">{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Dietary bar */}
        <div className="rsvp-chart-card">
          <div className="rsvp-chart-card__head">
            <span className="rsvp-chart-card__title">Dietary</span>
            <span className="rsvp-chart-card__hint">attending only</span>
          </div>
          {dietEntries.length > 0
            ? <div className="rsvp-chart-canvas"><canvas ref={barRef} /></div>
            : <div className="rsvp-chart-empty">No special requirements noted</div>
          }
        </div>

        {/* Over time line */}
        <div className="rsvp-chart-card">
          <div className="rsvp-chart-card__head">
            <span className="rsvp-chart-card__title">Over Time</span>
            <span className="rsvp-chart-card__hint">cumulative</span>
          </div>
          {timeline.labels.length > 1
            ? <div className="rsvp-chart-canvas"><canvas ref={lineRef} /></div>
            : <div className="rsvp-chart-empty">Not enough data yet</div>
          }
        </div>
      </div>
    </div>
  );
}

export default RsvpCharts;
