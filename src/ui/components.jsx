import React from "react";
import { uid } from "@/lib/store.jsx";
const { useState, useEffect, useRef, useMemo, useCallback, useReducer } = React;

// ============================================================================
// components.jsx — shared UI primitives used across the app.
// ============================================================================


// --- Striped placeholder for imagery the client will replace ----------------
export function Placeholder({ label = "photo", ratio = "4 / 3", className = "", style = {} }) {
  return (
    <div className={"ph " + className} style={{ aspectRatio: ratio, ...style }}>
      <span className="ph__label">{label}</span>
    </div>
  );
}

// --- Monogram (couple initials) ---------------------------------------------
export function Monogram({ a, b, size = 40 }) {
  const ia = (a || "A").trim().charAt(0).toUpperCase();
  const ib = (b || "B").trim().charAt(0).toUpperCase();
  return (
    <span className="monogram" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {ia}<span className="monogram__amp">&</span>{ib}
    </span>
  );
}

// --- Button -----------------------------------------------------------------
export function Button({ variant = "primary", size = "md", block, type = "button", className = "", children, ...rest }) {
  const cls = [
    "btn",
    `btn--${variant}`,
    size !== "md" ? `btn--${size}` : "",
    block ? "btn--block" : "",
    className,
  ].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} {...rest}>{children}</button>
  );
}

// --- Form field wrapper -----------------------------------------------------
export function Field({ label, required, hint, error, children, id }) {
  return (
    <label className="field" htmlFor={id}>
      {label && (
        <span className="field__label">
          {label}{required && <span className="field__req">*</span>}
        </span>
      )}
      {children}
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error">{error}</span>}
    </label>
  );
}

export function Input(props) {
  return <input className={"input " + (props.className || "")} {...props} />;
}
export function Textarea(props) {
  return <textarea className={"input textarea " + (props.className || "")} {...props} />;
}
export function Select({ children, ...props }) {
  return <select className={"input select " + (props.className || "")} {...props}>{children}</select>;
}

// --- Section header ---------------------------------------------------------
export function SectionHead({ eyebrow, title, lead, center, light }) {
  return (
    <header className={"sec-head" + (center ? " sec-head--center" : "") + (light ? " sec-head--light" : "")}>
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      {title && <h2 className="sec-head__title">{title}</h2>}
      {lead && <p className="sec-head__lead">{lead}</p>}
    </header>
  );
}

// --- Modal ------------------------------------------------------------------
export function Modal({ open, onClose, children, wide, label = "Dialog" }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose && onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={label}>
      <div className="modal__backdrop" onClick={onClose} />
      <div className={"modal__panel" + (wide ? " modal__panel--wide" : "")}>
        <button className="modal__close" onClick={onClose} aria-label="Close">&times;</button>
        {children}
      </div>
    </div>
  );
}

// --- Toast (transient confirmation) -----------------------------------------
export let _toastFn = null;
export function ToastHost() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    _toastFn = (msg, kind = "ok") => {
      const id = uid();
      setToasts((t) => [...t, { id, msg, kind }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
    };
    return () => { _toastFn = null; };
  }, []);
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={"toast toast--" + t.kind}>{t.msg}</div>
      ))}
    </div>
  );
}
export function toast(msg, kind) { if (_toastFn) _toastFn(msg, kind); }

