import { defineConfig, devices } from "@playwright/test";

// E2E smoke suite for the wedding site. Targets the LIVE deploy by default so the
// scheduled cloud routine can run it with no build/auth/env setup. Override the
// target with PW_BASE_URL (e.g. a local preview) when running by hand.
//
//   npm run test:e2e
//   PW_BASE_URL=http://localhost:4173 npm run test:e2e
//
// Only no-auth, deterministic scenarios live here. Admin/superadmin/media-
// persistence cases need a login (and would write to prod) — keep those manual.
const BASE_URL = process.env.PW_BASE_URL || "https://wedding-site-8nh.pages.dev";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  retries: 1, // tolerate transient network/CDN blips on the live target
  reporter: [["list"], ["json", { outputFile: "playwright-report.json" }]],
  use: {
    baseURL: BASE_URL,
    headless: true,
    actionTimeout: 8_000,
    navigationTimeout: 20_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
