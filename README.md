# Evermore — Wedding Invitation Site

A single-page wedding website with a guest-facing invitation and a password-protected
admin area for the couple to manage everything. Built as a static site (no backend),
organized into small, single-responsibility modules so it stays easy to maintain.

---

## Quick start (local)

The pages load `.jsx` via the in-browser Babel transformer, so they must be served
over HTTP — **opening `index.html` from the file system will show a blank page.**

```bash
cd wedding-site
python3 -m http.server 8000      # then open http://localhost:8000
# or:  npx serve
# or:  VS Code → "Live Server" extension → Open with Live Server
```

Requires internet on first load (React, Babel, fonts, and the QR library load from CDNs).

---

## Project structure

```
wedding-site/
├── index.html            # Entry point. Loads CDN libs + app scripts in dependency order.
├── styles.css            # All styling. Themed via CSS custom properties (--*).
├── assets/
│   ├── invite/           # Envelope-theme art (envelope, paper, heart, frame, flowers, bg)
│   └── samples/          # Placeholder photos (hero, story, gallery)
└── js/
    ├── store.jsx         # State + persistence. Single source of truth (localStorage).
    ├── themes.jsx        # Theme definitions (colors/fonts per look).
    ├── components.jsx    # Shared UI: Button, Modal, CropModal, Field, Countdown, icons, map helpers.
    ├── tweaks-panel.jsx  # Live style-tweak overlay.
    ├── pages-main.jsx    # Guest pages: Home, Story, Details, Schedule, Venue, Envelope hero.
    ├── rsvp.jsx          # RSVP form + flow.
    ├── media.jsx         # Photo upload + gallery.
    ├── social.jsx        # Guestbook, quiz, video messages.
    ├── admin-core.jsx    # Admin shell: sign-in, layout, navigation.
    ├── admin-manage.jsx  # Admin panels: settings, theme, venue, photos, content editors.
    ├── app.jsx           # Router + nav + footer. Mounts the app.
    └── drag-arrange.js   # Plain-JS drag-to-arrange helper for the envelope layout.
```

**Load order matters** — `index.html` lists the scripts in dependency order
(`store` first, `app` last). If you add a module, insert it where its dependencies
are already defined.

---

## Architecture notes

- **State & data:** `store.jsx` holds all settings and guest-submitted data and persists
  to the browser's `localStorage`. There is **no server** — data is per-device and not
  shared between visitors. Real RSVP collection would require adding a backend.
- **Defaults:** the couple's defaults (names, date, venue, times, theme) live in the
  `DEFAULTS` object at the top of `store.jsx`. Edit there to change the out-of-the-box content.
- **Theming:** colors and fonts are CSS custom properties defined in `styles.css` and
  switched by `themes.jsx`. Add a theme by extending the `THEMES` map and adding its tokens.
- **Admin:** reachable via the "Admin sign in" link in the footer. Lets the couple edit
  content, venue/map, theme, and the envelope frame photo without touching code.

---

## How to make common changes

| I want to change…                | Edit…                                              |
|----------------------------------|----------------------------------------------------|
| Couple names / date / venue      | `DEFAULTS` in `js/store.jsx` (or Admin → Settings) |
| Colors / fonts                   | tokens in `styles.css`; theme map in `js/themes.jsx` |
| A guest page's copy or layout    | the matching component in `js/pages-main.jsx`      |
| RSVP questions/flow              | `js/rsvp.jsx`                                       |
| Envelope art / layout            | `assets/invite/*` and the envelope styles in `styles.css` |
| Admin panels                     | `js/admin-manage.jsx`                               |

---

## Deploying

Static host — drop the folder on **Netlify Drop**, **Vercel**, or **GitHub Pages**
(Settings → Pages → `main` / root). No build step required.

### Production note
The site compiles JSX in the browser on every load (fine for a personal site, slightly
slower first paint). For a faster, "production" build you'd precompile the `.jsx` to
plain JS and drop the Babel CDN script. Not required to run.
