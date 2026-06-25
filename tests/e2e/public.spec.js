import { test, expect } from "@playwright/test";

// ============================================================================
// Public (no-auth) smoke scenarios from docs/TEST-CASES.md.
// Targets the live deploy (PW_BASE_URL override). Written defensively: the demo
// client's theme/modules can change (it's currently the Olive Envelope theme,
// which hides the home nav behind the sealed envelope), so we wait for the app
// to mount and assert invariants that hold either way.
// ============================================================================

// Navigate and wait for the React app to actually render (Vite SPA mounts after
// load, so checking the DOM immediately races hydration).
async function gotoApp(page, path) {
  await page.goto(path);
  // Wait past the "Loading…" gate to a real post-load landmark. Use `attached`
  // (not `visible`) because on the envelope home the nav/footer can be present
  // but visually behind the sealed cover.
  await page.locator(".footer, .signin, .admin__side").first().waitFor({ state: "attached", timeout: 15_000 });
}

function trackConsoleErrors(page) {
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}
const IGNORE = [/favicon/i, /\/auth\/v1\/token/i, /net::ERR_/i, /Failed to load resource/i];
const realErrors = (errs) => errs.filter((e) => !IGNORE.some((re) => re.test(e)));

test.describe("Home (TC-F, routing)", () => {
  test("A5/F1 home loads with title + hero, no console errors", async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await gotoApp(page, "/home");
    await expect(page).toHaveTitle(/Celebrately|Evermore/);
    await expect(page.locator(".hero, .eg-hero").first()).toBeVisible();
    expect(realErrors(errs), `console errors: ${realErrors(errs).join(" | ")}`).toHaveLength(0);
  });

  test("F2 countdown shows numbers, never NaN", async ({ page }) => {
    await gotoApp(page, "/home");
    const cd = page.locator(".countdown").first();
    if (await cd.count()) {
      const txt = await cd.innerText();
      expect(txt).not.toMatch(/NaN/);
      expect(txt).toMatch(/\d/);
    }
  });
});

test.describe("Footer & module gating (TC-E)", () => {
  test("E3 footer has no Upload link (gallery globally off)", async ({ page }) => {
    await gotoApp(page, "/home");
    const labels = await page.locator(".footer__links button").allInnerTexts();
    expect(labels.join(" ").toLowerCase()).not.toContain("upload");
  });

  test("E2 disabled section URL does not show that section (gallery → home)", async ({ page }) => {
    await gotoApp(page, "/gallery");
    await expect(page.locator(".gal-grid, .gal-empty")).toHaveCount(0);
    await expect(page.locator(".hero, .eg-hero").first()).toBeVisible();
  });
});

test.describe("Details page (TC-G)", () => {
  test("G1 ceremony line shows a real dash, not a raw \\u escape", async ({ page }) => {
    await gotoApp(page, "/details");
    const body = await page.locator("body").innerText();
    if (/The ceremony will be unplugged/.test(body)) {
      expect(body).not.toMatch(/\\u[0-9a-fA-F]{4}/);
      expect(body).toMatch(/unplugged — be/);
    }
  });

  test("G2 FAQ accordion opens one item at a time", async ({ page }) => {
    await gotoApp(page, "/details");
    const qs = page.locator(".faq-q");
    // The first FAQ is open by default, so click a *different* one and assert
    // exactly one stays open (accordion behavior).
    if ((await qs.count()) >= 2) {
      await qs.nth(1).click();
      await expect(page.locator(".faq-item--open")).toHaveCount(1);
    }
  });
});

test.describe("RSVP validation (TC-H, no submit)", () => {
  test("H1 blank name is blocked", async ({ page }) => {
    await gotoApp(page, "/rsvp");
    test.skip(!(await page.locator("#r-name").count()), "RSVP module disabled on this client");
    await page.locator('button[type="submit"]').click();
    await expect(page.locator(".field__error")).toContainText(/name/i);
    await expect(page.locator("#r-name")).toBeVisible(); // did not submit
  });

  test("H5 not-attending hides the guest-count field", async ({ page }) => {
    await gotoApp(page, "/rsvp");
    test.skip(!(await page.locator("#r-name").count()), "RSVP module disabled on this client");
    await page.getByText("Regretfully decline").click();
    await expect(page.locator("#r-count")).toHaveCount(0);
  });
});

test.describe("Envelope theme (TC-B, TC-D)", () => {
  test("B7/D1 envelope seals then opens (unlocks scroll)", async ({ page }) => {
    await gotoApp(page, "/home");
    // If the live theme isn't envelope, switch via the demo theme picker.
    if (!(await page.locator(".eg-hero").count())) {
      const picker = page.locator(".nav__themepick select");
      test.skip(!(await picker.count()), "not envelope and no theme picker");
      await picker.selectOption("envelope");
    }
    await expect(page.locator(".eg-hero")).toBeVisible();
    await expect(page.locator("body.env-sealed")).toHaveCount(1); // scroll locked
    await page.locator(".inv-seal-hotspot").click();
    await expect(page.locator(".eg-hero.is-open")).toBeVisible();
    await expect(page.locator("body.env-sealed")).toHaveCount(0); // unlocked
  });
});

test.describe("Responsive (TC-N)", () => {
  test("N1 mobile drawer opens with an opaque panel", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // Use a content page — the envelope cover hides the home nav until opened.
    await gotoApp(page, "/details");
    await page.locator(".nav__burger").first().click();
    const panel = page.locator(".drawer__panel");
    await expect(panel).toBeVisible();
    const bg = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)"); // not transparent (backdrop-filter trap regression)
  });
});
