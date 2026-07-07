// Superadmin → Health tab. Reads /api/cf-health (superadmin-gated Pages Function
// that proxies Cloudflare's GraphQL Analytics with a server-side read-only token)
// and renders router-vs-limit usage, Functions/R2 splits, a 7-day trend, zone
// cache-hit / 5xx / status codes. No CF token ever touches the browser.
import React from "react";
import { supabase } from "@/lib/supabase.js";
import { Button, Icon } from "@/ui/components.jsx";
const { useState, useEffect, useCallback } = React;

const nf = (n) => (+n || 0).toLocaleString("en-US");
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
const barColor = (pct) => (pct > 85 ? "#c0392b" : pct > 60 ? "#c98a1a" : "#2e7d51");

function Stat({ label, value, sub }) {
  return (
    <div style={{ flex: "1 1 140px", minWidth: 140, background: "var(--card, #fff)", border: "1px solid var(--line, #eee)", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 2, color: "var(--ink)" }}>{value}</div>
      {sub != null && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
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
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
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
    const pct = data.pctMonth || 0;
    const upstream = data.error === "upstream";
    body = (
      <div className="panel__body" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {upstream && <div style={{ background: "#fdf3e7", border: "1px solid #eecfa1", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>Cloudflare returned an error — showing what we have. Try Refresh.</div>}

        {/* Month usage vs Workers limit */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
            <span style={{ fontWeight: 600 }}>Router requests — month to date</span>
            <span style={{ color: "var(--muted)" }}>{nf(data.router?.month)} / {nf(data.limitMonth)} ({pct}%)</span>
          </div>
          <div style={{ height: 12, borderRadius: 6, background: "var(--line, #eee)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: barColor(pct), transition: "width .3s" }} />
          </div>
        </div>

        {/* Today's split */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Stat label="Router today" value={nf(data.router?.today)} sub={`${nf(data.router?.month)} this month`} />
          <Stat label="Functions today" value={nf(data.functions?.today)} sub={`${nf(data.functions?.month)} this month`} />
          <Stat label="R2 storage" value={fmtBytes(data.r2?.storageBytes)} sub={`${nf(data.r2?.objects)} objects`} />
          <Stat label="R2 ops today" value={nf(data.r2?.opsToday)} />
          <Stat label="Cache hit" value={`${data.zone?.cacheHitPct ?? 0}%`} sub={`${nf(data.zone?.reqToday)} edge req today`} />
          <Stat label="5xx today" value={nf(data.zone?.err5xx)} />
        </div>

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
