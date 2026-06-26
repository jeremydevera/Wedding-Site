import { test, expect } from "@playwright/test";

// ============================================================================
// Public (no-auth, no-write) scenarios from docs/TEST-CASES.md.
// Safe to run repeatedly against the live deploy (PW_BASE_URL override) — no
// logins, no DB writes (submit paths are exercised only up to client-side
// validation). Admin/superadmin, moderation, persistence and media-upload
// cases need a login and are NOT here (run manually).
//
// The demo client is currently the Olive Envelope theme (home nav hidden behind
// the sealed cover) with story+gallery off, rsvp+guestbook+quiz+venue on — the
// tests are written to tolerate that and to skip cleanly if a section is off.
// ============================================================================

async function gotoApp(page, path) {
  await page.goto(path);
  await page.locator(".footer, .signin, .admin__side").first().waitFor({ state: "attached", timeout: 15_000 });
}
const usePicker = (page) => page.locator(".nav__themepick select");

function trackConsoleErrors(page) {
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}
const IGNORE = [/favicon/i, /\/auth\/v1\/token/i, /net::ERR_/i, /Failed to load resource/i];
const realErrors = (errs) => errs.filter((e) => !IGNORE.some((re) => re.test(e)));

test.describe("A. Routing & shell", () => {
  test("A2 demo shows a theme picker (not the RSVP CTA) in the nav", async ({ page }) => {
    await gotoApp(page, "/details"); // nav is visible on a content page
    await expect(usePicker(page)).toHaveCount(1);
  });

  test("A5 deep links render their page (venue/schedule/quiz)", async ({ page }) => {
    await gotoApp(page, "/venue");
    await expect(page.locator('iframe[title="Venue map"]')).toBeVisible();
    await gotoApp(page, "/schedule");
    await expect(page.locator(".timeline, .sched-cards, .sched-min, .sched-cols").first()).toBeVisible();
  });
});

