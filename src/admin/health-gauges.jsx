// Superadmin Health — limited-resource usage as ONE Chart.js horizontal bar
// chart: a bar per capped metric (Router / Builds / R2 / Supabase DB) on a
// 0–100% axis, colored green→amber→red as it approaches the cap. Two-line
// category labels carry the real numbers; tooltips repeat them.
// Lazy-loaded (like rsvp-charts.jsx) so Chart.js stays out of the main bundle.
import React from "react";
import { Chart as ChartJS, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from "chart.js";

const { useRef, useEffect } = React;

ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const trackColor = "#eef1f5";
const usageColor = (pct) => (pct > 85 ? "#c0392b" : pct > 60 ? "#c98a1a" : "#2e7d51");

// Mount/destroy a Chart.js instance on a canvas ref (same pattern as rsvp-charts).
function useChart(ref, getConfig, deps) {
  const inst = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    if (inst.current) { inst.current.destroy(); inst.current = null; }
    inst.current = new ChartJS(ref.current, getConfig());
    return () => { if (inst.current) { inst.current.destroy(); inst.current = null; } };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

function chartConfig(items) {
  const rows = items.map((it) => {
    const has = it.used != null && it.limit > 0;
    const pct = has ? Math.round((it.used / it.limit) * 1000) / 10 : 0;
    const sub = it.note ? it.note : has ? `${it.fmt(it.used)} / ${it.fmt(it.limit)} · ${it.suffix}` : "no data";
    return { pct, has, label: [it.label + (it.detail ? ` · ${it.detail}` : ""), sub] };
  });
  return {
    type: "bar",
    data: {
      labels: rows.map((r) => r.label),
      datasets: [{
        data: rows.map((r) => (r.has ? Math.max(r.pct, 0.6) : 0)), // floor: a sliver stays visible at <1%
        backgroundColor: rows.map((r) => (r.has ? usageColor(r.pct) : trackColor)),
        borderRadius: 6,
        barThickness: 16,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 46 } }, // room for the % labels after the bars
      scales: {
        x: {
          min: 0, max: 100,
          ticks: { callback: (v) => `${v}%`, color: "#94a3b8", font: { size: 11 } },
          grid: { color: "#f1f4f8" },
          border: { display: false },
        },
        y: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: "#334155", font: { size: 12 } },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.92)",
          titleColor: "#fff",
          bodyColor: "rgba(255,255,255,0.85)",
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            title: (c) => { const l = c[0]?.label || ""; return String(l).split(",")[0]; },
            label: (c) => ` ${rows[c.dataIndex]?.pct ?? 0}% used · ${rows[c.dataIndex]?.label?.[1] || ""}`,
          },
        },
      },
      animation: { duration: 700, easing: "easeInOutQuart" },
    },
    // Draw the % just past the end of each bar (small custom plugin, no dep).
    plugins: [{
      id: "pctLabels",
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        const meta = chart.getDatasetMeta(0);
        ctx.save();
        ctx.font = "600 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.textBaseline = "middle";
        meta.data.forEach((bar, i) => {
          const r = rows[i];
          ctx.fillStyle = r.has ? "#334155" : "#94a3b8";
          ctx.fillText(r.has ? `${r.pct}%` : "—", bar.x + 8, bar.y);
        });
        ctx.restore();
      },
    }],
  };
}

export default function HealthGauges({ items }) {
  const ref = useRef(null);
  const list = items || [];
  useChart(ref, () => chartConfig(list), [JSON.stringify(list.map((i) => [i.label, i.used, i.limit, i.note]))]);
  return (
    <div style={{ background: "#fff", border: "1px solid #e4e8ef", borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ position: "relative", height: list.length * 56 + 34 }}>
        <canvas ref={ref} aria-label="Usage against limits" role="img" />
      </div>
    </div>
  );
}
