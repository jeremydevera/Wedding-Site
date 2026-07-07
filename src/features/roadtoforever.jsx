import React from "react";
import { useStore } from "@/lib/store.jsx";
import { mediaUrl } from "@/lib/media.js";

// ============================================================================
// roadtoforever.jsx — bespoke single-page wedding template (theme
// "roadtoforever"). Rendered full-screen (no site nav) when the client's theme
// is roadtoforever. Content is wired to the existing admin tabs:
//   Home     -> heroEyebrow + partnerA/partnerB
//   Our Story-> story[] (swipeable: paragraph + instax photo; palm stays put)
//   Schedule -> schedule[] + weddingDateLabel
//   Details  -> detailCards[] (About tiles) + faq[] (More Information)
// Design-only for now (hidden from the wizard/demo dropdown).
// ============================================================================

const A = "/themes/roadtoforever/";
const { useState, useEffect, useRef, useCallback } = React;

// One shared IntersectionObserver-based reveal for the whole page.
function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll(".rtf-rv"));
    if (!("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((ents) => {
      ents.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}

// Swipeable Love Story — paragraph + instax photo cycle; palm is OUTSIDE this,
// so it never moves. Touch-drag on mobile + arrows/dots on desktop.
function LoveStory({ story }) {
  const items = (Array.isArray(story) && story.length ? story : [{ title: "Our Love Story", desc: "", img: "" }]);
  const [i, setI] = useState(0);
  const n = items.length;
  const go = useCallback((d) => setI((x) => (x + d + n) % n), [n]);
  const startX = useRef(null);
  const onDown = (e) => { startX.current = (e.touches ? e.touches[0].clientX : e.clientX); };
  const onUp = (e) => {
    if (startX.current == null) return;
    const end = (e.changedTouches ? e.changedTouches[0].clientX : e.clientX);
    const dx = end - startX.current; startX.current = null;
    if (Math.abs(dx) > 45) go(dx < 0 ? 1 : -1);
  };
  const it = items[i];
  const photo = it.img ? mediaUrl(it.img) : A + (i % 2 ? "instax2.jpg" : "instax1.jpg");
  return (
    <section className="rtf-love">
      <img className="rtf-palm" src={A + "palm.png"} alt="" aria-hidden="true" />
      <div className="rtf-wrap">
        <h2 className="rtf-h rtf-rv">Our Love Story</h2>
        <div className="rtf-love-swipe rtf-rv" onTouchStart={onDown} onTouchEnd={onUp} onMouseDown={onDown} onMouseUp={onUp}>
          <figure className="rtf-instax">
            <img src={photo} alt={it.title || "Our story"} draggable="false" />
          </figure>
          <div className="rtf-love-text">
            {it.title ? <h3>{it.title}</h3> : null}
            <p>{it.desc || "Write a paragraph that tells your story as a couple — how you met, your journey together, and what makes your relationship unique."}</p>
          </div>
        </div>
        {n > 1 && (
          <div className="rtf-swipe-ctrl">
            <button type="button" aria-label="Previous" onClick={() => go(-1)}>&#8592;</button>
            <div className="rtf-dots">{items.map((_, k) => <span key={k} className={k === i ? "on" : ""} onClick={() => setI(k)} />)}</div>
            <button type="button" aria-label="Next" onClick={() => go(1)}>&#8594;</button>
          </div>
        )}
      </div>
    </section>
  );
}

const ABOUT_FALLBACK = [
  { title: "Getting There", body: "Share details about your ceremony, reception, or any other program-related thing here." },
  { title: "What to Wear", body: "Share details about your ceremony, reception, or any other program-related thing here." },
  { title: "Parking Options", body: "Share details about your ceremony, reception, or any other program-related thing here." },
];

export function RoadToForeverSite() {
  const { settings: s, story, schedule, faq, detailCards } = useStore();
  useReveal();

  const about = (Array.isArray(detailCards) && detailCards.length
    ? detailCards.map((c) => ({ title: c.title, body: c.body })) : ABOUT_FALLBACK).slice(0, 3);
  const events = Array.isArray(schedule) ? schedule.filter((e) => (e.title || "").trim()) : [];
  const faqs = Array.isArray(faq) ? faq.filter((f) => (f.q || "").trim()) : [];
  const heroImg = s.heroImage ? mediaUrl(s.heroImage) : A + "hero.jpg";

  return (
    <div className="rtf">
      <style>{RTF_CSS}</style>

      {/* HERO */}
      <header className="rtf-hero" style={{ backgroundImage: `linear-gradient(rgba(66,5,8,.42),rgba(66,5,8,.52)), url('${heroImg}')` }}>
        <div className="rtf-hero-in rtf-rv in">
          {s.heroEyebrow ? <p className="rtf-eyebrow">{s.heroEyebrow}</p> : null}
          <h1 className="rtf-names">{s.partnerA || "Partner A"} <span>&amp;</span> {s.partnerB || "Partner B"}</h1>
        </div>
      </header>

      {/* OUR LOVE STORY (swipeable) */}
      <LoveStory story={story} />

      {/* ABOUT THE WEDDING */}
      <section className="rtf-about">
        <div className="rtf-wrap">
          <h2 className="rtf-h rtf-rv">About the Wedding</h2>
          <p className="rtf-sub rtf-rv">Share details about your ceremony, reception, or anything else here.</p>
          <div className="rtf-tiles">
            {about.map((t, k) => (
              <article className="rtf-tile rtf-rv" key={k}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.1"><path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/><circle cx="12" cy="9" r="2.3"/></svg>
                <h3>{t.title || "Detail"}</h3>
                <p>{t.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* SCHEDULE OF EVENTS */}
      <section className="rtf-sched">
        <div className="rtf-wrap rtf-sched-grid">
          <img className="rtf-church rtf-rv" src={A + "church.png"} alt="" aria-hidden="true" />
          <div>
            <h2 className="rtf-h rtf-rv">Schedule of Events</h2>
            {s.weddingDateLabel ? <p className="rtf-date rtf-rv">{s.weddingDateLabel}</p> : null}
            <div className="rtf-rows">
              {events.map((e, k) => (
                <div className="rtf-row rtf-rv" key={k}>
                  <span className="rtf-t">{e.time}</span>
                  <span className="rtf-ev">{e.title}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* MORE INFORMATION */}
      {faqs.length > 0 && (
        <section className="rtf-info">
          <div className="rtf-wrap">
            <h2 className="rtf-h rtf-rv" style={{ color: "#f4ead4", textAlign: "center" }}>More Information</h2>
            <div className="rtf-faq">
              {faqs.map((f, k) => (
                <div className="rtf-rv" key={k}>
                  <h3>{f.q}</h3>
                  <p>{f.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CONTACT DETAILS */}
      <section className="rtf-contact">
        <div className="rtf-wrap">
          <img className="rtf-woman rtf-rv" src={A + "woman.png"} alt="" aria-hidden="true" />
          <div className="rtf-contact-body">
            <h2 className="rtf-h rtf-rv">Contact Details</h2>
            <div className="rtf-cards">
              {[s.partnerA || "Partner A", s.partnerB || "Partner B"].map((name, k) => (
                <div className="rtf-card rtf-rv" key={k}>
                  <div className="rtf-name">{name}</div>
                  <address>
                    {s.venueAddress || "123 Anywhere St. Any City ST 12345"}<br /><br />
                    Telephone: (123) 456-7890<br />Mobile: (123) 456-7890
                  </address>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <p className="rtf-foot">{s.heroEyebrow || "Road to Forever"} · {s.partnerA} &amp; {s.partnerB}</p>
    </div>
  );
}

const RTF_CSS = `
@font-face{font-family:'rtf-display';src:url('/themes/roadtoforever/fonts/f765c7954ae9dc36ed1db84285297996.woff') format('woff');font-weight:300 900;font-display:swap}
@font-face{font-family:'rtf-script';src:url('/themes/roadtoforever/fonts/003e82bf2f68067801da6a72d24cdf78.woff') format('woff');font-display:swap}
@font-face{font-family:'rtf-body';src:url('/themes/roadtoforever/fonts/341b81c278176b71907964872c948c77.woff') format('woff');font-weight:300 900;font-display:swap}
.rtf{font-family:'rtf-body','Jost',sans-serif;color:var(--ink,#3b1e14);background:#48100e;overflow-x:hidden}
.rtf *{box-sizing:border-box}
.rtf .rtf-wrap{max-width:1080px;margin:0 auto;padding:0 24px}
.rtf .rtf-h{font-family:'rtf-display',serif;font-weight:400;font-size:clamp(40px,6vw,66px);line-height:1.04;letter-spacing:normal}
.rtf .rtf-rv{opacity:0;transform:translateY(38px);transition:opacity .9s cubic-bezier(.22,.61,.36,1),transform 1s cubic-bezier(.22,.61,.36,1)}
.rtf .rtf-rv.in{opacity:1;transform:none}
@media(prefers-reduced-motion:reduce){.rtf .rtf-rv{opacity:1;transform:none;transition:none}}

/* HERO */
.rtf-hero{min-height:100svh;display:grid;place-items:center;text-align:center;color:#f4ead4;background-size:cover;background-position:center 30%;padding:40px 24px}
.rtf-eyebrow{font-family:'rtf-script',cursive;font-size:clamp(28px,5vw,54px);margin-bottom:-2px;color:#f6ecd8}
.rtf-names{font-family:'rtf-display',serif;font-weight:400;font-size:clamp(58px,13vw,162px);line-height:1;letter-spacing:normal}
.rtf-names span{font-style:normal;font-weight:400;padding:0 .05em}

/* LOVE STORY */
.rtf-love{position:relative;background:var(--accent,#b0472c);color:#f4ead4;padding:clamp(64px,9vw,110px) 0}
.rtf-palm{position:absolute;top:26px;left:min(6vw,70px);width:clamp(70px,9vw,120px);opacity:.9;pointer-events:none}
.rtf-love .rtf-h{color:#f6ecd8;text-align:center;margin-bottom:34px}
.rtf-love-swipe{display:grid;grid-template-columns:minmax(0,360px) 1fr;gap:clamp(28px,5vw,64px);align-items:center;touch-action:pan-y}
.rtf-instax{background:#f4ead4;padding:14px 14px 54px;box-shadow:0 18px 40px -18px rgba(0,0,0,.5);transform:rotate(-2deg)}
.rtf-instax img{width:100%;height:340px;object-fit:cover;display:block}
.rtf-love-text h3{font-family:'rtf-display',serif;font-style:italic;font-size:28px;margin-bottom:12px}
.rtf-love-text p{color:#f3e3d3;font-weight:300;max-width:46ch;font-size:17px}
.rtf-swipe-ctrl{display:flex;align-items:center;justify-content:center;gap:20px;margin-top:34px}
.rtf-swipe-ctrl button{background:none;border:1px solid rgba(246,236,216,.5);color:#f6ecd8;width:42px;height:42px;border-radius:50%;cursor:pointer;font-size:18px}
.rtf-swipe-ctrl button:hover{background:rgba(246,236,216,.14)}
.rtf-dots{display:flex;gap:9px}
.rtf-dots span{width:9px;height:9px;border-radius:50%;background:rgba(246,236,216,.4);cursor:pointer}
.rtf-dots span.on{background:#f6ecd8}

/* ABOUT */
.rtf-about{background:var(--bg,#f1e8d7);color:var(--ink,#3b1e14);padding:clamp(66px,9vw,116px) 0;text-align:center}
.rtf-about .rtf-h{margin-bottom:10px}
.rtf-about .rtf-sub{color:var(--ink-soft,#6a4a38);margin-bottom:clamp(36px,5vw,58px);font-weight:300}
.rtf-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(24px,4vw,52px)}
.rtf-tile svg{width:52px;height:52px;color:var(--accent,#b0472c);margin:0 auto 16px;display:block}
.rtf-tile h3{font-family:'rtf-display',serif;font-style:italic;font-weight:600;font-size:25px;margin-bottom:9px}
.rtf-tile p{color:var(--ink-soft,#6a4a38);font-size:15px;font-weight:300}

/* SCHEDULE */
.rtf-sched{background:var(--surface-2,#e9dcc4);color:var(--ink,#3b1e14);padding:clamp(66px,9vw,116px) 0}
.rtf-sched-grid{display:grid;grid-template-columns:.85fr 1.15fr;gap:clamp(28px,5vw,64px);align-items:center}
.rtf-church{width:100%;max-width:420px;display:block;justify-self:center}
.rtf-date{letter-spacing:.26em;text-transform:uppercase;font-size:13px;color:var(--muted,#8a6f57);margin:8px 0 28px}
.rtf-row{display:grid;grid-template-columns:auto 1fr;gap:20px;align-items:baseline;padding:15px 0;border-bottom:1px solid var(--line,#d8c6aa)}
.rtf-row:last-child{border-bottom:0}
.rtf-t{font-family:'rtf-display',serif;font-size:22px;white-space:nowrap}
.rtf-ev{font-family:'rtf-display',serif;font-style:italic;font-size:22px;text-align:right;color:var(--accent,#b0472c)}

/* MORE INFO */
.rtf-info{background:#380c0a;color:#f4ead4;padding:clamp(66px,9vw,116px) 0}
.rtf-info .rtf-h{margin-bottom:clamp(34px,5vw,54px)}
.rtf-faq{max-width:720px;margin:0 auto;text-align:center;display:flex;flex-direction:column;gap:30px}
.rtf-faq h3{font-family:'rtf-display',serif;font-style:italic;font-size:26px;color:#f6ecd8;margin-bottom:8px}
.rtf-faq p{color:#e7cdbf;font-weight:300;max-width:56ch;margin:0 auto}

/* CONTACT */
.rtf-contact{background:#a28558;color:#3b1e14;padding:clamp(66px,9vw,116px) 0}
.rtf-contact .rtf-wrap{display:grid;grid-template-columns:.7fr 1.3fr;gap:clamp(24px,4vw,56px);align-items:center}
.rtf-woman{width:100%;max-width:300px;display:block;opacity:.92}
.rtf-contact .rtf-h{color:#4a120e;margin-bottom:30px}
.rtf-cards{display:grid;grid-template-columns:1fr 1fr;gap:clamp(24px,4vw,48px)}
.rtf-card{border-top:1px solid rgba(74,18,14,.3);padding-top:20px}
.rtf-name{font-family:'rtf-display',serif;font-style:italic;font-size:27px;color:#4a120e;margin-bottom:12px}
.rtf-card address{font-style:normal;color:#5a3a2a;font-weight:300;font-size:14.5px;line-height:1.85}
.rtf-foot{text-align:center;color:#d9c4a8;font-size:11px;letter-spacing:.2em;text-transform:uppercase;padding:30px 0;background:#380c0a}

@media(max-width:820px){
  .rtf-love-swipe{grid-template-columns:1fr;max-width:420px;margin:0 auto}
  .rtf-instax{transform:none;margin:0 auto;max-width:340px}
  .rtf-love-text{text-align:center}
  .rtf-love-text p{margin:0 auto}
  .rtf-tiles{grid-template-columns:1fr;max-width:420px;margin:0 auto}
  .rtf-sched-grid{grid-template-columns:1fr;text-align:center}
  .rtf-church{max-width:300px}
  .rtf-ev{text-align:right}
  .rtf-contact .rtf-wrap{grid-template-columns:1fr;text-align:center}
  .rtf-woman{max-width:220px;margin:0 auto}
  .rtf-cards{grid-template-columns:1fr;max-width:360px;margin:0 auto}
  .rtf-palm{width:64px;left:18px;top:16px}
}
`;
