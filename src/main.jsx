// main.jsx — Vite entry: load styles, mount <App/>, then the drag helper.
import "@/styles/styles.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app/App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// load the (optional) drag-to-arrange helper after the app has mounted
import("@/lib/drag-arrange.js");

// self-updating tabs: poll for new deploys and refresh (public auto, admin via
// a banner) so clients get every release WITHOUT clearing caches or reopening.
import("@/lib/update-check.js").then((m) => m.initUpdateCheck()).catch(() => {});

// Boot watchdog — a hung boot (e.g. Firebase's IndexedDB lock held by another
// stale tab) used to strand users on a WHITE PAGE with no way out except
// clearing site data by hand. If nothing has mounted after 12s, offer
// self-service recovery: Reload, or Reset-this-device (drop this origin's
// Firebase/local state, then reload — same as a fresh visit; may need to sign
// in again). Plain DOM on purpose: must render even when React never did.
setTimeout(() => {
  const root = document.getElementById("root");
  if (!root || root.childElementCount > 0) return; // app mounted — all good
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;inset:0;display:grid;place-items:center;background:#fff;font-family:system-ui,sans-serif;z-index:99999;padding:20px";
  box.innerHTML =
    '<div style="max-width:420px;text-align:center">' +
    '<h2 style="margin:0 0 8px;font-size:20px;color:#171717">Taking longer than usual…</h2>' +
    '<p style="margin:0 0 18px;font-size:14px;color:#6b7280;line-height:1.5">The page didn’t finish loading. This usually clears up with a reload. If it keeps happening, use Reset — it gives this browser a fresh start (you may need to sign in again).</p>' +
    '<div style="display:flex;gap:10px;justify-content:center">' +
    '<button id="bw-reload" style="background:#1E5BD6;color:#fff;border:none;border-radius:999px;padding:10px 20px;font:700 14px system-ui;cursor:pointer">Reload</button>' +
    '<button id="bw-reset" style="background:#fff;color:#171717;border:1px solid #d9d9de;border-radius:999px;padding:10px 20px;font:700 14px system-ui;cursor:pointer">Reset &amp; reload</button>' +
    "</div></div>";
  document.body.appendChild(box);
  document.getElementById("bw-reload").onclick = () => window.location.reload();
  document.getElementById("bw-reset").onclick = async () => {
    try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* ignore */ }
    try {
      const dbs = (indexedDB.databases ? await indexedDB.databases() : []) || [];
      await Promise.allSettled(dbs.map((d) => d.name && new Promise((res) => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = res; })));
    } catch (e) { /* ignore */ }
    window.location.reload();
  };
}, 12000);