// --- Confirm dialog (promise-based, styled) ---------------------------------
export let _confirmFn = null;
export function ConfirmHost() {
  const [state, setState] = useState(null);
  useEffect(() => {
    _confirmFn = (opts) => new Promise((resolve) => setState({ ...opts, resolve }));
    return () => { _confirmFn = null; };
  }, []);
  const close = (val) => { setState((s) => { if (s) s.resolve(val); return null; }); };
  return (
    <Modal open={!!state} onClose={() => close(false)} label="Confirm">
      {state && (
        <div style={{ textAlign: "center" }}>
          <div className="confirm__seal" style={{ borderColor: state.danger ? "oklch(0.72 0.12 25)" : "var(--gold)", color: state.danger ? "oklch(0.55 0.16 25)" : "var(--accent)" }}>
            {state.danger ? Icon.trash({}) : Icon.check({})}
          </div>
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: 28, marginBottom: 10 }}>{state.title || "Are you sure?"}</h3>
          {state.message && <p style={{ color: "var(--ink-soft)", maxWidth: "42ch", margin: "0 auto 24px" }}>{state.message}</p>}
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Button variant="ghost" onClick={() => close(false)}>{state.cancelLabel || "Cancel"}</Button>
            <Button variant={state.danger ? "danger" : "primary"} onClick={() => close(true)}>{state.confirmLabel || "Confirm"}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
export function confirmDialog(opts) {
  const o = typeof opts === "string" ? { message: opts } : (opts || {});
  if (!_confirmFn) return Promise.resolve(window.confirm(o.message || "Are you sure?"));
  return _confirmFn(o);
}

// --- Crop modal (pan + zoom within an aspect frame) -------------------------
export function CropModal({ open, src, aspect = 1, onCancel, onApply, frameSrc }) {
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [live, setLive] = useState(null);
  const imgRef = useRef(null);
  const W = 340;
  const H = Math.round(W / (aspect || 1));

  useEffect(() => {
    if (!open || !src) return;
    setZoom(1); setNat({ w: 0, h: 0 });
    const im = new Image();
    im.onload = () => setNat({ w: im.naturalWidth, h: im.naturalHeight });
    im.src = src;
  }, [open, src]);

  const baseScale = nat.w ? Math.max(W / nat.w, H / nat.h) : 1;
  const scale = baseScale * zoom;
  const dispW = nat.w * scale, dispH = nat.h * scale;
  const clamp = (o) => ({ x: Math.min(0, Math.max(W - dispW, o.x)), y: Math.min(0, Math.max(H - dispH, o.y)) });

  useEffect(() => {
    if (nat.w) setOff(clamp({ x: (W - dispW) / 2, y: (H - dispH) / 2 }));
    // eslint-disable-next-line
  }, [nat.w, nat.h, zoom]);

  function onDown(e) {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, o0 = { ...off };
    const move = (ev) => setOff(clamp({ x: o0.x + (ev.clientX - sx), y: o0.y + (ev.clientY - sy) }));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  function drawCrop() {
    const im = imgRef.current;
    if (!im || !nat.w) return null;
    const srcX = -off.x / scale, srcY = -off.y / scale, srcW = W / scale, srcH = H / scale;
    const outW = Math.min(1400, Math.round(srcW));
    const outH = Math.round(outW / (aspect || 1));
    const c = document.createElement("canvas");
    c.width = outW; c.height = outH;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(im, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
    return c;
  }

  // live oval-frame preview — recompute as the user drags / zooms
  useEffect(() => {
    if (!frameSrc || !open || !nat.w) return;
    const raf = requestAnimationFrame(() => { const c = drawCrop(); if (c) setLive(c.toDataURL("image/jpeg", 0.85)); });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line
  }, [off.x, off.y, scale, nat.w, frameSrc, open]);

  function apply() {
    const c = drawCrop();
    if (!c) { onCancel && onCancel(); return; }
    onApply(c.toDataURL("image/jpeg", 0.86));
  }

  if (!open) return null;
  return (
    <Modal open={open} onClose={onCancel} label="Crop photo" wide={!!frameSrc}>
      <SectionHead eyebrow="Adjust" title="Crop photo" />
      <p style={{ color: "var(--muted)", fontSize: 14, marginTop: -16, marginBottom: 16 }}>Drag to reposition, slide to zoom. {frameSrc ? "The preview shows exactly how it sits in the frame." : "The shaded frame is what guests will see."}</p>
      <div className="crop">
        <div style={{ display: "flex", gap: 22, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "center", width: "100%" }}>
          <div className="crop__view" style={{ width: W, height: H }} onPointerDown={onDown}>
            {src && <img ref={imgRef} src={src} alt="" draggable="false" style={{ position: "absolute", left: off.x, top: off.y, width: dispW, height: dispH, maxWidth: "none" }} />}
            <div className="crop__frame" />
          </div>
          {frameSrc && (
            <div style={{ flex: "none", textAlign: "center" }}>
              <span className="field__label" style={{ display: "block", marginBottom: 8 }}>In the frame</span>
              <div style={{ position: "relative", width: 200, aspectRatio: "766 / 800", filter: "drop-shadow(0 6px 14px rgba(26,30,12,.28))" }}>
                <img src={live || src} alt="" style={{ position: "absolute", left: "20.6%", top: "14.9%", width: "78%", height: "75%", objectFit: "cover", display: "block" }} />
                <img src={frameSrc} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "auto", display: "block" }} />
              </div>
            </div>
          )}
        </div>
        <label className="crop__zoom">
          <span>Zoom</span>
          <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} style={{ flex: 1, accentColor: "var(--accent)" }} />
        </label>
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", width: "100%" }}>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={apply}>Apply crop</Button>
        </div>
      </div>
    </Modal>
  );
}

// --- Google Maps helpers (parse pasted map links for coordinates) -----------
export function mapResolveQuery(q) {
  q = (q || "").trim();
  if (!q) return "";
  const at = q.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);              // .../@40.7,-74.0,15z
  if (at) return at[1] + "," + at[2];
  const ll = q.match(/[?&](?:q|query|destination)=([^&]+)/);     // ...?q=40.7,-74.0
  if (ll) return decodeURIComponent(ll[1].replace(/\+/g, " "));
  const place = q.match(/\/place\/([^/@]+)/);                    // .../place/Name+Here/
  if (place) return decodeURIComponent(place[1].replace(/\+/g, " "));
  return q;
}
// A precise "lat,lng" string when both coords are real numbers, else "".
export function mapCoordStr(lat, lng) {
  return (lat !== "" && lat != null && lng !== "" && lng != null && Number.isFinite(parseFloat(lat)) && Number.isFinite(parseFloat(lng)))
    ? parseFloat(lat) + "," + parseFloat(lng) : "";
}
export function mapEmbedUrl(q, lat, lng) { return "https://www.google.com/maps?q=" + encodeURIComponent(mapCoordStr(lat, lng) || mapResolveQuery(q)) + "&output=embed"; }
export function mapDirUrl(q, lat, lng) { return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(mapCoordStr(lat, lng) || mapResolveQuery(q)); }
export function mapSearchUrl(q) { return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent((q || "").trim() || "wedding venue"); }

