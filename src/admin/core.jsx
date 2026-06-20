import React from "react";
import qrcode from "qrcode-generator";
import { go } from "@/lib/nav.js";
import { useStore } from "@/lib/store.jsx";
import { Button, Field, Icon, Input, Monogram, Placeholder, toast } from "@/ui/components.jsx";
const { useState, useEffect, useRef, useMemo, useCallback, useReducer } = React;

// ============================================================================
// admin-core.jsx — admin auth, shell/sidebar, dashboard, shared admin utils
// ============================================================================

export const ADMIN_SESSION = "evermore_admin_session";

export function isAuthed() { return sessionStorage.getItem(ADMIN_SESSION) === "1"; }

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

// --- Login ------------------------------------------------------------------
export function AdminLogin({ onAuthed }) {
  const { settings } = useStore();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [show, setShow] = useState(false);

  function submit(e) {
    e.preventDefault();
    if (pw === settings.adminPassword) {
      sessionStorage.setItem(ADMIN_SESSION, "1");
      onAuthed();
    } else {
      setErr("Incorrect password. Please try again.");
    }
  }
  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <Monogram a={settings.partnerA} b={settings.partnerB} size={56} />
        <h1 className="login__title">Admin Sign In</h1>
        <p className="login__sub">Manage RSVPs, media, and more.</p>
        <Field label="Password" error={err} id="a-pw">
          <div style={{ position: "relative" }}>
            <Input id="a-pw" type={show ? "text" : "password"} value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} placeholder="Enter admin password" autoFocus />
            <button type="button" onClick={() => setShow((s) => !s)} className="icon-btn" style={{ position: "absolute", right: 8, top: 8, border: "none" }} aria-label="Toggle password">
              {show ? Icon.eyeOff({}) : Icon.eye({})}
            </button>
          </div>
        </Field>
        <Button type="submit" variant="primary" size="lg" block>Sign in</Button>
        <p style={{ marginTop: 18, fontSize: 12, color: "var(--muted)" }}>Demo password: <code>{settings.adminPassword}</code></p>
        <button type="button" className="footer__admin" style={{ marginTop: 14 }} onClick={() => go("home")}>&larr; Back to website</button>
      </form>
    </div>
  );
}

// --- Dashboard --------------------------------------------------------------
export function AdminDashboard({ goTab }) {
  const { rsvps, media, guestbook, quizSubs } = useStore();
  const attending = rsvps.filter((r) => r.status === "attending");
  const guestCount = attending.reduce((s, r) => s + (r.count || 0), 0);
  const photos = media.filter((m) => m.type === "photo" && m.category === "gallery");
  const videos = media.filter((m) => m.type === "video");
  const pendingMedia = media.filter((m) => m.status === "pending");
  const stats = [
    { label: "RSVPs", value: rsvps.length, sub: `${attending.length} attending`, tab: "rsvps" },
    { label: "Guest Count", value: guestCount, sub: "people coming", tab: "rsvps" },
    { label: "Photos", value: photos.length, sub: pendingMedia.length ? `${pendingMedia.length} to review` : "all clear", tab: "media" },
    { label: "Videos", value: videos.length, sub: "uploaded", tab: "media" },
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
            <div className="panel__head"><div className="panel__title">Latest Uploads</div><Button variant="ghost" size="sm" onClick={() => goTab("media")}>Manage</Button></div>
            <div className="panel__body">
              {recentMedia.length === 0 ? <p style={{ color: "var(--muted)", margin: 0 }}>No uploads yet.</p> : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                  {recentMedia.map((m) => (
                    <div key={m.id} className="amedia__media" style={{ borderRadius: "var(--radius)", border: "1px solid var(--line)" }}>
                      {m.dataUrl ? <img src={m.dataUrl} alt="" /> : <Placeholder label={m.type} ratio="1" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
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

Object.assign(window, { isAuthed, ADMIN_SESSION, downloadCSV, fmtDate, QRCanvas, downloadQR, AdminLogin, AdminDashboard });
