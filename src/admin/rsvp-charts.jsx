import React from "react";
import { Chart as ChartJS, DoughnutController, ArcElement, Tooltip, Legend } from "chart.js";
import { rsvpStats } from "@/lib/rsvp.js";

const { useRef, useEffect, useMemo } = React;

ChartJS.register(DoughnutController, ArcElement, Tooltip, Legend);

// Default palette (not tied to the client's site theme).
// Attendance: green / amber / terracotta.
const STATUS_COLORS = ["#5f7a3a", "#c99a2e", "#a24b3b"];
// Dietary: muted earth tones, one per slice.
const DIET_COLORS = ["#6b7a3a", "#8c6a4a", "#4a5320", "#b7a98a", "#7a8b99", "#9a6a7a", "#c99a2e", "#5f8a7a"];

const TIP = {
  backgroundColor: "rgba(42, 39, 34, 0.92)",
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

// Shared thick-ring donut config: 48% hole, borderless square-edged slices.
function donutConfig(labels, values, colors) {
  return {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderWidth: 0,
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
        tooltip: { ...TIP, callbacks: { label: (c) => ` ${c.label}: ${c.parsed}` } },
      },
      animation: { duration: 900, easing: "easeInOutQuart" },
    },
  };
}

function DonutCard({ title, hint, canvasRef, centerNum, centerLbl, legend, empty }) {
  return (
    <div className="rsvp-chart-card">
      <div className="rsvp-chart-card__head">
        <span className="rsvp-chart-card__title">{title}</span>
        <span className="rsvp-chart-card__hint">{hint}</span>
      </div>
      {legend.length === 0 ? (
        <div className="rsvp-chart-empty">{empty}</div>
      ) : (
        <div className="rsvp-chart-body">
          <div className="rsvp-donut-wrap">
            <canvas ref={canvasRef} />
            <div className="rsvp-donut-center">
              <span className="rsvp-donut-num">{centerNum}</span>
              <span className="rsvp-donut-lbl">{centerLbl}</span>
            </div>
          </div>
          <div className="rsvp-chart-legend">
            {legend.map(([l, c, v]) => (
              <div key={l} className="rsvp-legend-row">
                <span className="rsvp-legend-dot" style={{ background: c }} />
                <span className="rsvp-legend-label">{l}</span>
                <span className="rsvp-legend-val">{v}</span>
              </div>
            ))}
          </div>
        </div>
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
  ), [stats.attendingParties, stats.maybe, stats.declined]);

  useChart(dietRef, () => donutConfig(
    dietEntries.map(([k]) => k),
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
          canvasRef={statusRef}
          centerNum={stats.total} centerLbl="parties"
          legend={[
            ["Attending", STATUS_COLORS[0], stats.attendingParties],
            ["Maybe",     STATUS_COLORS[1], stats.maybe],
            ["Declined",  STATUS_COLORS[2], stats.declined],
          ]}
          empty="No RSVPs yet"
        />
        <DonutCard
          title="Dietary" hint="attending only"
          canvasRef={dietRef}
          centerNum={dietTotal} centerLbl="guests"
          legend={dietEntries.map(([k, v], i) => [k, DIET_COLORS[i % DIET_COLORS.length], v])}
          empty="No special requirements noted"
        />
      </div>
    </div>
  );
}

export default RsvpCharts;
