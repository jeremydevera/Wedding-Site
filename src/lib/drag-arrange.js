/* Drag-to-arrange mode for the open-envelope stack.
   Toggle with the "Arrange" button (bottom-left). Drag pieces to move,
   scroll-wheel over a piece to resize it, then hit "Copy CSS" to read
   the final values back. Loaded lazily as an ES module from main.jsx. */
import { PREMIUM_THEMES } from "@/themes";
import { Store, STORE_KEY } from "@/lib/store.jsx";
import { ADMIN_SESSION } from "@/admin/core.jsx";

(function () {
  "use strict";

  var SELECTOR = ".inv-l-card, .inv-l-framegroup, .inv-l-heart, .inv-l-front, .inv-l-flower, .inv-l-paperflower, .inv-l-video";
  var LABELS = {
    "inv-l-card": "Card",
    "inv-l-framegroup": "Frame + video",
    "inv-l-video": "Video",
    "inv-l-heart": "Heart",
    "inv-l-front": "Envelope front",
    "inv-l-flower": "Flower",
    "inv-l-paperflower": "Paper flower"
  };

  var active = false;
  var panel, list, toggleBtn;
  var drag = null; // {el, startX, startY, parentRect, grabDX, grabDY}

  function labelFor(el) {
    for (var k in LABELS) if (el.classList.contains(k)) return LABELS[k];
    return el.className;
  }

  function activeStack() {
    // prefer the stack inside the currently active page
    var pg = document.querySelector(".inv-page.is-active .inv-env-stack, .eg-page.is-active .inv-env-stack");
    if (pg) return pg;
    var all = document.querySelectorAll(".inv-env-stack");
    for (var i = 0; i < all.length; i++) {
      if (all[i].offsetParent !== null) return all[i];
    }
    return all[0] || null;
  }

  function draggables() {
    var stack = activeStack();
    if (!stack) return [];
    return Array.prototype.slice.call(stack.querySelectorAll(SELECTOR));
  }

  function pct(el) {
    var p = el.offsetParent || el.parentElement;
    if (!p) return { left: 0, top: 0, width: 0 };
    var r = el.getBoundingClientRect();
    var pr = p.getBoundingClientRect();
    return {
      left: (r.left - pr.left) / pr.width * 100,
      top: (r.top - pr.top) / pr.height * 100,
      width: r.width / pr.width * 100
    };
  }

  function refreshReadout() {
    if (!list) return;
    var els = draggables();
    var html = "";
    els.forEach(function (el) {
      var v = pct(el);
      var sel = "." + (el.className.split(" ").find(function (c) { return c.indexOf("inv-l-") === 0; }) || el.className);
      html += '<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px solid #2a2a2a">' +
        '<span style="color:#9fd3a6">' + labelFor(el) + '</span>' +
        '<code style="color:#ddd">left:' + v.left.toFixed(1) + '%; top:' + v.top.toFixed(1) + '%; width:' + v.width.toFixed(1) + '%;</code>' +
        '</div>';
    });
    list.innerHTML = html;
  }

  function decorate(on) {
    draggables().forEach(function (el) {
      if (on) {
        el.dataset._oldOutline = el.style.outline || "";
        el.dataset._oldCursor = el.style.cursor || "";
        el.style.outline = "1.5px dashed rgba(159,211,166,.9)";
        el.style.cursor = "grab";
      } else {
        el.style.outline = el.dataset._oldOutline || "";
        el.style.cursor = el.dataset._oldCursor || "";
        delete el.dataset._oldOutline;
        delete el.dataset._oldCursor;
      }
    });
  }

  function onDown(e) {
    if (!active) return;
    var el = e.target.closest(SELECTOR);
    if (!el || !el.closest(".inv-env-stack")) return;
    e.preventDefault();
    e.stopPropagation();
    var r = el.getBoundingClientRect();
    drag = { el: el, grabDX: e.clientX - r.left, grabDY: e.clientY - r.top };
    el.style.cursor = "grabbing";
    el.setPointerCapture && el.setPointerCapture(e.pointerId);
  }

  function onMove(e) {
    if (!drag) return;
    e.preventDefault();
    var el = drag.el;
    var p = el.offsetParent || el.parentElement;
    var pr = p.getBoundingClientRect();
    var left = (e.clientX - drag.grabDX - pr.left) / pr.width * 100;
    var top = (e.clientY - drag.grabDY - pr.top) / pr.height * 100;
    el.style.left = left.toFixed(2) + "%";
    el.style.top = top.toFixed(2) + "%";
    refreshReadout();
  }

  function onUp(e) {
    if (!drag) return;
    drag.el.style.cursor = "grab";
    drag = null;
    refreshReadout();
  }

  function onWheel(e) {
    if (!active) return;
    var el = e.target.closest(SELECTOR);
    if (!el || !el.closest(".inv-env-stack")) return;
    e.preventDefault();
    var p = el.offsetParent || el.parentElement;
    var pr = p.getBoundingClientRect();
    var cur = el.getBoundingClientRect().width / pr.width * 100;
    var next = Math.max(3, cur + (e.deltaY < 0 ? 1 : -1));
    el.style.width = next.toFixed(2) + "%";
    refreshReadout();
  }

  function setActive(on) {
    active = on;
    decorate(on);
    panel.style.display = on ? "block" : "none";
    toggleBtn.textContent = on ? "✓ Done arranging" : "↔ Arrange";
    toggleBtn.style.background = on ? "#9fd3a6" : "#1c1c1c";
    toggleBtn.style.color = on ? "#10240f" : "#fff";
    if (on) refreshReadout();
  }

  function copyCSS() {
    var els = draggables();
    var lines = els.map(function (el) {
      var v = pct(el);
      var sel = "." + (el.className.split(" ").find(function (c) { return c.indexOf("inv-l-") === 0; }) || el.className);
      return sel + " { left: " + v.left.toFixed(1) + "%; top: " + v.top.toFixed(1) + "%; width: " + v.width.toFixed(1) + "%; }";
    });
    var text = lines.join("\n");
    navigator.clipboard && navigator.clipboard.writeText(text);
    var note = document.getElementById("__arrange_copied");
    if (note) { note.textContent = "Copied! Paste it to me."; setTimeout(function () { note.textContent = ""; }, 2500); }
  }

  function build() {
    if (toggleBtn) return;
    toggleBtn = document.createElement("button");
    toggleBtn.textContent = "↔ Arrange";
    Object.assign(toggleBtn.style, {
      position: "fixed", left: "16px", bottom: "16px", zIndex: 99999,
      font: "600 13px/1 system-ui, sans-serif", padding: "10px 14px",
      border: "none", borderRadius: "8px", background: "#1c1c1c", color: "#fff",
      cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,.3)"
    });
    toggleBtn.onclick = function () { setActive(!active); };
    document.body.appendChild(toggleBtn);

    panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "fixed", left: "16px", bottom: "60px", zIndex: 99999, display: "none",
      width: "320px", maxHeight: "60vh", overflow: "auto", padding: "14px",
      background: "#141414", border: "1px solid #333", borderRadius: "10px",
      font: "12px/1.4 ui-monospace, monospace", color: "#ddd",
      boxShadow: "0 8px 28px rgba(0,0,0,.45)"
    });
    panel.innerHTML =
      '<div style="font:600 13px/1 system-ui;color:#fff;margin-bottom:8px">Drag pieces to move · scroll over one to resize</div>' +
      '<div id="__arrange_list"></div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-top:12px">' +
      '<button id="__arrange_copy" style="font:600 12px/1 system-ui;padding:8px 12px;border:none;border-radius:7px;background:#9fd3a6;color:#10240f;cursor:pointer">Copy CSS</button>' +
      '<span id="__arrange_copied" style="color:#9fd3a6;font:12px/1 system-ui"></span>' +
      '</div>';
    document.body.appendChild(panel);
    list = panel.querySelector("#__arrange_list");
    panel.querySelector("#__arrange_copy").onclick = copyCSS;

    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("wheel", onWheel, { passive: false, capture: true });
  }

  // ---- When is the Arrange tool available? --------------------------------
  // Shown only to the signed-in couple while the Olive Envelope theme is active
  // (so guests never see it). Manual overrides: ?arrange in the URL, or the
  // Ctrl/Cmd+Shift+A shortcut, which force it on regardless of theme.
  // Live store first — Supabase-hydrated settings and the restored auth session
  // never reach localStorage/sessionStorage (Store.hydrate deliberately doesn't
  // persist, and loadSession doesn't set the session flag), so the storage
  // fallbacks below only cover the moment before the store module is ready.
  function isAdmin() {
    try {
      var role = (Store.get().auth || {}).role;
      if (role === "owner" || role === "superadmin") return true;
    } catch (e) {}
    try { return sessionStorage.getItem(ADMIN_SESSION) === "1"; } catch (e) { return false; }
  }
  function settingsObj() {
    try {
      var s = Store.get().settings;
      if (s) return s;
    } catch (e) {}
    try { return (JSON.parse(localStorage.getItem(STORE_KEY) || "{}").settings || {}); }
    catch (e) { return {}; }
  }
  function manualOverride() {
    if (/[?&]arrange\b/.test(location.search)) return true;
    try { return localStorage.getItem("arrangeMode") === "1"; } catch (e) { return false; }
  }
  // Prefer the LIVE theme painted on the document (applyTheme sets data-theme),
  // so it also works while a theme is previewed (demo picker / admin live
  // preview) and hasn't been persisted to localStorage yet. Fall back to the
  // saved theme.
  function liveTheme() {
    try { return document.documentElement.getAttribute("data-theme") || ""; }
    catch (e) { return ""; }
  }
  function arrangeAllowed() {
    var s = settingsObj();
    var theme = liveTheme() || s.theme;
    var premium = PREMIUM_THEMES.indexOf(theme) !== -1;
    return manualOverride() || (isAdmin() && premium && !!s.arrangeEnabled);
  }

  function tick() {
    var allowed = arrangeAllowed();
    var onEnvelope = !!document.querySelector(".inv-env-stack");
    if (allowed && onEnvelope) {
      build();                                  // no-op after first call
      if (toggleBtn) toggleBtn.style.display = "block";
      // "Arrange Now" sets this flag — drop straight into edit mode once.
      var auto = false;
      try { auto = sessionStorage.getItem("arrangeStart") === "1"; } catch (e) {}
      if (auto && !active) {
        try { sessionStorage.removeItem("arrangeStart"); } catch (e) {}
        setActive(true);
      }
    } else {
      if (active) setActive(false);             // leave edit mode if no longer allowed
      if (toggleBtn) toggleBtn.style.display = "none";
    }
  }

  // Re-evaluate continuously so it appears the moment "Enable arrange" is on and
  // you open the live page, and disappears when you turn it off or sign out.
  setInterval(tick, 600);

  // Ctrl/Cmd+Shift+A — force the tool on/off without editing the URL (remembered).
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "A" || e.key === "a")) {
      e.preventDefault();
      var on = manualOverride();
      try { localStorage.setItem("arrangeMode", on ? "0" : "1"); } catch (err) {}
      tick();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tick);
  } else {
    tick();
  }
})();
