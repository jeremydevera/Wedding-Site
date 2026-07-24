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
const MX = [[0, -0.8], [17, -0.8], [20, 0.8], [38, 0.8], [40, 0], [80, 0], [97, 0], [100, -0.8]];
const MR = [[0, 30 * D], [17, 30 * D], [20, -30 * D], [38, -30 * D], [40, 0], [80, 0], [97, 0], [100, 30 * D]];
// carousel ring rotation (matches CSS 41→44/53→56/65→68/77→80)
const RING = [[0, 0], [41, 0], [44, -90 * D], [53, -90 * D], [56, -180 * D], [65, -180 * D], [68, -270 * D], [77, -270 * D], [80, -360 * D], [100, -360 * D]];
// intro zoom (gentle settle on the whole rig). Kept small — a big zoom + the
// mobile down-nudge dropped the enlarged phone onto the buttons.
const ZOOM = [[0, 1.14], [40, 1.14], [100, 1]];

// One screenshot PER FEATURE. slot0 = the invite hero (front during the s1
// "invitation" beat); it swaps to the schedule shot for the s2 "everything in
// one place" beat. Carousel fronts map to their captions: dashboard → "know
// your guest list", entourage → "your entourage", setup → "set up fast".
const SHOTS = ["/assets/login-shot-2.jpg", "/assets/login-shot-dash.jpg", "/assets/login-shot-4.jpg", "/assets/login-setup.jpg"];
const S2_SHOT = "/assets/login-shot-3.jpg"; // schedule — swapped onto the front phone for the s2 caption

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
    loader.load("/models/iphonex.glb", (gltf) => {
      if (disposed) return;
      // normalize: center, rotate the long axis (local X = phone length) upright
      // to world +Y — the front already faces the camera (+Z) — then scale to a
      // known on-screen height.
      const base = gltf.scene;
      const box = new THREE.Box3().setFromObject(base);
      const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
      base.position.sub(c);
      const norm = new THREE.Group(); norm.add(base);
      // Model is already upright (long axis = world Y) + front-facing (+Z toward
      // camera), so NO rotation — just scale to a known on-screen height.
      norm.scale.setScalar(2.35 / sz.y);
      const outer = new THREE.Group(); outer.add(norm);
      outer.updateMatrixWorld(true);

      // No tagged screen mesh + no screen UVs. The display is the THINNEST large
      // plane (the glossy glass/bezel layer is thin too but not zero — pick the
      // truly-planar one with the biggest area). Rebuild its UVs from the in-plane
      // axes (local X = length -> v, local Y = width -> u) so the screenshot maps
      // exactly; the clearcoat material (per-slot below) keeps the screen glare.
      const cands = [];
      base.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        o.geometry.computeBoundingBox();
        const s = o.geometry.boundingBox.getSize(new THREE.Vector3());
        const dims = [s.x, s.y, s.z].slice().sort((a, b) => a - b);
        cands.push({ o, thick: dims[0], area: dims[1] * dims[2] });
      });
      const minThick = Math.min(...cands.map((c) => c.thick));
      let screenMesh = null, bestArea = -1;
      for (const c of cands) if (c.thick <= minThick + 0.5 && c.area > bestArea) { bestArea = c.area; screenMesh = c.o; }
      if (screenMesh) {
        const g = screenMesh.geometry, pos = g.attributes.position;
        let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
        for (let vi = 0; vi < pos.count; vi++) {
          const x = pos.getX(vi), y = pos.getY(vi);
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        const uv = new Float32Array(pos.count * 2);
        for (let vi = 0; vi < pos.count; vi++) {
          uv[vi * 2] = 1 - (pos.getY(vi) - minY) / (maxY - minY);      // u = width (local Y, mirrored to read correctly)
          uv[vi * 2 + 1] = (pos.getX(vi) - minX) / (maxX - minX);      // v = length (local X)
        }
        g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        screenMesh.userData.lgpScreen = true;
      }

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
          if (o.userData && o.userData.lgpScreen) {
            const tex = i === 0 ? texInvite : loadTex(SHOTS[i]);
            // Emissive screenshot = bright/readable regardless of lights; clearcoat
            // over it reflects the key/rim lights as a glass GLARE streak (retained).
            o.material = new THREE.MeshPhysicalMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1, map: tex, roughness: 0.5, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, side: THREE.DoubleSide, toneMapped: false });
            screen = o;
          }
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
    });

    const t0 = performance.now();
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      if (disposed) return;
      const t = (performance.now() - t0) / 1000;
      const hash = window.location.hash || "";
      const dbgi = /lgpi=([\d.]+)/.exec(hash); // debug freeze: #lgpi=<pct> pins the INTRO
      if (reduce) {
        rig.scale.setScalar(1); mover.rotation.y = 16 * D; rig.position.y = nudgeY;
      } else if (dbgi || t < INTRO) {
        const pct = dbgi ? parseFloat(dbgi[1]) : (t / INTRO) * 100;
        const scale = kf(ZOOM, pct);
        rig.scale.setScalar(scale);
        // intro: zoom in WHILE sliding to the left pose, so the phone is already
        // on the left when the "invitation" caption appears (loop starts left).
        mover.position.x = kf([[0, 0], [100, -0.8]], pct);
        mover.rotation.y = kf([[0, 0], [100, 30 * D]], pct);
        ring.rotation.y = 0;
        // Lift as it zooms so the enlarged phone's BOTTOM stays put (never drops
        // onto the buttons). halfWorld ≈ 2.05/2; no top caption during the intro.
        rig.position.y = nudgeY + (scale - 1) * 1.025;
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
          if (s0.material.emissiveMap !== want) { s0.material.emissiveMap = want; s0.material.map = want; s0.material.needsUpdate = true; }
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
