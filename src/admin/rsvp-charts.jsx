import React from "react";
import { Chart as ChartJS, DoughnutController, ArcElement, Tooltip, Legend } from "chart.js";
import { rsvpStats } from "@/lib/rsvp.js";

const { useRef, useEffect, useMemo } = React;

ChartJS.register(DoughnutController, ArcElement, Tooltip, Legend);

// Adminator-style vibrant palette (matches the template's charts page).
const STATUS_COLORS = ["#2E5BFF", "#8C54FF", "#00C1D4"]; // attending / maybe / declined
const DIET_COLORS = ["#2E5BFF", "#8C54FF", "#00C1D4", "#10B981", "#F59E0B", "#EC4899", "#64748B", "#FD7E14"];

const TIP = {
  backgroundColor: "rgba(15, 23, 42, 0.92)",
  titleColor: "#fff",
  bodyColor: "rgba(255,255,255,0.85)",
  padding: { x: 12, y: 8 },
  cornerRadius: 8,
  displayColors: false,
};

// Mount a Chart.js instance on a ref'd canvas; destroy on unmount/deps change.
function useChart(ref, getConfig, deps) {
  const inst = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    if (inst.current) { inst.current.destroy(); inst.current = null; }
    inst.current = new ChartJS(ref.current, getConfig());
    return () => { if (inst.current) { inst.current.destroy(); inst.current = null; } };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

// Adminator-style doughnut: big hole, white gaps + rounded slice ends, and the
// legend as labelled dots on the right side of the chart.
function donutConfig(labels, values, colors) {
  return {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderWidth: 0,
        spacing: 3,
        borderRadius: 8,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      layout: { padding: 6 }, // room for hoverOffset so slices don't clip
      plugins: {
        legend: {
          display: true,
          position: "right",
          labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 7, boxHeight: 7, padding: 14, color: "#64748B", font: { size: 12.5 } },
        },
        tooltip: { ...TIP, callbacks: { label: (c) => ` ${c.label}: ${c.parsed}` } },
      },
      animation: { duration: 900, easing: "easeInOutQuart" },
    },
  };
}

function DonutCard({ title, hint, badge, canvasRef, hasData, empty }) {
  return (
    <div className="rsvp-chart-card">
      <div className="rsvp-chart-card__head">
        <span className="rsvp-chart-card__title">{title}</span>
        <span className="rsvp-chart-card__hint">{hint}</span>
        {badge && <span className="rsvp-chart-card__badge">{badge}</span>}
      </div>
      {hasData
        ? <div className="rsvp-donut-wrap"><canvas ref={canvasRef} /></div>
        : <div className="rsvp-chart-empty">{empty}</div>}
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
    [`Attending (${stats.attendingParties})`, `Maybe (${stats.maybe})`, `Declined (${stats.declined})`],
    [stats.attendingParties, stats.maybe, stats.declined],
    STATUS_COLORS,
  ), [stats.attendingParties, stats.maybe, stats.declined]);

  useChart(dietRef, () => donutConfig(
    dietEntries.map(([k, v]) => `${k} (${v})`),
    dietEntries.map(([, v]) => v),
    dietEntries.map((_, i) => DIET_COLORS[i % DIET_COLORS.length]),
  ), [dietEntries]);

  if (!rsvps.length) return null;

  const dietTotal = dietEntries.reduce((s, [, v]) => s + v, 0);

  return (
    <div className="rsvp-charts">
      <div className="rsvp-charts__row">
        <DonutCard
          title="Attendance" hint="by party"
          badge={`${stats.total} ${stats.total === 1 ? "PARTY" : "PARTIES"}`}
          canvasRef={statusRef}
          hasData
          empty="No RSVPs yet"
        />
        <DonutCard
          title="Dietary" hint="attending only"
          badge={dietTotal ? `${dietTotal} ${dietTotal === 1 ? "GUEST" : "GUESTS"}` : null}
          canvasRef={dietRef}
          hasData={dietEntries.length > 0}
          empty="No special requirements noted"
        />
      </div>
    </div>
  );
}

export default RsvpCharts;