// --- Countdown to a date ----------------------------------------------------
export function useCountdown(targetIso) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const target = new Date(targetIso).getTime();
  let diff = Math.max(0, target - now);
  const days = Math.floor(diff / 86400000); diff -= days * 86400000;
  const hours = Math.floor(diff / 3600000); diff -= hours * 3600000;
  const minutes = Math.floor(diff / 60000); diff -= minutes * 60000;
  const seconds = Math.floor(diff / 1000);
  return { days, hours, minutes, seconds, done: target <= now };
}

export function Countdown({ targetIso, light }) {
  const { days, hours, minutes, seconds, done } = useCountdown(targetIso);
  if (done) return <div className={"countdown countdown--done" + (light ? " countdown--light" : "")}>The day is here — cheers! ✨</div>;
  const units = [
    { n: days, l: "Days" },
    { n: hours, l: "Hours" },
    { n: minutes, l: "Minutes" },
    { n: seconds, l: "Seconds" },
  ];
  return (
    <div className={"countdown" + (light ? " countdown--light" : "")}>
      {units.map((u, i) => (
        <div className="countdown__unit" key={i}>
          <span className="countdown__num">{String(u.n).padStart(2, "0")}</span>
          <span className="countdown__lbl">{u.l}</span>
        </div>
      ))}
    </div>
  );
}

// --- small inline icons (line style, no slop) -------------------------------
export const Icon = {
  rings: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><circle cx="9" cy="15" r="6" stroke="currentColor" strokeWidth="1.4"/><circle cx="15" cy="13" r="6" stroke="currentColor" strokeWidth="1.4"/></svg>),
  pin: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z" stroke="currentColor" strokeWidth="1.4"/><circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.4"/></svg>),
  camera: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><path d="M3 8.5A1.5 1.5 0 0 1 4.5 7H7l1.2-1.8A1 1 0 0 1 9 4.7h6a1 1 0 0 1 .8.5L17 7h2.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-9Z" stroke="currentColor" strokeWidth="1.4"/><circle cx="12" cy="12.5" r="3.2" stroke="currentColor" strokeWidth="1.4"/></svg>),
  play: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><path d="M8 6.5v11l9-5.5-9-5.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>),
  heart: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><path d="M12 20s-7-4.4-7-9.4A4 4 0 0 1 12 7a4 4 0 0 1 7 3.6c0 5-7 9.4-7 9.4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>),
  check: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><path d="m5 12.5 4.5 4.5L19 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  calendar: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><rect x="4" y="5.5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.4"/><path d="M4 10h16M8 3.5v4M16 3.5v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>),
  book: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><path d="M12 6.5C10.5 5.2 8.3 4.8 5.5 5.2A1 1 0 0 0 4.6 6.2v11.3a1 1 0 0 0 1.1 1c2.5-.3 4.7 0 6.3 1.2 1.6-1.2 3.8-1.5 6.3-1.2a1 1 0 0 0 1.1-1V6.2a1 1 0 0 0-.9-1C17.7 4.8 13.5 5.2 12 6.5Zm0 0v13" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>),
  quiz: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.4"/><path d="M9.6 9.6a2.4 2.4 0 1 1 3.3 2.2c-.6.3-.9.7-.9 1.5M12 16.4h.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>),
  upload: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><path d="M12 16V5m0 0L8 9m4-4 4 4M5 18.5h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  grid: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><rect x="4" y="4" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.4"/><rect x="13" y="4" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.4"/><rect x="4" y="13" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.4"/><rect x="13" y="13" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.4"/></svg>),
  qr: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4"/><rect x="14" y="4" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4"/><rect x="4" y="14" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4"/><path d="M14 14h3v3M20 14v6M14 20h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>),
  user: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><circle cx="12" cy="8.5" r="3.5" stroke="currentColor" strokeWidth="1.4"/><path d="M5.5 19a6.5 6.5 0 0 1 13 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>),
  search: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><circle cx="11" cy="11" r="6.2" stroke="currentColor" strokeWidth="1.4"/><path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>),
  download: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19.5h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  eye: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke="currentColor" strokeWidth="1.4"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.4"/></svg>),
  eyeOff: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><path d="M4 4l16 16M9.8 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.4 3.2M6.3 7.9A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 3.3-.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>),
  trash: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><path d="M5 7h14M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7m2 0-.7 11a2 2 0 0 1-2 1.9H9.7a2 2 0 0 1-2-1.9L7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  edit: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><path d="M4 20.5h4.2L19 9.7a2 2 0 0 0 0-2.8l-1.9-1.9a2 2 0 0 0-2.8 0L3.5 16.3V20.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="m13.3 7.3 3.4 3.4" stroke="currentColor" strokeWidth="1.4"/></svg>),
  crop: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  menu: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>),
  close: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>),
  arrow: (p) => (<svg viewBox="0 0 24 24" fill="none" {...p}><path d="M5 12h14m0 0-5-5m5 5-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>),
};

