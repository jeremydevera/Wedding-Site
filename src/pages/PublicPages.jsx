import React from "react";
import { go } from "@/lib/nav.js";
import { onSiteScroll, scrollOffset, siteScrollEl } from "@/lib/scroll.js";
import { cropBoxStyle, cropTransform, mediaUrl } from "@/lib/media.js";
import { useStore } from "@/lib/store.jsx";
import { mapStyleFilter } from "@/lib/mapStyles.js";
import { featureVisible, moduleEnabled, sectionLabel } from "@/lib/roles.js";
import { PREVIEW_SAMPLES } from "@/lib/samples.js";
import { egTintGradientFor, envColorFilterFor, isEnvelopeTheme } from "@/themes";
import { Button, Countdown, FloatingDecor, Icon, Placeholder, SectionHead, mapCoordStr, mapDirUrl, mapEmbedUrl, mapResolveQuery } from "@/ui/components.jsx";
import { VinylPlayer } from "@/features/music.jsx";
const { useState, useEffect, useRef, useMemo, useCallback, useReducer } = React;

// ============================================================================
// pages/PublicPages.jsx — Home + content pages (Details, Story, Schedule, Venue, FAQ)
// ============================================================================

// Uploaded hero photo: decide whether the hero text needs to flip LIGHT.
// Effective brightness = the photo's average luminance dimmed by the tint wash
// (the wash is near-black, so strength scales brightness down linearly). Dark
// result -> light text. Beta-gated with the uploader (siteBgBeta).
export function useHeroTextLight(s) {
  const [light, setLight] = useState(false);
  const img = s.heroImage, on = s.heroTintOn !== false;
  const t = Math.max(0, Math.min(100, s.heroTint == null ? 55 : +s.heroTint));
  useEffect(() => {
    if (!img || s.siteBgBeta !== true) { setLight(false); return; }
    let dead = false;
    const el = new Image();
    el.onload = () => {
      if (dead) return;
      try {
        const c = document.createElement("canvas");
        c.width = 16; c.height = 16;
        const ctx = c.getContext("2d");
        ctx.drawImage(el, 0, 0, 16, 16);
        const d = ctx.getImageData(0, 0, 16, 16).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        const luma = sum / (d.length / 4);
        const eff = luma * (1 - (on ? t : 0) / 100);
        setLight(eff < 140);
      } catch (_) {
        setLight(on && t >= 50); // can't sample — trust a strong wash to be dark
      }
    };
    el.onerror = () => { if (!dead) setLight(on && t >= 50); };
    el.src = mediaUrl(img);
    return () => { dead = true; };
  }, [img, on, t, s.siteBgBeta]);
  return light;
}

