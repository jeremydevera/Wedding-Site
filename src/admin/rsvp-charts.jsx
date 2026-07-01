import React from "react";
import * as am5 from "@amcharts/amcharts5";
import * as am5percent from "@amcharts/amcharts5/percent";
import * as am5xy from "@amcharts/amcharts5/xy";
import am5themes_Animated from "@amcharts/amcharts5/themes/Animated";
import { rsvpStats } from "@/lib/rsvp.js";

const { useRef, useEffect, useMemo } = React;

const GOLD = 0xd4a853, COPPER = 0xa07c50, ROSE = 0x9a5f5f, MUTED = 0xb4aea2;
const BAR_SHADES = [0xd4a853, 0xc49848, 0xb48838, 0xa47840, 0x9a7048, 0xa07c50, 0x886040, 0x785838];
const HEX = { gold: "#d4a853", copper: "#a07c50", rose: "#9a5f5f" };

// Soft axis styling shared by the XY charts: faint grid, muted small labels.
function styleAxis(renderer) {
  renderer.labels.template.setAll({ fill: am5.color(MUTED), fontSize: 11, fillOpacity: 0.85 });
  renderer.grid.template.setAll({ stroke: am5.color(MUTED), strokeOpacity: 0.08 });
}

// Mount an amCharts root on a ref'd div; dispose on unmount/deps change.
function useAmChart(ref, build, deps) {
  useEffect(() => {
    if (!ref.current) return;
    const root = am5.Root.new(ref.current);
    root.setThemes([am5themes_Animated.new(root)]);
    build(root);
    return () => root.dispose();
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
  useAmChart(donutRef, (root) => {
    const chart = root.container.children.push(am5percent.PieChart.new(root, {
      innerRadius: am5.percent(76),
    }));
    const series = chart.series.push(am5percent.PieSeries.new(root, {
      valueField: "value", categoryField: "category",
    }));
    series.get("colors").set("colors", [am5.color(GOLD), am5.color(COPPER), am5.color(ROSE)]);
    series.labels.template.set("forceHidden", true);
    series.ticks.template.set("forceHidden", true);
    series.slices.template.setAll({ strokeOpacity: 0, toggleKey: "none", tooltipText: "{category}: {value}" });
    series.slices.template.states.create("hover", { scale: 1.04 });
    series.data.setAll([
      { category: "Attending", value: stats.attendingParties },
      { category: "Maybe",     value: stats.maybe },
      { category: "Declined",  value: stats.declined },
    ]);
    series.appear(900, 80);
  }, [stats.attendingParties, stats.maybe, stats.declined]);

  // Dietary horizontal bar
  useAmChart(barRef, (root) => {
    if (!dietEntries.length) return;
    const chart = root.container.children.push(am5xy.XYChart.new(root, {
      panX: false, panY: false, wheelX: "none", wheelY: "none", paddingLeft: 0,
    }));
    const yRend = am5xy.AxisRendererY.new(root, { inversed: true, minGridDistance: 12 });
    yRend.grid.template.set("forceHidden", true);
    yRend.labels.template.setAll({ fill: am5.color(MUTED), fontSize: 12 });
    const yAxis = chart.yAxes.push(am5xy.CategoryAxis.new(root, { categoryField: "diet", renderer: yRend }));
    const xRend = am5xy.AxisRendererX.new(root, {});
    styleAxis(xRend);
    const xAxis = chart.xAxes.push(am5xy.ValueAxis.new(root, { min: 0, maxPrecision: 0, renderer: xRend }));
    const series = chart.series.push(am5xy.ColumnSeries.new(root, {
      xAxis, yAxis, valueXField: "count", categoryYField: "diet",
      tooltip: am5.Tooltip.new(root, { labelText: "{categoryY}: {valueX}" }),
    }));
    series.columns.template.setAll({
      height: 16, cornerRadiusTR: 4, cornerRadiusBR: 4, strokeOpacity: 0, templateField: "colSettings",
    });
    const data = dietEntries.map(([diet, count], i) => ({
      diet, count, colSettings: { fill: am5.color(BAR_SHADES[i] != null ? BAR_SHADES[i] : COPPER) },
    }));
    yAxis.data.setAll(data);
    series.data.setAll(data);
    series.appear(700);
  }, [dietEntries]);

  // RSVPs over time (cumulative smoothed area)
  useAmChart(lineRef, (root) => {
    if (timeline.labels.length < 2) return;
    const data = timeline.labels.map((day, i) => ({
      day, total: timeline.total[i], attending: timeline.attending[i],
    }));
    const chart = root.container.children.push(am5xy.XYChart.new(root, {
      panX: false, panY: false, wheelX: "none", wheelY: "none", layout: root.verticalLayout,
    }));
    const cursor = chart.set("cursor", am5xy.XYCursor.new(root, { behavior: "none" }));
    cursor.lineY.set("visible", false);
    const xRend = am5xy.AxisRendererX.new(root, { minGridDistance: 60 });
    styleAxis(xRend);
    const xAxis = chart.xAxes.push(am5xy.CategoryAxis.new(root, { categoryField: "day", renderer: xRend }));
    xAxis.data.setAll(data);
    const yRend = am5xy.AxisRendererY.new(root, {});
    styleAxis(yRend);
    const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, { min: 0, maxPrecision: 0, renderer: yRend }));
    const mkSeries = (name, field, color, width, fillOpacity) => {
      const s = chart.series.push(am5xy.SmoothedXLineSeries.new(root, {
        name, xAxis, yAxis, valueYField: field, categoryXField: "day",
        stroke: am5.color(color), fill: am5.color(color),
        tooltip: am5.Tooltip.new(root, { labelText: "{name}: {valueY}" }),
      }));
      s.strokes.template.setAll({ strokeWidth: width });
      s.fills.template.setAll({ fillOpacity, visible: true });
      s.data.setAll(data);
      s.appear(800);
      return s;
    };
    mkSeries("Responses", "total", GOLD, 2, 0.10);
    mkSeries("Guests", "attending", COPPER, 1.5, 0.07);
    const legend = chart.children.push(am5.Legend.new(root, { centerX: am5.percent(50), x: am5.percent(50) }));
    legend.labels.template.setAll({ fill: am5.color(MUTED), fontSize: 11 });
    legend.markers.template.setAll({ width: 8, height: 8 });
    legend.data.setAll(chart.series.values);
    chart.appear(800, 100);
  }, [timeline]);

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
            <div ref={donutRef} className="rsvp-chart-el" />
            <div className="rsvp-donut-center">
              <span className="rsvp-donut-num">{stats.total}</span>
              <span className="rsvp-donut-lbl">parties</span>
            </div>
          </div>
          <div className="rsvp-chart-legend">
            {[["Attending", HEX.gold, stats.attendingParties], ["Maybe", HEX.copper, stats.maybe], ["Declined", HEX.rose, stats.declined]].map(([l, c, v]) => (
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
            ? <div className="rsvp-chart-canvas"><div ref={barRef} className="rsvp-chart-el" /></div>
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
            ? <div className="rsvp-chart-canvas"><div ref={lineRef} className="rsvp-chart-el" /></div>
            : <div className="rsvp-chart-empty">Not enough data yet</div>
          }
        </div>
      </div>
    </div>
  );
}

export default RsvpCharts;
