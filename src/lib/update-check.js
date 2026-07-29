// In-app update detector — deploys must reach users WITHOUT anyone clearing
// caches (owner requirement). The served index.html is no-cache (_headers),
// but long-lived tabs and browsers that cached index.html BEFORE that rule
// shipped keep running old code forever. This closes the loop from inside the
// app: poll the server's index.html, compare its bundle hash to the one this
// tab is running, and refresh when they differ.
//
// - Public guest pages: reload automatically (once per new hash — a marker in
//   sessionStorage prevents any possibility of a reload loop).
// - Admin pages: never yank the page away (unsaved edits) — show a fixed
//   "new version" bar with a Refresh button instead.
// - Sessions live in IndexedDB + the shared cookie, so a reload never logs
//   anyone out.
// Framework-free on purpose: one file, runs the same on public + admin.

const POLL_MS = 5 * 60 * 1000; // every 5 minutes + every return to the tab

function currentBundle() {
  const s = document.querySelector('script[src*="assets/index-"]');
  const m = s && s.src && s.src.match(/index-[A-Za-z0-9_-]+\.js/); // hashes are MIXED-case
  return m ? m[0] : null;
}

async function servedBundle() {
  // Cache-busting query + no-store: always hits the edge, never the HTTP cache.
  const res = await fetch("/?upd=" + Date.now(), { cache: "no-store", redirect: "follow" });
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(/index-[A-Za-z0-9_-]+\.js/);
  return m ? m[0] : null;
}

function showAdminBar(latest) {
  if (document.getElementById("upd-bar")) return;
  const bar = document.createElement("div");
  bar.id = "upd-bar";
  bar.setAttribute("role", "status");
  bar.style.cssText = "position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:12px;background:#171717;color:#fff;font:600 13.5px/1.2 inherit;padding:10px 12px 10px 16px;border-radius:999px;box-shadow:0 12px 32px -10px rgba(0,0,0,.5);max-width:calc(100vw - 32px)";
  const txt = document.createElement("span");
  txt.textContent = "A new version of Celebrately is ready";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Refresh";
  btn.style.cssText = "background:#fff;color:#171717;border:none;border-radius:999px;padding:7px 14px;font:700 13px/1 inherit;cursor:pointer";
  btn.onclick = () => { markReloaded(latest); window.location.reload(); };
  bar.append(txt, btn);
  document.body.appendChild(bar);
}

// once-per-hash reload marker — even if something goes sideways we can never
// reload more than once for the same target bundle.
const reloadedFor = () => { try { return sessionStorage.getItem("evermore_upd_reloaded"); } catch (_) { return null; } };
const markReloaded = (h) => { try { sessionStorage.setItem("evermore_upd_reloaded", h); } catch (_) { /* ignore */ } };

let started = false;
export function initUpdateCheck() {
  if (started || typeof window === "undefined") return;
  started = true;
  const state = { current: currentBundle(), latest: null, ticking: false };
  // exposed for tests/diagnostics (window.__evermoreUpdate.check() forces a pass)
  window.__evermoreUpdate = state;

  async function check() {
    if (state.ticking || !state.current) return;
    state.ticking = true;
    try {
      const latest = await servedBundle();
      state.latest = latest;
      if (!latest || latest === state.current) return;
      if (reloadedFor() === latest) return;           // already tried this target
      const inAdmin = !!document.querySelector(".admin");
      if (inAdmin) { showAdminBar(latest); return; }  // never auto-yank the admin
      markReloaded(latest);
      window.location.reload();
    } catch (_) { /* offline — try again next tick */ }
    finally { state.ticking = false; }
  }
  state.check = check;

  setInterval(check, POLL_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
  setTimeout(check, 20000); // first pass shortly after boot (off the critical path)
}
