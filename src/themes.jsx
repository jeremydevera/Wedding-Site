import React from "react";
const { useState, useEffect, useRef, useMemo, useCallback, useReducer } = React;

// ============================================================================
// themes.jsx — theme engine. Each theme is a complete look the client can pick.
// applyTheme() writes CSS custom properties onto :root; Tweaks can layer
// accent/font overrides on top.
// ============================================================================

export const THEMES = {
  classic: {
    label: "Classic Ivory",
    blurb: "Warm cream and rich gold. Soft, romantic, timeless.",
    vars: {
      "--bg": "oklch(0.981 0.014 88)",
      "--surface": "oklch(0.995 0.008 88)",
      "--surface-2": "oklch(0.958 0.018 88)",
      "--ink": "oklch(0.27 0.016 72)",
      "--ink-soft": "oklch(0.43 0.015 72)",
      "--muted": "oklch(0.6 0.012 72)",
      "--line": "oklch(0.89 0.014 88)",
      "--accent": "oklch(0.64 0.08 80)",
      "--accent-soft": "oklch(0.94 0.04 82)",
      "--accent-ink": "oklch(0.99 0.008 88)",
      "--gold": "oklch(0.66 0.09 78)",
      "--font-display": "'Cormorant Garamond', serif",
      "--font-body": "'Jost', sans-serif",
      "--radius": "4px",
      "--hero-tint": "oklch(0.64 0.08 80 / 0.2)",
    },
  },
  classic2: {
    label: "Classic Noir",
    blurb: "Pure white with charcoal black. Crisp, formal, black-tie.",
    vars: {
      "--bg": "oklch(0.988 0.001 250)",
      "--surface": "oklch(1 0 0)",
      "--surface-2": "oklch(0.962 0.002 250)",
      "--ink": "oklch(0.19 0.004 250)",
      "--ink-soft": "oklch(0.36 0.004 250)",
      "--muted": "oklch(0.55 0.004 250)",
      "--line": "oklch(0.89 0.003 250)",
      "--accent": "oklch(0.3 0.008 250)",
      "--accent-soft": "oklch(0.92 0.004 250)",
      "--accent-ink": "oklch(0.99 0 0)",
      "--gold": "oklch(0.7 0.05 80)",
      "--font-display": "'Cormorant Garamond', serif",
      "--font-body": "'Jost', sans-serif",
      "--radius": "0px",
      "--hero-tint": "oklch(0.2 0.005 250 / 0.45)",
    },
  },
  classic3: {
    label: "Classic White",
    blurb: "Cool pure white with slate grey. Crisp, minimal, modern-classic.",
    vars: {
      "--bg": "oklch(0.993 0.0015 250)",
      "--surface": "oklch(1 0 0)",
      "--surface-2": "oklch(0.974 0.002 250)",
      "--ink": "oklch(0.23 0.006 250)",
      "--ink-soft": "oklch(0.4 0.006 250)",
      "--muted": "oklch(0.57 0.005 250)",
      "--line": "oklch(0.91 0.003 250)",
      "--accent": "oklch(0.48 0.013 250)",
      "--accent-soft": "oklch(0.94 0.005 250)",
      "--accent-ink": "oklch(0.99 0.002 250)",
      "--gold": "oklch(0.62 0.015 250)",
      "--font-display": "'Cormorant Garamond', serif",
      "--font-body": "'Jost', sans-serif",
      "--radius": "3px",
      "--hero-tint": "oklch(0.4 0.01 250 / 0.2)",
    },
  },
  glass: {
    label: "Glassy White",
    blurb: "Frosted white glass over a soft light haze. Airy and modern.",
    vars: {
      "--bg": "oklch(0.96 0.006 250)",
      "--surface": "oklch(1 0 0)",
      "--surface-2": "oklch(0.95 0.008 250)",
      "--ink": "oklch(0.26 0.012 255)",
      "--ink-soft": "oklch(0.42 0.012 255)",
      "--muted": "oklch(0.56 0.01 255)",
      "--line": "oklch(0.9 0.008 250)",
      "--accent": "oklch(0.55 0.04 250)",
      "--accent-soft": "oklch(0.93 0.02 250)",
      "--accent-ink": "oklch(0.99 0.004 250)",
      "--gold": "oklch(0.7 0.025 250)",
      "--font-display": "'Jost', sans-serif",
      "--font-body": "'Nunito Sans', sans-serif",
      "--radius": "16px",
      "--hero-tint": "oklch(0.4 0.01 250 / 0.16)",
    },
  },
  noir: {
    label: "Midnight Editorial",
    blurb: "High-contrast ink on warm white with a thin gold rule. Modern, bold.",
    vars: {
      "--bg": "oklch(0.98 0.004 95)",
      "--surface": "oklch(1 0 0)",
      "--surface-2": "oklch(0.96 0.004 95)",
      "--ink": "oklch(0.18 0.01 60)",
      "--ink-soft": "oklch(0.34 0.01 60)",
      "--muted": "oklch(0.54 0.008 60)",
      "--line": "oklch(0.86 0.006 80)",
      "--accent": "oklch(0.62 0.09 65)",
      "--accent-soft": "oklch(0.94 0.03 75)",
      "--accent-ink": "oklch(0.99 0.005 80)",
      "--gold": "oklch(0.66 0.1 70)",
      "--font-display": "'Cormorant Garamond', serif",
      "--font-body": "'Jost', sans-serif",
      "--radius": "2px",
      "--hero-tint": "oklch(0.18 0.01 60 / 0.42)",
    },
  },
  garden: {
    label: "Garden Botanical",
    blurb: "Cream, forest green, and terracotta. Natural, airy, lush.",
    vars: {
      "--bg": "oklch(0.972 0.018 110)",
      "--surface": "oklch(0.99 0.01 110)",
      "--surface-2": "oklch(0.95 0.022 120)",
      "--ink": "oklch(0.3 0.04 145)",
      "--ink-soft": "oklch(0.44 0.04 145)",
      "--muted": "oklch(0.56 0.03 140)",
      "--line": "oklch(0.87 0.025 120)",
      "--accent": "oklch(0.5 0.08 150)",
      "--accent-soft": "oklch(0.92 0.04 150)",
      "--accent-ink": "oklch(0.985 0.012 110)",
      "--gold": "oklch(0.64 0.11 55)",
      "--font-display": "'Cormorant Garamond', serif",
      "--font-body": "'Jost', sans-serif",
      "--radius": "10px",
      "--hero-tint": "oklch(0.3 0.04 145 / 0.34)",
    },
  },
  blush: {
    label: "Blush Atelier",
    blurb: "Soft blush, warm taupe, rose-gold. Delicate and pretty.",
    vars: {
      "--bg": "oklch(0.972 0.016 25)",
      "--surface": "oklch(0.992 0.008 25)",
      "--surface-2": "oklch(0.955 0.02 25)",
      "--ink": "oklch(0.33 0.03 20)",
      "--ink-soft": "oklch(0.46 0.03 20)",
      "--muted": "oklch(0.6 0.025 20)",
      "--line": "oklch(0.88 0.018 25)",
      "--accent": "oklch(0.62 0.08 20)",
      "--accent-soft": "oklch(0.93 0.03 20)",
      "--accent-ink": "oklch(0.99 0.008 25)",
      "--gold": "oklch(0.72 0.07 50)",
      "--font-display": "'Cormorant Garamond', serif",
      "--font-body": "'Jost', sans-serif",
      "--radius": "6px",
      "--hero-tint": "oklch(0.62 0.08 20 / 0.22)",
    },
  },
  dusk: {
    label: "Dusty Blue",
    blurb: "Powder blue, slate, and soft silver. Calm and airy.",
    vars: {
      "--bg": "oklch(0.975 0.012 250)",
      "--surface": "oklch(0.992 0.006 250)",
      "--surface-2": "oklch(0.95 0.016 250)",
      "--ink": "oklch(0.28 0.03 255)",
      "--ink-soft": "oklch(0.43 0.03 255)",
      "--muted": "oklch(0.58 0.02 255)",
      "--line": "oklch(0.88 0.015 250)",
      "--accent": "oklch(0.52 0.06 250)",
      "--accent-soft": "oklch(0.93 0.025 250)",
      "--accent-ink": "oklch(0.985 0.008 250)",
      "--gold": "oklch(0.7 0.07 80)",
      "--font-display": "'Cormorant Garamond', serif",
      "--font-body": "'Jost', sans-serif",
      "--radius": "5px",
      "--hero-tint": "oklch(0.4 0.06 255 / 0.34)",
    },
  },
  burgundy: {
    label: "Burgundy Velvet",
    blurb: "Deep wine, warm cream, and antique gold. Rich and romantic.",
    vars: {
      "--bg": "oklch(0.975 0.01 35)",
      "--surface": "oklch(0.992 0.006 35)",
      "--surface-2": "oklch(0.95 0.016 30)",
      "--ink": "oklch(0.27 0.04 22)",
      "--ink-soft": "oklch(0.42 0.04 22)",
      "--muted": "oklch(0.57 0.03 22)",
      "--line": "oklch(0.88 0.015 30)",
      "--accent": "oklch(0.43 0.11 18)",
      "--accent-soft": "oklch(0.93 0.03 18)",
      "--accent-ink": "oklch(0.99 0.008 40)",
      "--gold": "oklch(0.72 0.08 75)",
      "--font-display": "'Cormorant Garamond', serif",
      "--font-body": "'Jost', sans-serif",
      "--radius": "3px",
      "--hero-tint": "oklch(0.32 0.1 20 / 0.42)",
    },
  },
  lavender: {
    label: "Lavender Fields",
    blurb: "Soft violet, lilac, and silver. Dreamy and gentle.",
    vars: {
      "--bg": "oklch(0.974 0.012 300)",
      "--surface": "oklch(0.992 0.006 300)",
      "--surface-2": "oklch(0.95 0.018 300)",
      "--ink": "oklch(0.3 0.04 305)",
      "--ink-soft": "oklch(0.45 0.035 305)",
      "--muted": "oklch(0.58 0.025 305)",
      "--line": "oklch(0.88 0.015 300)",
      "--accent": "oklch(0.52 0.08 305)",
      "--accent-soft": "oklch(0.93 0.03 305)",
      "--accent-ink": "oklch(0.985 0.008 300)",
      "--gold": "oklch(0.72 0.06 80)",
      "--font-display": "'Cormorant Garamond', serif",
      "--font-body": "'Jost', sans-serif",
      "--radius": "9px",
      "--hero-tint": "oklch(0.42 0.07 305 / 0.32)",
    },
  },
  emerald: {
    label: "Emerald & Gold",
    blurb: "Deep emerald, jewel green, and warm gold. Opulent and bold.",
    vars: {
      "--bg": "oklch(0.972 0.014 160)",
      "--surface": "oklch(0.99 0.008 160)",
      "--surface-2": "oklch(0.95 0.02 165)",
      "--ink": "oklch(0.27 0.05 165)",
      "--ink-soft": "oklch(0.42 0.045 165)",
      "--muted": "oklch(0.56 0.03 165)",
      "--line": "oklch(0.87 0.02 160)",
      "--accent": "oklch(0.45 0.09 165)",
      "--accent-soft": "oklch(0.92 0.04 165)",
      "--accent-ink": "oklch(0.985 0.012 160)",
      "--gold": "oklch(0.72 0.1 85)",
      "--font-display": "'Cormorant Garamond', serif",
      "--font-body": "'Jost', sans-serif",
      "--radius": "4px",
      "--hero-tint": "oklch(0.32 0.08 165 / 0.4)",
    },
  },
  terracotta: {
    label: "Tuscan Terracotta",
    blurb: "Warm clay, sand, and burnt orange. Sun-soaked and earthy.",
    vars: {
      "--bg": "oklch(0.975 0.016 60)",
      "--surface": "oklch(0.992 0.008 60)",
      "--surface-2": "oklch(0.95 0.022 55)",
      "--ink": "oklch(0.3 0.04 45)",
      "--ink-soft": "oklch(0.45 0.04 45)",
      "--muted": "oklch(0.58 0.03 45)",
      "--line": "oklch(0.88 0.018 55)",
      "--accent": "oklch(0.56 0.1 45)",
      "--accent-soft": "oklch(0.93 0.035 45)",
      "--accent-ink": "oklch(0.99 0.01 60)",
      "--gold": "oklch(0.68 0.09 70)",
      "--font-display": "'Cormorant Garamond', serif",
      "--font-body": "'Jost', sans-serif",
      "--radius": "7px",
      "--hero-tint": "oklch(0.45 0.09 45 / 0.36)",
    },
  },
  champagne: {
    label: "Champagne Gold",
    blurb: "Warm ivory with luminous gold. Understated luxury.",
    vars: {
      "--bg": "oklch(0.98 0.012 85)",
      "--surface": "oklch(0.996 0.006 85)",
      "--surface-2": "oklch(0.955 0.016 85)",
      "--ink": "oklch(0.28 0.02 80)",
      "--ink-soft": "oklch(0.43 0.02 80)",
      "--muted": "oklch(0.58 0.015 80)",
      "--line": "oklch(0.88 0.012 85)",
      "--accent": "oklch(0.6 0.075 75)",
      "--accent-soft": "oklch(0.94 0.03 80)",
      "--accent-ink": "oklch(0.22 0.02 80)",
      "--gold": "oklch(0.66 0.09 78)",
      "--font-display": "'Cormorant Garamond', serif",
      "--font-body": "'Jost', sans-serif",
      "--radius": "2px",
      "--hero-tint": "oklch(0.4 0.05 75 / 0.34)",
    },
  },
  envelope: {
    label: "Olive Envelope",
    blurb: "Olive paper, warm ivory, burgundy and cream. The invitation, brought to life.",
    vars: {
      "--bg": "oklch(0.963 0.014 96)",
      "--surface": "oklch(0.99 0.008 96)",
      "--surface-2": "oklch(0.94 0.02 100)",
      "--ink": "oklch(0.3 0.035 125)",
      "--ink-soft": "oklch(0.44 0.035 128)",
      "--muted": "oklch(0.57 0.025 122)",
      "--line": "oklch(0.87 0.022 105)",
      "--accent": "oklch(0.48 0.075 124)",
      "--accent-soft": "oklch(0.93 0.035 120)",
      "--accent-ink": "oklch(0.98 0.012 96)",
      "--gold": "oklch(0.5 0.13 25)",
      "--font-display": "'Cormorant Garamond', serif",
      "--font-body": "'EB Garamond', serif",
      "--radius": "2px",
      "--hero-tint": "oklch(0.3 0.06 126 / 0.46)",
    },
  },
};

