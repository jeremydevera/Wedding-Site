import React from "react";
import qrcode from "qrcode-generator";
import { go } from "@/lib/nav.js";
import { resolveSubdomain } from "@/lib/tenant.js";
import { DISABLED_MODULES } from "@/lib/roles.js";
import { useStore } from "@/lib/store.jsx";
import { matchedRsvps } from "@/lib/guests.js";
import { headsOf } from "@/lib/rsvp.js";
import { signIn } from "@/lib/auth.js";
import { Button, Field, Icon, Input, Monogram, Placeholder, toast } from "@/ui/components.jsx";
// Lazy: amCharts is heavy — split into its own chunk, loaded only when the
// Dashboard tab renders.
const RsvpCharts = React.lazy(() => import("@/admin/rsvp-charts.jsx"));
const { useState, useEffect, useRef, useMemo, useCallback, useReducer } = React;

// ============================================================================
// admin/core.jsx — admin auth, shell/sidebar, dashboard, shared admin utils
// ============================================================================

export const ADMIN_SESSION = "evermore_admin_session";

// CSV download helper
export function downloadCSV(filename, rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Export downloaded");
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// --- QR canvas (uses global qrcode-generator) -------------------------------
export function QRCanvas({ text, size = 150, fg = "#1b1b1b" }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || typeof qrcode === "undefined") return;
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const c = ref.current;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr; c.height = size * dpr;
    const ctx = c.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
    const cell = size / count;
    ctx.fillStyle = fg;
    for (let r = 0; r < count; r++)
      for (let col = 0; col < count; col++)
        if (qr.isDark(r, col)) ctx.fillRect(Math.floor(col * cell), Math.floor(r * cell), Math.ceil(cell), Math.ceil(cell));
  }, [text, size, fg]);
  return <canvas ref={ref} style={{ width: size, height: size }} />;
}

export function downloadQR(text, label) {
  if (typeof qrcode === "undefined") return;
  const size = 600;
  const qr = qrcode(0, "M"); qr.addData(text); qr.make();
  const count = qr.getModuleCount();
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
  const margin = 40, area = size - margin * 2, cell = area / count;
  ctx.fillStyle = "#1b1b1b";
  for (let r = 0; r < count; r++)
    for (let col = 0; col < count; col++)
      if (qr.isDark(r, col)) ctx.fillRect(margin + col * cell, margin + r * cell, Math.ceil(cell), Math.ceil(cell));
  const a = document.createElement("a");
  a.href = c.toDataURL("image/png");
  a.download = `qr-${label}.png`;
  a.click();
  toast("QR code downloaded");
}

// --- Brand logo (Cobalt) -----------------------------------------------------
// Single source of truth for the Celebrately mark. Used in login + superadmin.
// Same geometry as public/favicon.svg / the App Store icon — keep them in sync.
export function Logo({ size = 30, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64"
      role="img" aria-label="Celebrately" style={{ display: "block", flex: "none" }}>
      <rect width="64" height="64" rx="16" fill="#1E5BD6" />
      <path d="M12 40 C20 24 28 24 32 32 C36 40 44 40 52 26"
        fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <circle cx="15" cy="24" r="2" fill="#BCD6FF" />
      <circle cx="50" cy="40" r="2" fill="#BCD6FF" />
    </svg>
  );
}

// --- Login ------------------------------------------------------------------
export function AdminLogin({ onAuthed }) {
  const store = useStore();
  const settings = store.settings || {};
  const sub = resolveSubdomain();   // null on apex platform hub
  const isClient = !!sub;           // client subdomain -> their theme + initials
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr("");
    try { await signIn(email.trim(), pw); onAuthed && onAuthed(); }
    catch (e2) { setErr("Wrong email or password."); }
    finally { setBusy(false); }
  }
  const [showPw, setShowPw] = useState(false);
  return (
    <div className={"signin" + (isClient ? " signin--themed" : "")}>
      <div className="signin__pane">
      <header className="signin__top">
        {isClient ? (
          <div className="signin__brand">
            <Monogram a={settings.partnerA} b={settings.partnerB} size={34} />
            <span className="signin__word">{settings.partnerA} <span className="amp">&amp;</span> {settings.partnerB}</span>
          </div>
        ) : (
          <div className="signin__brand"><Logo size={30} /><span className="signin__word">Celebrately</span></div>
        )}
        <button className="signin__back" onClick={() => go("home")}>← Back to website</button>
      </header>
      <div className="signin__center">
        <form className="signin__form" onSubmit={submit} noValidate>
          <h1 className="signin__title">Welcome back</h1>
          <p className="signin__sub">Sign in to your account</p>

          <div className="signin__field">
            <label htmlFor="a-email">Email</label>
            <input id="a-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>

          <div className="signin__field">
            <label htmlFor="a-pw">Password</label>
            <div className="signin__pwwrap">
              <input id="a-pw" type={showPw ? "text" : "password"} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" />
              <button type="button" className="signin__eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"}>{(showPw ? Icon.eyeOff : Icon.eye)({})}</button>
            </div>
            {err && <div className="signin__err">{err}</div>}
          </div>

          <button type="submit" className="signin__btn" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      </div>
      </div>
    </div>
  );
}

