import React from "react";

import { go } from "@/lib/nav.js";
import { Store, useStore } from "@/lib/store.jsx";
import { loadClientData, saveClientData } from "@/lib/api.js";
import { resolveSubdomain } from "@/lib/tenant.js";
import { FONT_OPTIONS, THEMES, THEME_FONTS, applyTheme } from "@/themes";
import { Button, ConfirmHost, FloatingDecor, Icon, Monogram, ToastHost, confirmDialog, toast } from "@/ui/components.jsx";
import { TweakButton, TweakColor, TweakSection, TweakSelect, TweakText, TweakToggle, TweaksPanel } from "@/ui/tweaks-panel.jsx";
import { DetailsPage, Home, SchedulePage, StoryPage, VenuePage } from "@/pages/PublicPages.jsx";
import { RSVPPage } from "@/features/rsvp.jsx";
import { GalleryPage, UploadPage, VideoMessagePage } from "@/features/media.jsx";
import { GuestbookPage, QuizPage } from "@/features/social.jsx";
import { AdminApp, ImageUploadField } from "@/admin/manage.jsx";
import { hasSection } from "@/config/eventTypes.js";
import { moduleEnabled } from "@/lib/roles.js";
const { useState, useEffect, useRef, useMemo, useCallback, useReducer } = React;

// ============================================================================
// app/App.jsx — router, public nav + footer, tweaks panel, root App, mount
// ============================================================================

export const ROUTES = {
  home: Home, story: StoryPage, details: DetailsPage, schedule: SchedulePage,
  venue: VenuePage, rsvp: RSVPPage, upload: UploadPage, gallery: GalleryPage,
  guestbook: GuestbookPage, quiz: QuizPage, "video-message": VideoMessagePage,
  admin: AdminApp,
};

export const NAV_LINKS = [
  { key: "home", label: "Home" },
  { key: "story", label: "Our Story" },
  { key: "details", label: "Details" },
  { key: "schedule", label: "Schedule" },
  { key: "venue", label: "Venue" },
  { key: "gallery", label: "Gallery" },
  { key: "guestbook", label: "Guestbook" },
  { key: "quiz", label: "Quiz" },
];

// Nav links visible for the active event type (home always shows). Driven by
// the event-type registry so adding a type (birthday, corporate) re-shapes nav.
// Also filters by per-client module flags (absent key = on by default).
function visibleNav(eventType, modules) {
  return NAV_LINKS.filter((l) => l.key === "home" || (hasSection(eventType, l.key) && moduleEnabled(modules, l.key)));
}


export function useRoute() {
  const parse = () => {
    const key = window.location.pathname.replace(/^\/+/, "").split(/[/?]/)[0] || "home";
    return ROUTES[key] ? key : "home";
  };
  const [route, setRoute] = useState(parse());
  useEffect(() => {
    const onNav = () => { setRoute(parse()); window.scrollTo({ top: 0 }); };
    window.addEventListener("popstate", onNav); // back/forward
    window.addEventListener("nav", onNav);      // go() pushState
    return () => { window.removeEventListener("popstate", onNav); window.removeEventListener("nav", onNav); };
  }, []);
  return route;
}