export const FONT_OPTIONS = {
  display: {
    "Cormorant Garamond": "'Cormorant Garamond', serif",
    Playfair: "'Playfair Display', serif",
    Fraunces: "'Fraunces', serif",
    "EB Garamond": "'EB Garamond', serif",
    "DM Serif Display": "'DM Serif Display', serif",
    Italiana: "'Italiana', serif",
    Jost: "'Jost', sans-serif",
    Archivo: "'Archivo', sans-serif",
  },
  body: {
    Jost: "'Jost', sans-serif",
    Mulish: "'Mulish', sans-serif",
    "EB Garamond": "'EB Garamond', serif",
    "Nunito Sans": "'Nunito Sans', sans-serif",
    Archivo: "'Archivo', sans-serif",
  },
};

// Each theme also gets its own typography (keys map into FONT_OPTIONS)
export const THEME_FONTS = {
  classic:    { display: "Cormorant Garamond", body: "Jost" },
  classic2:   { display: "Playfair",            body: "Jost" },
  classic3:   { display: "Cormorant Garamond", body: "Jost" },
  noir:       { display: "DM Serif Display",   body: "Archivo" },
  garden:     { display: "Fraunces",            body: "Mulish" },
  blush:      { display: "Italiana",            body: "Mulish" },
  dusk:       { display: "Jost",                body: "Nunito Sans" },
  burgundy:   { display: "Playfair",            body: "EB Garamond" },
  lavender:   { display: "Fraunces",            body: "Jost" },
  emerald:    { display: "DM Serif Display",   body: "Nunito Sans" },
  terracotta: { display: "Fraunces",            body: "Archivo" },
  champagne:  { display: "Italiana",            body: "Jost" },
  envelope:   { display: "Cormorant Garamond", body: "EB Garamond" },
  glass:      { display: "Jost",                body: "Nunito Sans" },
};
// Per-theme button shape
export const THEME_BTN = {
  classic: "4px", classic2: "0px", classic3: "2px", noir: "0px", garden: "999px", blush: "999px", dusk: "6px",
  burgundy: "0px", lavender: "999px", emerald: "2px", terracotta: "12px", champagne: "0px", envelope: "2px", glass: "999px",
};

