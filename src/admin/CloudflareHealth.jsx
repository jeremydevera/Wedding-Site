// Superadmin → Health tab. Reads /api/cf-health (superadmin-gated Pages Function
// that proxies Cloudflare's GraphQL Analytics with a server-side read-only token)
// and renders router-vs-limit usage, Functions/R2 splits, a 7-day trend, zone
// cache-hit / 5xx / status codes. No CF token ever touches the browser.
import React from "react";
import { adminBridgeToken } from "@/lib/auth.js";
import { Button, Icon } from "@/ui/components.jsx";
import { InfoPop, InfoDot, useInfoHover } from "@/admin/health-info.jsx";
const { useState, useEffect, useCallback, Suspense } = React;

// Chart.js gauges load lazily (same pattern as rsvp-charts) to keep the main bundle lean.
const HealthGauges = React.lazy(() => import("@/admin/health-gauges.jsx"));

const nf = (n) => (+n || 0).toLocaleString("en-US");
// Compact tile value — the KPI card can be as narrow as ~158px and its value is
// 44px, so 6-7 digit counts clip. 144772 -> "144.8k", 1200000 -> "1.2M".
const nfc = (n) => {
  n = +n || 0;
  const t = (x, u) => `${(Math.round(x * 10) / 10).toString().replace(/\.0$/, "")}${u}`;
  if (n >= 1e6) return t(n / 1e6, "M");
  if (n >= 1e4) return t(n / 1e3, "k");
  return nf(n);
};
function fmtBytes(n) {
  n = +n || 0;
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}
function ago(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}
// R2 free tier includes 10 GB-month of storage (then $0.015/GB-mo) — the gauge
// shows usage against that free allowance.
const R2_FREE_BYTES = 10 * 1024 ** 3;

// ── Tile explainers ─────────────────────────────────────────────────────────
// These used to be two always-open blocks that dominated the tab. They now live
// as hover popovers on their OWN tile (owner request): Custom domains gauge and
// the Firebase Auth KPI tile.
const domainsInfo = (missing) => (
  <>
    <strong style={{ color: "var(--ink)" }}>Custom domains</strong> counts every hostname attached to the
    Pages project — <code>demo</code>, <code>www</code> and the apex each take a slot
    (<code>wedding-site-8nh.pages.dev</code> is free). The free plan caps at <strong>100 per project</strong> (Pro
    250, Business 500). Nearing the cap: serve client subdomains through a wildcard{" "}
    <code>*.celebrately.us</code> Worker route instead of attaching them — unlimited and free. Clients bringing
    their <em>own</em> domain scale via Cloudflare for SaaS (first 100 hostnames free, then ~$0.10/mo each).
    {missing && <><br /><strong style={{ color: "#a05a1a" }}>Showing "—"?</strong> The
    Cloudflare token can't read this yet — add <em>Account · Cloudflare Pages · Read</em> to the{" "}
    <code>CF_ANALYTICS_TOKEN</code> and redeploy. (Client subdomains resolve via the zone, not Pages custom
    domains, so this currently reads <strong>0 attached</strong>.)</>}
  </>
);

// Firebase Auth holds the Neon clients' logins — not a database, so its limits
// are about rate, not size.
const FIREBASE_INFO = (
  <>
    <strong style={{ color: "var(--ink)" }}>Firebase Auth</strong> holds the logins for Neon-backed client sites
    (email/password, Google, and guest sessions) — the sites' data lives in Neon, not here. It stores accounts,
    not files, so the limits are on <em>rate</em>, not size:
    <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
      <li>~<strong>100 new signups per hour per IP</strong> (anti-abuse) — which is why we already added the hourly
        registration cap.</li>
      <li>If it's ever upgraded to Identity Platform, the free tier is <strong>50,000 monthly active users</strong>,
        then paid per user. Plain email / Google / anonymous auth stays free regardless.</li>
    </ul>
  </>
);

