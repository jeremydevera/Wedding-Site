import React from "react";
import { go } from "@/lib/nav.js";
import { onSiteScroll, scrollOffset, siteScrollEl } from "@/lib/scroll.js";
import { mediaUrl } from "@/lib/media.js";
import { useStore } from "@/lib/store.jsx";
import { mapStyleFilter } from "@/lib/mapStyles.js";
import { moduleEnabled } from "@/lib/roles.js";
import { egTintGradientFor, envColorFilterFor } from "@/themes";
import { Button, Countdown, FloatingDecor, Icon, Placeholder, SectionHead, mapCoordStr, mapDirUrl, mapEmbedUrl, mapResolveQuery } from "@/ui/components.jsx";
import { VinylPlayer } from "@/features/music.jsx";
const { useState, useEffect, useRef, useMemo, useCallback, useReducer } = React;

// ============================================================================
// pages/PublicPages.jsx — Home + content pages (Details, Story, Schedule, Venue, FAQ)
// ============================================================================

export function HeroBg() {
  const { settings } = useStore();
  if (settings.heroImage) {
    return (
      <div className="hero__media">
        <img src={mediaUrl(settings.heroImage)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <div className="hero__tint" />
      </div>
    );
  }
  return (
    <div className="hero__media hero__media--themed">
      <div className="hero__tint hero__tint--themed" />
    </div>
  );
}

export function StoryImg({ row }) {
  return row && row.img
    ? <img src={mediaUrl(row.img)} alt={row.title} style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: "var(--radius)", display: "block" }} />
    : <Placeholder label="story photo" ratio="4 / 3" />;
}

// Olive-green tint strength → CSS vars for the envelope background overlay.
export function egTintVars(s) {
  const on = s.envTintOn !== false;
  const open = on ? Math.max(0, Math.min(100, s.envTint == null ? 55 : s.envTint)) / 100 : 0;
  const sealed = on ? Math.min(1, open + 0.35) : 0;
  // Title size is a 1–10 scale that maps to a cqw fraction of the envelope width,
  // so the cover title scales with the envelope (bigger on larger screens).
  // Legacy rows stored other units (vw ~1–8, px ~16–34); anything outside 1–10
  // falls back to the default 5.
  const t = s.envTitleSize;
  const scale = (t != null && t >= 1 && t <= 10) ? t : 5;
  const titleCqw = (0.9 + (scale - 1) / 9 * 2.7).toFixed(3); // scale 1→0.9cqw (small), 5→2.1, 10→3.6
  const vars = { "--eg-tint": open, "--eg-tint-sealed": sealed, "--eg-tint-grad": egTintGradientFor(s.envTintColor || "olive", s.envTintCustom), "--eg-title-cqw": titleCqw };
  // Envelope paper recolor — only set when non-olive so the CSS fallback
  // (a no-op hue-rotate) keeps the drop-shadow filter list valid.
  const recolor = envColorFilterFor(s.envColor, s.envColorCustom);
  if (recolor) vars["--eg-env-recolor"] = recolor;
  return vars;
}

// Recolor stack for the envelope art: a duplicate image carrying the color
// filter (masked with a hole over the seal as a fallback), then the wax seal
// as its OWN unfiltered image on top — so the seal is pixel-identical to the
// original artwork no matter the paper color. The sealed-cover seal renders
// even WITHOUT a recolor: it carries the "pump" click-affordance animation.
function envRecolorOverlay(s, kind) {
  const recolor = envColorFilterFor(s.envColor, s.envColorCustom);
  if (kind === "sealed") return (<>
    {recolor ? <img className="inv-art-recolor inv-art-recolor--sealed" src="/assets/invite/env-closed.webp" alt="" aria-hidden="true" /> : null}
    <img className="inv-seal-img inv-seal-img--sealed" src="/assets/invite/seal-closed-v2.png" alt="" aria-hidden="true" />
  </>);
  if (!recolor) return null;
  return (<>
    <img className="inv-l-front inv-art-recolor inv-art-recolor--front" src="/assets/invite/p2-envelope-front.png" alt="" aria-hidden="true" />
    <img className="inv-seal-img inv-seal-img--front" src="/assets/invite/seal-front-v2.png" alt="" aria-hidden="true" />
  </>);
}