// Apply a theme + optional tweak overrides ({accent, gold, displayFont, bodyFont})
export function applyTheme(themeKey, overrides = {}) {
  const theme = THEMES[themeKey] || THEMES.classic;
  const root = document.documentElement;
  root.setAttribute("data-theme", themeKey);
  Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
  root.style.setProperty("--btn-radius", THEME_BTN[themeKey] || "4px");
  if (overrides.accent) {
    root.style.setProperty("--accent", overrides.accent);
    root.style.setProperty("--accent-soft", `color-mix(in oklch, ${overrides.accent} 16%, var(--surface))`);
  }
  if (overrides.gold) root.style.setProperty("--gold", overrides.gold);
  if (overrides.displayFont && FONT_OPTIONS.display[overrides.displayFont]) {
    root.style.setProperty("--font-display", FONT_OPTIONS.display[overrides.displayFont]);
  }
  if (overrides.bodyFont && FONT_OPTIONS.body[overrides.bodyFont]) {
    root.style.setProperty("--font-body", FONT_OPTIONS.body[overrides.bodyFont]);
  }
}

// Premium themes get extra capabilities (e.g. the layout Arrange tool).
export const PREMIUM_THEMES = ["envelope"];
export function isPremiumTheme(key) { return PREMIUM_THEMES.indexOf(key) !== -1; }