// --- Public nav -------------------------------------------------------------
export function Nav({ route }) {
  const { settings } = useStore();
  const [drawer, setDrawer] = useState(false);
  // Demo site (demo.<platform> / apex) is a theme showcase: swap the RSVP CTA for
  // a live theme picker so prospective clients can preview every design.
  const isDemo = resolveSubdomain() === "demo";
  // Anyone can preview a theme via the dropdown (local only — reverts on refresh).
  // A logged-in admin (superadmin/owner) picking one SAVES it as the site's theme.
  const pickTheme = async (k) => {
    Store.updateSettings({ theme: k, themeAccent: "", displayFont: THEME_FONTS[k].display, bodyFont: THEME_FONTS[k].body });
    const role = Store.get().auth?.role;
    if (role === "superadmin" || role === "owner") {
      try { await saveClientData(); toast("Theme saved"); } catch (e) { toast("Couldn't save theme"); }
    }
  };
  const ThemePicker = ({ block }) => (
    <label className={"nav__themepick" + (block ? " nav__themepick--block" : "")}>
      <span className="nav__themepick-label">{block ? "Preview a theme" : "Theme"}</span>
      <select value={settings.theme} aria-label="Preview a theme" onChange={(e) => pickTheme(e.target.value)}>
        {Object.keys(THEMES).map((k) => <option key={k} value={k}>{THEMES[k].label}</option>)}
      </select>
    </label>
  );
  return (
    <>
    <nav className="nav">
      <div className="container nav__inner">
        <a className="nav__brand" onClick={() => go("home")}>
          <Monogram a={settings.partnerA} b={settings.partnerB} size={40} />
          <span className="nav__names">{settings.partnerA} <span className="amp">&amp;</span> {settings.partnerB}</span>
        </a>
        <div className="nav__links">
          {visibleNav(settings.eventType, settings.modules).map((l) => (
            <button key={l.key} className={"nav__link" + (route === l.key ? " nav__link--active" : "")} onClick={() => go(l.key)}>{l.label}</button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isDemo
            ? <ThemePicker />
            : <Button className="nav__cta" variant="primary" size="sm" onClick={() => go("rsvp")}>RSVP</Button>}
          <button className="nav__burger" onClick={() => setDrawer(true)} aria-label="Menu">{Icon.menu({})}</button>
        </div>
      </div>
      </nav>

      {drawer && (
        <div className="drawer">
          <div className="drawer__bg" onClick={() => setDrawer(false)} />
          <div className="drawer__panel">
            <div className="drawer__head">
              <Monogram a={settings.partnerA} b={settings.partnerB} size={40} />
              <button className="nav__burger" onClick={() => setDrawer(false)} aria-label="Close">{Icon.close({})}</button>
            </div>
            {visibleNav(settings.eventType, settings.modules).map((l) => (
              <button key={l.key} className={"drawer__link" + (route === l.key ? " drawer__link--active" : "")} onClick={() => { go(l.key); setDrawer(false); }}>{l.label}</button>
            ))}
            {moduleEnabled(settings.modules, "gallery") && <button className="drawer__link" onClick={() => { go("upload"); setDrawer(false); }}>Share Photos</button>}
            {settings.uploadsEnabled && <button className="drawer__link" onClick={() => { go("video-message"); setDrawer(false); }}>Video Message</button>}
            <div style={{ marginTop: 20 }}>
              {isDemo
                ? <ThemePicker block />
                : <Button variant="primary" block onClick={() => { go("rsvp"); setDrawer(false); }}>RSVP Now</Button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function Footer() {
  const { settings } = useStore();
  return (
    <footer className="footer">
      <div className="container">
        <div className="divider-mark">{Icon.rings({})}</div>
        <div className="footer__names">{settings.partnerA} <span className="amp">&amp;</span> {settings.partnerB}</div>
        <div className="footer__hash">{settings.hashtag}</div>
        <div className="footer__links">
          {visibleNav(settings.eventType, settings.modules).map((l) => <button key={l.key} onClick={() => go(l.key)}>{l.label}</button>)}
          {moduleEnabled(settings.modules, "gallery") && <button onClick={() => go("upload")}>Upload</button>}
        </div>
        <p className="footer__fine">{settings.weddingDateLabel} &middot; {settings.venueName}</p>
        <button className="footer__admin" onClick={() => go("admin")}>Admin sign in</button>
      </div>
    </footer>
  );
}

// --- Tweaks (binds to Store) ------------------------------------------------
export const ACCENT_OPTIONS = ["#5b7560", "#5d7b97", "#b5654a", "#b06a72", "#b08d57", "#7a5a78"];

export function TweaksContent() {
  const { settings } = useStore();
  const s = settings;
  const upd = (patch) => Store.updateSettings(patch);
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Theme" />
      <TweakSelect label="Theme" value={s.theme}
        options={Object.keys(THEMES).map((k) => ({ value: k, label: THEMES[k].label }))}
        onChange={(v) => upd({ theme: v, themeAccent: "", displayFont: THEME_FONTS[v].display, bodyFont: THEME_FONTS[v].body })} />
      <TweakColor label="Accent" value={s.themeAccent || THEME_DEFAULT_ACCENT(s.theme)}
        options={ACCENT_OPTIONS} onChange={(v) => upd({ themeAccent: v })} />

      {s.theme === "envelope" && (
        <>
          <TweakSection label="Envelope Frame" />
          <div className="twk-row" style={{ display: "block" }}>
            <ImageUploadField label="Photo inside the oval frame" ratio="1 / 1"
              value={s.frameImage} onChange={(v) => upd({ frameImage: v })} />
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              A square photo of the couple works best. Leave empty to use the default animated frame.
            </p>
          </div>
        </>
      )}

      <TweakSection label="Typography" />
      <TweakSelect label="Headlines" value={s.displayFont}
        options={Object.keys(FONT_OPTIONS.display)} onChange={(v) => upd({ displayFont: v })} />
      <TweakSelect label="Body text" value={s.bodyFont}
        options={Object.keys(FONT_OPTIONS.body)} onChange={(v) => upd({ bodyFont: v })} />

      <TweakSection label="The Couple" />
      <TweakText label="Partner A" value={s.partnerA} onChange={(v) => upd({ partnerA: v })} />
      <TweakText label="Partner B" value={s.partnerB} onChange={(v) => upd({ partnerB: v })} />
      <TweakText label="Date label" value={s.weddingDateLabel} onChange={(v) => upd({ weddingDateLabel: v })} />

      <TweakSection label="Copy" />
      <TweakText label="Hero tagline" value={s.tagline} onChange={(v) => upd({ tagline: v })} />
      <TweakText label="Hashtag" value={s.hashtag} onChange={(v) => upd({ hashtag: v })} />
      <TweakText label="Welcome line" value={s.welcome} onChange={(v) => upd({ welcome: v })} />

      <TweakSection label="Home" />
      <TweakToggle label="Floating decorations" value={s.decorOn} onChange={(v) => upd({ decorOn: v })} />
      <TweakSelect label="Decoration" value={s.decorStyle}
        options={[{ value: "petals", label: "Petals" }, { value: "butterflies", label: "Butterflies (GIF)" }, { value: "hearts", label: "Hearts" }, { value: "fireflies", label: "Fireflies" }, { value: "leaves", label: "Leaves" }, { value: "confetti", label: "Confetti" }]}
        onChange={(v) => upd({ decorStyle: v })} />
      {s.decorStyle === "butterflies" && (
        <TweakSelect label="Butterfly look" value={s.butterflyStyle}
          options={[{ value: "fullcolor", label: "Full colour" }, { value: "assorted", label: "Assorted" }, { value: "faded", label: "Faded" }]}
          onChange={(v) => upd({ butterflyStyle: v })} />
      )}

      <TweakSection label="Data" />
      <div className="twk-row">
        <TweakButton secondary label="Reset demo data" onClick={() => confirmDialog({ title: "Reset demo data?", message: "Everything returns to defaults.", confirmLabel: "Reset", danger: true }).then((ok) => { if (ok) { Store.resetAll(); toast("Reset"); } })} />
      </div>
    </TweaksPanel>
  );
}

export function THEME_DEFAULT_ACCENT(themeKey) {
  // approximate hex of each theme's accent so the swatch shows a selection
  return ({ classic: "#5b7560", noir: "#b08d57", garden: "#3f7a52", blush: "#b06a72", dusk: "#5f7d9c", burgundy: "#7d2f3c", lavender: "#8f7fb0", emerald: "#2f7a5a", terracotta: "#c06a44", champagne: "#b08d57", envelope: "#5c6b3c" })[themeKey] || "#5b7560";
}

// --- Root -------------------------------------------------------------------
export function App() {
  const route = useRoute();
  const { settings } = useStore();

  React.useEffect(() => { loadClientData().catch((e) => console.error("load failed", e)); }, []);

  // apply theme whenever theme/accent/fonts change
  useEffect(() => {
    applyTheme(settings.theme, {
      accent: settings.themeAccent || undefined,
      displayFont: settings.displayFont,
      bodyFont: settings.bodyFont,
    });
  }, [settings.theme, settings.themeAccent, settings.displayFont, settings.bodyFont]);

  // theme-dependent scroll reveal animations
  useEffect(() => {
    if (route === "admin") return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const sel = "main .sec-head, main .story-row, main .info-card, main .card, main .gb-card, main .sched-cards__item, main .sched-cols__row, main .sched-min__row, main .countdown, main .hero__names, main .hero__welcome, main .hero__date, main .faq-item, main .divider-mark";
    const t = setTimeout(() => {
      const els = Array.from(document.querySelectorAll(sel));
      const counts = new Map();
      els.forEach((el) => {
        el.classList.add("reveal");
        const p = el.parentElement;
        const n = counts.get(p) || 0;
        el.style.setProperty("--rd", Math.min(n, 6) * 0.07 + "s");
        counts.set(p, n + 1);
      });
      let pending = els.slice();
      const check = () => {
        const h = window.innerHeight;
        pending = pending.filter((el) => {
          if (el.getBoundingClientRect().top < h * 0.92) { el.classList.add("is-in"); return false; }
          return true;
        });
      };
      let raf;
      const tick = () => { check(); if (pending.length) raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
      // safety: never leave text hidden, even if the page never scrolls
      const safety = setTimeout(() => { pending.forEach((el) => el.classList.add("is-in")); pending = []; }, 3500);
      App._cleanup = () => { cancelAnimationFrame(raf); clearTimeout(safety); };
    }, 40);
    return () => { clearTimeout(t); if (App._cleanup) App._cleanup(); };
  }, [route]);

  // Gate the render AFTER all hooks above (rules of hooks: hook count must be
  // stable across renders — an early return between hooks crashes on hydrate).
  if (Store.get().loading) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--ink-soft)" }}>Loading…</div>;
  }

  const Page = ROUTES[route] || Home;
  // Platform hub (bare apex, no client): only the admin login/console — no public site.
  const isHub = resolveSubdomain() === null;
  const isAdmin = route === "admin" || isHub;
  const routeBlocked = route !== "home" && route !== "admin" && !moduleEnabled(settings.modules, route);
  const ActivePage = routeBlocked ? Home : Page;

  return (
    <>
      {isAdmin ? (
        <AdminApp />
      ) : (
        <>
          <Nav route={route} />
          <main key={route}><ActivePage /></main>
          <Footer />
          <FloatingDecor on={settings.decorOn && route === "home"} style={settings.decorStyle} butterflyStyle={settings.butterflyStyle} butterflyColor={settings.butterflyColor} butterflyFlight={settings.butterflyFlight} butterflyCount={settings.butterflyCount} />
        </>
      )}
      <ToastHost />
      <ConfirmHost />
      <TweaksContent />
    </>
  );
}

// apply initial theme before first paint
applyTheme(Store.get().settings.theme, {
  accent: Store.get().settings.themeAccent || undefined,
  displayFont: Store.get().settings.displayFont,
  bodyFont: Store.get().settings.bodyFont,
});

