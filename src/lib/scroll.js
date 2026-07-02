// scroll.js — the public site scrolls inside #site-scroll on mobile (the
// pinned-header flex shell that stops the nav vanishing on iOS Safari) and
// inside the document on desktop. These helpers act on whichever is actually
// scrolling, so callers (route changes, "scroll to top" after a submit, the
// envelope hero) don't need to know which layout is live.

// The shell scroll box, but only when it's the real scroller (mobile). On
// desktop the element exists but the document scrolls, so this returns null.
export function siteScrollEl() {
  const el = document.getElementById("site-scroll");
  return el && el.scrollHeight > el.clientHeight + 4 ? el : null;
}

// Current scroll offset from the top of whichever scroller is live.
export function scrollOffset() {
  const el = siteScrollEl();
  if (el) return el.scrollTop;
  return window.scrollY || document.documentElement.scrollTop || 0;
}

// Scroll to the top. Hits both the shell box and the window — whichever isn't
// the live scroller is a harmless no-op, so this is layout-agnostic.
export function scrollToTop(opts) {
  const o = opts || { top: 0 };
  const el = document.getElementById("site-scroll");
  if (el) { try { el.scrollTo(o); } catch (_) { el.scrollTop = 0; } }
  try { window.scrollTo(o); } catch (_) { /* older browsers */ }
}

// Attach a scroll listener to the live scroller (shell box on mobile, else
// window). Returns an unsubscribe fn. Falls back to listening on both so it
// keeps working if the layout flips (resize / orientation).
export function onSiteScroll(handler, opts) {
  const el = document.getElementById("site-scroll");
  const o = opts || { passive: true };
  if (el) el.addEventListener("scroll", handler, o);
  window.addEventListener("scroll", handler, o);
  return () => {
    if (el) el.removeEventListener("scroll", handler, o);
    window.removeEventListener("scroll", handler, o);
  };
}