export function EnvelopeHero() {
  const { settings } = useStore();
  const s = settings;
  const [open, setOpen] = React.useState(false);

  // first screen = envelope only: lock scroll AND hide the nav until it's opened
  const [ready, setReady] = React.useState(false);
  const artRef = React.useRef(null);
  const triggerReady = React.useCallback(() => setReady(true), []);
  React.useEffect(() => {
    // Flip ready a couple frames after mount so the hidden text paints first, then
    // the type-on plays — independent of the image cache, so it runs on desktop
    // too (a cached image used to flip ready before first paint, skipping it).
    let r1, r2;
    r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setReady(true)); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, []);
  // Type-on reveal via Web Animations API. Crucially, ON FINISH we clear the
  // clip-path entirely so the resting state is unclipped — otherwise a browser
  // that clamps the negative end-inset to 0 shaves the last glyph ("m" in "From").
  React.useEffect(() => {
    if (!ready) return;
    const root = artRef.current && artRef.current.closest(".inv-sealed-wrap");
    if (!root) return;
    // The cover type-on is exempt from prefers-reduced-motion by design (owner's
    // choice) — it's a gentle text wipe; other motion still respects the setting.
    const type = (sel, count, dur, delay) => {
      const el = root.querySelector(sel);
      if (!el) return;
      if (!el.animate) { el.style.clipPath = "none"; return; }
      // Force the hidden start + reflow so the reveal ALWAYS plays — otherwise a
      // cached image (instant on desktop) flips ready before first paint and the
      // animation gets skipped.
      el.style.clipPath = "inset(-18% 100% -18% 0)";
      void el.offsetWidth;
      const anim = el.animate(
        [{ clipPath: "inset(-18% 100% -18% 0)" }, { clipPath: "inset(-18% 0% -18% 0)" }],
        { duration: dur, delay, easing: `steps(${count})`, fill: "forwards" }
      );
      anim.onfinish = () => { el.style.clipPath = "none"; anim.cancel(); }; // cancel so forwards-fill can't override the unclipped resting state
    };
    type(".inv-lf-label", 18, 900, 300);
    type(".inv-lf-type", 14, 1100, 1300);
  }, [ready]);
  React.useEffect(() => {
    if (!open) {
      document.body.style.overflow = "hidden";
      document.body.classList.add("env-sealed");
      return () => { document.body.style.overflow = ""; document.body.classList.remove("env-sealed"); };
    }
  }, [open]);

  // once opened, replay the background zoom-out every time the user scrolls back to the top
  React.useEffect(() => {
    if (!open) return;
    const hero = document.getElementById("env-hero");
    const bg = hero && hero.querySelector(".eg-bg");
    if (!bg) return;
    let atTop = true;
    const onScroll = () => {
      const y = scrollOffset(); // shell scroller on mobile, else the document
      if (y <= 2) {
        if (!atTop) {
          atTop = true;
          bg.style.animation = "none";
          void bg.offsetWidth; // force reflow to restart the animation
          bg.style.animation = "";
        }
      } else {
        atTop = false;
      }
    };
    return onSiteScroll(onScroll);
  }, [open]);

  // replay the heart slide-up every time it scrolls back into view
  React.useEffect(() => {
    if (!open) return;
    const hero = document.getElementById("env-hero");
    const heart = hero && hero.querySelector(".eg-open .inv-l-heart");
    if (!heart) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          heart.style.animation = "none";
          void heart.offsetWidth; // force reflow to restart
          heart.style.animation = "";
        }
      });
    }, { threshold: 0.4 });
    io.observe(heart);
    return () => io.disconnect();
  }, [open]);

  const scrollDown = () => {
    const hero = document.getElementById("env-hero");
    const next = hero && hero.nextElementSibling;
    const sc = siteScrollEl(); // mobile shell scroller (null on desktop)
    if (next && sc) {
      // rect delta is robust no matter which element is the offsetParent
      const delta = next.getBoundingClientRect().top - sc.getBoundingClientRect().top - 60;
      sc.scrollBy({ top: delta, behavior: "smooth" });
      return;
    }
    const top = next ? next.offsetTop - 60 : window.innerHeight;
    window.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <header className={"eg-hero" + (open ? " is-open" : "")} id="env-hero" style={egTintVars(s)}>
      <div className="eg-bg" style={s.envBgImage ? { backgroundImage: `url(${mediaUrl(s.envBgImage)})` } : undefined} />
      <div className="eg-stage">
        {/* Sealed envelope */}
        <div className={"eg-page" + (open ? "" : " is-active")}>
          <div className={"inv-sealed-wrap eg-sealed" + (ready ? " is-ready" : "")}>
            <img ref={artRef} className="inv-sealed-art" src="/assets/invite/env-closed.webp" alt="Sealed olive envelope with lace trim and wax seal" onLoad={triggerReady} />
            {envRecolorOverlay(s, "sealed")}
            <div className="inv-letter-from">
              <span className="inv-lf-label">A Love Letter From</span>
              <span className="inv-lf-names"><span className="inv-lf-type">{s.partnerA} &amp; {s.partnerB}</span></span>
            </div>
            <button className="inv-seal-hotspot" type="button" aria-label="Open the invitation" onClick={() => setOpen(true)} />
            <span className="inv-open-cue" onClick={() => setOpen(true)} role="button">Open the invitation</span>
          </div>
        </div>

        {/* Open envelope */}
        <div className={"eg-page" + (open ? " is-active" : "")}>
          <div className={"inv-env-stack eg-open" + (open ? " is-open" : "")}>
            <div className="inv-l-card">
              <img src="/assets/invite/p2-card.png" alt="Cream invitation card with green striped border" />
              <div className="inv-card-text">
                <span className="inv-ct-label">Save the Date</span>
                <span className="inv-ct-name"><span className="inv-ct-ink">{s.partnerA}</span></span>
                <span className="inv-ct-amp">&amp;</span>
                <span className="inv-ct-name"><span className="inv-ct-ink">{s.partnerB}</span></span>
              </div>
            </div>
            <div className="inv-l-framegroup">
              <div className="inv-l-video" aria-hidden="true">
                <FrameMedia s={s} />
              </div>
              <img className="inv-frame-img" src="/assets/invite/p2-frame.png" alt="Cream oval frame with embossed peony" />
            </div>
            <div className="inv-l-heart">
              <img src="/assets/invite/p2-heart.webp" alt="Burgundy lace heart" />
              <span className="inv-heart-text">{(s.heartText || "").trim()}</span>
            </div>
            <img className="inv-l-front" src="/assets/invite/p2-envelope-front.png" alt="Olive envelope front pocket" />
            {envRecolorOverlay(s, "front")}
            <img className="inv-l-flower" src="/assets/invite/p2-flowers.png" alt="Floral spray of calla lilies, anthurium, orchids and amaranthus" />
          </div>
        </div>
      </div>

      <button className={"eg-cue" + (open ? " is-shown" : "")} type="button" onClick={scrollDown} aria-label="Scroll to the details">
        <span className="eg-cue__txt">View the details</span>
        <svg width="28" height="16" viewBox="0 0 30 17" fill="none"><path d="M2 2l13 12L28 2" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
    </header>
  );
}

