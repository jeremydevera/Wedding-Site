#!/usr/bin/env node
// scripts/ui-check.mjs — geometry/visual guard for the public site.
//
// WHY: several shipped bugs were invisible to unit tests because they are
// geometry, not logic — cover names overlapping the wax seal, names running off
// the top on wide/short desktops, a coach-mark hanging off a phone's right edge,
// a tooltip painting behind a table, a clipped chart legend. Each was only
// findable by measuring a really-rendered page at several viewport shapes.
//
// Usage:
//   npm run ui:check                      # run `npm run build` first
//   node scripts/ui-check.mjs --shots-only
//   node scripts/ui-check.mjs --client kevin-joana --vp desktop
//
// Non-zero exit if any invariant fails, so it can gate a deploy.
//
// THREE THINGS THIS SCRIPT LEARNED THE HARD WAY (do not "simplify" them away):
//  1. ONE browser context per device class, reused across sizes. A context per
//     viewport means a new ANONYMOUS Firebase session per viewport; a dozen of
//     those in a minute gets rate-limited and every page then renders "This site
//     isn't available" — which reads exactly like a real app bug. Storage state
//     is cached under .ui-check/ so repeat runs reuse the same session.
//  2. Wait for the mount with state:"attached". While the envelope cover is up,
//     body.env-sealed sets .nav { display:none }, so a visibility wait never
//     resolves even though the app IS mounted.
//  3. Measure text, not containers, and skip .inv-lf-probe. .inv-letter-from is
//     78% of the COVER (wider than a phone by design) and hidden probes share the
//     .inv-lf-names class — measuring either reports overflow that isn't real.

import { createServer } from "http";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { extname, join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const OUT = join(ROOT, ".ui-check");
const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  const v = i === -1 ? "" : args[i + 1] || "";
  return v.startsWith("--") ? "" : v;
};
const SHOTS_ONLY = args.includes("--shots-only");
const ONLY_CLIENT = argOf("--client");
const ONLY_VP = argOf("--vp");

if (!existsSync(join(DIST, "index.html"))) {
  console.error("No dist/ build found — run `npm run build` first.");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

// ── serve the built app ─────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".mp4": "video/mp4", ".woff2": "font/woff2", ".json": "application/json",
  ".glb": "model/gltf-binary", ".wasm": "application/wasm",
};
const server = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let f = join(DIST, u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname));
  if (!existsSync(f) || !extname(f)) f = join(DIST, "index.html"); // SPA fallback
  res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
});
// Ephemeral port: a fixed one gets held by a leftover run, listen() then emits
// EADDRINUSE asynchronously and every page fails for a bogus reason.
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const PORT = server.address().port;

const pw = await import(join(ROOT, "node_modules/playwright/index.js"));
const chromium = pw.chromium || (pw.default && pw.default.chromium);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Real subdomains mapped to this server: the tenant is resolved from the
// hostname (localhost always resolves to "demo", so spoofing the host is the
// only way to exercise another client's theme locally).
const CLIENTS = ONLY_CLIENT ? [ONLY_CLIENT] : ["kevin-joana", "demo"];
const HOST_RULES = "--host-resolver-rules=" + CLIENTS.map((c) => `MAP ${c}.celebrately.us 127.0.0.1`).join(",");

// wide-and-short matters most: the cover is sized max(142vw, 215vh), so those
// windows scale the art — and its cqw-based text — up the hardest.
const VIEWPORTS = [
  { name: "wide-short", width: 1280, height: 600, kind: "desktop" },
  { name: "desktop", width: 1440, height: 900, kind: "desktop" },
  { name: "large", width: 1920, height: 1080, kind: "desktop" },
  { name: "laptop", width: 1366, height: 768, kind: "desktop" },
  { name: "phone", width: 390, height: 844, kind: "mobile" },
  { name: "phone-small", width: 360, height: 640, kind: "mobile" },
].filter((v) => !ONLY_VP || v.name === ONLY_VP);

const failures = [];
const fail = (where, msg) => { failures.push(`${where}: ${msg}`); console.log(`  FAIL ${where} — ${msg}`); };
const ok = (where, msg) => console.log(`  ok   ${where} — ${msg}`);
const note = (where, msg) => console.log(`  note ${where} — ${msg}`);

const browser = await chromium.launch({ headless: true, args: [HOST_RULES] });

