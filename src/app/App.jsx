import React from "react";

import { go } from "@/lib/nav.js";
import { onSiteScroll, scrollOffset, scrollToTop } from "@/lib/scroll.js";
import { Store, useStore } from "@/lib/store.jsx";
import { loadClientData } from "@/lib/api.js";
import { resolveSubdomain } from "@/lib/tenant.js";
import { FONT_OPTIONS, THEMES, THEME_FONTS, applyTheme, isPremiumTheme } from "@/themes";
import { Button, ConfirmHost, FallingFx, FloatingDecor, Icon, Monogram, ToastHost, confirmDialog, toast } from "@/ui/components.jsx";
import { FX_LIST } from "@/lib/falling-fx.js";
import { TweakButton, TweakColor, TweakSection, TweakSelect, TweakText, TweakToggle, TweaksPanel } from "@/ui/tweaks-panel.jsx";
import { DetailsPage, Home, SchedulePage, StoryPage, VenuePage } from "@/pages/PublicPages.jsx";
import { RSVPPage } from "@/features/rsvp.jsx";
import { GalleryPage, UploadPage, VideoMessagePage } from "@/features/media.jsx";
import { GuestbookPage, QuizPage } from "@/features/social.jsx";
import { MusicMount } from "@/features/music.jsx";
import { AdminApp, ImageUploadField } from "@/admin/manage.jsx";
import { ApplyWizard } from "@/admin/apply.jsx";
import { RoadToForeverSite } from "@/features/roadtoforever.jsx";
import { hasSection } from "@/config/eventTypes.js";
import { moduleEnabled, moduleLabel, sectionLabel } from "@/lib/roles.js";
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