// --- Floating home decorations (toggleable) --------------------------------
export function decorGlyph(style) {
  const a = { fill: "currentColor" };
  switch (style) {
    case "hearts":
      return (
        <svg viewBox="0 0 24 24" className="decor__svg">
          <path d="M12 20s-7-4.4-7-9.4A4 4 0 0 1 12 7a4 4 0 0 1 7 3.6c0 5-7 9.4-7 9.4Z" fill="currentColor" />
        </svg>
      );
    case "petals":
      return <span className="decor__petal" />;
    case "leaves":
      return <span className="decor__leaf" />;
    case "confetti":
      return <span className="decor__conf" />;
    case "snow":
      return <span className="decor__snow" />;
    case "bubbles":
      return <span className="decor__bubble" />;
    case "sparkles":
      return <span className="decor__spark" />;
    case "orbs":
      return <span className="decor__orb" />;
    case "balloons":
      return <span className="decor__balloon">🎈</span>;
    case "fireflies":
    default:
      return <span className="decor__fly" />;
  }
}

export function FloatingDecor({ on, style }) {
  const active = on && style && style !== "none";
  const baseCount = style === "fireflies" ? 20 : style === "confetti" ? 28 : style === "snow" ? 26 : style === "sparkles" ? 22 : style === "bubbles" ? 16 : style === "orbs" ? 12 : style === "balloons" ? 9 : style === "petals" || style === "leaves" ? 18 : 12;
  const count = baseCount;
  const items = useMemo(() => {
    if (!active) return [];
    return Array.from({ length: count }).map(() => ({
      left: Math.random() * 100,
      top: 6 + Math.random() * 80,
      delay: -Math.random() * 18,
      dur: (9 + Math.random() * 13),
      sc: 0.55 + Math.random() * 0.95,
      sway: (Math.random() * 2 - 1).toFixed(2),
      hue: Math.random() > 0.5 ? "a" : "b",
      chue: Math.floor(Math.random() * 330),
    }));
  }, [active, style, count]);
  if (!active) return null;

  return (
    <div className={"decor decor--" + style} aria-hidden="true">
      {items.map((it, i) => {
        const hueDeg = style === "balloons" ? it.chue : 0;
        const st = { left: it.left + "%", animationDelay: it.delay + "s", animationDuration: it.dur + "s", "--sc": it.sc, "--sway": it.sway + "", "--hue": hueDeg + "deg" };
        return (
          <span key={i} className={"decor__item decor__item--" + it.hue} style={st}>
            {decorGlyph(style)}
          </span>
        );
      })}
    </div>
  );
}

// Small contained preview of a decoration (for the admin settings panel)
export function DecorPreview({ style }) {
  const n = 5;
  const items = useMemo(() => Array.from({ length: n }).map(() => ({
    left: 5 + Math.random() * 88,
    top: 8 + Math.random() * 74,
    delay: -(Math.random() * 4).toFixed(2),
    dur: (3.4 + Math.random() * 2),
    sc: 0.65 + Math.random() * 0.7,
    sway: (Math.random() * 2 - 1).toFixed(2),
    chue: Math.floor(Math.random() * 330),
  })), [n, style]);
  if (!style || style === "none") return null;
  const cls = "decor-preview decor--" + style;
  return (
    <div className={cls} aria-hidden="true">
      {items.map((it, i) => {
        const hueDeg = style === "balloons" ? it.chue : 0;
        return (
          <span key={i} className="decor-preview__item" style={{ left: it.left + "%", top: it.top + "%", animationDelay: it.delay + "s", animationDuration: it.dur + "s", "--sc": it.sc, "--hue": hueDeg + "deg", "--sway": it.sway }}>
            {decorGlyph(style)}
          </span>
        );
      })}
    </div>
  );
}

