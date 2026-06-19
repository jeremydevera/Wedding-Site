# Evermore — Wedding / Event Site

A single-page event website (guest-facing pages + a password-gated admin area),
built with **Vite + React**. Data is currently **mock data** held in the browser's
`localStorage` — there is no backend yet (Supabase + multi-tenant come next; see
`docs/superpowers/specs/`).

---

## Quick start (local)

```bash
npm install
npm run dev          # dev server with hot reload
# build + check the production output:
npm run build        # outputs to dist/
npm run preview      # serve the built dist/ locally
```

First load fetches Google Fonts from a CDN; everything else (React, the app, the QR
library) is bundled locally by Vite.

---

## Project structure

```
.
├── index.html            # Vite entry. Loads /src/main.jsx as a module.
├── vite.config.js        # Vite + @vitejs/plugin-react config (build -> dist/).
├── package.json
├── public/
│   └── assets/           # Static art, served at /assets/*
│       ├── invite/       # Envelope-theme art
│       └── samples/      # Placeholder photos (hero, story, gallery)
└── src/
    ├── main.jsx          # Entry: imports styles, app (self-mounts), drag helper.
    ├── styles.css        # All styling. Themed via CSS custom properties (--*).
    ├── nav.js            # Tiny hash-router helper: go("route").
    ├── store.jsx         # State + persistence (localStorage mock data).
    ├── themes.jsx        # Theme definitions (colors/fonts per look).
    ├── components.jsx    # Shared UI: Button, Modal, CropModal, Field, Countdown, icons, map helpers.
    ├── tweaks-panel.jsx  # Live style-tweak overlay.
    ├── pages-main.jsx    # Guest pages: Home, Story, Details, Schedule, Venue, Envelope hero.
    ├── rsvp.jsx          # RSVP form + flow.
    ├── media.jsx         # Photo upload + gallery.
    ├── social.jsx        # Guestbook, quiz, video messages.
    ├── admin-core.jsx    # Admin shell: sign-in, layout, navigation.
    ├── admin-manage.jsx  # Admin panels: settings, theme, venue, photos, content editors.
    ├── app.jsx           # Router + nav + footer. Mounts the app (ReactDOM.createRoot).
    └── drag-arrange.js   # Plain-JS drag-to-arrange helper for the envelope layout.
```

Modules are plain ES modules now (explicit `import`/`export`); Vite resolves the graph,
so script load order is no longer manual.

---

## Architecture notes

- **State & data (mock):** `store.jsx` holds all settings and guest-submitted data and
  persists to `localStorage`. **No server** — data is per-device, not shared between
  visitors. Real persistence/auth/multi-tenant is the next milestone (Supabase).
- **Defaults:** out-of-the-box content (names, date, venue, times, theme) lives in
  `DEFAULT_SETTINGS` at the top of `store.jsx`, or via Admin → Settings.
- **Theming:** colors/fonts are CSS custom properties switched by `themes.jsx`. Add a
  look by extending the `THEMES` map (a plain data object — no JSX needed).
- **Admin:** reachable via the "Admin sign in" link in the footer (mock password in
  `DEFAULT_SETTINGS.adminPassword`).

---

## Deploying (Cloudflare Pages)

This is a static SPA — deploy the build output:

- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Framework preset:** none / Vite

Connect the GitHub repo to Cloudflare Pages (or drag `dist/` to Netlify Drop for a quick
test). Routing is hash-based (`#/home`), so no SPA redirect rule is needed.

> Note: data is still browser-local mock data, so a deployed site won't share RSVPs or
> guestbook entries between devices until the Supabase backend is added.
