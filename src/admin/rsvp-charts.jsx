import React from "react";
import { Chart as ChartJS, DoughnutController, ArcElement, Tooltip, Legend } from "chart.js";
import { rsvpStats } from "@/lib/rsvp.js";
import { useStore } from "@/lib/store.jsx";

const { useRef, useEffect, useMemo } = React;

ChartJS.register(DoughnutController, ArcElement, Tooltip, Legend);

// Fallback palette — only used if theme-var resolution fails (non-browser env).
const STATUS_FALLBACK = ["#5f7a3a", "#c99a2e", "#a24b3b"];
const DIET_FALLBACK = ["#6b7a3a", "#8c6a4a", "#4a5320", "#b7a98a", "#7a8b99", "#9a6a7a", "#c99a2e", "#5f8a7a"];

// Chart.js hands colors straight to canvas fillStyle, which can't evaluate
// var()/color-mix() — so resolve the theme's CSS custom properties to literal
// rgb by round-tripping each through a 1x1 canvas.
function themePalette() {
  try {
    const cs = getComputedStyle(document.documentElement);
    const cnv = document.createElement("canvas");
    cnv.width = cnv.height = 1;
    const ctx = cnv.getContext("2d", { willReadFrequently: true });
    const rgbOf = (name) => {
      ctx.fillStyle = cs.getPropertyValue(name).trim();
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const accent = rgbOf("--accent"), gold = rgbOf("--gold"), ink = rgbOf("--ink"),
      inkSoft = rgbOf("--ink-soft"), surface = rgbOf("--surface");
    const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
    const css = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    return {
      // Attending = full accent; Maybe = soft accent tint; Declined = neutral grey.
      status: [css(accent), css(mix(accent, surface, 0.55)), css(mix(ink, surface, 0.6))],
      // Dietary: ramp built from the theme's accent/gold/ink so every slice stays on-palette.
      diet: [accent, gold, mix(accent, surface, 0.4), mix(gold, surface, 0.4),
        inkSoft, mix(accent, surface, 0.68), mix(gold, surface, 0.68), mix(ink, surface, 0.5)].map(css),
    };
  } catch {
    return { status: STATUS_FALLBACK, diet: DIET_FALLBACK };
  }
}

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
  const { settings } = useStore();
  const stats = useMemo(() => rsvpStats(rsvps), [rsvps]);
  const dietEntries = useMemo(
    () => Object.entries(stats.diets).sort((a, b) => b[1] - a[1]).slice(0, 8),
    [stats.diets],
  );
  // Slice colors come from the client's applied theme (accent/gold/ink vars);
  // recompute when the owner switches theme or tweaks the accent.
  const palette = useMemo(() => themePalette(), [settings.theme, settings.themeAccent]);

  const statusRef = useRef(null);
  const dietRef   = useRef(null);

  useChart(statusRef, () => donutConfig(
    ["Attending", "Maybe", "Declined"],
    [stats.attendingParties, stats.maybe, stats.declined],
    palette.status,
  ), [stats.attendingParties, stats.maybe, stats.declined, palette]);

  useChart(dietRef, () => donutConfig(
    dietEntries.map(([k]) => k),
    dietEntries.map(([, v]) => v),
    dietEntries.map((_, i) => palette.diet[i % palette.diet.length]),
  ), [dietEntries, palette]);

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
            ["Attending", palette.status[0], stats.attendingParties],
            ["Maybe",     palette.status[1], stats.maybe],
            ["Declined",  palette.status[2], stats.declined],
          ]}
          empty="No RSVPs yet"
        />
        <DonutCard
          title="Dietary" hint="attending only"
          canvasRef={dietRef}
          centerNum={dietTotal} centerLbl="guests"
          legend={dietEntries.map(([k, v], i) => [k, palette.diet[i % palette.diet.length], v])}
          empty="No special requirements noted"
        />
      </div>
    </div>
  );
}

export default RsvpCharts;