// Media inside the envelope's oval frame: the owner can set an image, GIF, or
// MP4 (Settings -> Theme -> Envelope Frame Photo). Falls back to the default
// animated GIF. CSS covers both tags (.inv-l-video video/img).
function FrameMedia({ s }) {
  const src = mediaUrl(s.frameImage) || "/assets/invite/frame-video.gif";
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(src)
    ? <video src={src} muted loop autoPlay playsInline />
    : <img src={src} alt="" />;
}

export function EnvelopeInvite() {
  const { settings } = useStore();
  const s = settings;
  const [open, setOpen] = React.useState(false);

  return (
    <div className={"inv-stage" + (open ? " is-open" : "")} style={egTintVars(s)}>
      {/* Sealed envelope */}
      <div className={"inv-page" + (open ? "" : " is-active")}>
        <div className="inv-sealed-wrap">
          <img className="inv-sealed-art" src="/assets/invite/env-closed.webp" alt="Sealed olive envelope with lace trim and wax seal" />
          {envRecolorOverlay(s, "sealed")}
          <div className="inv-letter-from">
            <span className="inv-lf-label">A Love Letter From</span>
            <span className="inv-lf-names"><span className="inv-lf-type">{s.partnerA} &amp; {s.partnerB}</span></span>
          </div>
          <button className="inv-seal-hotspot" type="button" aria-label="Open the invitation" onClick={() => setOpen(true)} />
          <span className="inv-open-cue" onClick={() => setOpen(true)} role="button">Open the invitation</span>
        </div>
      </div>

      {/* Open envelope */}
      <div className={"inv-page" + (open ? " is-active" : "")}>
        <div className="inv-env-stack">
          <div className="inv-l-card">
            <img src="/assets/invite/p2-card.png" alt="Cream invitation card with green striped border" />
            <div className="inv-card-text">
              <span className="inv-ct-label">Save the Date</span>
              <span className="inv-ct-name"><span className="inv-ct-ink">{s.partnerA}</span></span>
              <span className="inv-ct-amp">&amp;</span>
              <span className="inv-ct-name"><span className="inv-ct-ink">{s.partnerB}</span></span>
            </div>
          </div>
          <div className="inv-l-framegroup">
            <div className="inv-l-video" aria-hidden="true">
              <FrameMedia s={s} />
            </div>
            <img className="inv-frame-img" src="/assets/invite/p2-frame.png" alt="Cream oval frame with embossed peony" />
          </div>
          <div className="inv-l-heart">
            <img src="/assets/invite/p2-heart.webp" alt="Burgundy lace heart" />
            <span className="inv-heart-text">{(s.heartText || "").trim()}</span>
          </div>
          <img className="inv-l-front" src="/assets/invite/p2-envelope-front.png" alt="Olive envelope front pocket" />
          {envRecolorOverlay(s, "front")}
          <img className="inv-l-flower" src="/assets/invite/p2-flowers.png" alt="Floral spray of calla lilies, anthurium, orchids and amaranthus" />
        </div>
      </div>
    </div>
  );
}