function MetricRow({ icon = "grid", label, value, detail, warn, info }) {
  // One metric = one table row (owner request: a single table, not tile cards —
  // a wrapping tile grid still reads as separate sections). `info` = long-form
  // explainer popover on hover/focus/tap of the row.
  const { open, anchor, bind } = useInfoHover(!!info);
  return (
    <tr {...bind} style={{ cursor: info ? "help" : "default", ...(bind.style || {}) }}>
      <td style={{ whiteSpace: "nowrap" }}>
        {info && open && <InfoPop anchor={anchor}>{info}</InfoPop>}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
          <span style={{ color: "var(--muted)", display: "inline-flex" }} aria-hidden="true">{Icon[icon] ? Icon[icon]({ style: { width: 15, height: 15 } }) : null}</span>
          {label}{info && <InfoDot />}
        </span>
      </td>
      <td style={{ whiteSpace: "nowrap", fontWeight: 800, fontVariantNumeric: "tabular-nums", color: warn ? "#a05a1a" : "inherit" }}>{value}</td>
      <td style={{ color: "var(--muted)" }}>{detail || ""}</td>
    </tr>
  );
}
// Two-line sparkline (router + functions) over the day series, no chart dep.
function Spark({ series }) {
  const W = 520, H = 70, pad = 6;
  const days = series || [];
  if (days.length < 2) return null;
  const max = Math.max(1, ...days.map((d) => Math.max(d.router, d.functions)));
  const x = (i) => pad + (i * (W - pad * 2)) / (days.length - 1);
  const y = (v) => H - pad - (v / max) * (H - pad * 2);
  const path = (key) => days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="7-day request trend">
      <path d={path("router")} fill="none" stroke="#3b6fb5" strokeWidth="2" />
      <path d={path("functions")} fill="none" stroke="#c98a1a" strokeWidth="2" strokeDasharray="4 3" />
    </svg>
  );
}

