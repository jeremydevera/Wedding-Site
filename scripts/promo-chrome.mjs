#!/usr/bin/env node
// scripts/promo-chrome.mjs — wrap a captured app screen in mobile browser chrome
// for the login promo's 3D phone (public/assets/login-scr-*.jpg).
//
// The promo screens must look like a REAL phone browsing the site: an
// edge-to-edge app render reads as fake. Owner's spec (2026-08-03/05): iOS-style
// status bar on top, NO URL bar, and a plain bottom bar with no icons.
//
//   node scripts/promo-chrome.mjs <content.png> <outName>
//   node scripts/promo-chrome.mjs shots/demo-cover.png login-scr-invite
//
// The content image must already be the CONTENT-AREA aspect: 600x1134, i.e.
// captured at 390x737 (any deviceScaleFactor). Anything taller is pinned to the
// top and cropped.

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [srcArg, outName] = process.argv.slice(2);
if (!srcArg || !outName) {
  console.error("usage: node scripts/promo-chrome.mjs <content.png> <outName e.g. login-scr-invite>");
  process.exit(2);
}
const SRC = resolve(srcArg);
if (!existsSync(SRC)) { console.error(`no such content image: ${SRC}`); process.exit(2); }

const W = 600, H = 1298, STATUS = 88, URLROW = 0, BOTTOM = 76; // URLROW 0 = no URL bar
const CONTENT = H - STATUS - URLROW - BOTTOM;                   // 1134
const TMP = join(ROOT, ".ui-check");
mkdirSync(TMP, { recursive: true });

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:${W}px;height:${H}px;background:#1c1c1e;overflow:hidden;
       font-family:-apple-system,"SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  .status{height:${STATUS}px;display:flex;align-items:center;justify-content:space-between;padding:0 34px 6px;color:#fff}
  .time{font-size:23px;font-weight:600;letter-spacing:.2px}
  .ind{display:flex;align-items:center;gap:9px}
  .content{height:${CONTENT}px;overflow:hidden;position:relative;background:#fff}
  .content img{position:absolute;left:0;top:0;width:${W}px;display:block}
  .bar{height:${BOTTOM}px}
</style></head><body>
  <div class="status">
    <span class="time">9:41</span>
    <span class="ind">
      <svg width="24" height="17" viewBox="0 0 24 17" fill="#fff"><rect x="0" y="11" width="4" height="6" rx="1.2"/><rect x="6.5" y="8" width="4" height="9" rx="1.2"/><rect x="13" y="4.5" width="4" height="12.5" rx="1.2"/><rect x="19.5" y="1" width="4" height="16" rx="1.2" opacity=".4"/></svg>
      <svg width="23" height="17" viewBox="0 0 23 17" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M2 6.2C5 3.4 8.1 2 11.5 2S18 3.4 21 6.2"/><path d="M5.6 10C7.5 8.3 9.4 7.5 11.5 7.5s4 .8 5.9 2.5"/><circle cx="11.5" cy="14.2" r="1.4" fill="#fff" stroke="none"/></svg>
      <svg width="35" height="18" viewBox="0 0 35 18"><rect x="0.9" y="0.9" width="29" height="16.2" rx="5" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.8"/><rect x="3.2" y="3.2" width="21" height="11.6" rx="3.2" fill="#fff"/><path d="M32 6.2v5.6c1.7-.5 2.4-1.5 2.4-2.8S33.7 6.7 32 6.2z" fill="#fff" fill-opacity=".45"/></svg>
    </span>
  </div>
  <div class="content"><img src="file://${SRC}"></div>
  <div class="bar"></div>
</body></html>`;

const htmlPath = join(TMP, `promo-${outName}.html`);
writeFileSync(htmlPath, html);

const pw = await import(join(ROOT, "node_modules/playwright/index.js"));
const chromium = pw.chromium || (pw.default && pw.default.chromium);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(`file://${htmlPath}`, { waitUntil: "load" });
await page.waitForTimeout(600);
const png = join(TMP, `promo-${outName}.png`);
await page.screenshot({ path: png });
await ctx.close();
await browser.close();

// JPEG for the texture (the velvet art is noisy, so it needs a lower quality to
// stay a sane size; these load with the lazy 3D chunk).
const out = join(ROOT, "public/assets", `${outName}.jpg`);
const quality = outName.includes("invite") ? "72" : "86";
execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", quality, png, "--out", out]);
console.log(`wrote ${out}`);