// Envelope background tint presets — each is a vertical 2-stop gradient (with alpha).
export const EG_TINTS = {
  olive:    { label: "Olive",    top: "oklch(0.30 0.06 126 / 0.62)", bottom: "oklch(0.22 0.05 126 / 0.78)", dot: "#41502a" },
  charcoal: { label: "Charcoal", top: "oklch(0.28 0.01 250 / 0.60)", bottom: "oklch(0.18 0.01 250 / 0.80)", dot: "#2c2f33" },
  wine:     { label: "Wine",     top: "oklch(0.28 0.09 22 / 0.60)",  bottom: "oklch(0.20 0.08 22 / 0.80)",  dot: "#5a2230" },
  navy:     { label: "Navy",     top: "oklch(0.30 0.07 264 / 0.60)", bottom: "oklch(0.20 0.06 264 / 0.80)", dot: "#283a5e" },
  sepia:    { label: "Sepia",    top: "oklch(0.34 0.05 70 / 0.58)",  bottom: "oklch(0.24 0.05 64 / 0.78)",  dot: "#5c4527" },
  plum:     { label: "Plum",     top: "oklch(0.30 0.08 330 / 0.60)", bottom: "oklch(0.21 0.07 330 / 0.80)", dot: "#4d2845" },
};
export function egTintGradient(key) {
  const t = EG_TINTS[key] || EG_TINTS.olive;
  return `linear-gradient(180deg, ${t.top}, ${t.bottom})`;
}

Object.assign(window, { THEMES, FONT_OPTIONS, THEME_FONTS, THEME_BTN, applyTheme, PREMIUM_THEMES, isPremiumTheme, EG_TINTS, egTintGradient });
