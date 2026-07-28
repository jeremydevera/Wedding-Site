// Shared hover-popover bits for the Health tab. Kept in their OWN module (not in
// health-gauges.jsx) because that file is lazy-loaded with Chart.js — the KPI
// tiles in CloudflareHealth.jsx need these too, and importing them from the
// gauge chunk would drag Chart.js into the main bundle.
//
// 🔴 The bubble renders through a PORTAL to <body>, positioned from the tile's
// bounding rect. It cannot be a plain absolutely-positioned child: `.kpi` sets
// `overflow: hidden` (for its radial glow) which CLIPS the bubble to the card,
// and `.kpi:hover` sets a `transform`, which makes even `position: fixed`
// resolve against the card instead of the viewport. A portal escapes both.
import React from "react";
import { createPortal } from "react-dom";

const { useState, useRef, useEffect, useCallback } = React;

const BUBBLE_W = 360;   // matches the max width below
const GAP = 10;         // space between tile and bubble

// Where should the bubble sit for this anchor? Prefers above; flips below when
// there isn't room. Clamped so it never runs off either edge.
function placeFor(el, width) {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(width || BUBBLE_W, vw - 20);
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(10, Math.min(left, vw - w - 10));
  const below = r.bottom + GAP;
  // Rough height guess only decides the flip; the bubble itself is auto-height.
  const flip = r.top < 210 && vh - r.bottom > r.top;
  return { left, w, top: flip ? below : undefined, bottom: flip ? undefined : vh - r.top + GAP, flip,
    arrowLeft: Math.max(12, Math.min(r.left + r.width / 2 - left, w - 12)) };
}

// Long-form explainer shown on hover of its tile (the domain-cap / Firebase notes
// that used to sit as always-open blocks). Light card, so the prose it's handed
// (strong/code/em in --ink) reads exactly as it did inline.
// `tone`: "light" for prose explainers, "dark" for the compact per-shard readout.
// `width`: override for short content (the breakdown doesn't need the full 360).
export function InfoPop({ anchor, children, tone = "light", width }) {
  const [pos, setPos] = useState(() => (anchor ? placeFor(anchor, width) : null));
  const sync = useCallback(() => { if (anchor) setPos(placeFor(anchor, width)); }, [anchor, width]);
  useEffect(() => {
    sync();
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => { window.removeEventListener("scroll", sync, true); window.removeEventListener("resize", sync); };
  }, [sync]);
  if (!anchor || !pos || typeof document === "undefined") return null;
  const dark = tone === "dark";
  const edge = dark ? "#0f172a" : "var(--line, #e4e1d8)";
  const arrow = pos.flip
    ? { bottom: "100%", borderBottom: `7px solid ${edge}`, borderTop: 0 }
    : { top: "100%", borderTop: `7px solid ${edge}`, borderBottom: 0 };
  return createPortal(
    <div role="tooltip" style={{
      position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.w,
      zIndex: 9999,
      background: dark ? "#0f172a" : "var(--panel, #fff)",
      border: dark ? "none" : "1px solid var(--line, #e4e1d8)",
      borderRadius: dark ? 10 : 12, padding: dark ? "10px 12px" : "11px 14px",
      boxShadow: dark ? "0 10px 30px rgba(15,23,42,.28)" : "0 14px 38px rgba(15,23,42,.22)",
      textAlign: "left", fontWeight: dark ? 500 : 400, fontSize: 12.5, lineHeight: 1.55,
      color: dark ? "#e2e8f0" : "var(--muted)",
      pointerEvents: "none", whiteSpace: "normal",
    }}>
      {children}
      <div style={{ position: "absolute", left: pos.arrowLeft, width: 0, height: 0,
        borderLeft: "7px solid transparent", borderRight: "7px solid transparent", ...arrow }} />
    </div>,
    document.body,
  );
}

// Tiny "there's more here" affordance beside a label that has a hover popover.
export function InfoDot() {
  return (
    <span aria-hidden="true" style={{ display: "inline-grid", placeItems: "center", width: 14, height: 14, marginLeft: 5, borderRadius: "50%", border: "1px solid #cbd5e1", color: "#94a3b8", fontSize: 9.5, fontWeight: 800, lineHeight: 1, verticalAlign: "text-top", flex: "none" }}>i</span>
  );
}

// Hover/focus/tap state for a tile that owns an info popover. `ref` is the anchor
// the bubble is measured from; tap-to-toggle keeps it reachable on touch.
export function useInfoHover(enabled) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  if (!enabled) return { open: false, anchor: null, bind: {}, ref };
  return {
    open,
    anchor: ref.current,
    ref,
    bind: {
      ref,
      onMouseEnter: () => setOpen(true),
      onMouseLeave: () => setOpen(false),
      onFocus: () => setOpen(true),
      onBlur: () => setOpen(false),
      onClick: () => setOpen((v) => !v),
      tabIndex: 0,
      style: { cursor: "help" },
    },
  };
}
