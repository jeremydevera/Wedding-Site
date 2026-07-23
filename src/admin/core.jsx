import React from "react";
import qrcode from "qrcode-generator";
import { go } from "@/lib/nav.js";
import { resolveSubdomain } from "@/lib/tenant.js";
import { DISABLED_MODULES, moduleEnabled } from "@/lib/roles.js";
import { useStore } from "@/lib/store.jsx";
import { reconcileGuests } from "@/lib/guests.js";
import { headsOf } from "@/lib/rsvp.js";
import { signIn, signInGoogle, requestPasswordReset } from "@/lib/auth.js";
import { Button, Field, Icon, Input, Monogram, Placeholder, toast } from "@/ui/components.jsx";
// Lazy: amCharts is heavy — split into its own chunk, loaded only when the
// Dashboard tab renders.
const RsvpCharts = React.lazy(() => import("@/admin/rsvp-charts.jsx"));
// Real 3D iPhone login scene (three.js + owner's GLB) — heavy, so lazy: the
// CSS phone rig renders instantly as the Suspense fallback and swaps to WebGL.
const LoginPromo3D = React.lazy(() => import("@/admin/login-promo-3d.jsx"));
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

// Pure-CSS 3D iPhone (17-Pro-style: titanium edges + buttons, camera plateau,
// Dynamic Island). Six faces in preserve-3d; screens tinted per carousel slot.
// Styles: styles.css ".lgp-*" (login promo scene).
function LoginPhone({ shot }) {
  return (
    <div className="lgp-iph">
      <i className="lgp-fB">
        <span className="lgp-plateau"><span className="lgp-lens lgp-l1" /><span className="lgp-lens lgp-l2" /><span className="lgp-lens lgp-l3" /><span className="lgp-flash" /></span>
        <svg className="lgp-blogo" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="rgba(255,255,255,.1)" /><path d="M12 40 C20 24 28 24 32 32 C36 40 44 40 52 26" fill="none" stroke="rgba(255,255,255,.75)" strokeWidth="5" strokeLinecap="round" /></svg>
      </i>
      <i className="lgp-fR"><span className="lgp-btnP" /></i>
      <i className="lgp-fL"><span className="lgp-btnA" /><span className="lgp-btnV1" /><span className="lgp-btnV2" /></i>
      <i className="lgp-fT" /><i className="lgp-fBo"><span className="lgp-usb" /></i>
      {/* screen = REAL app screenshot (captured from the live demo) */}
      <i className="lgp-fF"><span className="lgp-isl" /><span className="lgp-scr"><img className="lgp-shot" src={shot} alt="" loading="lazy" /></span></i>
    </div>
  );
}

// The split-shell LEFT panel — brand + tagline + promo scene. ONE component
// shared by the main login AND /register (login-design-single-source): change
// it here and both pages move together.
export function SigninAside() {
  return (
    <aside className="signin__aside signin__aside--promo">
      <div className="signin__asidetop">
        <div className="signin__brand">
          <Logo size={28} />
          <span className="signin__word">Celebrately.</span>
        </div>
        <p className="signin__tagline">Celebrate life's biggest moments, beautifully.</p>
      </div>
      <LoginPromoScene />
    </aside>
  );
}

