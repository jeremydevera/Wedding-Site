import React from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
const { useEffect, useRef } = React;

// ============================================================================
// login-promo-3d — a REAL 3D iPhone (public/models/iphone16.glb) shown front-
// facing, its screen showing the LIVE site via an <iframe> (a real emulator,
// not a screenshot). WebGL renders only the phone body; each frame we project
// the screen rect to the page and lay the iframe on it (clamped to the phone
// body so it never spills past the glass), with a CSS glare sweep on top.
// The phone slides left<->right on a timeline while the matching side caption
// fades in — a pure TRANSLATION, so the phone stays front-facing and the flat
// iframe keeps fitting the screen exactly. Lazy-loaded chunk.
// ============================================================================

const MODEL = "/models/iphone16.glb";
const EMU_SRC = "https://demo.celebrately.us/"; // live site rendered inside the phone
const IFRAME_W = 402; // logical device width the site renders at (scaled to the screen rect)
const smooth = (a, b, t) => { const s = t * t * (3 - 2 * t); return a + (b - a) * s; };

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
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:1";
    host.appendChild(renderer.domElement);

    // Live-site iframe + a glare sweep, laid onto the projected screen each frame.
    const emu = document.createElement("iframe");
    emu.src = EMU_SRC; emu.title = "Celebrately preview"; emu.loading = "lazy";
    emu.style.cssText = "position:absolute;left:0;top:0;width:" + IFRAME_W + "px;border:0;background:#0b0b12;transform-origin:0 0;border-radius:38px;overflow:hidden;opacity:0;transition:opacity .6s ease;z-index:2;box-shadow:none";
    const glare = document.createElement("div");
    glare.style.cssText = "position:absolute;left:0;top:0;width:" + IFRAME_W + "px;pointer-events:none;transform-origin:0 0;border-radius:38px;opacity:0;transition:opacity .6s ease;z-index:3;background:linear-gradient(122deg,rgba(255,255,255,.30) 0%,rgba(255,255,255,.08) 15%,rgba(255,255,255,0) 38%,rgba(255,255,255,0) 100%)";
    host.appendChild(emu); host.appendChild(glare);
    emu.addEventListener("load", () => { emu.style.opacity = "1"; glare.style.opacity = "1"; });

    // Side captions live in the .lgp-stage next to the canvas — drive them from
    // the same timeline so text and phone motion stay in sync.
    const stage = host.parentNode;
    const capR = stage && stage.querySelector(".lgp-s1"); // text on the right (phone slid left)
    const capL = stage && stage.querySelector(".lgp-s2"); // text on the left  (phone slid right)
    const setCap = (el, on, hidden) => { if (!el) return; el.style.opacity = on ? "1" : "0"; el.style.transform = on ? "translate(0,-50%)" : hidden; };
    setCap(capR, false, "translate(22px,-50%)"); setCap(capL, false, "translate(-28px,-50%)");

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    cam.position.set(0, 0, 6.6);
    scene.add(new THREE.AmbientLight(0xffffff, 1.7));
    const keyL = new THREE.DirectionalLight(0xffffff, 2.0); keyL.position.set(2.5, 3, 4); scene.add(keyL);
    const rimL = new THREE.DirectionalLight(0xe97c5d, 1.0); rimL.position.set(-3, -1, -2); scene.add(rimL);

    const rig = new THREE.Group(); scene.add(rig);
    let slideX = 0.72, canSlide = true; // desktop: swing between -slideX and +slideX; narrow: centered, no slide
    const size = () => {
      const w = host.clientWidth || 600, h = host.clientHeight || 700;
      const aspect = w / h;
      renderer.setSize(w, h); cam.aspect = aspect;
      const tanHalf = 0.2867; // tan(32°/2)
      // fit the phone to ~half the panel height; back off more on narrow panels
      cam.position.z = aspect < 0.85 ? Math.max(2.6 / (tanHalf * 2), 1.4 / (tanHalf * Math.max(aspect, 0.35))) : 6.2;
      // swing on any reasonably wide panel (a desktop promo column is ~0.55–0.8);
      // scale the throw to width and keep phone centered on tall/narrow panels.
      canSlide = aspect >= 0.5;
      slideX = canSlide ? 0.62 * Math.min(1, aspect / 0.72) : 0;
      cam.updateProjectionMatrix();
    };
    size();
    const ro = new ResizeObserver(size); ro.observe(host);

    let screenMesh = null;
    const draco = new DRACOLoader(); draco.setDecoderPath("/draco/");
    const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
    loader.load(MODEL, (gltf) => {
      if (disposed) return;
      const base = gltf.scene;
      const box = new THREE.Box3().setFromObject(base);
      const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
      base.position.sub(c);
      const norm = new THREE.Group(); norm.add(base);
      norm.rotation.y = -Math.PI / 2;      // screen glass faces the camera (+Z), not the back
      norm.scale.setScalar(2.35 / sz.y);   // long axis is world Y
      rig.add(norm);
      rig.updateMatrixWorld(true);
      // Prefer the model's own "screen" material; fall back to the thinnest large
      // planar mesh. (A big flat backdrop plane can otherwise win the geometric
      // pick by area.) Darken it as a fallback behind the iframe.
      base.traverse((o) => { if (o.isMesh && /screen/i.test((o.material && o.material.name) || "")) screenMesh = o; });
      if (!screenMesh) {
        const cands = [];
        base.traverse((o) => { if (!o.isMesh || !o.geometry) return; o.geometry.computeBoundingBox(); const s = o.geometry.boundingBox.getSize(new THREE.Vector3()); const d = [s.x, s.y, s.z].sort((a, b) => a - b); cands.push({ o, thick: d[0], area: d[1] * d[2] }); });
        const minT = Math.min(...cands.map((cc) => cc.thick));
        let best = -1; for (const cc of cands) if (cc.thick <= minT + 0.01 && cc.area > best) { best = cc.area; screenMesh = cc.o; }
      }
      if (screenMesh) screenMesh.material = new THREE.MeshBasicMaterial({ color: 0x0b0b12 });
    });

    // project the front-face (max-z) corners of a world Box3 to page pixels
    const v = new THREE.Vector3();
    const projRect = (bb, W, H) => {
      let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
      for (const xx of [bb.min.x, bb.max.x]) for (const yy of [bb.min.y, bb.max.y]) {
        v.set(xx, yy, bb.max.z).project(cam);
        const px = (v.x * 0.5 + 0.5) * W, py = (-v.y * 0.5 + 0.5) * H;
        mnx = Math.min(mnx, px); mny = Math.min(mny, py); mxx = Math.max(mxx, px); mxy = Math.max(mxy, py);
      }
      return { x: mnx, y: mny, w: mxx - mnx, h: mxy - mny };
    };

    // timeline (seconds): rise-in, then loop [dwell-left, slide, dwell-right, slide]
    const INTRO = 0.9, DWELL = 4.4, SLIDE = 0.5, LOOP = (DWELL + SLIDE) * 2;
    const t0 = performance.now();
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sBox = new THREE.Box3(), bBox = new THREE.Box3();
    const tick = () => {
      if (disposed) return;
      const t = (performance.now() - t0) / 1000;
      const intro = Math.min(t / INTRO, 1), ei = intro * intro * (3 - 2 * intro);
      const bob = reduce ? 0 : Math.sin(t * 0.85) * 0.03;

      // horizontal swing + caption sync (front-facing throughout — no yaw).
      // Captions only when there's room to slide (wide panels); otherwise the
      // phone stays centered with no caption so text never overlaps the glass.
      let px = 0, showR = false, showL = false;
      if (canSlide && !reduce) {
        const lt = ((t - INTRO) % LOOP + LOOP) % LOOP;
        if (t < INTRO) { px = -slideX; }
        else if (lt < DWELL) { px = -slideX; showR = true; }               // phone left, caption right
        else if (lt < DWELL + SLIDE) { px = smooth(-slideX, slideX, (lt - DWELL) / SLIDE); }
        else if (lt < DWELL * 2 + SLIDE) { px = slideX; showL = true; }     // phone right, caption left
        else { px = smooth(slideX, -slideX, (lt - DWELL * 2 - SLIDE) / SLIDE); }
      }
      setCap(capR, showR && t > INTRO, "translate(22px,-50%)");
      setCap(capL, showL && t > INTRO, "translate(-28px,-50%)");

      rig.position.set(px, bob + (1 - ei) * -0.18, 0);
      rig.scale.setScalar(0.95 + 0.05 * ei);
      renderer.render(scene, cam);

      if (screenMesh) {
        const W = host.clientWidth, H = host.clientHeight;
        const sr = projRect(sBox.setFromObject(screenMesh), W, H); // the glass
        const br = projRect(bBox.setFromObject(rig), W, H);         // the whole phone body
        // clamp the screen rect INTO the body (minus a bezel) so the live view
        // can never bleed past the frame, then inset for the rounded glass.
        const bezX = br.w * 0.055, bezY = br.h * 0.02;
        let x0 = Math.max(sr.x, br.x + bezX), y0 = Math.max(sr.y, br.y + bezY);
        let x1 = Math.min(sr.x + sr.w, br.x + br.w - bezX), y1 = Math.min(sr.y + sr.h, br.y + br.h - bezY);
        const rw = x1 - x0, rh = y1 - y0, ix = rw * 0.02, iy = rh * 0.012;
        const x = x0 + ix, y = y0 + iy, ww = rw - ix * 2, hh = rh - iy * 2;
        const IH = Math.round(IFRAME_W * (hh / ww));
        const sc = ww / IFRAME_W;
        emu.style.height = IH + "px"; emu.style.transform = `translate(${x}px,${y}px) scale(${sc})`;
        glare.style.height = IH + "px"; glare.style.transform = `translate(${x}px,${y}px) scale(${sc})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect();
      renderer.dispose(); draco.dispose();
      host.contains(renderer.domElement) && host.removeChild(renderer.domElement);
      emu.remove(); glare.remove();
      setCap(capR, false, "translate(22px,-50%)"); setCap(capL, false, "translate(-28px,-50%)");
    };
  }, []);
  return <div ref={hostRef} className="lgp-canvas" />;
}
