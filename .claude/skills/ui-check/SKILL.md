---
name: ui-check
description: Verify the rendered UI with Playwright before claiming any visual change works. Use ALWAYS after touching CSS, layout, themes, the envelope cover, admin tables/charts, or any component's markup — and before pushing such a change. Measures real geometry at desktop + phone viewport shapes and writes screenshots to look at.
---

# UI check (Playwright)

Unit tests here pass while the UI is visibly broken, because the bugs in this
project are **geometry, not logic**. Real examples that shipped:

- cover names overlapping the wax seal
- names running off the top of the screen on wide/short desktops (mobile looked perfect)
- a coach-mark half off a phone's right edge, copy cut in half
- the RSVP tooltip painting *behind* the Recent RSVPs table
- a chart legend clipped on mobile because a later unconditional rule beat the media query

None of those were catchable without measuring a really-rendered page.

## Run it

```bash
npm run build && npm run ui:check
```

Narrow it while iterating:

```bash
node scripts/ui-check.mjs --client kevin-joana --vp desktop
node scripts/ui-check.mjs --shots-only       # capture only, no assertions
```

Screenshots land in `.ui-check/` (git-ignored). **Look at them** — assertions
only catch what they were told to check; the screenshot catches the rest.

## When this is mandatory

Run it before pushing any change that touches:

- `src/styles/styles.css`, any theme, or `src/themes/*`
- the envelope cover / invite (`PublicPages.jsx`) — cover text, seal, reveal timing
- public nav, footer, or the drawer
- admin tables, charts, gauges, tooltips, popovers, modals
- fonts, font sizes, or anything using `cqw`/`vw`/`vh` units

## What it asserts

Per client (`kevin-joana`, `demo`) × 6 viewport shapes (including a **wide-short**
1280×600 desktop, which is the shape that exposes cover-scaling bugs):

- cover text is ≥8px from the top, never overlaps the wax seal, and the name
  lines sit inside the viewport
- the document does not scroll sideways (names the widest offending element)
- every visible `<img>` actually decoded
- desktop nav still exposes the Login CTA
- no uncaught JS errors (console noise and aborted media are notes, not failures)

## Extending it

Add an assertion whenever you fix a visual bug, so it cannot come back. Keep the
three hard-won details in the script's header comment intact — one browser
context per device class (a context per viewport burns anonymous Firebase
sessions and gets rate-limited into fake "site isn't available" failures), a
`state:"attached"` mount wait (the nav is `display:none` behind the cover), and
measuring text rather than containers (`.inv-letter-from` is deliberately wider
than a phone; `.inv-lf-probe` elements are hidden measuring probes).

## Reporting

Give the owner the numbers, not just "looks fine" — e.g. "cover clears the seal
by 37px on desktop, 91px on phone; worst top clearance 28px at 1280×600". If a
check fails, fix the UI, do not loosen the assertion, unless the assertion is
provably measuring the wrong thing (that has happened — twice).
