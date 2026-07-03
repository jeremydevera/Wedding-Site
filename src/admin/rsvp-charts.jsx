import React from "react";
import { Chart as ChartJS, DoughnutController, ArcElement, Tooltip, Legend } from "chart.js";
import { rsvpStats } from "@/lib/rsvp.js";

const { useRef, useEffect, useMemo } = React;

ChartJS.register(DoughnutController, ArcElement, Tooltip, Legend);

// Adminator-style vibrant palette (matches the template's charts page).
const STATUS_COLORS = ["#2E5BFF", "#8C54FF", "#4D9FEC"]; // attending / maybe / declined (royal / purple / sky, like the reference)
const DIET_COLORS = ["#2E5BFF", "#8C54FF", "#4D9FEC", "#10B981", "#F59E0B", "#EC4899", "#64748B", "#FD7E14"];

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
        legend: {
          display: true,
          position: "right",
          labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8, boxHeight: 8, padding: 18, color: "#64748B", font: { size: 14 } },
        },
        tooltip: { ...TIP, callbacks: { label: (c) => ` ${c.label}: ${c.parsed}` } },
      },
      animation: { duration: 900, easing: "easeInOutQuart" },
    },
  };
}

function DonutCard({ eyebrow, title, badge, canvasRef, hasData, empty }) {
  return (
    <div className="rsvp-chart-card">
      <div className="rsvp-chart-card__head">
        <div>
          <span className="rsvp-chart-card__eyebrow">{eyebrow}</span>
          <span className="rsvp-chart-card__title">{title}</span>
        </div>
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
    ["Attending", "Maybe", "Declined"],
    [stats.attendingParties, stats.maybe, stats.declined],
    STATUS_COLORS,
  ), [stats.attendingParties, stats.maybe, stats.declined]);

  useChart(dietRef, () => donutConfig(
    dietEntries.map(([k]) => k),
    dietEntries.map(([, v]) => v),
    dietEntries.map((_, i) => DIET_COLORS[i % DIET_COLORS.length]),
  ), [dietEntries]);

  if (!rsvps.length) return null;

  return (
    <div className="rsvp-charts">
      <div className="rsvp-charts__row">
        <DonutCard
          eyebrow="RSVPs" title="Attendance split"
          canvasRef={statusRef}
          hasData
          empty="No RSVPs yet"
        />
        <DonutCard
          eyebrow="Guests" title="Dietary needs"
          canvasRef={dietRef}
          hasData={dietEntries.length > 0}
          empty="No special requirements noted"
        />
      </div>
    </div>
  );
}

export default RsvpCharts;