export function HeroBg() {
  const { settings } = useStore();
  if (settings.heroImage) {
    // Same strength semantics as the Olive Envelope background tint: off = no
    // scrim, otherwise (heroTint ?? 55)/100 scales the wash (55 = envelope's
    // default).
    const tintStyle = settings.heroTintOn === false
      ? { display: "none" }
      : { opacity: Math.max(0, Math.min(100, settings.heroTint == null ? 55 : +settings.heroTint)) / 100 };
    return (
      <div className="hero__media">
        <img src={mediaUrl(settings.heroImage)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <div className="hero__tint" style={tintStyle} />
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
  if (!row || !row.img) return <Placeholder label="story photo" ratio="4 / 3" />;
  const base = { width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: "var(--radius)", display: "block" };
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(row.img)) {
    // Bug 0014: cropTransform is a pan/zoom (scale/translate) meant for a
    // cover-fitted video INSIDE an overflow:hidden box (see cropTransform's
    // doc). Applying it straight on the <video> let a zoomed crop escape its
    // frame and bleed across the page — clip it.
    return (
      <div style={{ width: "100%", aspectRatio: "4 / 3", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <video src={mediaUrl(row.img)} muted loop autoPlay playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", ...(cropTransform(row.imgCrop) || {}) }} />
      </div>
    );
  }
  return <img src={mediaUrl(row.img)} alt={row.title} style={base} />;
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
function envRecolorOverlay(s, kind, artSrc) {
  const recolor = envColorFilterFor(s.envColor, s.envColorCustom);
  if (kind === "sealed") return (<>
    {recolor ? <img className={"inv-art-recolor inv-art-recolor--sealed" + (artSrc ? " inv-art-recolor--nomask" : "")} src={artSrc || "/assets/invite/env-closed.webp"} alt="" aria-hidden="true" /> : null}
    {/* env2 (burgundy cutout art) carries its own decorative oval seal baked in
        — no overlay image; the hotspot pulse is the click affordance. Olive
        keeps its cut-out seal (it carries the pump animation + stays cream
        under recolor). */}
    {artSrc
      ? null
      : <img className="inv-seal-img inv-seal-img--sealed" src="/assets/invite/seal-closed-v2.png" alt="" aria-hidden="true" />}
  </>);
  if (!recolor) return null;
  return (<>
    <img className={"inv-l-front inv-art-recolor inv-art-recolor--front" + (artSrc ? " inv-art-recolor--nomask" : "")} src={artSrc || "/assets/invite/p2-envelope-front.png"} alt="" aria-hidden="true" />
    {/* env2's open envelope has no separate seal on the front pocket */}
    {!artSrc && <img className="inv-seal-img inv-seal-img--front" src="/assets/invite/seal-front-v2.png" alt="" aria-hidden="true" />}
  </>);
}
export function EnvelopeHero() {
  const { settings } = useStore();
  const s = settings;
  const [open, setOpen] = React.useState(false);
  // Envelope 2 uses its own lace-ivory cover, recolored live on a canvas by the
  // Settings -> Theme envelope color (paper takes the color, seal stays light).
  // The open state (card/frame/flowers) is unchanged.
  const isEnv2 = s.theme === "envelope2";
  const sealedSrc = isEnv2 ? "/assets/invite/env2-closed.png" : "/assets/invite/env-closed.webp";
  const sealedAlt = isEnv2 ? "Sealed burgundy lace envelope with a wax seal" : "Sealed olive envelope with lace trim and wax seal";
  // Open-state front pocket: env2 uses its own open envelope (olive-toned, fit to
  // the olive pocket's box so the card/heart/flowers still line up).
  const frontSrc = isEnv2 ? "/assets/invite/red-envelope-front.png" : "/assets/invite/p2-envelope-front.png";

  // first screen = envelope only: lock scroll AND hide the nav until it's opened
  const [ready, setReady] = React.useState(false);
  const artRef = React.useRef(null);
  const triggerReady = React.useCallback(() => setReady(true), []);

  // env2 cover title max width: measure the hidden one-line probe (real fonts,
  // real cqw/vw sizing) against the safe budget — 86% of the viewport (mobile
  // shows a slice of a wider-than-screen envelope) and 62% of the envelope
  // (the flap's plain paper narrows into the lace). Overflow -> stacked title.
  // Re-measured on resize and once the script font finishes loading (Great
  // Vibes metrics differ a lot from the fallback).
  const titleProbeRef = React.useRef(null);
  const nameProbeARef = React.useRef(null);
  const nameProbeBRef = React.useRef(null);
  const [stackTitle, setStackTitle] = React.useState(false);
  // when stacked, scale the lines so the LONGER name fills the budget (up to
  // full title size) — a fixed reduction left short stacked names tiny.
  const [stackEm, setStackEm] = React.useState(0.78);
  React.useLayoutEffect(() => {
    if (!isEnv2) return;
    const measure = () => {
      const el = titleProbeRef.current;
      if (!el) return;
      const wrap = el.closest(".eg-sealed");
      const budget = Math.min(window.innerWidth * 0.86, (wrap ? wrap.clientWidth : window.innerWidth) * 0.62);
      if (!(budget > 0) || !(el.offsetWidth > 0)) return;
      const stacked = el.offsetWidth > budget;
      setStackTitle(stacked);
      if (stacked) {
        const wA = nameProbeARef.current ? nameProbeARef.current.offsetWidth : 0;
        const wB = nameProbeBRef.current ? nameProbeBRef.current.offsetWidth : 0;
        const widest = Math.max(wA, wB, 1);
        setStackEm(Math.max(0.6, Math.min(1, Math.round((budget * 0.98 / widest) * 1000) / 1000)));
      }
    };
    measure();
    // fonts.ready can resolve BEFORE the probe's first paint even requests
    // Great Vibes — also re-measure on every loadingdone (font arrival) and
    // once after a beat, so a fallback-font measurement can't stick.
    const fonts = document.fonts;
    if (fonts && fonts.ready) fonts.ready.then(measure).catch(() => {});
    if (fonts && fonts.addEventListener) fonts.addEventListener("loadingdone", measure);
    const late = setTimeout(measure, 2000);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      if (fonts && fonts.removeEventListener) fonts.removeEventListener("loadingdone", measure);
      clearTimeout(late);
    };
  }, [isEnv2, s.partnerA, s.partnerB, s.envTitleSize]);
  // Wait for the envelope art (paper + wax seal) to fully DECODE before showing
  // the cover — previously the type-on played over a blank/partial background
  // and the image popped in late. Fails open after 4s so a slow/failed decode
  // never blanks the cover forever.
  const [artReady, setArtReady] = React.useState(false);
  React.useEffect(() => {
    let dead = false;
    const decode = (src) => {
      const im = new Image();
      im.src = src;
      return (im.decode ? im.decode() : Promise.resolve()).catch(() => {});
    };
    Promise.all([decode(sealedSrc), ...(isEnv2 ? [] : [decode("/assets/invite/seal-closed-v2.png")])])
      .then(() => { if (!dead) setArtReady(true); });
    const t = setTimeout(() => { if (!dead) setArtReady(true); }, 4000);
    return () => { dead = true; clearTimeout(t); };
  }, []);
  React.useEffect(() => {
    // Flip ready a couple frames AFTER the art is decoded so the cover fades in
    // complete and the type-on plays over the finished envelope (the two-frame
    // delay keeps the hidden text painting first, cached or not).
    if (!artReady) return;
    let r1, r2;
    r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setReady(true)); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [artReady]);
  // Type-on reveal via Web Animations API. Crucially, ON FINISH we clear the
  // clip-path entirely so the resting state is unclipped — otherwise a browser
  // that clamps the negative end-inset to 0 shaves the last glyph ("m" in "From").
  React.useEffect(() => {
    if (!ready) return;
    const root = artRef.current && artRef.current.closest(".inv-sealed-wrap");
    if (!root) return;
    // The cover type-on is exempt from prefers-reduced-motion by design (owner's
    // choice) — it's a gentle text wipe; other motion still respects the setting.
    const typeEl = (el, count, dur, delay) => {
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
    const type = (sel, count, dur, delay) => typeEl(root.querySelector(sel), count, dur, delay);
    // env2 stacked names (name / & / name): reveal LINE BY LINE, not all at once.
    const stack = isEnv2 ? root.querySelector(".inv-lf-type.inv-lf-stack") : null;
    if (stack) {
      const lines = Array.prototype.slice.call(stack.querySelectorAll(":scope > span"));
      // Hide each line WHILE the container is still CSS-clipped, then unclip the
      // container so only the per-line wipes are visible (no all-at-once flash).
      lines.forEach((l) => { if (l.animate) l.style.clipPath = "inset(-18% 100% -18% 0)"; });
      stack.style.clipPath = "none";
      void stack.offsetWidth;
      lines.forEach((line, i) => {
        const n = Math.max(4, ((line.textContent || "").trim().length) || 4);
        typeEl(line, n, 620, 400 + i * 680); // 400ms start, +680ms per line
      });
    } else {
      type(".inv-lf-label", 18, 900, 300);
      type(".inv-lf-type", 14, 1100, isEnv2 ? 400 : 1300); // env2 has no label line — names type first
    }
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
          <div className={"inv-sealed-wrap eg-sealed" + (ready ? " is-ready" : "")} style={{ opacity: artReady ? 1 : 0, transition: "opacity .45s ease" }}>
            <img ref={artRef} className="inv-sealed-art" src={sealedSrc} alt={sealedAlt} onLoad={triggerReady} />
            {/* Envelope 2 now runs through the SAME olive recolor path
                (envColorFilterFor -> --eg-env-recolor -> .inv-art-recolor), just
                pointed at the env2 art, so both themes share one function. */}
            {isEnv2 ? envRecolorOverlay(s, "sealed", sealedSrc) : envRecolorOverlay(s, "sealed")}
            {/* env2: the couple's initials embossed into the wax oval — stacked
                diagonally (classic monogram); inline text was too wide for the
                portrait oval and crossed the rim. */}
            {isEnv2 && ((s.partnerA || "").trim() || (s.partnerB || "").trim()) ? (
              <span className="inv-seal-mono" aria-hidden="true">
                {(s.partnerA || "").trim() ? <span className="inv-seal-mono__a">{(s.partnerA || "").trim().charAt(0).toUpperCase()}</span> : null}
                {(s.partnerB || "").trim() ? <span className="inv-seal-mono__b">{(s.partnerB || "").trim().charAt(0).toUpperCase()}</span> : null}
              </span>
            ) : null}
            <div className="inv-letter-from">
              {!isEnv2 && <span className="inv-lf-label">A Love Letter From</span>}
              {/* env2: the one-line title has a hard MAX WIDTH — a hidden probe
                  (same classes = same font/size rules incl. the mobile caps)
                  measures what one line would take; past the budget the names
                  stack (name / & / name). Width-based, not character-count, so
                  it adapts per screen and per Title Size. */}
              {isEnv2 && (<>
                <span ref={titleProbeRef} className="inv-lf-names inv-lf-probe" aria-hidden="true">{(s.partnerA || "").trim()} &amp; {(s.partnerB || "").trim()}</span>
                <span ref={nameProbeARef} className="inv-lf-names inv-lf-probe" aria-hidden="true">{(s.partnerA || "").trim()}</span>
                <span ref={nameProbeBRef} className="inv-lf-names inv-lf-probe" aria-hidden="true">{(s.partnerB || "").trim()}</span>
              </>)}
              {isEnv2 && stackTitle ? (
                <span className="inv-lf-names"><span className="inv-lf-type inv-lf-stack" style={{ fontSize: stackEm + "em" }}>
                  <span>{(s.partnerA || "").trim()}</span>
                  <span className="inv-lf-stack__amp">&amp;</span>
                  <span>{(s.partnerB || "").trim()}</span>
                </span></span>
              ) : (
                <span className="inv-lf-names"><span className="inv-lf-type">{s.partnerA} &amp; {s.partnerB}</span></span>
              )}
              {isEnv2 && <span className="inv-lf-sub">We are getting married</span>}
            </div>
            <button className="inv-seal-hotspot" type="button" aria-label={isEnv2 ? "Click to open" : "Open the invitation"} onClick={() => setOpen(true)} />
            {/* env2 shows no text cue (owner request) — the pulsing seal is the affordance */}
            {!isEnv2 && <span className="inv-open-cue" onClick={() => setOpen(true)} role="button">Open the invitation</span>}
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
              <img className="inv-frame-img" src={isEnv2 ? "/assets/invite/white-frame.png" : "/assets/invite/p2-frame.png"} alt={isEnv2 ? "Ornate white oval frame with floral crests" : "Cream oval frame with embossed peony"} />
            </div>
            <div className="inv-l-heart">
              <img src={isEnv2 ? "/assets/invite/heart-white.png" : "/assets/invite/p2-heart.webp"} alt={isEnv2 ? "White lace heart" : "Burgundy lace heart"} />
              <span className="inv-heart-text">{(s.heartText || "").trim()}</span>
            </div>
            <img className="inv-l-front" src={frontSrc} alt={isEnv2 ? "Open burgundy envelope pocket" : "Olive envelope front pocket"} />
            {isEnv2 ? envRecolorOverlay(s, "front", frontSrc) : envRecolorOverlay(s, "front")}
            {/* env2: the pocket's baked oval seal carries the same stacked
                initials as the sealed cover */}
            {isEnv2 && ((s.partnerA || "").trim() || (s.partnerB || "").trim()) ? (
              <span className="inv-seal-mono inv-seal-mono--front" aria-hidden="true">
                {(s.partnerA || "").trim() ? <span className="inv-seal-mono__a">{(s.partnerA || "").trim().charAt(0).toUpperCase()}</span> : null}
                {(s.partnerB || "").trim() ? <span className="inv-seal-mono__b">{(s.partnerB || "").trim().charAt(0).toUpperCase()}</span> : null}
              </span>
            ) : null}
            <img className="inv-l-flower" src={isEnv2 ? "/assets/invite/whiteflower.png" : "/assets/invite/p2-flowers.png"} alt="Floral spray of calla lilies, anthurium, orchids and amaranthus" />
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
// env2's .inv-l-video window: 42.5% x 57.5% of the square white-frame canvas.
const ENV2_FRAME_BOX_ASPECT = 42.5 / 57.5;
function FrameMedia({ s }) {
  const src = mediaUrl(s.frameImage) || "/assets/invite/frame-video.gif";
  const isEnv2 = s.theme === "envelope2";
  const [nat, setNat] = React.useState(null);
  if (!/\.(mp4|webm|mov|m4v)(\?|$)/i.test(src)) return <img src={src} alt="" />;
  // env2: render the crop the way the modal previews it — the element at the
  // video's true cover size, positioned + clamped (cropBoxStyle). The olive
  // translate path stays byte-identical for existing clients.
  const style = isEnv2
    ? (nat ? cropBoxStyle(s.frameImageCrop, nat.w / nat.h, ENV2_FRAME_BOX_ASPECT) : undefined)
    : cropTransform(s.frameImageCrop);
  return <video src={src} muted loop autoPlay playsInline style={style}
    onLoadedMetadata={isEnv2 ? ((e) => setNat({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })) : undefined} />;
}

export function EnvelopeInvite() {
  const { settings } = useStore();
  const s = settings;
  const [open, setOpen] = React.useState(false);

  return (
    <div className={"inv-stage" + (open ? " is-open" : "")} style={egTintVars(s)}>
      {/* Sealed envelope */}
      <div className={"inv-page" + (open ? "" : " is-active")}>
        <div className="inv-sealed-wrap" style={{ opacity: artReady ? 1 : 0, transition: "opacity .45s ease" }}>
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
  const { settings, story, schedule: scheduleRaw, entourage, attire, playlist, venues, detailCards, faq } = useStore();
  const heroTextLight = useHeroTextLight(settings);
  // Per-section home header overrides (Home → each folder → "Section header").
  // Blank/absent falls back to the stock copy, so new clients look unchanged.
  const hh = (k, defEyebrow, defTitle) => {
    const h = (settings.homeHeads || {})[k] || {};
    return { e: (h.eyebrow || "").trim() || defEyebrow, t: (h.title || "").trim() || defTitle };
  };
  // Guard against a non-array truthy schedule in tenant content (bad import /
  // manual DB edit): clientToState only falls back to seeds on falsiness, so an
  // object/string would reach .slice/.length below and white-screen the home.
  // Show-to-Home emulator: inside the admin preview iframe (__previewSamples)
  // an EMPTY module falls back to sample content so the layout always shows.
  // Never active on a real guest view.
  const sampleMode = settings.__previewSamples === true;
  const scheduleReal = Array.isArray(scheduleRaw) ? scheduleRaw : [];
  const schedule = sampleMode && !scheduleReal.length ? PREVIEW_SAMPLES.schedule : scheduleReal;
  const cardsReal = (detailCards || []).filter((c) => (c.title || "").trim() || (c.body || "").trim());
  const cardsShown = sampleMode && !cardsReal.length ? PREVIEW_SAMPLES.detailCards : cardsReal;
  const faqReal = (Array.isArray(faq) ? faq : []).filter((x) => x.home !== false);
  const faqShown = sampleMode && !faqReal.length ? PREVIEW_SAMPLES.faq : faqReal;
  const playlistShown = sampleMode && !(playlist || []).length ? PREVIEW_SAMPLES.playlist : playlist;
  const entourageShown = sampleMode && !(entourage || []).filter((g) => g && (g.people || []).length).length ? PREVIEW_SAMPLES.entourage : entourage;
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
    if (q) return [{ id: "legacy", mapQuery: q, mapLat: s.mapLat, mapLng: s.mapLng, address: s.venueAddress || s.venueName, cards: [] }];
    if (sampleMode) return [{ id: "sample", mapQuery: PREVIEW_SAMPLES.venue.mapQuery, address: PREVIEW_SAMPLES.venue.address, name: PREVIEW_SAMPLES.venue.name, cards: [] }];
    return [];
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
      {isEnvelopeTheme(s.theme) ? (
        <EnvelopeHero />
      ) : (
      <header className={"hero" + (heroTextLight ? " hero--on-photo" : "")}>
        <HeroBg />
        <div className="hero__inner">
          <div className="eyebrow hero__eyebrow eyebrow--solo">{s.tagline}</div>
          {/* Solo title (birthday: no partner B) gets a smaller clamp + balanced
              wrapping — couple-name sizing overflows on long titles. */}
          <h1 className={"hero__names" + (s.partnerB ? "" : " hero__names--solo")}>
            {s.partnerA}{s.partnerB ? <><span className="amp">&amp;</span>{s.partnerB}</> : null}
          </h1>
          {s.weddingDateLabel && <div className="hero__date">{s.weddingDateLabel}</div>}
          {s.showCountdown !== false && <Countdown targetIso={s.weddingDate} />}
          <p className="hero__welcome">{s.welcome}</p>
        </div>
        <div className="hero__scroll">Scroll</div>
      </header>
      )}

      {/* COUNTDOWN (envelope theme — the hero is replaced by the envelope) */}
      {isEnvelopeTheme(s.theme) && (
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
      {!isEnvelopeTheme(s.theme) && (
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
      {featureVisible(s, "venue") && s.showMap !== false && homeMaps.length > 0 && (
        <section className="block" id="home-map">
          <div className="container">
            <SectionHead center eyebrow={hh("maps", "The Venue", "Where we'll celebrate").e} title={hh("maps", "The Venue", "Where we'll celebrate").t} />
            {homeMaps.length > 1
              ? <HomeMapsCarousel maps={homeMaps} />
              : <HomeMapBlock m={homeMaps[0]} />}
          </div>
        </section>
      )}

      {/* SCHEDULE PREVIEW — hidden when the timeline toggle is off or the
          Schedule module is disabled (matches nav + /schedule route). */}
      {s.showTimeline !== false && featureVisible(s, "schedule") && (
      <section className="block block--tint" id="home-schedule">
        <div className="container">
          <SectionHead center eyebrow={hh("schedule", "The Day", "A glimpse of the schedule").e} title={hh("schedule", "The Day", "A glimpse of the schedule").t} />
          <ScheduleView items={s.homeTimelineLayout === "horizontal" ? schedule : schedule.slice(0, 3)} style={s.homeTimelineLayout === "horizontal" ? "horizontal" : "alt"} />
          {s.homeTimelineLayout !== "horizontal" && schedule.length > 0 && (
            <div style={{ textAlign: "center", marginTop: 20 }}>
              <Button variant="ghost" onClick={() => go("schedule")}>See the full timeline {Icon.arrow({})}</Button>
            </div>
          )}
        </div>
      </section>
      )}

      {/* DETAILS PREVIEW — opt-in (Home → Details), right after the schedule
          glimpse. Cards come from the Details tab; layout = vertical stack or a
          horizontally scrolling row. Hidden when the Details module is off. */}
      {s.showHomeDetails === true && featureVisible(s, "details") && cardsShown.length > 0 && (
        <section className="block" id="home-details">
          <div className="container">
            <SectionHead center eyebrow={hh("details", sectionLabel("details", s.moduleLabels, "Details"), "").e} title={hh("details", "", "The details").t} />
            {s.homeDetailsLayout === "horizontal"
              ? <HomeDetailsCarousel cards={cardsShown} />
              : (
                <div className="home-details-stack">
                  {cardsShown.map((c, i) => (
                    <article className="home-dcard" key={i}>
                      <span className="home-dcard__no" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                      <div className="home-dcard__eyebrow">{(Icon[c.icon] || Icon.rings)({})}<i className="home-dcard__tick" aria-hidden="true" /></div>
                      <h3 className="home-dcard__title">{c.title}</h3>
                      <p className="home-dcard__body">{c.body}</p>
                    </article>
                  ))}
                </div>
              )}
            <div style={{ textAlign: "center", marginTop: 22 }}>
              <Button variant="ghost" onClick={() => go("details")}>See all details {Icon.arrow({})}</Button>
            </div>
          </div>
        </section>
      )}

      {/* FAQ PREVIEW — opt-in (Home → FAQ), after the details preview. Questions
          come from the Details tab; hidden when the Details module is off. */}
      {s.showHomeFaq === true && featureVisible(s, "details") && faqShown.length > 0 && (
        <section className="block block--tint" id="home-faq">
          <div className="container container--narrow">
            <SectionHead center eyebrow={hh("faq", "Good to know", "Frequently asked").e} title={hh("faq", "Good to know", "Frequently asked").t} />
            <HomeFaqList faq={faqShown} />
          </div>
        </section>
      )}

      {/* ATTIRE GUIDE — right after the schedule glimpse */}
      {s.showAttire !== false && (s.accessV2 !== true || featureVisible(s, "details")) && <AttireView groups={attire} />}

      {/* MUSIC — vinyl player now sits right after the schedule glimpse */}
      {s.showMusic !== false && (s.accessV2 !== true || featureVisible(s, "music")) && <VinylPlayer tracks={playlistShown} />}

      {/* ENTOURAGE — groups of people (Groomsmen, Bridesmaids, …) */}
      {s.showEntourage !== false && (s.accessV2 !== true || featureVisible(s, "entourage")) && <EntourageView groups={entourageShown} />}
    </div>
  );
}

// Public attire-guide section: each group has an example image and a colour
// palette. Renders nothing when there are no groups with any content.
// Home FAQ accordion — same faq-item markup as the Details page, own open state.
export function HomeFaqList({ faq }) {
  const [open, setOpen] = useState(-1);
  return (
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
  );
}

export function AttireView({ groups }) {
  const { settings } = useStore();
  const h = (settings.homeHeads || {}).attire || {};
  const list = (groups || []).filter((g) => g && ((g.name || "").trim() || g.image || (g.desc || "").trim() || (g.palette || []).length));
  if (!list.length) return null;
  return (
    <section className="block" id="home-attire">
      <div className="container">
        <SectionHead center eyebrow={(h.eyebrow || "").trim() || "What to wear"} title={(h.title || "").trim() || "Attire guide"} />
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
  const { settings } = useStore();
  const h = (settings.homeHeads || {}).entourage || {};
  const list = (groups || []).filter((g) => g && (g.people || []).length);
  if (!list.length) return null;
  return (
    <section className="block" id="home-entourage">
      <div className="container">
        <SectionHead center eyebrow={(h.eyebrow || "").trim() || "With Us"} title={(h.title || "").trim() || "The Entourage"} />
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
  const { story, settings } = useStore();
  return (
    <div className="fade-up">
      <PageHero eyebrow={sectionLabel("story", settings.moduleLabels, "Our Story")} title="How we got here" lead="Every love story is beautiful, but this one is ours." />
      <section className="block" style={{ paddingTop: 30 }}>
        <div className="container" style={{ maxWidth: 920 }}>
          <div className="story-list">
            {(Array.isArray(story) ? story : []).map((row, i) => (
              <div className="story-row" key={i}>
                <span className="story-dot" aria-hidden="true" />
                <div className="story-row__media"><StoryImg row={row} /></div>
                <div>
                  <div className="story-row__year">{row.year}</div>
                  <h3 className="story-row__title">{row.title}</h3>
                  <p className="story-row__desc">{row.desc}</p>
                </div>
              </div>
            ))}
          </div>
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
      <PageHero eyebrow={sectionLabel("details", s.moduleLabels, "Wedding Details")} title="Everything you need to know" lead={s.weddingDateLabel ? `We can't wait to celebrate with you on ${s.weddingDateLabel}.` : "We can't wait to celebrate with you."} />
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

// Shared horizontal-rail mechanics: track scroll PROGRESS so dot i maps to
// scroll fraction i/(n-1) — dots light in order and the chevrons disable at the
// ends even when the rail only overflows a little. Used by the schedule's
// horizontal timeline AND the home Details carousel.
function useRailNav(n) {
  const ref = useRef(null);
  const [active, setActive] = useState(0);
  const [overflow, setOverflow] = useState(false);
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
  return { ref, active, overflow, toItem };
}

// Frosted nav pill (chevrons + dot indicators) shown only when a rail overflows.
function RailNav({ n, active, toItem, itemNoun = "item" }) {
  return (
    <div className="tl-nav">
      <button type="button" className="tl-nav__arrow" onClick={() => toItem(active - 1)} disabled={active === 0} aria-label="Previous">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <div className="tl-nav__dots">
        {Array.from({ length: n }, (_, i) => (
          <button key={i} type="button" className={"tl-nav__dot" + (i === active ? " is-active" : "")} onClick={() => toItem(i)} aria-label={`Go to ${itemNoun} ${i + 1}`} aria-current={i === active} />
        ))}
      </div>
      <button type="button" className="tl-nav__arrow" onClick={() => toItem(active + 1)} disabled={active === n - 1} aria-label="Next">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
      </button>
    </div>
  );
}

// Home Details, horizontal layout: same carousel mechanics as the horizontal
// timeline (scroll rail + frosted chevron/dot pill). On desktop the row becomes
// a centered wrap-grid (CSS) — no overflow, so the pill hides itself there.
export function HomeDetailsCarousel({ cards }) {
  const { ref, active, overflow, toItem } = useRailNav(cards.length);
  return (
    <div className="home-details-hwrap">
      <div className="home-details-row" ref={ref}>
        {cards.map((c, i) => (
          <article className={"home-dcard" + (overflow && i === active ? " is-active" : "")} key={i}>
            <span className="home-dcard__no" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
            <div className="home-dcard__eyebrow">{(Icon[c.icon] || Icon.rings)({})}<i className="home-dcard__tick" aria-hidden="true" /></div>
            <h3 className="home-dcard__title">{c.title}</h3>
            <p className="home-dcard__body">{c.body}</p>
          </article>
        ))}
      </div>
      {overflow && <RailNav n={cards.length} active={active} toItem={toItem} itemNoun="detail" />}
    </div>
  );
}

// Horizontal timeline: a scrollable rail with desktop nav arrows that appear
// only when there's more to scroll in that direction (scrollbar hidden on
// desktop; mobile keeps native touch scroll).
function HorizontalTimeline({ items }) {
  const { ref, active, overflow, toItem } = useRailNav(items.length);
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
      {/* Nav pill (adapted from the "tilt stack carousel" pen). Shown only when the rail overflows. */}
      {overflow && <RailNav n={items.length} active={active} toItem={toItem} itemNoun="event" />}
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
      <PageHero eyebrow={sectionLabel("schedule", settings.moduleLabels, "The Day Of")} title="Wedding day schedule" lead="Here's how the celebration will unfold, hour by hour." />
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
      <PageHero eyebrow={sectionLabel("venue", s.moduleLabels, "Venue & Map")} title={heroTitle} lead={heroLead} />
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

