import React from "react";
import qrcode from "qrcode-generator";
import { go } from "@/lib/nav.js";
import { resolveSubdomain } from "@/lib/tenant.js";
import { DISABLED_MODULES, moduleEnabled } from "@/lib/roles.js";
import { useStore } from "@/lib/store.jsx";
import { reconcileGuests } from "@/lib/guests.js";
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
          {/* New-site requests go through the /apply approval flow */}
          {!isClient && (
            <p style={{ textAlign: "center", fontSize: 13, color: "var(--sg-sub)", marginTop: 18 }}>
              New here? <a href="/apply" style={{ color: "#1E5BD6", fontWeight: 600, textDecoration: "none" }}>Request your wedding site →</a>
            </p>
          )}
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
  // Strict: guests are owner-curated — an added guest counts as attending with
  // their full allotted party until a reply says otherwise (reconcile rules).
  const recon = React.useMemo(
    () => (strict ? reconcileGuests(guests, rsvps) : null),
    [strict, guests, rsvps],
  );
  const counted = strict ? recon.rows.filter((x) => x.rsvp).map((x) => x.rsvp) : rsvps;
  const forApproval = rsvps.length - counted.length;
  const attending = strict
    ? recon.rows.filter((x) => x.status === "attending")
    : counted.filter((r) => r.status === "attending");
  const guestCount = strict
    ? recon.summary.confirmedHeads
    : attending.reduce((s, r) => s + headsOf(r), 0);
  const photos = media.filter((m) => m.type === "photo" && m.category === "gallery");
  const videos = media.filter((m) => m.type === "video");
  const pendingMedia = media.filter((m) => m.status === "pending");
  // Photos/Videos belong to the shelved gallery feature — hide their cards too.
  const mediaShelved = DISABLED_MODULES.has("gallery");
  // Hide a section's dashboard card when its module is switched off in Settings.
  const gbOn = moduleEnabled(settings.modules, "guestbook");
  const quizOn = moduleEnabled(settings.modules, "quiz");
  // Real week-over-week trend per tile: activity in the last 7 days vs the 7
  // days before, shown as an up/down percentage pill ("↗ +10%" / "↘ -7%" /
  // "− steady") like the Adminator reference.
  const trendOf = (list, weigh = () => 1) => {
    const WK = 7 * 86400000, now = Date.now();
    const tally = (from, to) => (list || []).reduce((s, x) => (x.createdAt > from && x.createdAt <= to ? s + weigh(x) : s), 0);
    const cur = tally(now - WK, now), prev = tally(now - 2 * WK, now - WK);
    if (!prev && !cur) return { pill: "steady", tone: "flat", cur };
    if (!prev) return { pill: `+${cur} new`, tone: "up", cur };
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct > 0) return { pill: `+${pct}%`, tone: "up", cur };
    if (pct < 0) return { pill: `${pct}%`, tone: "down", cur };
    return { pill: "steady", tone: "flat", cur };
  };
  // "up from N · last week" footer: N = the total as of a week ago (today's
  // total minus what was added in the last 7 days).
  const footOf = (value, t) => {
    const prev = Math.max(0, value - (t.cur || 0));
    return prev < value
      ? { dir: "up", word: "up from", val: String(prev) }
      : { dir: "flat", word: "matching", val: String(value) };
  };
  // Adminator's exact pill arrows (10px, stroke 2.5, currentColor)
  const pillArrow = (tone) => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {tone === "up" && <path d="M7 17l10-10M7 7h10v10" />}
      {tone === "down" && <path d="M7 7l10 10M7 17h10V7" />}
      {tone === "flat" && <path d="M5 12h14" />}
    </svg>
  );
  const attendingRaw = rsvps.filter((r) => r.status === "attending");
  const tRsvps  = trendOf(attendingRaw);
  const tGuests = trendOf(attendingRaw, (r) => headsOf(r));
  const tGb     = trendOf(guestbook);
  const tQuiz   = trendOf(quizSubs);
  const stats = [
    // "RSVPs" headline = ATTENDING total only (owner request) — in strict mode
    // read from the one reconcileGuests summary (same field the Guests tab's
    // Attending folder counts, so they can never disagree). Sub is just
    // "confirmed"; maybe/declined/for-approval live in the Guests tab folders.
    { label: "RSVPs", value: strict ? recon.summary.attending : attending.length, tab: "rsvps", icon: "check", accent: "success", pill: tRsvps.pill, tone: tRsvps.tone, foot: footOf(strict ? recon.summary.attending : attending.length, tRsvps) },
    { label: "Total Guests", value: guestCount, tab: "rsvps", icon: "user", accent: "info", pill: tGuests.pill, tone: tGuests.tone, foot: footOf(guestCount, tGuests) },
    ...(mediaShelved ? [] : [
      { label: "Photos", value: photos.length, sub: pendingMedia.length ? `${pendingMedia.length} to review` : "all clear", tab: "media", icon: "camera", accent: "purple", pill: pendingMedia.length ? `${pendingMedia.length} new` : null },
      { label: "Videos", value: videos.length, sub: "uploaded", tab: "media", icon: "play", accent: "amber", pill: null },
    ]),
    ...(gbOn ? [{ label: "Guestbook", value: guestbook.length, tab: "guestbook", icon: "book", accent: "purple", pill: tGb.pill, tone: tGb.tone, foot: footOf(guestbook.length, tGb) }] : []),
    ...(quizOn ? [{ label: "Quiz Plays", value: quizSubs.length, tab: "quiz", icon: "quiz", accent: "amber", pill: tQuiz.pill, tone: tQuiz.tone, foot: footOf(quizSubs.length, tQuiz) }] : []),
  ];
  const recentRsvps = rsvps.slice(0, 5);
  const recentMedia = media.slice(0, 6);
  const recentGb = guestbook.slice(0, 3);

  return (
    <div>
      <div className="stat-grid">
        {stats.map((s) => (
          <button key={s.label} className={"kpi kpi--" + (s.accent || "info")} onClick={() => goTab(s.tab)}>
            <div className="kpi__top">
              <span className="kpi__chip" aria-hidden="true">{Icon[s.icon] ? Icon[s.icon]({}) : null}</span>
              <span className="kpi__label">{s.label}</span>
              {s.pill && <span className={"kpi__pill" + (s.tone ? " kpi__pill--" + s.tone : "")}>{s.tone && pillArrow(s.tone)}{s.pill}</span>}
            </div>
            <div className="kpi__value">{s.value}</div>
            {s.foot ? (
              <div className="kpi__foot">
                <svg className={"kpi__cmp kpi__cmp--" + s.foot.dir} viewBox="0 0 24 24" aria-hidden="true">
                  {s.foot.dir === "up" ? <path d="M7 17l10-10M7 7h10v10" /> : <path d="M5 12h14" />}
                </svg>
                {s.foot.word} <strong>{s.foot.val}</strong> <span className="kpi__sep">·</span> last week
              </div>
            ) : (
              <div className="kpi__foot"><span className="kpi__tick" aria-hidden="true" />{s.sub}</div>
            )}
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

        {gbOn && (
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
        )}
      </div>
    </div>
  );
}

