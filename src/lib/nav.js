// nav.js — history (path) router helper. Routes are real paths (/home, /admin, …)
// so URLs have no "#". Preserves the query string (e.g. ?client= on localhost/hub).
import { scrollToTop } from "@/lib/scroll.js";

export function go(route) {
  const path = "/" + String(route || "home").replace(/^\/+/, "");
  const target = path + window.location.search;
  if (window.location.pathname + window.location.search !== target) {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new Event("nav"));
    scrollToTop({ top: 0 }); // reset the shell scroller (mobile) or window (desktop)
  }
}
