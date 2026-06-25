import React from "react";
import { go } from "@/lib/nav.js";
import { useStore } from "@/lib/store.jsx";
import { egTintGradient } from "@/themes";
import { Button, Countdown, FloatingDecor, Icon, Placeholder, SectionHead, mapDirUrl, mapEmbedUrl } from "@/ui/components.jsx";
const { useState, useEffect, useRef, useMemo, useCallback, useReducer } = React;

// ============================================================================
// pages/PublicPages.jsx — Home + content pages (Details, Story, Schedule, Venue, FAQ)
// ============================================================================

export function HeroBg() {
  const { settings } = useStore();
  if (settings.heroImage) {
    return (
      <div className="hero__media">
        <img src={settings.heroImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
    ? <img src={row.img} alt={row.title} style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: "var(--radius)", display: "block" }} />
    : <Placeholder label="story photo" ratio="4 / 3" />;
}

// Olive-green tint strength → CSS vars for the envelope background overlay.
export function egTintVars(s) {
  const on = s.envTintOn !== false;
  const open = on ? Math.max(0, Math.min(100, s.envTint == null ? 55 : s.envTint)) / 100 : 0;
  const sealed = on ? Math.min(1, open + 0.35) : 0;
  return { "--eg-tint": open, "--eg-tint-sealed": sealed, "--eg-tint-grad": egTintGradient(s.envTintColor || "olive") };
}

export function EnvelopeHero() {
  const { settings } = useStore();
  const s = settings;
  const [open, setOpen] = React.useState(false);
  const heartDate = React.useMemo(() => {
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(s.weddingDate || "");
    return m ? `${m[3]}.${m[2]}.${m[1]}` : s.weddingDateLabel;
  }, [s.weddingDate, s.weddingDateLabel]);

  // first screen = envelope only: lock scroll AND hide the nav until it's opened
  const [ready, setReady] = React.useState(false);
  const artRef = React.useRef(null);
  const triggerReady = React.useCallback(() => setReady(true), []);
  React.useEffect(() => {
    const img = artRef.current;
    if (img && img.complete && img.naturalWidth) triggerReady();
  }, [triggerReady]);
  // Type-on animation removed for now — text shows statically (see CSS).
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
      const y = window.scrollY || document.documentElement.scrollTop || 0;
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
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
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
    const top = next ? next.offsetTop - 60 : window.innerHeight;
    window.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <header className={"eg-hero" + (open ? " is-open" : "")} id="env-hero" style={egTintVars(s)}>
      <div className="eg-bg" style={s.envBgImage ? { backgroundImage: `url(${s.envBgImage})` } : undefined} />
      <div className="eg-stage">
        {/* Sealed envelope */}
        <div className={"eg-page" + (open ? "" : " is-active")}>
          <div className={"inv-sealed-wrap eg-sealed" + (ready ? " is-ready" : "")}>
            <img ref={artRef} className="inv-sealed-art" src="/assets/invite/env-closed.webp" alt="Sealed olive envelope with lace trim and wax seal" onLoad={triggerReady} />
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
                <img src={s.frameImage || "/assets/invite/frame-video.gif"} alt="" />
              </div>
              <img className="inv-frame-img" src="/assets/invite/p2-frame.png" alt="Cream oval frame with embossed peony" />
            </div>
            <div className="inv-l-heart">
              <img src="/assets/invite/p2-heart.webp" alt="Burgundy lace heart" />
              <span className="inv-heart-text">{heartDate}</span>
            </div>
            <img className="inv-l-front" src="/assets/invite/p2-envelope-front.png" alt="Olive envelope front pocket" />
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

export function EnvelopeInvite() {
  const { settings } = useStore();
  const s = settings;
  const [open, setOpen] = React.useState(false);
  const heartDate = React.useMemo(() => {
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(s.weddingDate || "");
    return m ? `${m[3]}.${m[2]}.${m[1]}` : s.weddingDateLabel;
  }, [s.weddingDate, s.weddingDateLabel]);

  return (
    <div className={"inv-stage" + (open ? " is-open" : "")}>
      {/* Sealed envelope */}
      <div className={"inv-page" + (open ? "" : " is-active")}>
        <div className="inv-sealed-wrap">
          <img className="inv-sealed-art" src="/assets/invite/env-closed.webp" alt="Sealed olive envelope with lace trim and wax seal" />
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
              <img src={s.frameImage || "/assets/invite/frame-video.gif"} alt="" />
            </div>
            <img className="inv-frame-img" src="/assets/invite/p2-frame.png" alt="Cream oval frame with embossed peony" />
          </div>
          <div className="inv-l-heart">
            <img src="/assets/invite/p2-heart.webp" alt="Burgundy lace heart" />
            <span className="inv-heart-text">{heartDate}</span>
          </div>
          <img className="inv-l-front" src="/assets/invite/p2-envelope-front.png" alt="Olive envelope front pocket" />
          <img className="inv-l-flower" src="/assets/invite/p2-flowers.png" alt="Floral spray of calla lilies, anthurium, orchids and amaranthus" />
        </div>
      </div>
    </div>
  );
}

export function Home() {
  const { settings, story, schedule } = useStore();
  const s = settings;

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
          <div className="hero__date">{s.weddingDateLabel}</div>
          <Countdown targetIso={s.weddingDate} />
          <p className="hero__welcome">{s.welcome}</p>
        </div>
        <div className="hero__scroll">Scroll</div>
      </header>
      )}

      {/* COUNTDOWN (envelope theme — the hero is replaced by the envelope) */}
      {s.theme === "envelope" && (
        <section className="block eg-celebrate" id="home-countdown" style={{ textAlign: "center", paddingBottom: 96 }}>
          <FloatingDecor on style="petals" />
          <div className="container container--narrow">
            <div className="eyebrow eyebrow--solo" style={{ justifyContent: "center" }}>{s.tagline}</div>
            <h2 style={{ fontSize: "clamp(28px,4.6vw,44px)", margin: "16px 0 14px", color: "var(--ink)" }}>
              You're invited to celebrate love
            </h2>
            <p style={{ color: "var(--ink-soft)", fontSize: 19, margin: "0 0 10px" }}>
              We can't wait to celebrate the start of our forever, surrounded by the people
              we love most. Thank you for being part of our story — here's a little about
              how we got here, and what our wedding day will hold.
            </p>
            <div style={{ color: "var(--ink-soft)", letterSpacing: ".12em", textTransform: "uppercase", fontSize: 14, margin: "18px 0 26px" }}>{s.weddingDateLabel}</div>
            <Countdown targetIso={s.weddingDate} light />
            <div style={{ marginTop: 30 }}>
              <Button variant="primary" size="lg" onClick={() => go("rsvp")}>{Icon.check({})} Respond now</Button>
            </div>
          </div>
        </section>
      )}

      {/* RSVP CTA — right after the countdown/timer (non-envelope themes) */}
      {s.theme !== "envelope" && (
        <section className="block" id="home-rsvp">
          <div className="container container--narrow" style={{ textAlign: "center" }}>
            <div className="divider-mark">{Icon.heart({})}</div>
            <div className="card card--pad-lg" style={{ marginTop: 30 }}>
              <div className="eyebrow eyebrow--solo" style={{ justifyContent: "center" }}>RSVP</div>
              <h2 style={{ fontSize: "clamp(28px,4.6vw,44px)", margin: "16px 0 12px" }}>Will you be there?</h2>
              <p style={{ color: "var(--ink-soft)", fontSize: 18, margin: "0 0 26px" }}>Kindly respond by {s.rsvpDeadline}.</p>
              <Button variant="primary" size="lg" onClick={() => go("rsvp")}>{Icon.check({})} Respond now</Button>
            </div>
          </div>
        </section>
      )}

      {/* WELCOME */}
      {s.theme !== "envelope" && (
      <section className="block">
        <div className="container container--narrow" style={{ textAlign: "center" }}>
          <div className="divider-mark">{Icon.rings({})}</div>
          <h2 style={{ fontSize: "clamp(28px,4.6vw,44px)", margin: "26px 0 18px" }}>
            You're invited to celebrate love
          </h2>
          <p style={{ color: "var(--ink-soft)", fontSize: 19 }}>
            We can't wait to celebrate the start of our forever, surrounded by the people
            we love most. Thank you for being part of our story — here's a little about
            how we got here, and what our wedding day will hold.
          </p>
        </div>
      </section>
      )}

      {/* SCHEDULE PREVIEW */}
      <section className="block block--tint" id="home-schedule">
        <div className="container">
          <SectionHead center eyebrow="The Day" title="A glimpse of the schedule" />
          <ScheduleView items={schedule} style="alt" />
          <div style={{ textAlign: "center", marginTop: 20 }}>
            <Button variant="ghost" onClick={() => go("schedule")}>See the full timeline {Icon.arrow({})}</Button>
          </div>
        </div>
      </section>
    </div>
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
          {story.map((row, i) => (
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
  const { settings, faq } = useStore();
  const s = settings;
  const [open, setOpen] = useState(0);
  return (
    <div className="fade-up">
      <PageHero eyebrow="Wedding Details" title="Everything you need to know" lead={`We can't wait to celebrate with you on ${s.weddingDateLabel}.`} />
      <section className="block" style={{ paddingTop: 20 }}>
        <div className="container">
          <div className="info-grid info-grid--2">
            <div className="card card--pad-lg info-card">
              <div className="info-card__icon">{Icon.rings({})}</div>
              <h3>The Ceremony</h3>
              <p className="lead-line">{s.ceremonyTime} &middot; {s.venueName}</p>
              <p>{s.venueAddress}. Please be seated 10 minutes before we begin. The ceremony will be unplugged — be fully present with us.</p>
            </div>
            <div className="card card--pad-lg info-card">
              <div className="info-card__icon">{Icon.heart({})}</div>
              <h3>The Reception</h3>
              <p className="lead-line">{s.receptionTime} onward</p>
              <p>Cocktails, dinner, and dancing follow immediately at the same venue. Expect to celebrate late into the night.</p>
            </div>
            <div className="card card--pad-lg info-card">
              <div className="info-card__icon">{Icon.user({})}</div>
              <h3>Dress Code</h3>
              <p>{s.dressCode}</p>
            </div>
            <div className="card card--pad-lg info-card">
              <div className="info-card__icon">{Icon.pin({})}</div>
              <h3>Getting There</h3>
              <p>Complimentary valet and self-parking at the rear entrance. Rideshare drop-off is at the front gate.</p>
              <Button variant="ghost" size="sm" style={{ marginTop: 14 }} onClick={() => go("venue")}>Venue & directions {Icon.arrow({})}</Button>
            </div>
          </div>
        </div>
      </section>

      <section className="block block--tint">
        <div className="container container--narrow">
          <SectionHead center eyebrow="Good to know" title="Frequently asked" />
          <div>
            {faq.map((item, i) => (
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

export function ScheduleView({ items, style }) {
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
  const { settings } = useStore();
  const s = settings;
  const query = (s.mapQuery && s.mapQuery.trim()) || s.venueAddress;
  const mapUrl = mapEmbedUrl(query, s.mapLat, s.mapLng);
  const dirUrl = mapDirUrl(query, s.mapLat, s.mapLng);
  return (
    <div className="fade-up">
      <PageHero eyebrow="Venue & Map" title={s.venueName} lead={s.venueAddress} />
      <section className="block" style={{ paddingTop: 24 }}>
        <div className="container">
          <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 30 }}>
            <iframe title="Venue map" src={mapUrl} style={{ width: "100%", height: 420, border: 0, display: "block" }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 44 }}>
            <Button variant="primary" size="lg" onClick={() => window.open(dirUrl, "_blank")}>{Icon.pin({})} Get Directions</Button>
          </div>
          <div className="info-grid info-grid--3">
            {[
              { t: "Parking", d: "Complimentary valet and self-parking available at the rear entrance from 2:00 PM." },
              { t: "Arrival", d: "Please arrive by 2:30 PM. The ceremony begins promptly at " + s.ceremonyTime + "." },
              { t: "Weather", d: "The ceremony is outdoors \u2014 bring a light layer for the evening breeze." },
            ].map((n, i) => (
              <div className="card info-card" key={i}>
                <h3>{n.t}</h3>
                <p>{n.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

