import React from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
const { useEffect, useRef } = React;

// ============================================================================
// login-promo-3d — the REAL 3D iPhone (owner's Draco-compressed GLB,
// public/models/iphone17promax.glb) driven with the V1 choreography:
// zoom intro → ONE phone snaps left (caption right) / right (caption left) →
// 4-phone carousel. Lazy-loaded chunk (three.js ~150KB gz + 138KB model), so
// the main bundle is untouched. Captions stay the pure-CSS .lgp-cap timeline —
// this component only replaces the phone rig with a WebGL canvas.
// ============================================================================

// Timeline constants — MUST mirror the .lgp-* CSS caption timings.
const INTRO = 3.6, LOOP = 32;

// piecewise keyframes [pct, value]; smoothstep between stops
function kf(points, pct) {
  if (pct <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (pct <= points[i][0]) {
      const [p0, v0] = points[i - 1], [p1, v1] = points[i];
      if (p1 === p0) return v1;
      let t = (pct - p0) / (p1 - p0);
      t = t * t * (3 - 2 * t); // smoothstep
      return v0 + (v1 - v0) * t;
    }
  }
  return points[points.length - 1][1];
}
const D = Math.PI / 180;
// mover: x offset + yaw. Starts/ends CENTERED (x=0) so the phone settles in the
// middle after the intro, THEN moves left (caption right, s1), then right
// (caption left, s2), then back to center for the carousel. 0%==100% → seamless.
const MX = [[0, 0], [2, 0], [7, -0.8], [20, -0.8], [25, 0.8], [38, 0.8], [41, 0], [100, 0]];
const MR = [[0, 0], [2, 0], [7, 30 * D], [20, 30 * D], [25, -30 * D], [38, -30 * D], [41, 0], [100, 0]];
// carousel ring rotation (matches CSS 41→44/53→56/65→68/77→80)
const RING = [[0, 0], [41, 0], [44, -90 * D], [53, -90 * D], [56, -180 * D], [65, -180 * D], [68, -270 * D], [77, -270 * D], [80, -360 * D], [100, -360 * D]];
// intro zoom (gentle settle on the whole rig). Kept small — a big zoom + the
// mobile down-nudge dropped the enlarged phone onto the buttons.
const ZOOM = [[0, 1.14], [40, 1.14], [100, 1]];

// One screenshot PER FEATURE. slot0 = the invite hero (front during the s1
// "invitation" beat); it swaps to the S2 shot for the s2 "everything in one
// place" beat. Carousel fronts map to their captions: dashboard → "know your
// guest list", entourage → "your entourage", setup → "set up fast".
// Owner request 2026-07-31: the invite hero is the red Velvet Envelope cover
// (closed, wax seal) and the s2 shot is the dashboard RSVP donut charts.
// Every screen is a login-scr-*.jpg: the app screen composited INSIDE mobile
// browser chrome (status bar + URL pill + bottom toolbar). Edge-to-edge app
// renders read as fake — a real phone always shows the browser around the page.
// Superseded login-shot-* files stay on disk — cached bundles still fetch them.
const SHOTS = ["/assets/login-scr-invite.jpg", "/assets/login-scr-dash.jpg", "/assets/login-scr-entourage.jpg", "/assets/login-scr-setup.jpg"];
const S2_SHOT = "/assets/login-scr-charts.jpg"; // dashboard donuts — swapped onto the front phone for the s2 caption
// Feature copy for the ?lgpv showcases — names each screen as it appears. Order
// matches cycleTex = [invite, schedule, dashboard, entourage, setup].
const FEATURES = [
  ["The invitation", "Where your celebration begins."],
  ["Everything in one place", "Schedule, venue and more."],
  ["Know your guest list", "RSVPs made simple."],
  ["Your entourage", "Introduce your wedding party."],
  ["Set up in minutes", "Pick, personalize, share."],
];