for (const client of CLIENTS) {
  for (const kind of ["desktop", "mobile"]) {
    const vps = VIEWPORTS.filter((v) => v.kind === kind);
    if (!vps.length) continue;
    const statePath = join(OUT, `state-${client}-${kind}.json`);
    const ctx = await browser.newContext({
      viewport: { width: vps[0].width, height: vps[0].height },
      deviceScaleFactor: kind === "mobile" ? 2 : 1,
      isMobile: kind === "mobile", hasTouch: kind === "mobile",
      storageState: existsSync(statePath) ? statePath : undefined,
    });
    const page = await ctx.newPage();
    const jsErrors = [], warnings = [];
    page.on("pageerror", (e) => jsErrors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") warnings.push("console: " + m.text().slice(0, 90)); });
    page.on("requestfailed", (r) => warnings.push(`reqfail: ${r.url().split("/").pop()} ${(r.failure() || {}).errorText || ""}`));

    for (const vp of vps) {
      const label = `${client}/${vp.name}`;
      jsErrors.length = 0; warnings.length = 0;
      try {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`http://${client}.celebrately.us:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
        const MOUNT = ".nav, .eg-sealed, .inv-stage";
        try {
          await page.waitForSelector(MOUNT, { state: "attached", timeout: 25000 });
        } catch {
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.waitForSelector(MOUNT, { state: "attached", timeout: 25000 });
        }
        await sleep(1200);

        // ── envelope cover, for themes that gate the site behind one ──────────
        if (await page.locator(".eg-sealed").count()) {
          await page.waitForSelector(".eg-sealed.is-ready", { state: "attached", timeout: 20000 }).catch(() => {});
          await sleep(3200); // names type on, seal monogram fades in
          const cover = await page.evaluate(() => {
            const blk = document.querySelector(".eg-sealed .inv-letter-from");
            const seal = document.querySelector(".eg-sealed .inv-seal-hotspot");
            const names = document.querySelector(".eg-sealed .inv-lf-names:not(.inv-lf-probe)");
            if (!blk || !seal || !names) return null;
            const b = blk.getBoundingClientRect(), s = seal.getBoundingClientRect();
            const lines = [...names.querySelectorAll(".inv-lf-stack > span")]; // name / & / name
            const boxes = (lines.length ? lines : [names]).map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
            return {
              top: Math.round(b.top),
              gapToSeal: Math.round(s.top - b.bottom),
              inkLeft: Math.round(Math.min(...boxes.map((r) => r.left))),
              inkRight: Math.round(Math.max(...boxes.map((r) => r.right))),
              font: getComputedStyle(names).fontSize,
              vw: window.innerWidth,
            };
          });
          if (cover && !SHOTS_ONLY) {
            cover.top >= 8 ? ok(label, `cover text ${cover.top}px from top`) : fail(label, `cover text only ${cover.top}px from top (clipping)`);
            cover.gapToSeal >= 0 ? ok(label, `clears wax seal by ${cover.gapToSeal}px`) : fail(label, `cover text overlaps the wax seal by ${-cover.gapToSeal}px`);
            (cover.inkLeft >= 0 && cover.inkRight <= cover.vw)
              ? ok(label, `cover names fit (${cover.font})`)
              : fail(label, `cover names out of viewport (${cover.inkLeft}..${cover.inkRight} of ${cover.vw})`);
          }
          await page.screenshot({ path: join(OUT, `${client}-${vp.name}-cover.png`) });
          const opener = page.locator(".inv-seal-hotspot");
          if (await opener.count()) { await opener.first().click(); await sleep(5000); }
        }

        // ── the page ─────────────────────────────────────────────────────────
        const body = await page.evaluate(() => {
          const de = document.documentElement;
          const offenders = [...document.querySelectorAll("body *")]
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && r.right > window.innerWidth + 2;
            })
            .slice(0, 5)
            .map((el) => String(el.className || el.tagName).slice(0, 36));
          const imgs = [...document.querySelectorAll("img")].filter((i) => i.getBoundingClientRect().width > 0);
          return {
            hScroll: de.scrollWidth - de.clientWidth,
            offenders,
            brokenImgs: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src.split("/").pop()),
            navCtas: [...document.querySelectorAll(".nav__cta")].map((b) => b.textContent.trim()),
          };
        });
        if (!SHOTS_ONLY) {
          body.hScroll <= 2 ? ok(label, "no horizontal scroll") : fail(label, `document scrolls sideways ${body.hScroll}px (widest: ${body.offenders.join(", ") || "?"})`);
          body.brokenImgs.length === 0 ? ok(label, "images all loaded") : fail(label, `broken images: ${body.brokenImgs.join(", ")}`);
          if (vp.kind === "desktop") {
            body.navCtas.some((t) => /login/i.test(t))
              ? ok(label, `nav CTAs [${body.navCtas.join(", ")}]`)
              : fail(label, `nav missing the Login CTA (got [${body.navCtas.join(", ")}])`);
          }
          jsErrors.length === 0 ? ok(label, "no uncaught JS errors") : fail(label, `pageerror: ${jsErrors[0].slice(0, 90)}`);
          if (warnings.length) note(label, `${warnings.length} warning(s), first: ${warnings[0].slice(0, 70)}`);
        }
        await page.screenshot({ path: join(OUT, `${client}-${vp.name}-home.png`) });
      } catch (e) {
        fail(label, `threw: ${String(e.message).split("\n")[0].slice(0, 110)}`);
      }
    }
    await ctx.storageState({ path: statePath }).catch(() => {});
    await ctx.close();
  }
}

await browser.close();
server.close();

console.log(`\nscreenshots: ${OUT}`);
if (failures.length) {
  console.log(`\n${failures.length} UI check failure(s):`);
  for (const f of failures) console.log(" - " + f);
  process.exit(1);
}
console.log("all UI checks passed");
