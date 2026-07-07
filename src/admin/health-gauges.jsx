// Superadmin Health — limited-resource gauges (Chart.js half-doughnuts).
// One gauge per metric with a cap (Router / Builds / R2 storage / Supabase DB):
// colored "used" arc over a grey remainder, % in the gauge mouth, numbers under.
// Lazy-loaded (like rsvp-charts.jsx) so Chart.js stays out of the main bundle.
import React from "react";
import { Chart as ChartJS, DoughnutController, ArcElement, Tooltip } from "chart.js";

const { useRef, useEffect } = React;

ChartJS.register(DoughnutController, ArcElement, Tooltip);

const trackColor = "#eef1f5";
const gaugeColor = (pct) => (pct > 85 ? "#c0392b" : pct > 60 ? "#c98a1a" : "#2e7d51");

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

function gaugeConfig(pct) {
  const used = Math.min(100, Math.max(0, pct));
  return {
    type: "doughnut",
    data: {
      datasets: [{
        data: [used, 100 - used],
        backgroundColor: [gaugeColor(pct), trackColor],
        borderWidth: 0,
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Half-doughnut "speedometer": start at 9 o'clock, sweep 180° over the top.
      rotation: -90,
      circumference: 180,
      cutout: "74%",
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: { duration: 800, easing: "easeInOutQuart" },
    },
  };
}

function Gauge({ label, used, limit, fmt, suffix, detail, note }) {
  const ref = useRef(null);
  const has = used != null && limit > 0;
  const pct = has ? Math.round((used / limit) * 1000) / 10 : 0;
  useChart(ref, () => gaugeConfig(has ? pct : 0), [used, limit, has]);
  return (
    <div style={{ background: "#fff", border: "1px solid #e4e8ef", borderRadius: 14, padding: "16px 16px 14px", textAlign: "center", minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
        {detail && <span style={{ color: "#94a3b8", fontWeight: 500 }}> · {detail}</span>}
      </div>
      {/* Canvas box; the % sits in the gauge mouth (bottom-center of the half arc). */}
      <div style={{ position: "relative", height: 92 }}>
        <canvas ref={ref} aria-label={`${label} usage`} role="img" />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, fontSize: 22, fontWeight: 700, color: has ? "#1e293b" : "#94a3b8", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", pointerEvents: "none" }}>
          {has ? `${pct}%` : "—"}
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8, borderTop: "1px dashed #eef1f5", paddingTop: 8 }}>
        {note ? note : has ? <>{fmt(used)} / {fmt(limit)} · {suffix}</> : "no data"}
      </div>
    </div>
  );
}

export default function HealthGauges({ items }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
      {(items || []).map((it) => <Gauge key={it.label} {...it} />)}
    </div>
  );
}
