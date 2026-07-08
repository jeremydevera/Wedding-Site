// Superadmin Health — limited-resource usage as full Chart.js rings ("design A"):
// one full-circle donut per capped metric (Router / Builds / R2 / Supabase DB),
// colored used-arc over a grey track, % centered, real numbers under a dashed
// rule. Same visual family as the RSVP donuts.
// Lazy-loaded (like rsvp-charts.jsx) so Chart.js stays out of the main bundle.
import React from "react";
import { Chart as ChartJS, DoughnutController, ArcElement } from "chart.js";

const { useRef, useEffect } = React;

ChartJS.register(DoughnutController, ArcElement);

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

function ringConfig(pct, has) {
  // Floor tiny-but-nonzero usage to a visible sliver; unknown -> empty track.
  const used = has ? Math.max(Math.min(pct, 100), pct > 0 ? 1 : 0) : 0;
  return {
    type: "doughnut",
    data: {
      datasets: [{
        data: [used, 100 - used],
        backgroundColor: [usageColor(pct), trackColor],
        borderWidth: 0, // square arc ends — rounded caps turn a tiny % into a blob
      }],
    },
    options: {
      cutout: "76%",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: false, // render instantly — no sweep-in on load/refresh
    },
  };
}

function Ring({ label, used, limit, fmt, suffix, detail, note }) {
  const ref = useRef(null);
  const has = used != null && limit > 0;
  const pct = has ? Math.round((used / limit) * 1000) / 10 : 0;
  useChart(ref, () => ringConfig(pct, has), [used, limit, has]);
  return (
    <div style={{ background: "#fff", border: "1px solid #e4e8ef", borderRadius: 14, padding: "14px 14px 12px", textAlign: "center", minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
        {detail && <span style={{ color: "#94a3b8", fontWeight: 500 }}> · {detail}</span>}
      </div>
      <div style={{ position: "relative", height: 118 }}>
        <canvas ref={ref} aria-label={`${label} usage`} role="img" />
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
          <div style={{ fontWeight: 800, fontSize: 19, color: has ? "#1e293b" : "#94a3b8", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", lineHeight: 1.15 }}>
            {has ? `${pct}%` : "—"}
            <div style={{ fontSize: 9.5, color: "#94a3b8", fontWeight: 600, letterSpacing: ".08em" }}>USED</div>
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 10, borderTop: "1px dashed #eef1f5", paddingTop: 8 }}>
        {note ? note : has ? <>{fmt(used)} / {fmt(limit)} · {suffix}</> : "no data"}
      </div>
    </div>
  );
}

export default function HealthGauges({ items }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))", gap: 14 }}>
      {(items || []).map((it) => <Ring key={it.label} {...it} />)}
    </div>
  );
}