// V1 login showcase (owner pick 2026-07-23): zoom intro → ONE phone snaps left
// (caption right) / right (caption left) → 4-phone carousel. Pure CSS, no video.
function LoginPromoScene() {
  return (
    <div className="lgp-stage" aria-hidden="true">
      <span className="lgp-glow" />
      <React.Suspense fallback={
        <div className="lgp-zoomer"><div className="lgp-mover"><div className="lgp-ring">
          <div className="lgp-slot"><LoginPhone shot="/assets/login-phone.jpg" /></div>
          <div className="lgp-slot"><LoginPhone shot="/assets/login-shot-2.jpg" /></div>
          <div className="lgp-slot"><LoginPhone shot="/assets/login-shot-dash.jpg" /></div>
          <div className="lgp-slot"><LoginPhone shot="/assets/login-shot-4.jpg" /></div>
        </div></div></div>
      }>
        <LoginPromo3D />
      </React.Suspense>
      <div className="lgp-cap lgp-r lgp-s1"><span className="lgp-ey">Featuring</span><span className="lgp-h">RSVP in one tap</span><span className="lgp-p">Guests reply from their phone — every answer lands live.</span></div>
      <div className="lgp-cap lgp-l lgp-s2"><span className="lgp-ey">Featuring</span><span className="lgp-h">Live dashboard</span><span className="lgp-p">RSVPs, guests, guestbook — one glance, always current.</span></div>
      <div className="lgp-cap lgp-r lgp-c1"><span className="lgp-ey">Featuring</span><span className="lgp-h">Guestbook</span><span className="lgp-p">Wishes from everyone you love — kept forever.</span></div>
      <div className="lgp-cap lgp-l lgp-c2"><span className="lgp-ey">Featuring</span><span className="lgp-h">The day's schedule</span><span className="lgp-p">Ceremony to last dance — guests know what's next.</span></div>
      <div className="lgp-cap lgp-r lgp-c3"><span className="lgp-ey">Featuring</span><span className="lgp-h">Your entourage</span><span className="lgp-p">Everyone honored by name, group by group.</span></div>
      <div className="lgp-cap lgp-l lgp-c4"><span className="lgp-ey">Featuring</span><span className="lgp-h">Your invitation</span><span className="lgp-p">Opens like a real envelope — names, date, countdown.</span></div>
    </div>
  );
}
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
    catch (e2) {
      // Neon owners get crafted, actionable messages from signIn (site pending
      // approval / not this site's admin) — surface those; otherwise the
      // generic credentials line. Swallowing everything showed a pending owner
      // "Wrong email or password" and made her think her password broke.
      const m = e2 && e2.message ? e2.message : "";
      // Keep this passthrough in step with the crafted messages signIn throws —
      // masking them into the generic line gaslights users whose password was right.
      setErr(/waiting for approval|access to this site|6-digit code|isn't verified/i.test(m) ? m : "Wrong email or password.");
    }
    finally { setBusy(false); }
  }
  const [showPw, setShowPw] = useState(false);
  // iOS Safari focuses/fills the first field on load when it has saved
  // credentials for the site (no autofocus exists in our code; Supabase's
  // sign-in has the same plain markup — it just has no saved creds to push).
  // Mechanical guarantee of the Supabase behavior on touch devices: fields are
  // readOnly until the user's FIRST TAP (pointerdown fires before focus, so a
  // real tap unlocks before the keyboard decision), and any unsolicited focus
  // while still locked is blurred. Desktop keyboard/Tab flow is untouched.
  const coarse = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const [fieldsArmed, setFieldsArmed] = useState(!coarse);
  const armFields = () => { if (!fieldsArmed) setFieldsArmed(true); };
  const guardFocus = (e) => { if (!fieldsArmed) e.target.blur(); };
  // Arrived from a client site's Google button (popups can't open there —
  // Firebase authorizes exact domains only). Nudge them to tap Google again.
  const gFrom = !isClient ? new URLSearchParams(window.location.search).get("gfrom") : null;
  const [remember, setRemember] = useState(false);
  const [gBusy, setGBusy] = useState(false);
  // "Remember me" — prefill the last email on this device (email only, never pw)
  useEffect(() => {
    try { const e = localStorage.getItem("celebrately_login_email"); if (e) { setEmail(e); setRemember(true); } } catch (_) {}
  }, []);
  useEffect(() => {
    try { remember && email ? localStorage.setItem("celebrately_login_email", email) : (!remember && localStorage.removeItem("celebrately_login_email")); } catch (_) {}
  }, [remember, email]);
  const forgot = async (e) => {
    e.preventDefault();
    if (!email.trim()) { toast("Enter your email above first, then tap Forgot your password.", "err"); return; }
    await requestPasswordReset(email);
    toast("If that email has an account, we've sent a password reset link. Check your inbox (and spam).", "success");
  };
  const googleLogin = async () => {
    setGBusy(true); setErr("");
    try {
      const p = await signInGoogle();
      if (!p?.redirecting) { onAuthed && onAuthed(); }
    } catch (e2) {
      const m = e2?.message || "";
      setErr(/popup-closed|cancelled/i.test(m) ? "Google sign-in was cancelled." : m || "Google sign-in failed.");
    } finally { setGBusy(false); }
  };
  return (
    <div className="signin signin--split signin--login">
      {/* LEFT — the shared SigninAside (also used by /register). ONE design
          everywhere: a redesign there applies to every login and the sign-up. */}
      <SigninAside />

      {/* RIGHT — form */}
      <div className="signin__pane">
        {isClient && <button className="signin__back" onClick={() => go("home")}>← Back to website</button>}
        <div className="signin__center">
          <form className="signin__form" onSubmit={submit} noValidate>
            <h1 className="signin__title">Log in to Celebrately.</h1>
            <p className="signin__sub">{gFrom ? <>Tap <strong>Log in with Google</strong> below — we'll take you straight to your site's admin.</> : "Welcome back! Sign in with the details you used during registration."}</p>

            <div className="signin__field signin__field--icon">
              <label htmlFor="a-email">Email</label>
              <span className="signin__ficon" aria-hidden="true">{Icon.mail({})}</span>
              <input id="a-email" type="email" autoComplete="email" value={email} readOnly={!fieldsArmed} onPointerDown={armFields} onFocus={guardFocus} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>

            <div className="signin__field signin__field--icon">
              <label htmlFor="a-pw">Password</label>
              <span className="signin__ficon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
              <div className="signin__pwwrap">
                <input id="a-pw" type={showPw ? "text" : "password"} autoComplete="current-password" value={pw} readOnly={!fieldsArmed} onPointerDown={armFields} onFocus={guardFocus} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" />
                <button type="button" className="signin__eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"}>{(showPw ? Icon.eyeOff : Icon.eye)({})}</button>
              </div>
            </div>

            <div className="signin__meta">
              <label className="signin__remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember me</label>
              <a href="#" className="signin__forgot" onClick={forgot}>Forgot your password?</a>
            </div>

            {err && <div className="signin__err">{err}</div>}

            <button type="submit" className="signin__btn" disabled={busy}>{busy ? "Signing in…" : "LOGIN"}</button>

            {/* social BELOW email/password (owner request) */}
            <div className="signin__or"><span>or</span></div>
            <div className="signin__social">
              <button type="button" className="signin__socialbtn" onClick={googleLogin} disabled={gBusy}>
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.7 1.22 9.2 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                {gBusy ? "Opening Google…" : "Log in with Google"}
              </button>
            </div>

            <p className="signin__reg">Don't have an account? <a href="https://celebrately.us/register">Register</a></p>
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

