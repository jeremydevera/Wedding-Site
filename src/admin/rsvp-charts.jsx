import React from "react";
import {
  Chart as ChartJS,
  ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, BarElement,
  PointElement, LineElement, Filler,
} from "chart.js";
import { rsvpStats } from "@/lib/rsvp.js";

const { useRef, useEffect, useMemo } = React;

ChartJS.register(
  ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, BarElement,
  PointElement, LineElement, Filler,
);

const C = {
  gold:   "#d4a853",
  copper: "#a07c50",
  rose:   "#9a5f5f",
  grid:   "rgba(180,174,162,0.08)",
  tip: {
    backgroundColor: "#18160f",
    titleColor: "#d4a853",
    bodyColor: "rgba(240,237,232,0.8)",
    borderColor: "rgba(180,174,162,0.18)",
    borderWidth: 1,
    padding: { x: 14, y: 10 },
    cornerRadius: 8,
    boxWidth: 8, boxHeight: 8, boxPadding: 4,
  },
};

ChartJS.defaults.font.size = 11;
ChartJS.defaults.color = "rgba(180,174,162,0.85)";

function useChart(canvasRef, getConfig, deps) {
  const inst = useRef(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    if (inst.current) { inst.current.destroy(); inst.current = null; }
    inst.current = new ChartJS(canvasRef.current, getConfig());
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
  const stats    = useMemo(() => rsvpStats(rsvps), [rsvps]);
  const timeline = useMemo(() => buildTimeline(rsvps), [rsvps]);
  const dietEntries = useMemo(
    () => Object.entries(stats.diets).sort((a, b) => b[1] - a[1]).slice(0, 8),
    [stats.diets],
  );

  const donutRef = useRef(null);
  const barRef   = useRef(null);
  const lineRef  = useRef(null);

  // Attendance donut
  useChart(donutRef, () => ({
    type: "doughnut",
    data: {
      labels: ["Attending", "Maybe", "Declined"],
      datasets: [{
        data: [stats.attendingParties, stats.maybe, stats.declined],
        backgroundColor: [C.gold, C.copper, C.rose],
        borderWidth: 2,
        borderColor: "rgba(0,0,0,0.35)",
        hoverOffset: 8,
      }],
    },
    options: {
      cutout: "74%",
      plugins: {
        legend: { display: false },
        tooltip: {
          ...C.tip,
          callbacks: { label: (ctx) => `  ${ctx.label}: ${ctx.parsed}` },
        },
      },
      animation: { duration: 900, easing: "easeInOutQuart" },
    },
  }), [stats.attendingParties, stats.maybe, stats.declined]);

  // Dietary horizontal bar
  const BAR_SHADES = ["#d4a853","#c49848","#b48838","#a47840","#9a7048",C.copper,"#886040","#785838"];
  useChart(barRef, () => ({
    type: "bar",
    data: {
      labels: dietEntries.map(([k]) => k),
      datasets: [{
        label: "Guests",
        data: dietEntries.map(([, v]) => v),
        backgroundColor: dietEntries.map((_, i) => BAR_SHADES[i] || C.copper),
        borderRadius: 4,
        borderSkipped: false,
        barThickness: 16,
      }],
    },
    options: {
      indexAxis: "y",
      plugins: { legend: { display: false }, tooltip: { ...C.tip } },
      scales: {
        x: { grid: { color: C.grid }, ticks: { stepSize: 1 }, border: { color: "transparent" } },
        y: { grid: { display: false }, ticks: { font: { size: 12 } }, border: { color: "transparent" } },
      },
      animation: { duration: 700, easing: "easeInOutQuart" },
    },
  }), [JSON.stringify(dietEntries)]);

  // RSVPs over time (cumulative area)
  useChart(lineRef, () => ({
    type: "line",
    data: {
      labels: timeline.labels,
      datasets: [
        {
          label: "Responses",
          data: timeline.total,
          borderColor: C.gold,
          backgroundColor: "rgba(212,168,83,0.10)",
          borderWidth: 2,
          pointRadius: timeline.labels.length > 20 ? 0 : 3,
          pointHoverRadius: 5,
          pointBackgroundColor: C.gold,
          fill: true,
          tension: 0.4,
        },
        {
          label: "Guests",
          data: timeline.attending,
          borderColor: C.copper,
          backgroundColor: "rgba(160,124,80,0.07)",
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.4,
        },
      ],
    },
    options: {
      plugins: {
        legend: {
          display: true,
          labels: { boxWidth: 8, boxHeight: 8, padding: 16, color: "rgba(180,174,162,0.85)" },
        },
        tooltip: { ...C.tip, mode: "index", intersect: false },
      },
      scales: {
        x: {
          grid: { color: C.grid },
          ticks: { maxTicksLimit: 8, color: "rgba(180,174,162,0.7)" },
          border: { color: "transparent" },
        },
        y: {
          grid: { color: C.grid },
          ticks: { stepSize: 1, color: "rgba(180,174,162,0.7)" },
          border: { color: "transparent" },
          beginAtZero: true,
        },
      },
      animation: { duration: 800, easing: "easeInOutQuart" },
      interaction: { mode: "nearest", axis: "x", intersect: false },
    },
  }), [timeline.labels.join(","), timeline.total.join(",")]);

  if (!rsvps.length) return null;

  const kpis = [
    { label: "Responses", value: stats.total,           sub: "submitted" },
    { label: "Attending", value: stats.attendingHeads,  sub: "guests" },
    { label: "Maybe",     value: stats.maybe,           sub: "parties" },
    { label: "Declined",  value: stats.declined,        sub: "parties" },
  ];

  return (
    <div className="rsvp-charts">
      <div className="rsvp-charts__kpis">
        {kpis.map((k, i) => (
          <div key={k.label} className="rsvp-kpi" style={{ animationDelay: `${i * 65}ms` }}>
            <div className="rsvp-kpi__num">{k.value}</div>
            <div className="rsvp-kpi__label">{k.label}</div>
            <div className="rsvp-kpi__sub">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="rsvp-charts__row">
        {/* Attendance donut */}
        <div className="rsvp-chart-card" style={{ animationDelay: "60ms" }}>
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
            {[["Attending", C.gold, stats.attendingParties], ["Maybe", C.copper, stats.maybe], ["Declined", C.rose, stats.declined]].map(([l, c, v]) => (
              <div key={l} className="rsvp-legend-row">
                <span className="rsvp-legend-dot" style={{ background: c }} />
                <span className="rsvp-legend-label">{l}</span>
                <span className="rsvp-legend-val">{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Dietary bar */}
        <div className="rsvp-chart-card" style={{ animationDelay: "120ms" }}>
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
        <div className="rsvp-chart-card" style={{ animationDelay: "180ms" }}>
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