test.describe("B. Themes (preview only — no save)", () => {
  test("B1 picking themes updates the applied theme", async ({ page }) => {
    await gotoApp(page, "/details");
    const picker = usePicker(page);
    test.skip(!(await picker.count()), "no theme picker (not demo)");
    for (const t of ["classic", "noir", "blush"]) {
      await picker.selectOption(t);
      await expect(page.locator("html")).toHaveAttribute("data-theme", t);
    }
  });

  test("B3 premium group exists with envelope", async ({ page }) => {
    await gotoApp(page, "/details");
    const picker = usePicker(page);
    test.skip(!(await picker.count()), "no theme picker");
    const hasPremiumGroup = await picker.locator('optgroup[label*="Premium"] option[value="envelope"]').count();
    expect(hasPremiumGroup).toBeGreaterThan(0);
  });

  test("B7 preview reverts to the saved theme on reload", async ({ page }) => {
    await gotoApp(page, "/details");
    const picker = usePicker(page);
    test.skip(!(await picker.count()), "no theme picker");
    const saved = await page.locator("html").getAttribute("data-theme");
    const other = saved === "classic" ? "noir" : "classic";
    await picker.selectOption(other);
    await expect(page.locator("html")).toHaveAttribute("data-theme", other);
    await page.reload();
    await page.locator(".footer").first().waitFor({ state: "attached" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", saved);
  });
});

test.describe("C/D. Envelope theme", () => {
  test("C1 envelope home shows its own decoration layer (built-in)", async ({ page }) => {
    await gotoApp(page, "/home");
    test.skip(!(await page.locator(".eg-hero").count()), "demo not on envelope theme");
    // the celebrate section carries the built-in FloatingDecor
    await expect(page.locator("#home-countdown")).toHaveCount(1);
  });

  test("D1 envelope seals then opens (unlocks scroll)", async ({ page }) => {
    await gotoApp(page, "/home");
    if (!(await page.locator(".eg-hero").count())) {
      const picker = usePicker(page);
      test.skip(!(await picker.count()), "not envelope and no picker");
      await picker.selectOption("envelope");
    }
    await expect(page.locator(".eg-hero")).toBeVisible();
    await expect(page.locator("body.env-sealed")).toHaveCount(1);
    await page.locator(".inv-seal-hotspot").click();
    await expect(page.locator(".eg-hero.is-open")).toBeVisible();
    await expect(page.locator("body.env-sealed")).toHaveCount(0);
  });

  test("D6 heart date is formatted DD.MM.YYYY", async ({ page }) => {
    await gotoApp(page, "/home");
    const heart = page.locator(".inv-heart-text").first();
    test.skip(!(await heart.count()), "not envelope theme");
    await expect(heart).toHaveText(/\d{2}\.\d{2}\.\d{4}/);
  });
});

test.describe("E. Module gating", () => {
  test("E3 footer has no Upload link (gallery off)", async ({ page }) => {
    await gotoApp(page, "/home");
    const labels = await page.locator(".footer__links button").allInnerTexts();
    expect(labels.join(" ").toLowerCase()).not.toContain("upload");
  });

  test("E2 disabled gallery URL falls back to home (no gallery UI)", async ({ page }) => {
    await gotoApp(page, "/gallery");
    await expect(page.locator(".gal-grid, .gal-empty")).toHaveCount(0);
    await expect(page.locator(".hero, .eg-hero").first()).toBeVisible();
  });

  test("E2b disabled story URL falls back to home", async ({ page }) => {
    await gotoApp(page, "/story");
    await expect(page.locator(".story-row")).toHaveCount(0);
    await expect(page.locator(".hero, .eg-hero").first()).toBeVisible();
  });
});

test.describe("F/G. Home & content", () => {
  test("A5/F1 home loads with hero, no console errors", async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await gotoApp(page, "/home");
    await expect(page).toHaveTitle(/Celebrately|Evermore/);
    await expect(page.locator(".hero, .eg-hero").first()).toBeVisible();
    expect(realErrors(errs), realErrors(errs).join(" | ")).toHaveLength(0);
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

  test("G1 Details ceremony shows a real dash, not a raw \\u escape", async ({ page }) => {
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
    if ((await qs.count()) >= 2) {
      await qs.nth(1).click();
      await expect(page.locator(".faq-item--open")).toHaveCount(1);
    }
  });

  test("G4 schedule lists timeline items", async ({ page }) => {
    await gotoApp(page, "/schedule");
    const items = page.locator(".tl-item, .sched-cards__item, .sched-min__row, .sched-cols__row");
    expect(await items.count()).toBeGreaterThan(0);
  });

  test("G5 venue map + Get Directions present", async ({ page }) => {
    await gotoApp(page, "/venue");
    await expect(page.locator('iframe[title="Venue map"]')).toBeVisible();
    await expect(page.getByText(/Get Directions/i)).toBeVisible();
  });
});

test.describe("H. RSVP validation (no submit)", () => {
  test("H1 blank name blocked", async ({ page }) => {
    await gotoApp(page, "/rsvp");
    test.skip(!(await page.locator("#r-name").count()), "RSVP off");
    await page.locator('button[type="submit"]').click();
    await expect(page.locator(".field__error")).toContainText(/name/i);
    await expect(page.locator("#r-name")).toBeVisible();
  });

  test("H4 notes over 1000 chars blocked (no submit)", async ({ page }) => {
    await gotoApp(page, "/rsvp");
    test.skip(!(await page.locator("#r-name").count()), "RSVP off");
    await page.fill("#r-name", "ZZ_TEST");
    await page.fill("#r-notes", "x".repeat(1001));
    await page.locator('button[type="submit"]').click();
    await expect(page.locator(".field__error")).toContainText(/1000/);
    await expect(page.locator(".confirm__title")).toHaveCount(0); // did NOT submit
  });

  test("H5 not-attending hides the guest-count field", async ({ page }) => {
    await gotoApp(page, "/rsvp");
    test.skip(!(await page.locator("#r-name").count()), "RSVP off");
    await page.getByText("Regretfully decline").click();
    await expect(page.locator("#r-count")).toHaveCount(0);
  });

  test("H6 count > 1 reveals the guest-names field", async ({ page }) => {
    await gotoApp(page, "/rsvp");
    test.skip(!(await page.locator("#r-count").count()), "RSVP off / not attending");
    await page.selectOption("#r-count", "2");
    await expect(page.locator("#r-plus")).toBeVisible();
  });
});

test.describe("I/J. Guestbook & Quiz validation (no submit)", () => {
  test("I1 guestbook blank submit blocked", async ({ page }) => {
    await gotoApp(page, "/guestbook");
    const open = page.getByRole("button", { name: /Sign the guestbook/i });
    test.skip(!(await open.count()), "guestbook off");
    await open.first().click();
    await page.getByRole("button", { name: /Post message/i }).click();
    await expect(page.locator(".field__error").first()).toBeVisible();
  });

  test("J1 quiz requires a name to start", async ({ page }) => {
    await gotoApp(page, "/quiz");
    const start = page.getByRole("button", { name: /Start the quiz/i });
    test.skip(!(await start.count()), "quiz off");
    await start.click();
    await expect(page.locator(".field__error")).toContainText(/name/i);
  });
});

test.describe("N. Responsive", () => {
  test("N1 mobile drawer opens with an opaque panel", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApp(page, "/details");
    await page.locator(".nav__burger").first().click();
    const panel = page.locator(".drawer__panel");
    await expect(panel).toBeVisible();
    const bg = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("N2 no horizontal scroll at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApp(page, "/details");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
