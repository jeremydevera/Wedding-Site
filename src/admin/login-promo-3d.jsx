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
const MX = [[0, 0], [4, 0], [6, -0.8], [20, -0.8], [24, 0.8], [38, 0.8], [41, 0], [100, 0]];
const MR = [[0, 0], [4, 0], [6, 30 * D], [20, 30 * D], [24, -30 * D], [38, -30 * D], [41, 0], [100, 0]];
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
      // Dolly back on narrow/tall (mobile) so the phone fits with room for the top
      // caption and the bottom buttons; more back-off than desktop keeps it smaller.
      cam.position.z = Math.max(6.6, 5.4 / Math.max(aspect, 0.35));
      // Small downward nudge (mobile) so the phone sits a touch lower — tighter gap
      // to the buttons without tucking under them on short screens. Desktop centered.
      nudgeY = aspect < 0.8 ? -0.12 : 0;
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
        phone.traverse((o) => {
          if (o.userData && o.userData.lgpScreen) { o.material = new THREE.MeshBasicMaterial({ map: i === 0 ? texInvite : loadTex(SHOTS[i]), toneMapped: false, side: THREE.DoubleSide }); screen = o; }
        });
        const slot = new THREE.Group();
        slot.rotation.y = i * Math.PI / 2;
        const arm = new THREE.Group(); arm.position.z = R; arm.add(phone);
        slot.add(arm); ring.add(slot);
        if (i > 0) slot.visible = false; // intro + snap phase show ONE phone
        slots.push({ slot, phone, screen });
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
        mover.position.x = 0;          // intro: phone CENTERED
        mover.rotation.y = 0; ring.rotation.y = 0;
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
        // phones 2-4 join for the carousel phase (match CSS lgp-join 40→44/95→99)
        const joinOp = kf([[0, 0], [40, 0], [44, 1], [95, 1], [99, 0], [100, 0]], pct);
        for (let i = 1; i < slots.length; i++) slots[i].slot.visible = joinOp > 0.5;
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