// --- Dashboard --------------------------------------------------------------

export function AdminDashboard({ goTab }) {
  const { rsvps, media, guestbook, quizSubs, guests, settings } = useStore();
  // Strict RSVP: only replies matched to an invited guest count toward the
  // tiles/charts — unmatched ones sit in the RSVPs tab's "For Approval".
  const strict = settings.strictRsvp === true;
  const counted = React.useMemo(
    () => (strict ? matchedRsvps(guests, rsvps) : rsvps),
    [strict, guests, rsvps],
  );
  const forApproval = rsvps.length - counted.length;
  const attending = counted.filter((r) => r.status === "attending");
  // headsOf keeps this tile identical to the RSVP tab's Total head count
  // (named companions + guest; falls back to the picked count).
  const guestCount = attending.reduce((s, r) => s + headsOf(r), 0);
  const photos = media.filter((m) => m.type === "photo" && m.category === "gallery");
  const videos = media.filter((m) => m.type === "video");
  const pendingMedia = media.filter((m) => m.status === "pending");
  // Photos/Videos belong to the shelved gallery feature — hide their cards too.
  const mediaShelved = DISABLED_MODULES.has("gallery");
  const stats = [
    { label: "RSVPs", value: counted.length, sub: `${attending.length} attending` + (strict && forApproval > 0 ? ` · ${forApproval} for approval` : ""), tab: "rsvps" },
    { label: "Guest Count", value: guestCount, sub: "people coming", tab: "rsvps" },
    ...(mediaShelved ? [] : [
      { label: "Photos", value: photos.length, sub: pendingMedia.length ? `${pendingMedia.length} to review` : "all clear", tab: "media" },
      { label: "Videos", value: videos.length, sub: "uploaded", tab: "media" },
    ]),
    { label: "Guestbook", value: guestbook.length, sub: "messages", tab: "guestbook" },
    { label: "Quiz Plays", value: quizSubs.length, sub: "submissions", tab: "quiz" },
  ];
  const recentRsvps = rsvps.slice(0, 5);
  const recentMedia = media.slice(0, 6);
  const recentGb = guestbook.slice(0, 3);

  return (
    <div>
      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {stats.map((s) => (
          <button key={s.label} className="stat" onClick={() => goTab(s.tab)} style={{ cursor: "pointer", textAlign: "left", font: "inherit", color: "inherit" }}>
            <div className="stat__label">{s.label}</div>
            <div className="stat__value">{s.value}</div>
            <div className="stat__sub">{s.sub}</div>
          </button>
        ))}
      </div>

      <React.Suspense fallback={null}><RsvpCharts rsvps={counted} /></React.Suspense>

      <div style={{ display: "grid", gap: 24, gridTemplateColumns: "1fr" }}>
        <div className="panel">
          <div className="panel__head">
            <div className="panel__title">Recent RSVPs</div>
            <Button variant="ghost" size="sm" onClick={() => goTab("rsvps")}>View all</Button>
          </div>
          <div className="panel__body--flush table-wrap">
            <table className="tbl">
              <thead><tr><th>Name</th><th>Status</th><th>Guests</th><th>Submitted</th></tr></thead>
              <tbody>
                {recentRsvps.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.fullName}</strong><div style={{ color: "var(--muted)", fontSize: 13 }}>{r.email}</div></td>
                    <td><span className={"tag tag--" + r.status}>{r.status.replace("_", " ")}</span></td>
                    <td>{r.count}</td>
                    <td style={{ color: "var(--muted)" }}>{fmtDate(r.createdAt)}</td>
                  </tr>
                ))}
                {recentRsvps.length === 0 && <tr><td colSpan={4} style={{ color: "var(--muted)" }}>No RSVPs yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: "grid", gap: 24, gridTemplateColumns: "1fr" }} className="dash-2col">
          <div className="panel">
            <div className="panel__head"><div className="panel__title">Recent Messages</div><Button variant="ghost" size="sm" onClick={() => goTab("guestbook")}>Moderate</Button></div>
            <div className="panel__body">
              {recentGb.length === 0 ? <p style={{ color: "var(--muted)", margin: 0 }}>No messages yet.</p> : recentGb.map((g) => (
                <div key={g.id} style={{ paddingBottom: 12, marginBottom: 12, borderBottom: "1px solid var(--line)" }}>
                  <div style={{ fontStyle: "italic", color: "var(--ink-soft)" }}>&ldquo;{g.message.slice(0, 90)}{g.message.length > 90 ? "\u2026" : ""}&rdquo;</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{g.name}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