// One framed home map (map + address bar + optional tiles). Shared by the
// single-map layout and each carousel slide.
function HomeMapBlock({ m }) {
  const { settings } = useStore();
  const mapFilter = mapStyleFilter(settings);
  return (
    <>
      <div className="home-map">
        <iframe className="home-map__frame" style={mapFilter ? { filter: mapFilter } : undefined} title={m.addr ? `Map — ${m.addr}` : "Venue map"} src={m.url} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
        <div className="home-map__bar home-map__bar--actions">
          <div className="home-map__actions">
            <Button variant="ghost" size="sm" onClick={() => go("venue")}>See full details</Button>
            {m.target && <Button variant="primary" size="sm" onClick={() => window.open(mapDirUrl(m.query, m.lat, m.lng), "_blank", "noopener,noreferrer")}>{Icon.pin({})} Get directions</Button>}
          </div>
        </div>
      </div>
      {(m.name || m.addr || m.query) && (
        <div className="home-map__caption">
          <span className="home-map__pin">{Icon.pin({})}</span>
          <div>
            {m.name && <div className="home-map__name">{m.name}</div>}
            <div className="home-map__caption-addr">{m.addr || (!m.name ? m.query : "")}</div>
          </div>
        </div>
      )}
      {m.cards.length > 0 && (
        <div className="info-grid info-grid--3" style={{ marginTop: 22 }}>
          {m.cards.map((n, i) => (
            <div className="card info-card" key={n.id || i}><h3>{n.t}</h3><p>{n.d}</p></div>
          ))}
        </div>
      )}
    </>
  );
}

