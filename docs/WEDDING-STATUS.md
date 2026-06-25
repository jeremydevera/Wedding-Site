# Wedding Site — Bug & Enhancement Tracker

Single source of truth for bugs + enhancements on the Celebrately / Evermore
wedding site. Updated when you log an item, run `/weddingstatus`, or after a
Claude test run. Done items stay here as the permanent history.

## Legend
- **Severity** — `P1` very urgent · `P2` priority · `P3` low priority
- **Status** — `Pending` · `In Progress` · `Done` · `Deferred` · `Rejected`
- **Where** — exact place to find it (nav path the user clicks).
- **`[APPROVAL]`** in a title = Claude found this (testing / scheduled run); needs your review before work.

## Next IDs
- Next Bug ID: **0006**
- Next Enhancement ID: **0004**

---

## Pending

### Bug ID: 0002 — [APPROVAL] Guestbook messages hidden on new clients
- **Severity:** P2 · **Status:** Pending · **Added:** 2026-06-25
- **Where:** Admin → Settings → Access ("Auto-approve guestbook messages" toggle)
- **Action:** New client's guest messages stay hidden even though the toggle looks ON.
- **Plan:** Make the server default match the toggle (auto-approve ON by default).

### Bug ID: 0003 — [APPROVAL] Guest photo/video uploads don't save
- **Severity:** P2 · **Status:** Deferred (you said ignore for now) · **Added:** 2026-06-25
- **Where:** Guest site → Upload (Share Photos) · Admin → Media
- **Action:** Uploads only live on the phone that sent them — other devices and the admin never see them.
- **Plan:** Add a server table + save uploads to it, so the gallery and admin sync everywhere.

### Bug ID: 0004 — [APPROVAL] RSVP "Email" shown but never collected
- **Severity:** P3 · **Status:** Pending · **Added:** 2026-06-25
- **Where:** Guest site → RSVP form · Admin → RSVPs
- **Action:** Admin shows an Email column, but the RSVP form never asks for email — so it's always blank.
- **Plan:** Add an email box to the RSVP form, or remove Email from the admin.

### Bug ID: 0005 — [APPROVAL] Turned-off section just shows Home
- **Severity:** P3 · **Status:** Pending · **Added:** 2026-06-25
- **Where:** Guest site → a switched-off section link (e.g. /guestbook when disabled)
- **Action:** Opening a turned-off section silently shows the homepage with no message.
- **Plan:** Show a short "this section isn't available" note instead.

---

## Done / History

### Enhancement ID: 0001 — Venue location picker (search + map pin)
- **Severity:** P2 · **Status:** Done — commit `e7306d8`, 2026-06-25
- **Where:** Admin → Settings → Venue → Map location
- **Action:** Let the client search a place and drop a pin on a map.
- **Resolution:** `LocationPicker` (Photon search + Leaflet map, drag/click pin). Saves coords; public Venue map uses them. Verified in-browser, no CORS errors.

### Enhancement ID: 0002 — Features toggles use guest-facing labels
- **Severity:** P3 · **Status:** Done — commit `1e1ea43`, 2026-06-25
- **Where:** Admin → Settings → Features
- **Action:** Show toggle names how guests see them (Story → "Our Story", Rsvp → "RSVP").
- **Resolution:** `MODULE_LABELS` / `moduleLabel()` in `lib/roles.js`, used by Settings → Features + superadmin client editor.

### Enhancement ID: 0003 — Hide "Upload" link when gallery is off
- **Severity:** P3 · **Status:** Done — commit `1e1ea43`, 2026-06-25
- **Where:** Guest site → footer + mobile menu
- **Action:** Don't show Upload / Share Photos when the gallery is disabled.
- **Resolution:** Gated footer "Upload" + drawer "Share Photos" on the gallery module; "Video Message" on uploads enabled.

### Bug ID: 0001 — Details page showed a broken dash
- **Severity:** P3 · **Status:** Done — commit `e7306d8`, 2026-06-25
- **Where:** Guest site → Details → "The Ceremony" card
- **Action:** A raw code (`—`) showed instead of a dash (—).
- **Resolution:** `PublicPages.jsx:385` — replaced the escape in JSX text with a real em-dash.