export function CloudflareHealth() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (force) => {
    setLoading(true); setError(null);
    try {
      const token = await adminBridgeToken();
      const res = await fetch(`/api/cf-health${force ? "?refresh=1" : ""}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error || `Request failed (${res.status})`); setData(null); }
      else setData(j);
    } catch (e) {
      setError(e.message || "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  const head = (
    <div className="panel__head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div className="panel__title">Cloudflare Health</div>
      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {data && data.updatedAt && <span style={{ color: "var(--muted)", fontSize: 12 }}>updated {ago(data.updatedAt)}</span>}
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => load(true)}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </span>
    </div>
  );

  let body;
  if (loading && !data) {
    body = <div style={{ padding: 24, color: "var(--muted)" }}><span className="admin-saving__spin" aria-hidden="true" style={{ marginRight: 8, display: "inline-block", verticalAlign: "middle" }} />Loading Cloudflare stats…</div>;
  } else if (error) {
    body = (
      <div style={{ padding: 20 }}>
        <p style={{ color: "#c0392b", marginTop: 0 }}>Couldn't load stats: {error}</p>
        <Button variant="secondary" size="sm" onClick={() => load(true)}>Try again</Button>
      </div>
    );
  } else if (data && data.configured === false) {
    body = (
      <div style={{ padding: 20, fontSize: 14, lineHeight: 1.55 }}>
        <p style={{ marginTop: 0 }}><strong>Not configured yet.</strong> Add a read-only Cloudflare token so this tab can read your usage.</p>
        <ol style={{ paddingLeft: 18, color: "var(--ink)" }}>
          <li>CF dashboard → <em>My Profile → API Tokens → Create Token → Custom</em>. Permissions: <em>Account · Account Analytics · Read</em>, <em>Zone · Analytics · Read</em> (zone <code>celebrately.us</code>). Copy the token.</li>
          <li>Workers &amp; Pages → <code>wedding-site</code> → Settings → Variables and Secrets → add <code>CF_ANALYTICS_TOKEN</code> (Encrypt), then redeploy.</li>
        </ol>
      </div>
    );
  } else if (data) {
    const upstream = data.error === "upstream";
    // Router gauge is plan-aware: Workers Free is capped per DAY (100k), Paid per
    // month (10M) — the gauge tracks whichever limit actually applies. Unknown
    // plan (token lacks Billing: Read) keeps the monthly view + shows a hint.
    const planFree = data.workersPlan === "free";
    const routerGauge = planFree
      ? { label: "Router requests", detail: `Free plan · ${nfc(data.router?.month)} this month`, used: data.router?.today, limit: data.limitDay || 100_000, fmt: nf, suffix: "today · resets midnight UTC" }
      : { label: "Router requests", detail: `${nfc(data.router?.today)} today${data.workersPlan === "paid" ? " · Paid plan" : ""}`, used: data.router?.month, limit: data.limitMonth, fmt: nf, suffix: "this month", note: data.workersPlan == null ? "plan unknown — token needs Billing: Read" : null };
    body = (
      <div className="panel__body" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {upstream && <div style={{ background: "#fdf3e7", border: "1px solid #eecfa1", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>Cloudflare returned an error — showing what we have. Try Refresh.</div>}

        {/* Everything with a hard/free-tier limit renders as a gauge. */}
        <Suspense fallback={<div style={{ color: "var(--muted)", fontSize: 13, padding: "18px 0" }}>Loading gauges…</div>}>
          <HealthGauges items={[
            routerGauge,
            // Builds are metered in MINUTES (3,000/mo free · 6,000/mo Workers Paid),
            // not the legacy 500-build count — that old gauge pegged at "500/500".
            { label: "Build minutes", detail: data.builds?.count != null ? `${nf(data.builds.count)} builds` : undefined, used: data.builds?.minutes, limit: data.builds?.limitMinutes || 3000, fmt: nf, suffix: "min this month", note: data.builds?.minutes == null ? "token needs Pages: Read" : null },
            { label: "Custom domains", used: data.domains?.count, limit: data.domains?.limit || 100, fmt: nf, suffix: "attached", note: data.domains?.count == null ? "token needs Pages: Read" : null, info: domainsInfo(data.domains?.count == null) },
            { label: "R2 storage", detail: `${nf(data.r2?.objects)} objects`, used: data.r2?.storageBytes, limit: data.r2?.limitBytes || R2_FREE_BYTES, fmt: fmtBytes, suffix: "free tier" },
            { label: "Neon database", detail: data.neon?.shardCount ? `across ${data.neon.shardCount} shards` : undefined, used: data.neon?.totalBytes, limit: data.neon?.totalLimitBytes || 536870912, fmt: fmtBytes, suffix: "free tier", note: data.neon == null ? "no shards configured" : (data.neon?.totalBytes == null ? "unavailable" : null), breakdown: (data.neon?.shards || []).map((s) => ({ name: s.id, bytes: s.bytes, limit: data.neon.limitBytesPerShard })) },
          ]} />
        </Suspense>

        {/* ONE table (owner request 2026-07-31 — tiles in a wrapping grid still
            read as separate rows/sections): every no-gauge metric is a row. */}
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Metric</th><th style={{ whiteSpace: "nowrap" }}>Value</th><th>Detail</th></tr></thead>
            <tbody>
              <MetricRow
                icon="calendar" label="Monthly bill"
                value={data.bill ? `$${data.bill.monthlyUSD.toFixed(2)}` : "—"}
                detail={data.bill
                  ? (data.bill.projectedUSD > data.bill.monthlyUSD
                      ? `projected $${data.bill.projectedUSD.toFixed(2)} with overage`
                      : (data.bill.items || []).map((i) => i.name).join(" + ") || "no paid subscriptions")
                  : "token needs Billing: Read"}
              />
              <MetricRow
                icon="upload" label="Last deploy"
                value={data.deploy?.commit || "—"}
                warn={!!data.deploy && data.deploy.status !== "success"}
                detail={data.deploy ? `${data.deploy.status || "?"} · ${ago(data.deploy.createdOn) || "just now"}` : "token needs Pages: Read"}
              />
              <MetricRow
                icon="home" label="Hosts up"
                value={data.hosts ? `${data.hosts.filter((h) => h.ok).length}/${data.hosts.length}` : "—"}
                warn={!!data.hosts && !data.hosts.every((h) => h.ok)}
                detail={data.hosts
                  ? (data.hosts.every((h) => h.ok)
                      ? `all reachable · ${Math.max(...data.hosts.map((h) => h.ms))}ms slowest`
                      : `DOWN: ${data.hosts.filter((h) => !h.ok).map((h) => h.host).join(", ")}`)
                  : "no data"}
              />
              <MetricRow icon="bell" label="Router errors" value={nf(data.router?.errorsToday)} warn={(data.router?.errorsToday || 0) > 0} detail="worker errors today" />
              <MetricRow icon="gear" label="Functions" value={nfc(data.functions?.today)} detail={`today · ${nfc(data.functions?.month)} this month`} />
              <MetricRow icon="download" label="R2 ops" value={nfc(data.r2?.opsToday)} detail="reads + writes today" />
              <MetricRow icon="check" label="Cache hit" value={`${data.zone?.cacheHitPct ?? 0}%`} detail={`${nfc(data.zone?.reqToday)} edge req today`} />
              <MetricRow icon="bell" label="5xx errors" value={nf(data.zone?.err5xx)} warn={(data.zone?.err5xx || 0) > 0} detail="server errors today" />
              <MetricRow icon="grid" label="Bandwidth" value={fmtBytes(data.zone?.bytesToday)} detail={`${nfc(data.zone?.uniquesToday)} unique visitors today`} />
              <MetricRow icon="user" label="Firebase Auth" value="Free" detail="client logins" info={FIREBASE_INFO} />
            </tbody>
          </table>
        </div>

        {/* Month-end pace line under the gauges' numbers. */}
        {data.bill && (
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: -6 }}>
            At this pace by month end: ~{nfc(data.bill.projectedRequests)} router requests · ~{nf(data.bill.projectedBuildMinutes)} build min · ${data.bill.projectedUSD.toFixed(2)} bill
          </div>
        )}

        {/* 7-day trend */}
        <div>
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
            <span><span style={{ color: "#3b6fb5" }}>■</span> Router</span>
            <span><span style={{ color: "#c98a1a" }}>▬</span> Functions</span>
            <span style={{ marginLeft: "auto" }}>last 7 days</span>
          </div>
          <Spark series={data.series} />
        </div>

        {/* Per-day + status tables */}
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <div className="table-wrap" style={{ flex: "1 1 280px" }}>
            <table className="tbl"><thead><tr><th>Day</th><th style={{ textAlign: "right" }}>Router</th><th style={{ textAlign: "right" }}>Functions</th></tr></thead>
              <tbody>
                {(data.series || []).slice().reverse().map((d) => (
                  <tr key={d.date}><td>{d.date}</td><td style={{ textAlign: "right" }}>{nf(d.router)}</td><td style={{ textAlign: "right" }}>{nf(d.functions)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-wrap" style={{ flex: "1 1 220px" }}>
            <table className="tbl"><thead><tr><th>Status (today)</th><th style={{ textAlign: "right" }}>Requests</th></tr></thead>
              <tbody>
                {(data.zone?.status || []).slice(0, 8).map((s) => (
                  <tr key={s.code}><td>{s.code}</td><td style={{ textAlign: "right" }}>{nf(s.count)}</td></tr>
                ))}
                {!(data.zone?.status || []).length && <tr><td colSpan={2} style={{ color: "var(--muted)" }}>No data yet today</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return <div className="panel">{head}{body}</div>;
}