// Snap-scroll carousel shell: one full-width slide per child, with the same
// frosted arrows + dots pill as the horizontal timeline ("glimpse of the
// day"). `labels[i]` names each dot for screen readers. Used by the home maps
// and the Venue page's multi-location layout.
function SnapCarousel({ labels = [], children }) {
  const slides = React.Children.toArray(children);
  const n = slides.length;
  const ref = useRef(null);
  const [active, setActive] = useState(0);
  const update = useCallback(() => {
    const el = ref.current; if (!el) return;
    const idx = el.clientWidth ? Math.round(el.scrollLeft / el.clientWidth) : 0;
    const j = Math.max(0, Math.min(n - 1, idx));
    setActive((p) => (p === j ? p : j));
  }, [n]);
  useEffect(() => {
    update();
    const el = ref.current; if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { el.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [update]);
  const toItem = (i) => {
    const el = ref.current; if (!el) return;
    const j = Math.max(0, Math.min(n - 1, i));
    el.scrollTo({ left: j * el.clientWidth, behavior: "smooth" });
  };
  return (
    <div className="map-car">
      <div className="map-car__rail" ref={ref}>
        {slides.map((c, i) => (
          <div className="map-car__slide" key={i} aria-hidden={i !== active}>{c}</div>
        ))}
      </div>
      <div className="tl-nav">
        <button type="button" className="tl-nav__arrow" onClick={() => toItem(active - 1)} disabled={active === 0} aria-label="Previous location">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="tl-nav__dots">
          {slides.map((_, i) => (
            <button key={i} type="button" className={"tl-nav__dot" + (i === active ? " is-active" : "")} onClick={() => toItem(i)} aria-label={"Go to " + (labels[i] || "location " + (i + 1))} aria-current={i === active} />
          ))}
        </div>
        <button type="button" className="tl-nav__arrow" onClick={() => toItem(active + 1)} disabled={active === n - 1} aria-label="Next location">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>
    </div>
  );
}

// Multiple home maps → one slide per location.
function HomeMapsCarousel({ maps }) {
  return (
    <SnapCarousel labels={maps.map((m) => m.addr)}>
      {maps.map((m, mi) => <HomeMapBlock key={m.id || mi} m={m} />)}
    </SnapCarousel>
  );
}

export function Home() {
  const { settings, story, schedule: scheduleRaw, entourage, attire, playlist, venues } = useStore();
  // Guard against a non-array truthy schedule in tenant content (bad import /
  // manual DB edit): clientToState only falls back to seeds on falsiness, so an
  // object/string would reach .slice/.length below and white-screen the home.
  const schedule = Array.isArray(scheduleRaw) ? scheduleRaw : [];
  const s = settings;
  // Home maps: every venue the owner ticked (homeVenueIds, in venue-list order).
  // Legacy fallback: homeVenueId, else the first venue; no venues at all falls
  // back to the flat settings map. Each entry renders its own map block, plus
  // its tiles when homeShowTiles is on.
  const homeVenues = (() => {
    const list = venues || [];
    const picked = Array.isArray(s.homeVenueIds)
      ? list.filter((v) => s.homeVenueIds.includes(v.id))
      : (() => { const one = list.find((v) => v.id === s.homeVenueId) || list[0]; return one ? [one] : []; })();
    if (picked.length) return picked;
    const q = (s.mapQuery && s.mapQuery.trim()) || s.venueAddress;
    return q ? [{ id: "legacy", mapQuery: q, mapLat: s.mapLat, mapLng: s.mapLng, address: s.venueAddress || s.venueName, cards: [] }] : [];
  })();
  // Per-venue tile selection: homeTiles[venueId] = [cardId,…]. Legacy fallback:
  // if homeTiles was never set but the old homeShowTiles flag is on, show all.
  const homeTiles = (s.homeTiles && typeof s.homeTiles === "object") ? s.homeTiles : null;
  const legacyAllTiles = !homeTiles && s.homeShowTiles === true;
  const homeMaps = homeVenues.map((v) => {
    const q = (v.mapQuery && v.mapQuery.trim()) || v.address;
    const chosen = homeTiles ? (homeTiles[v.id] || []) : [];
    return {
      id: v.id, query: q, lat: v.mapLat, lng: v.mapLng,
      // Resolved geocodable target: coords when present, else a parsed query.
      // Empty when the venue has no address/query/coords — filtered out below so
      // we never render a blank/garbage Google Maps embed (mapEmbedUrl is always
      // truthy, so the old `.filter(m => m.url)` was a no-op).
      target: mapCoordStr(v.mapLat, v.mapLng) || mapResolveQuery(q),
      url: mapEmbedUrl(q, v.mapLat, v.mapLng),
      name: v.name || "",
      addr: v.address || "",
      cards: (v.cards || []).filter((c) => ((c.t || "").trim() || (c.d || "").trim()) && (legacyAllTiles || chosen.includes(c.id))),
    };
  }).filter((m) => m.target);

  // replay the "Will you be there?" rise-in every time it scrolls into view
  React.useEffect(() => {
    const el = document.querySelector("#home-rsvp .rsvp-cta-inner");
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          el.classList.remove("is-in");
          void el.offsetWidth; // restart the animation
          el.classList.add("is-in");
        } else {
          el.classList.remove("is-in");
        }
      });
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [s.theme]);

  return (
    <div>
      {/* HERO */}
      {s.theme === "envelope" ? (
        <EnvelopeHero />
      ) : (
      <header className="hero">
        <HeroBg />
        <div className="hero__inner">
          <div className="eyebrow hero__eyebrow eyebrow--solo">{s.tagline}</div>
          <h1 className="hero__names">
            {s.partnerA}<span className="amp">&amp;</span>{s.partnerB}
          </h1>
          {s.weddingDateLabel && <div className="hero__date">{s.weddingDateLabel}</div>}
          {s.showCountdown !== false && <Countdown targetIso={s.weddingDate} />}
          <p className="hero__welcome">{s.welcome}</p>
        </div>
        <div className="hero__scroll">Scroll</div>
      </header>
      )}

      {/* COUNTDOWN (envelope theme — the hero is replaced by the envelope) */}
      {s.theme === "envelope" && (
        <section className="block eg-celebrate" id="home-countdown" style={{ textAlign: "center", paddingBottom: 96 }}>
          {/* IMPORTANT — DO NOT make this configurable. The Olive Envelope theme
              ALWAYS shows falling leaves, regardless of the client's decorStyle/
              decorOn (it's a bespoke template). Never bind this to s.decorStyle. */}
          <FloatingDecor on style="leaves" />
          <div className="container container--narrow">
            <div className="eyebrow eyebrow--solo" style={{ justifyContent: "center" }}>{s.tagline}</div>
            <h2 style={{ fontSize: "clamp(28px,4.6vw,44px)", margin: "16px 0 14px", color: "var(--ink)" }}>
              {s.inviteTitle}
            </h2>
            <p style={{ color: "var(--ink-soft)", fontSize: 19, margin: "0 0 10px" }}>
              {s.inviteBody}
            </p>
            {s.weddingDateLabel && <div style={{ color: "var(--ink-soft)", letterSpacing: ".12em", textTransform: "uppercase", fontSize: 14, margin: "18px 0 26px" }}>{s.weddingDateLabel}</div>}
            {s.showCountdown !== false && <Countdown targetIso={s.weddingDate} light />}
            {s.rsvpDeadlineOn !== false && s.rsvpDeadline && <p style={{ color: "var(--ink-soft)", fontSize: 15, margin: "26px 0 0", letterSpacing: ".04em" }}>Kindly respond by {s.rsvpDeadline}.</p>}
            <div style={{ marginTop: 22 }}>
              <Button variant="primary" size="lg" onClick={() => go("rsvp")}>{Icon.check({})} Respond now</Button>
            </div>
          </div>
        </section>
      )}

      {/* WELCOME / invitation — RSVP button lives right under this section */}
      {s.theme !== "envelope" && (
      <section className="block" id="home-rsvp">
        <div className="container container--narrow rsvp-cta-inner" style={{ textAlign: "center" }}>
          <div className="divider-mark">{Icon.rings({})}</div>
          <h2 style={{ fontSize: "clamp(28px,4.6vw,44px)", margin: "26px 0 18px" }}>
            {s.inviteTitle}
          </h2>
          <p style={{ color: "var(--ink-soft)", fontSize: 19 }}>
            {s.inviteBody}
          </p>
          {s.rsvpDeadlineOn !== false && s.rsvpDeadline && <p style={{ color: "var(--ink-soft)", fontSize: 15, margin: "22px 0 16px", letterSpacing: ".04em" }}>Kindly respond by {s.rsvpDeadline}.</p>}
          <Button variant="primary" size="lg" onClick={() => go("rsvp")}>{Icon.check({})} Respond now</Button>
        </div>
      </section>
      )}

      {/* MAP — venue location right after the invitation (map only, framed).
          Hidden when the Venue module is off (matches nav + /venue route). */}
      {moduleEnabled(s.modules, "venue") && s.showMap !== false && homeMaps.length > 0 && (
        <section className="block" id="home-map">
          <div className="container">
            <SectionHead center eyebrow="The Venue" title="Where we'll celebrate" />
            {homeMaps.length > 1
              ? <HomeMapsCarousel maps={homeMaps} />
              : <HomeMapBlock m={homeMaps[0]} />}
          </div>
        </section>
      )}

      {/* SCHEDULE PREVIEW — hidden when the timeline toggle is off or the
          Schedule module is disabled (matches nav + /schedule route). */}
      {s.showTimeline !== false && moduleEnabled(s.modules, "schedule") && (
      <section className="block block--tint" id="home-schedule">
        <div className="container">
          <SectionHead center eyebrow="The Day" title="A glimpse of the schedule" />
          <ScheduleView items={s.homeTimelineLayout === "horizontal" ? schedule : schedule.slice(0, 3)} style={s.homeTimelineLayout === "horizontal" ? "horizontal" : "alt"} />
          {s.homeTimelineLayout !== "horizontal" && schedule.length > 0 && (
            <div style={{ textAlign: "center", marginTop: 20 }}>
              <Button variant="ghost" onClick={() => go("schedule")}>See the full timeline {Icon.arrow({})}</Button>
            </div>
          )}
        </div>
      </section>
      )}

      {/* ATTIRE GUIDE — right after the schedule glimpse */}
      {s.showAttire !== false && <AttireView groups={attire} />}

      {/* MUSIC — vinyl player now sits right after the schedule glimpse */}
      {s.showMusic !== false && <VinylPlayer tracks={playlist} />}

      {/* ENTOURAGE — groups of people (Groomsmen, Bridesmaids, …) */}
      {s.showEntourage !== false && <EntourageView groups={entourage} />}
    </div>
  );
}