export default function LoginPromo3D() {
  const hostRef = useRef(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let raf = 0, disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    cam.position.set(0, 0, 6.6);
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2.5, 3, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(0xe97c5d, 1.1); rim.position.set(-3, -1, -2); scene.add(rim);

    const rig = new THREE.Group();       // intro zoom scale
    const mover = new THREE.Group();     // left/right snaps
    const ring = new THREE.Group();      // carousel
    rig.add(mover); mover.add(ring); scene.add(rig);
    let nudgeY = 0;                      // mobile downward nudge (set in size())

    const size = () => {
      const w = host.clientWidth || 600, h = host.clientHeight || 700;
      const aspect = w / h;
      renderer.setSize(w, h); cam.aspect = aspect;
      // Size the phone to a fixed fraction of the viewport HEIGHT (not width) so it
      // stays consistent across short (SE) → tall screens and always leaves room for
      // the caption + buttons. Keying off aspect made SHORT screens get a BIGGER
      // phone (backwards) → it touched the buttons. zHoriz guards the ±0.8 x-snaps
      // from clipping on very narrow viewports. Desktop keeps its big z=6.6 framing.
      const tanHalf = 0.2867; // tan(FOV/2), FOV=32°
      const zVert = 2.35 / (0.43 * 2 * tanHalf);           // phone ≈ 43% of height
      const zHoriz = 1.35 / (tanHalf * Math.max(aspect, 0.35));
      cam.position.z = aspect < 0.8 ? Math.max(zVert, zHoriz) : 6.6;
      nudgeY = aspect < 0.8 ? 0.1 : 0; // nudge the phone slightly UP on mobile
      rig.position.y = nudgeY;
      cam.updateProjectionMatrix();
    };
    size();
    const ro = new ResizeObserver(size); ro.observe(host);

    const draco = new DRACOLoader(); draco.setDecoderPath("/draco/");
    const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
    const texLoader = new THREE.TextureLoader();
    const slots = [];
    let texInvite = null, texSchedule = null; // front-phone swap (s1 invite ↔ s2 schedule)
    // Preview variants: ?lgpv=1..5 swaps in an alternate single-phone choreography
    // (no param = the default carousel). Lets the owner pick a favorite live.
    const V = +(new URLSearchParams(window.location.search).get("lgpv") || 0);
    let cycleTex = null, screen0 = null;       // 5-screen cycle + front screen mesh (variants)
    let featEl = null, featH = null, featP = null; // JS-driven feature caption overlay
    loader.load("/models/iphone17promax.glb", (gltf) => {
      if (disposed) return;
      // normalize: center + scale to a known height, rotate display toward +Z
      const base = gltf.scene;
      const box = new THREE.Box3().setFromObject(base);
      const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
      base.position.sub(c);
      const norm = new THREE.Group(); norm.add(base);
      norm.scale.setScalar(2.35 / sz.y);
      norm.rotation.y = Math.PI / 2; // GLB display faces -X → face the camera (+Z)
      const outer = new THREE.Group(); outer.add(norm);

      // The GLB screen mesh ships smeared UVs — rebuild them from the mesh's
      // own flat geometry (display plane is local Y-Z), so the screenshot maps
      // ONTO the actual display surface: exact fit, rounded corners, notch cut.
      outer.updateMatrixWorld(true);
      outer.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const n = o.material.name || "";
        if (/screen/i.test(n)) {
          const g = o.geometry, pos = g.attributes.position;
          let minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
          for (let vi = 0; vi < pos.count; vi++) {
            const y = pos.getY(vi), z = pos.getZ(vi);
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
          }
          const uv = new Float32Array(pos.count * 2);
          for (let vi = 0; vi < pos.count; vi++) {
            uv[vi * 2] = 1 - (pos.getY(vi) - minY) / (maxY - minY); // u across width (local Y, mirrored)
            uv[vi * 2 + 1] = (pos.getZ(vi) - minZ) / (maxZ - minZ);     // v up height
          }
          g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
          o.userData.lgpScreen = true;
          o.material = new THREE.MeshBasicMaterial({ color: 0x05060a });
        } else if (/^glass/i.test(n)) {
          o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.06; o.material.depthWrite = false;
        }
      });

      const loadTex = (url) => { const tex = texLoader.load(url); tex.colorSpace = THREE.SRGBColorSpace; return tex; };
      texInvite = loadTex(SHOTS[0]);   // slot0 default (s1 "invitation")
      texSchedule = loadTex(S2_SHOT);  // slot0 during s2 "everything in one place"
      const R = 1.72;
      for (let i = 0; i < 4; i++) {
        const phone = i === 0 ? outer : outer.clone(true);
        let screen = null;
        // Carousel phones (i>0) get INDEPENDENT material copies so they can fade
        // out on their own at the loop's end (a graceful dissolve, not a pop).
        const fade = []; // {m, base} — base opacity to scale by the exit factor
        phone.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          if (o.userData && o.userData.lgpScreen) { o.material = new THREE.MeshBasicMaterial({ map: i === 0 ? texInvite : loadTex(SHOTS[i]), toneMapped: false, side: THREE.BackSide }); screen = o; }
          else if (i > 0) { o.material = o.material.clone(); }
          if (i > 0) { o.material.transparent = true; fade.push({ m: o.material, base: o.material.opacity }); }
        });
        const slot = new THREE.Group();
        slot.rotation.y = i * Math.PI / 2;
        const arm = new THREE.Group(); arm.position.z = R; arm.add(phone);
        slot.add(arm); ring.add(slot);
        if (i > 0) slot.visible = false; // intro + snap phase show ONE phone
        slots.push({ slot, phone, screen, fade });
      }
      ring.position.z = -R; // front phone sits at world z=0
      // Phone is ready → start this rig's clock AND un-pause the CSS captions at the
      // same instant, so they run in lockstep (no early "invitation" over a centered
      // phone; loops stay aligned).
      t0 = performance.now();
      const stage = host.closest(".lgp-stage");
      stage?.classList.add("lgp-go");
      if (V >= 1 && V <= 5) {
        cycleTex = [texInvite, texSchedule, loadTex(SHOTS[1]), loadTex(SHOTS[2]), loadTex(SHOTS[3])];
        screen0 = slots[0].screen;
        if (screen0) screen0.material.transparent = true; // allow the swap cross-dip
        stage?.classList.add("lgp-variant"); // CSS hides the default-timed captions
        featEl = stage?.querySelector(".lgp-feat") || null;
        if (featEl) { featEl.className = "lgp-feat lgp-feat--v" + V; featH = featEl.querySelector(".lgp-feat-h"); featP = featEl.querySelector(".lgp-feat-p"); }
        // Variant 5 = gallery: give each of the 4 phones its own feature screen.
        if (V === 5) for (let i = 0; i < slots.length; i++) { const s = slots[i].screen; if (s) { s.material.map = cycleTex[i]; s.material.needsUpdate = true; } }
      }
    });

    // The phone starts in lockstep with the CSS captions: both begin the instant the
    // GLB is ready. The captions are CSS-paused until the stage gets .lgp-go; this
    // rig's clock (t0) is set at that same moment (in the loader callback). The 3D
    // chunk loads late, so without this the captions ran ahead — "The invitation"
    // showed while the phone was still centered (overlap) and the loops stayed
    // permanently offset ("obvious loop").
    let t0 = null;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ── App showcases (?lgpv=N). Each walks through the app's FEATURES: the screen
    // changes and the JS caption names it ("Featuring — Know your guest list"). lt =
    // loop seconds. 1 Tour · 2 Billboard · 3 Flip · 4 Orbit · 5 Gallery (4 phones).
    const sin = Math.sin;
    const setFeat = (idx, op) => {
      if (!featEl) return;
      if (featEl.__i !== idx) { featEl.__i = idx; if (featH) featH.textContent = FEATURES[idx][0]; if (featP) featP.textContent = FEATURES[idx][1]; }
      featEl.style.opacity = String(Math.max(0, Math.min(1, op)));
    };
    const variantTick = (v, lt) => {
      if (v === 5) {                                     // Gallery — 4 phones, slow turntable
        for (let i = 1; i < slots.length; i++) slots[i].slot.visible = true;
        ring.rotation.y = -lt * 0.2;
        mover.position.x = 0; mover.position.y = 0.03 * sin(lt * 0.8); mover.rotation.y = 0; mover.rotation.x = 0.06; rig.scale.setScalar(1);
        const raw = (-ring.rotation.y) / (Math.PI / 2), nearest = Math.round(raw);
        setFeat(((nearest % 4) + 4) % 4, 1 - Math.min(1, Math.abs(raw - nearest) * 3.2)); // fade between stops
        return;
      }
      ring.rotation.y = 0;
      for (let i = 1; i < slots.length; i++) slots[i].slot.visible = false; // single phone
      const INT = v === 3 ? 4.6 : 4.0;                   // feature dwell
      const seg = lt % INT, idx = Math.floor(lt / INT) % FEATURES.length;
      if (screen0) {
        const tex = cycleTex[idx];
        if (screen0.material.map !== tex) { screen0.material.map = tex; screen0.material.needsUpdate = true; }
        screen0.material.opacity = 0.12 + 0.88 * Math.min(1, seg / 0.45, (INT - seg) / 0.45); // cross-dip
      }
      setFeat(idx, Math.min(1, seg / 0.6, (INT - seg) / 0.6));
      let sx = 0, sy = 0, ry = 0, rx = 0, sc = 1;
      if (v === 1) {                                     // Tour — caption beside, phone eases opposite
        const capLeft = idx % 2 === 1;
        if (featEl) featEl.setAttribute("data-side", capLeft ? "left" : "right");
        sx = capLeft ? 0.5 : -0.5; ry = capLeft ? -0.16 : 0.16; sy = 0.03 * sin(lt * 1.1);
      } else if (v === 2) {                              // Billboard — caption on top, gentle bob
        sy = -0.02 + 0.03 * sin(lt * 0.9); ry = 0.06 * sin(lt * 0.6);
      } else if (v === 3) {                              // Flip — flips to the next feature
        const f = lt % INT, fl = f > INT - 0.95 ? kf([[0, 0], [100, Math.PI]], ((f - (INT - 0.95)) / 0.95) * 100) : 0;
        ry = 0.18 * sin(lt * 0.7) + fl; rx = 0.08 * sin(lt * 0.5);
        sc = f > INT - 0.95 ? 1 + 0.08 * sin(((f - (INT - 0.95)) / 0.95) * Math.PI) : 1;
      } else {                                           // Orbit — parallax tilt, caption bottom-left
        sx = 0.14 * sin(lt * 0.6); sy = 0.06 * sin(lt * 0.9); ry = 0.4 * sin(lt * 0.6); rx = 0.15 * sin(lt * 0.9);
      }
      mover.position.x = sx; mover.position.y = sy; mover.rotation.y = ry; mover.rotation.x = rx; rig.scale.setScalar(sc);
    };

    const tick = () => {
      if (disposed) return;
      const t = t0 == null ? 0 : (performance.now() - t0) / 1000;
      const hash = window.location.hash || "";
      const dbgi = /lgpi=([\d.]+)/.exec(hash); // debug freeze: #lgpi=<pct> pins the INTRO
      if (reduce) {
        rig.scale.setScalar(1); mover.rotation.y = 16 * D; rig.position.y = nudgeY;
      } else if (dbgi || t < INTRO) {
        const pct = dbgi ? parseFloat(dbgi[1]) : (t / INTRO) * 100;
        const scale = kf(ZOOM, pct);
        rig.scale.setScalar(scale);
        // intro: settle CENTERED (matches loop 0% and the carousel), so the wrap and
        // the intro→loop handoff are seamless. Captions are gated until now, so the
        // "invitation" caption only appears once the loop moves the phone left.
        mover.position.x = 0;
        mover.rotation.y = 0;
        ring.rotation.y = 0;
        // Lift as it zooms so the enlarged phone's BOTTOM stays put (never drops
        // onto the buttons). halfWorld ≈ 2.05/2; no top caption during the intro.
        rig.position.y = nudgeY + (scale - 1) * 1.025;
      } else if (V >= 1 && V <= 5) {
        rig.position.y = nudgeY;
        variantTick(V, t - INTRO);
      } else {
        rig.scale.setScalar(1);
        rig.position.y = nudgeY;
        // debug freeze: #lgp=<pct> pins the loop position (visual QA)
        const dbg = /lgp=([\d.]+)/.exec(hash);
        const pct = dbg ? parseFloat(dbg[1]) : (((t - INTRO) % LOOP) / LOOP) * 100;
        mover.position.x = kf(MX, pct);
        mover.rotation.y = kf(MR, pct);
        ring.rotation.y = kf(RING, pct);
        // Carousel phones fade IN as they join and gracefully DISSOLVE + recede at
        // the end (no abrupt pop). Smoothstep opacity, plus a slight shrink so they
        // ease away rather than blink out. Fade-out spread over 90→99% (~3s).
        const joinOp = kf([[0, 0], [40, 0], [45, 1], [90, 1], [99, 0], [100, 0]], pct);
        for (let i = 1; i < slots.length; i++) {
          const s = slots[i];
          s.slot.visible = joinOp > 0.01;
          if (joinOp > 0.01) {
            for (let k = 0; k < s.fade.length; k++) s.fade[k].m.opacity = s.fade[k].base * joinOp;
            s.slot.scale.setScalar(0.92 + 0.08 * joinOp); // subtle recede as it dissolves
          }
        }
        // Front phone swaps invite → schedule for the right-snap "everything in
        // one place / schedule" beat (s2, ~24-38%), then back for the carousel.
        const s0 = slots[0] && slots[0].screen;
        if (s0 && texInvite && texSchedule) {
          const want = pct >= 21 && pct < 40 ? texSchedule : texInvite;
          if (s0.material.map !== want) { s0.material.map = want; s0.material.needsUpdate = true; }
        }
      }
      renderer.render(scene, cam);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect();
      renderer.dispose(); draco.dispose();
      host.contains(renderer.domElement) && host.removeChild(renderer.domElement);
    };
  }, []);
  return <div ref={hostRef} className="lgp-canvas" />;
}
