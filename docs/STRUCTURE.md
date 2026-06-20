# Project structure

Best-practice layout, organized by responsibility so the codebase scales to
many themes and event types (weddings, birthdays, corporate, …) without a
rewrite. Imports use the `@/` alias (→ `src/`), so files can move between
folders without breaking importers.

```
src/
├── main.jsx              # Vite entry: loads styles, mounts <App/>, loads drag helper
├── app/
│   └── App.jsx           # Root: router, nav, footer, tweaks panel
├── lib/                  # Framework-agnostic plumbing
│   ├── store.jsx         # State + persistence (localStorage mock; → Supabase later)
│   ├── nav.js            # Hash-router helper: go("route")
│   └── drag-arrange.js   # Plain-JS drag-to-arrange helper
├── ui/                   # Shared, reusable presentation primitives
│   ├── components.jsx    # Button, Field, Modal, CropModal, Countdown, Icon, FloatingDecor…
│   └── tweaks-panel.jsx  # Live style-tweak overlay
├── pages/
│   └── PublicPages.jsx   # Guest pages: Home, Story, Details, Schedule, Venue (+ envelope hero)
├── features/             # Self-contained guest features
│   ├── rsvp.jsx
│   ├── media.jsx         # Upload + gallery
│   └── social.jsx        # Guestbook + quiz
├── admin/                # Operator/owner admin area
│   ├── core.jsx          # Sign-in, shell, layout
│   └── manage.jsx        # Settings/theme/venue/content editors
├── themes/               # Visual look system
│   ├── registry.jsx      # THEMES tokens, fonts, applyTheme()
│   └── index.js          # Barrel — import from "@/themes"
├── config/
│   └── eventTypes.js     # Event-type registry (wedding/birthday/corporate)
├── templates/            # (reserved) per-event-type layout templates
└── styles/
    └── styles.css        # All CSS (themed via CSS custom properties)
```

Path alias: `@/x` → `src/x` (configured in `vite.config.js` and `jsconfig.json`).

---

## How to add a new theme (a new "look")

A theme is a set of CSS custom properties (colors, fonts, radius). No JSX.

1. Add an entry to `THEMES` in `src/themes/registry.jsx`:
   ```js
   midnight: {
     label: "Midnight Blue",
     blurb: "Deep navy with silver.",
     vars: { "--bg": "...", "--ink": "...", "--accent": "...", "--font-display": "...", "--font-body": "...", "--radius": "6px" },
   },
   ```
2. (Optional) add font/radius/button defaults in `THEME_FONTS` / `THEME_BTN`.
3. Make it selectable for the event types that should offer it — add the key to
   the relevant `themes:` array in `src/config/eventTypes.js`.

That's it — the theme picker and `applyTheme()` pick it up automatically.

---

## How to add a new event type (e.g. birthday, corporate)

Event types reuse the same engine with different terminology, sections, and
theme set. Add an entry to `EVENT_TYPES` in `src/config/eventTypes.js`:

```js
anniversary: {
  label: "Anniversary",
  terms: { host: "the couple", action: "Celebrating us", rsvp: "Join us?" },
  sections: ["story", "details", "schedule", "venue", "gallery", "guestbook"],
  defaultTheme: "champagne",
  themes: ["champagne", "blush", "burgundy", "classic"],
},
```

- `sections` — which guest sections show for this event type. Page/nav rendering
  reads `hasSection(eventType, name)`.
- `themes` — which looks the admin can assign for this event type
  (`themesForEvent(eventType)`).
- `terms` — copy tokens (host role, hero action line, RSVP heading). The page
  components currently hardcode wedding copy; migrate strings to read from
  `eventType(key).terms` as each event type is brought online.

No new framework, route, or build change is needed — the structure absorbs new
event types as data.

---

## Conventions

- **Imports** use `@/…` (never deep relative `../../`).
- **`ui/`** = generic and reusable; **`features/`** = one guest capability each;
  **`pages/`** = compositions of `ui` + `features`.
- Keep large files focused — when one grows past a few hundred lines doing
  several jobs, split it along the folder boundaries above (e.g. `social.jsx`
  → `features/guestbook.jsx` + `features/quiz.jsx`).
- Data layer lives in `lib/store.jsx` today (localStorage mock) and is the single
  seam that swaps to Supabase later — features call the store, not storage directly.