// Public attire-guide section: each group has an example image and a colour
// palette. Renders nothing when there are no groups with any content.
export function AttireView({ groups }) {
  const list = (groups || []).filter((g) => g && ((g.name || "").trim() || g.image || (g.desc || "").trim() || (g.palette || []).length));
  if (!list.length) return null;
  return (
    <section className="block" id="home-attire">
      <div className="container">
        <SectionHead center eyebrow="What to wear" title="Attire guide" />
        <div className="attire-grid">
          {list.map((g) => {
            const pal = g.palette || [];
            return (
              <div className="attire-card" key={g.id}>
                {/* Only show the image area when a photo was uploaded — no photo
                    means no box (name + description + palette dots only). */}
                {g.image && (
                  <div className="attire-card__img">
                    <img src={mediaUrl(g.image)} alt={g.name || "Attire"} />
                  </div>
                )}
                {g.name ? <div className="attire-card__name">{g.name}</div> : null}
                {g.desc ? <div className="attire-card__desc">{g.desc}</div> : null}
                {pal.length > 0 && (
                  <div className="attire-card__palette">
                    {pal.map((c, i) => <span key={i} className="attire-card__swatch" style={{ background: c }} title={c} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// Public entourage section: each group titled, people listed as "Name — Role".
// Renders nothing when there are no groups with people.
export function EntourageView({ groups }) {
  const list = (groups || []).filter((g) => g && (g.people || []).length);
  if (!list.length) return null;
  return (
    <section className="block" id="home-entourage">
      <div className="container">
        <SectionHead center eyebrow="With Us" title="The Entourage" />
        <div className="ent-grid">
          {list.map((g) => (
            <div className="ent-group" key={g.id}>
              <h3 className="ent-group__title">{g.title}</h3>
              <ul className="ent-people">
                {(g.people || []).map((p) => (
                  <li className="ent-person" key={p.id}>
                    <span className="ent-person__name">{p.name}</span>
                    {p.role ? <span className="ent-person__role">{p.role}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function PageHero({ eyebrow, title, lead }) {
  return (
    <div className="page-hero container">
      <div className="eyebrow eyebrow--solo" style={{ justifyContent: "center" }}>{eyebrow}</div>
      <h1>{title}</h1>
      {lead && <p>{lead}</p>}
    </div>
  );
}

export function StoryPage() {
  const { story } = useStore();
  return (
    <div className="fade-up">
      <PageHero eyebrow="Our Story" title="How we got here" lead="Every love story is beautiful, but this one is ours." />
      <section className="block" style={{ paddingTop: 30 }}>
        <div className="container" style={{ maxWidth: 920 }}>
          {(Array.isArray(story) ? story : []).map((row, i) => (
            <div className="story-row" key={i}>
              <div className="story-row__media"><StoryImg row={row} /></div>
              <div>
                <div className="story-row__year">{row.year}</div>
                <h3 className="story-row__title">{row.title}</h3>
                <p className="story-row__desc">{row.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function DetailsPage() {
  const { settings, faq, detailCards } = useStore();
  const s = settings;
  const [open, setOpen] = useState(0);
  return (
    <div className="fade-up">
      <PageHero eyebrow="Wedding Details" title="Everything you need to know" lead={s.weddingDateLabel ? `We can't wait to celebrate with you on ${s.weddingDateLabel}.` : "We can't wait to celebrate with you."} />
      <section className="block" style={{ paddingTop: 20 }}>
        <div className="container">
          <div className="info-grid info-grid--2">
            {(detailCards || []).filter((c) => (c.title || "").trim() || (c.body || "").trim()).map((c, i) => (
              <div className="card card--pad-lg info-card" key={i}>
                <div className="info-card__icon">{(Icon[c.icon] || Icon.rings)({})}</div>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="block block--tint">
        <div className="container container--narrow">
          <SectionHead center eyebrow="Good to know" title="Frequently asked" />
          <div>
            {(Array.isArray(faq) ? faq : []).map((item, i) => (
              <div className={"faq-item" + (open === i ? " faq-item--open" : "")} key={i}>
                <button className="faq-q" onClick={() => setOpen(open === i ? -1 : i)}>
                  {item.q}<span className="faq-q__icon" />
                </button>
                <div className="faq-a" style={{ maxHeight: open === i ? 240 : 0 }}>
                  <div className="faq-a__inner">{item.a}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

// Horizontal timeline: a scrollable rail with desktop nav arrows that appear
// only when there's more to scroll in that direction (scrollbar hidden on
// desktop; mobile keeps native touch scroll).
function HorizontalTimeline({ items }) {
  const ref = useRef(null);
  const [active, setActive] = useState(0);
  const [overflow, setOverflow] = useState(false);
  // The rail scrolls continuously, so the dots track scroll PROGRESS: dot i maps
  // to scroll fraction i/(n-1). This keeps the dots lighting in order and the
  // chevrons disabling at the ends even when the rail only overflows a little.
  const n = items.length;
  const update = useCallback(() => {
    const el = ref.current; if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setOverflow(max > 4);
    const frac = max > 4 ? el.scrollLeft / max : 0;
    const idx = n > 1 ? Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1)))) : 0;
    setActive((p) => (p === idx ? p : idx));
  }, [n]);
  useEffect(() => {
    update();
    const el = ref.current; if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { el.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [update]);
  const toItem = (i) => {
    const el = ref.current; if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const j = Math.max(0, Math.min(n - 1, i));
    el.scrollTo({ left: n > 1 ? (j / (n - 1)) * max : 0, behavior: "smooth" });
  };
  return (
    <div className="timeline-hwrap">
      <div className="timeline-h" ref={ref}>
        <div className="timeline-h__track">
          {items.map((it, i) => (
            <div className={"tl-h-item" + (overflow && i === active ? " is-active" : "")} key={i}>
              <div className="tl-time">{it.time}</div>
              <span className="tl-h-dot" />
              <div className="tl-h-body">
                <h3 className="tl-h-title">{it.title}</h3>
                <p className="tl-desc">{it.desc}</p>
                {it.loc && <div className="tl-loc">{Icon.pin({})} {it.loc}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Nav pill (adapted from the "tilt stack carousel" pen): prev/next chevrons
          + dot indicators in a frosted pill. Shown only when the rail overflows. */}
      {overflow && (
        <div className="tl-nav">
          <button type="button" className="tl-nav__arrow" onClick={() => toItem(active - 1)} disabled={active === 0} aria-label="Previous">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div className="tl-nav__dots">
            {items.map((_, i) => (
              <button key={i} type="button" className={"tl-nav__dot" + (i === active ? " is-active" : "")} onClick={() => toItem(i)} aria-label={"Go to event " + (i + 1)} aria-current={i === active} />
            ))}
          </div>
          <button type="button" className="tl-nav__arrow" onClick={() => toItem(active + 1)} disabled={active === items.length - 1} aria-label="Next">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}

export function ScheduleView({ items: itemsProp, style }) {
  const items = Array.isArray(itemsProp) ? itemsProp : [];
  const s = style || "line";
  if (s === "cards") {
    return (
      <div className="sched-cards">
        {items.map((it, i) => (
          <div className="sched-cards__item" key={i}>
            <div className="sched-cards__time">{it.time}</div>
            <div>
              <h3 className="sched-cards__title">{it.title}</h3>
              <p className="tl-desc">{it.desc}</p>
              {it.loc && <div className="tl-loc">{Icon.pin({})} {it.loc}</div>}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (s === "minimal") {
    return (
      <div className="sched-min">
        {items.map((it, i) => (
          <div className="sched-min__row" key={i}>
            <div className="sched-min__time">{it.time}</div>
            <h3 className="sched-min__title">{it.title}</h3>
            <p className="tl-desc" style={{ maxWidth: "46ch", margin: "6px auto 0" }}>{it.desc}</p>
            {it.loc && <div className="tl-loc" style={{ justifyContent: "center" }}>{Icon.pin({})} {it.loc}</div>}
          </div>
        ))}
      </div>
    );
  }
  if (s === "columns") {
    return (
      <div className="sched-cols">
        {items.map((it, i) => (
          <div className="sched-cols__row" key={i}>
            <div className="sched-cols__time">{it.time}</div>
            <div>
              <h3 className="sched-cols__title">{it.title}</h3>
              <p className="tl-desc">{it.desc}</p>
              {it.loc && <div className="tl-loc">{Icon.pin({})} {it.loc}</div>}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (s === "horizontal") {
    return <HorizontalTimeline items={items} />;
  }
  return (
    <div className={"timeline" + (s === "alt" ? " timeline--alt" : "")}>
      {items.map((it, i) => (
        <div className="tl-item" key={i}>
          <span className="tl-dot" />
          <div className="tl-time">{it.time}</div>
          <h3 className="tl-title">{it.title}</h3>
          <p className="tl-desc">{it.desc}</p>
          {it.loc && <div className="tl-loc">{Icon.pin({})} {it.loc}</div>}
        </div>
      ))}
    </div>
  );
}

export function SchedulePage() {
  const { schedule, settings } = useStore();
  return (
    <div className="fade-up">
      <PageHero eyebrow="The Day Of" title="Wedding day schedule" lead="Here's how the celebration will unfold, hour by hour." />
      <section className="block" style={{ paddingTop: 30 }}>
        <div className="container">
          <ScheduleView items={schedule} style="alt" />
        </div>
      </section>
    </div>
  );
}

export function VenuePage() {
  const { settings, venues } = useStore();
  const s = settings;
  // Show every venue that has something to display (a map target or any tile).
  const list = (venues || []).filter((v) =>
    ((v.mapQuery || v.address || v.name || "").trim()) ||
    (v.cards || []).some((c) => (c.t || "").trim() || (c.d || "").trim()));
  const multi = list.length > 1;
  // Header follows the venues you edit (not the legacy settings map). Single
  // location → its name + address; multiple → a generic title (each location
  // gets its own heading below).
  const first = list[0];
  const heroTitle = multi ? "Where we'll celebrate" : ((first && (first.name || first.address)) || s.venueName);
  const heroLead = multi ? "Here's where we'll be." : ((first && first.address) || s.venueAddress);
  return (
    <div className="fade-up">
      <PageHero eyebrow="Venue & Map" title={heroTitle} lead={heroLead} />
      {(() => {
        const sectionOf = (v, vi) => {
          const query = (v.mapQuery && v.mapQuery.trim()) || v.address;
          // Only render the map + directions when there's a resolvable target
          // (coords or a geocodable query). A venue admitted on name alone with
          // no address/query/coords would otherwise show a blank Google embed
          // and a directions link with an empty destination.
          const target = mapCoordStr(v.mapLat, v.mapLng) || mapResolveQuery(query);
          const mapUrl = mapEmbedUrl(query, v.mapLat, v.mapLng);
          const dirUrl = mapDirUrl(query, v.mapLat, v.mapLng);
          const cards = (v.cards || []).filter((c) => (c.d || "").trim() || (c.t || "").trim());
          return (
            <>
              {multi && <SectionHead center eyebrow={`Location ${vi + 1}`} title={v.name || v.address} />}
              {target && (
                <>
                  <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 30 }}>
                    <iframe title={"Venue map" + (multi ? " " + (vi + 1) : "")} src={mapUrl} style={{ width: "100%", height: 420, border: 0, display: "block", filter: mapStyleFilter(settings) || undefined }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: 44 }}>
                    <Button variant="primary" size="lg" onClick={() => window.open(dirUrl, "_blank", "noopener,noreferrer")}>{Icon.pin({})} Get Directions</Button>
                  </div>
                </>
              )}
              {cards.length > 0 && (
                <div className="info-grid info-grid--3">
                  {cards.map((n, i) => (
                    <div className="card info-card" key={n.id || i}>
                      <h3>{n.t}</h3>
                      <p>{n.d}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          );
        };
        // 2+ locations → the same snap carousel as the home maps; one stays flat.
        return multi ? (
          <section className="block" style={{ paddingTop: 24 }}>
            <div className="container">
              <SnapCarousel labels={list.map((v) => v.name || v.address)}>
                {list.map((v, vi) => <React.Fragment key={v.id || vi}>{sectionOf(v, vi)}</React.Fragment>)}
              </SnapCarousel>
            </div>
          </section>
        ) : (
          <section className="block" style={{ paddingTop: 24 }}>
            <div className="container">{list[0] ? sectionOf(list[0], 0) : null}</div>
          </section>
        );
      })()}
    </div>
  );
}