// A switched-off section reached by direct link: a friendly note instead of
// silently rendering Home (BUG-0005). Nav/footer already hide disabled links —
// this covers bookmarks, shared URLs, and stale QR codes.
function SectionUnavailable({ section }) {
  return (
    <div className="fade-up">
      <section className="block">
        <div className="container container--narrow">
          <div className="card card--pad-lg confirm">
            <h2 className="confirm__title">{moduleLabel(section) || "This section"} isn't available</h2>
            <p className="confirm__text">The couple hasn't turned this section on for their site. Head back to the main page to see everything that's live.</p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <Button variant="primary" onClick={() => go("home")}>Back home</Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// Nav links visible for the active event type (home always shows). Driven by
// the event-type registry so adding a type (birthday, corporate) re-shapes nav.
// Also filters by per-client module flags (absent key = on by default).
function visibleNav(eventType, modules, labels) {
  return NAV_LINKS
    .filter((l) => l.key === "home" || (hasSection(eventType, l.key) && moduleEnabled(modules, l.key)))
    .map((l) => {
      const custom = labels && typeof labels[l.key] === "string" ? labels[l.key].trim() : "";
      return custom ? { ...l, label: custom } : l;
    });
}



export function useRoute() {
  const parse = () => {
    const key = window.location.pathname.replace(/^\/+/, "").split(/[/?]/)[0] || "home";
    return ROUTES[key] ? key : "home";
  };
  const [route, setRoute] = useState(parse());
  useEffect(() => {
    const onNav = () => { setRoute(parse()); scrollToTop({ top: 0 }); };
    window.addEventListener("popstate", onNav); // back/forward
    window.addEventListener("nav", onNav);      // go() pushState
    return () => { window.removeEventListener("popstate", onNav); window.removeEventListener("nav", onNav); };
  }, []);
  return route;
}

// Built-in floating-decoration styles offered in the demo nav picker.
const DECOR_OPTS = [
  ["petals", "Falling petals"], ["hearts", "Hearts"], ["fireflies", "Fireflies"],
  ["leaves", "Drifting leaves"], ["confetti", "Confetti"], ["snow", "Falling snow"],
  ["bubbles", "Rising bubbles"], ["sparkles", "Sparkles"], ["orbs", "Bokeh orbs"],
  ["balloons", "Floating balloons"],
  // ...plus the refined FX effects, so this matches the Settings decoration list.
  ...FX_LIST.map((e) => ["fx-" + e.id, e.title]),
];

// --- Public nav -------------------------------------------------------------
export function Nav({ route }) {
  const { settings, auth, clientId } = useStore();
  const [drawer, setDrawer] = useState(false);
  // Demo try-bar visibility: hidden while scrolling DOWN (reading content),
  // shown when scrolling UP or at rest. The sealed envelope locks scrolling,
  // so no events fire there and the bar stays visible.
  const [barHidden, setBarHidden] = useState(false);
  useEffect(() => {
    let last = scrollOffset();
    const onScroll = () => {
      const y = scrollOffset();
      const dy = y - last;
      if (Math.abs(dy) < 6) return; // ignore jitter
      setBarHidden(dy > 0 && y > 40); // down = hide (never near the very top)
      last = y;
    };
    return onSiteScroll(onScroll);
  }, []);
  // Demo site (demo.<platform> / apex) is a theme showcase: swap the RSVP CTA for
  // a live theme picker so prospective clients can preview every design.
  // In the admin Theme picker the home page is embedded via /?preview — hide the
  // demo's own theme/decor pickers + try-bar there so the preview reads clean.
  const isDemo = resolveSubdomain() === "demo" && !new URLSearchParams(window.location.search).has("preview");
  // The home nav picker is PREVIEW ONLY for everyone — owners/admins included.
  // It applies in-memory via previewSettings and never persists, so it always
  // reverts to the saved theme on refresh. The saved theme/decor is changed
  // SOLELY in Settings → Theme. (The owner is `role: "owner"` for their own
  // site, so a per-role save here would let them override it from home — which
  // is exactly what we don't want.)
  const applyPick = (patch, _label) => {
    Store.previewSettings(patch);
  };
  const pickTheme = (k) => {
    applyPick({ theme: k, themeAccent: "", displayFont: THEME_FONTS[k].display, bodyFont: THEME_FONTS[k].body }, "Theme");
  };
  const ThemePicker = ({ block }) => (
    <label className={"nav__themepick" + (block ? " nav__themepick--block" : "")}>
      <span className="nav__themepick-label">Theme</span>
      <select value={settings.theme} aria-label="Preview a theme" onChange={(e) => pickTheme(e.target.value)}>
        <optgroup label="Themes">
          {Object.keys(THEMES).filter((k) => !isPremiumTheme(k) && k !== "roadtoforever").map((k) => <option key={k} value={k}>{THEMES[k].label}</option>)}
        </optgroup>
        <optgroup label="✦ Premium">
          {Object.keys(THEMES).filter((k) => isPremiumTheme(k) && k !== "roadtoforever").map((k) => <option key={k} value={k}>{THEMES[k].label}</option>)}
        </optgroup>
      </select>
    </label>
  );
  // Same rule as the theme picker: saves for the signed-in owner, previews for
  // anonymous visitors.
  const pickDecor = (v) => {
    applyPick(v === "none" ? { decorOn: false } : { decorOn: true, decorStyle: v }, "Decoration");
  };
  const DecorPicker = ({ block }) => (
    <label className={"nav__themepick" + (block ? " nav__themepick--block" : "")}>
      <span className="nav__themepick-label">Decoration</span>
      <select value={settings.decorOn ? settings.decorStyle : "none"} aria-label="Preview a decoration" onChange={(e) => pickDecor(e.target.value)}>
        <option value="none">None</option>
        {DECOR_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
  return (
    <>
    <nav className="nav">
      <div className="container nav__inner">
        <a className="nav__brand" onClick={() => go("home")}>
          <Monogram a={settings.partnerA} b={settings.partnerB} size={40} />
          <span className="nav__names">{settings.partnerA}{settings.partnerB ? <> <span className="amp">&amp;</span> {settings.partnerB}</> : null}</span>
        </a>
        <div className="nav__links">
          {visibleNav(settings.eventType, settings.modules, settings.moduleLabels).map((l) => (
            <button key={l.key} className={"nav__link" + (route === l.key ? " nav__link--active" : "")} onClick={() => go(l.key)}>{l.label}</button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* RSVP button shows on every site. Demo's only extra is the theme +
              decoration pickers beside it. */}
          <Button className="nav__cta" variant="primary" size="sm" onClick={() => go("rsvp")}>{sectionLabel("rsvp", settings.moduleLabels)}</Button>
          {isDemo && <>
            <Button className="nav__cta" variant="ghost" size="sm" onClick={() => { window.location.href = "https://celebrately.us/apply"; }}>Register</Button>
            <ThemePicker />{!isPremiumTheme(settings.theme) && <DecorPicker />}
          </>}
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
            {visibleNav(settings.eventType, settings.modules, settings.moduleLabels).map((l) => (
              <button key={l.key} className={"drawer__link" + (route === l.key ? " drawer__link--active" : "")} onClick={() => { go(l.key); setDrawer(false); }}>{l.label}</button>
            ))}
            {moduleEnabled(settings.modules, "gallery") && <button className="drawer__link" onClick={() => { go("upload"); setDrawer(false); }}>Share Photos</button>}
            {settings.uploadsEnabled && moduleEnabled(settings.modules, "video-message") && <button className="drawer__link" onClick={() => { go("video-message"); setDrawer(false); }}>Video Message</button>}
            <div style={{ marginTop: 20 }}>
              <Button variant="primary" block onClick={() => { go("rsvp"); setDrawer(false); }}>{sectionLabel("rsvp", settings.moduleLabels)} Now</Button>
            </div>
            {isDemo && (
              <div style={{ marginTop: 10 }}>
                <Button variant="ghost" block onClick={() => { window.location.href = "https://celebrately.us/apply"; }}>Register — get your own site</Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Demo showcase: a fixed bar so visitors can preview a theme + decoration
          immediately on mobile — even on the sealed envelope where the nav is hidden. */}
      {isDemo && (
        <div className={"demo-trybar" + (barHidden ? " demo-trybar--hide" : "")}>
          <ThemePicker block />
          {!isPremiumTheme(settings.theme) && <DecorPicker block />}
          <Button className="demo-trybar__reg" variant="primary" size="sm" onClick={() => { window.location.href = "https://celebrately.us/apply"; }}>Register — get your own site</Button>
        </div>
      )}
    </>
  );
}

// Footer fine-print line: the date obeys the "Show wedding date & countdown"
// master toggle (weddingDateOn) and only shows when there's a value — matching
// every other consumer (PublicPages hero/details). The separator dot only
// renders when both a date and a venue are present.
export function footerFine(settings) {
  const showDate = settings.weddingDateOn !== false && !!settings.weddingDateLabel;
  const date = showDate ? settings.weddingDateLabel : "";
  const venue = settings.venueName || "";
  return { date, venue, sep: !!(date && venue) };
}

export function Footer() {
  const { settings } = useStore();
  const fine = footerFine(settings);
  return (
    <footer className="footer">
      <div className="container">
        <div className="divider-mark">{Icon.rings({})}</div>
        <div className="footer__names">{settings.partnerA}{settings.partnerB ? <> <span className="amp">&amp;</span> {settings.partnerB}</> : null}</div>
        <div className="footer__hash">{settings.hashtag}</div>
        <div className="footer__links">
          {visibleNav(settings.eventType, settings.modules, settings.moduleLabels).map((l) => <button key={l.key} onClick={() => go(l.key)}>{l.label}</button>)}
          {moduleEnabled(settings.modules, "gallery") && <button onClick={() => go("upload")}>Upload</button>}
        </div>
        <p className="footer__fine">{fine.date}{fine.sep && " · "}{fine.venue}</p>
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
            <ImageUploadField purpose="frame" label="Photo inside the oval frame" ratio="1 / 1"
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

      {s.theme !== "envelope" && (<>
      <TweakSection label="Home" />
      <TweakToggle label="Floating decorations" value={s.decorOn} onChange={(v) => upd({ decorOn: v })} />
      <TweakSelect label="Decoration" value={s.decorStyle}
        options={[{ value: "petals", label: "Petals" }, { value: "hearts", label: "Hearts" }, { value: "fireflies", label: "Fireflies" }, { value: "leaves", label: "Leaves" }, { value: "confetti", label: "Confetti" }, { value: "snow", label: "Snow" }, { value: "bubbles", label: "Bubbles" }, { value: "sparkles", label: "Sparkles" }, { value: "orbs", label: "Bokeh orbs" }, { value: "balloons", label: "Balloons" }, ...FX_LIST.map((e) => ({ value: "fx-" + e.id, label: e.title }))]}
        onChange={(v) => upd({ decorStyle: v })} />
      </>)}

      <TweakSection label="Data" />
      <div className="twk-row">
        <TweakButton secondary label="Reset demo data" onClick={() => confirmDialog({ title: "Reset demo data?", message: "Everything returns to defaults.", confirmLabel: "Reset", danger: true }).then((ok) => { if (ok) { Store.resetAll(); toast("Reset"); } })} />
      </div>
    </TweaksPanel>
  );
}

export function THEME_DEFAULT_ACCENT(themeKey) {
  // approximate hex of each theme's accent so the swatch shows a selection
  return ({ classic: "#5b7560", classic2: "#3a3f47", classic3: "#6b7079", glass: "#5f78a6", noir: "#b08d57", garden: "#3f7a52", blush: "#b06a72", dusk: "#5f7d9c", burgundy: "#7d2f3c", lavender: "#8f7fb0", emerald: "#2f7a5a", terracotta: "#c06a44", champagne: "#b08d57", envelope: "#5c6b3c" })[themeKey] || "#5b7560";
}

// Pure render decision for the app root — testable without React/network.
// notfound takes precedence so a deleted/nonexistent subdomain can never fall
// through to seed content. apex (subdomain===null) and the admin route render
// the admin shell; everything else is the public client site.
export function rootView({ loading, notFound, subdomain, route }) {
  if (loading) return "loading";
  if (notFound) return "notfound";
  if (subdomain === null) return "admin"; // platform hub (bare apex)
  if (route === "admin") return "admin";
  return "public";
}

function NotFoundSite() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}>
      <div style={{ maxWidth: 440 }}>
        <div style={{ color: "var(--accent)", marginBottom: 14 }}>{Icon.rings({})}</div>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 32, marginBottom: 10 }}>This site isn’t available</h1>
        <p style={{ color: "var(--ink-soft)" }}>This event site has been removed or the address is incorrect.</p>
      </div>
    </div>
  );
}

// --- Root -------------------------------------------------------------------
export function App() {
  const route = useRoute();
  const { settings, notFound } = useStore();
  const loading = Store.get().loading; // re-run scroll-reveal once content hydrates

  const previewPatchRef = useRef(null);
  React.useEffect(() => {
    loadClientData()
      .catch((e) => console.error("load failed", e))
      .finally(() => {
        // Preview mode: the just-hydrated client theme (e.g. the demo's envelope)
        // would clobber the parent's requested preview — re-apply it after load.
        if (new URLSearchParams(window.location.search).has("preview") && previewPatchRef.current) {
          Store.previewSettings(previewPatchRef.current);
        }
      });
  }, []);

  // apply theme whenever theme/accent/fonts/envelope-color change
  useEffect(() => {
    applyTheme(settings.theme, {
      accent: settings.themeAccent || undefined,
      displayFont: settings.displayFont,
      bodyFont: settings.bodyFont,
      envColor: settings.envColor,
      envColorCustom: settings.envColorCustom,
      envMatchSite: settings.envMatchSite,
    });
  }, [settings.theme, settings.themeAccent, settings.displayFont, settings.bodyFont, settings.envColor, settings.envColorCustom, settings.envMatchSite]);

  // Live preview bridge: when embedded in the admin Theme picker (/?preview),
  // accept postMessage theme/decor updates and apply them IN-MEMORY only
  // (previewSettings never persists), so switching themes re-renders the real
  // page instantly with no reload and nothing saved.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("preview")) return;
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.type !== "evermore:preview") return;
      const patch = {};
      if (d.theme && THEME_FONTS[d.theme]) {
        Object.assign(patch, { theme: d.theme, themeAccent: "", displayFont: THEME_FONTS[d.theme].display, bodyFont: THEME_FONTS[d.theme].body });
      }
      if (d.decorStyle !== undefined) patch.decorStyle = d.decorStyle;
      if (d.decorOn !== undefined) patch.decorOn = d.decorOn;
      if (d.envColor !== undefined) patch.envColor = d.envColor;
      if (d.envColorCustom !== undefined) patch.envColorCustom = d.envColorCustom;
      if (d.envMatchSite !== undefined) patch.envMatchSite = d.envMatchSite;
      if (Object.keys(patch).length) { previewPatchRef.current = { ...(previewPatchRef.current || {}), ...patch }; Store.previewSettings(patch); }
    };
    window.addEventListener("message", onMsg);
    // Tell the parent we're mounted so it can push the initial theme (avoids a race).
    try { window.parent && window.parent.postMessage({ type: "evermore:preview-ready" }, window.location.origin); } catch (e) {}
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // theme-dependent scroll reveal animations — also re-runs when `loading` flips
  // false so the elements exist (home content hydrates async after first mount).
  useEffect(() => {
    if (route === "admin" || loading) return;
    // NOTE: intentionally NOT gated on prefers-reduced-motion — the reveal is a
    // gentle fade/rise the owner wants visible even with Reduce Motion on.
    // NOTE: the hero ("We're getting married") is intentionally excluded — the first
    // screen shows immediately, no fade-in.
    const sel = "main .sec-head, main .story-row, main .info-card, main .card, main .gb-card, main .sched-cards__item, main .sched-cols__row, main .sched-min__row, main .faq-item, main .divider-mark, main #home-rsvp h2, main #home-rsvp p, main #home-rsvp .btn, main #home-countdown h2, main #home-countdown > .container p";
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
      // Toggle on every entry/exit so the reveal REPLAYS each time you scroll
      // back to a section (not a one-shot).
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => e.target.classList.toggle("is-in", e.isIntersecting));
      }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
      els.forEach((el) => io.observe(el));
      App._cleanup = () => io.disconnect();
    }, 40);
    return () => { clearTimeout(t); if (App._cleanup) App._cleanup(); };
  }, [route, loading]);

  // Gate the render AFTER all hooks above (rules of hooks: hook count must be
  // stable across renders — an early return between hooks crashes on hydrate).
  const view = rootView({ loading: Store.get().loading, notFound, subdomain: resolveSubdomain(), route });
  if (view === "loading") {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--ink-soft)" }}>Loading…</div>;
  }
  if (view === "notfound") {
    return <NotFoundSite />;
  }

  const Page = ROUTES[route] || Home;
  // apex hub or the admin route → admin shell (no public site).
  const isAdmin = view === "admin";
  // /register (old self-serve signup) is retired — every new site goes through
  // the /apply approval flow. Old shared links land there too.
  if (isAdmin && resolveSubdomain() === null && /^\/register\/?$/.test(window.location.pathname)) {
    window.location.replace("/apply");
    return null;
  }
  // Prospect intake wizard (link sent to possible clients) — apex /apply.
  if (isAdmin && resolveSubdomain() === null && /^\/apply\/?$/.test(window.location.pathname)) {
    return (<><ApplyWizard /><ToastHost /><ConfirmHost /></>);
  }
  // BUG-0005: a switched-off section used to silently render Home. Show a short
  // "not available" note instead so the guest knows the link isn't broken.
  // Also gate event-type-excluded sections (e.g. a corporate site reached via a
  // direct /story link): a nav-section route that the active event type doesn't
  // list is blocked too, matching visibleNav. Auxiliary routes (upload,
  // video-message) aren't event-type sections, so they only check the module flag.
  // Bespoke single-page theme: render the whole custom template, no site nav.
  if (!isAdmin && settings.theme === "roadtoforever") {
    return (<><RoadToForeverSite /><ToastHost /><ConfirmHost /></>);
  }

  const isNavSection = NAV_LINKS.some((l) => l.key === route && l.key !== "home");
  const routeBlocked = route !== "home" && route !== "admin" &&
    (!moduleEnabled(settings.modules, route) || (isNavSection && !hasSection(settings.eventType, route)));
  const ActivePage = routeBlocked ? SectionUnavailable : Page;

  return (
    <>
      {isAdmin ? (
        <AdminApp />
      ) : (
        // Flex-scroll shell (mobile): nav is an in-flow child and only
        // .site-scroll scrolls, so the document can't scroll and the header
        // can't detach/vanish on iOS Safari — same fix as the admin shell.
        // Desktop is unaffected (CSS scopes it to <=860px; nav stays fixed).
        <div className="site-shell">
          <Nav route={route} />
          <div className="site-scroll" id="site-scroll">
            <main key={route}><ActivePage section={route} /></main>
            <Footer />
          </div>
          {settings.decorOn && route === "home" && settings.theme !== "envelope" && (
            String(settings.decorStyle).startsWith("fx-")
              ? <FallingFx id={settings.decorStyle.slice(3)} />
              : <FloatingDecor on style={settings.decorStyle} />
          )}
          <MusicMount />
        </div>
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
  envColor: Store.get().settings.envColor,
  envColorCustom: Store.get().settings.envColorCustom,
  envMatchSite: Store.get().settings.envMatchSite,
});

