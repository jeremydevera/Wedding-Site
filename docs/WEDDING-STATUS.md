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
- Next Enhancement ID: **0006**

---

## Pending

### Enhancement ID: 0005 — RSVP party-size cap per invite
- **Severity:** P2 · **Status:** Deferred (pending — reminder logged 2026-07-01) · **Added:** 2026-07-01
- **Where:** Guest site → RSVP form (count picker) · depends on Enhancement 0004 (guest list allocation)
- **Action:** No cap — a guest given 2 seats can still RSVP 6. Should limit the count to the allocation set on their invite (e.g. "Jeremy = 2" → max 2).
- **Plan:** Once guests self-identify (name-select or invite code — decision also pending), max the count picker at that guest's `allocation` and reject over-cap on submit. Deferred with the gating-model decision.

### Bug ID: 0002 — [APPROVAL] Guestbook messages hidden on new clients
- **Severity:** P2 · **Status:** Pending · **Added:** 2026-06-25
- **Where:** Admin → Settings → Access ("Auto-approve guestbook messages" toggle)
- **Action:** New client's guest messages stay hidden even though the toggle looks ON.
- **Plan:** Make the server default match the toggle (auto-approve ON by default).

### Bug ID: 0003 — Guest photo/video uploads don't save
- **Severity:** P2 · **Status:** Rejected (2026-06-26 — feature not used; gallery/upload dropped) · **Added:** 2026-06-25
- **Where:** Guest site → Upload (Share Photos) · Admin → Media
- **Action:** ~~Uploads only live on the phone that sent them.~~ Won't fix — the photo-upload/gallery feature is not used (gallery stays off via the platform kill switch).
- **Plan:** N/A — closed. If uploads are ever re-enabled, reopen: add a server table + save uploads so the gallery/admin sync.

### Bug ID: 0005 — [APPROVAL] Turned-off section just shows Home
- **Severity:** P3 · **Status:** Pending · **Added:** 2026-06-25
- **Where:** Guest site → a switched-off section link (e.g. /guestbook when disabled)
- **Action:** Opening a turned-off section silently shows the homepage with no message.
- **Plan:** Show a short "this section isn't available" note instead.

---

## Done / History

### Enhancement ID: 0004 — Guest list: who-hasn't-replied + headcount
- **Severity:** P2 · **Status:** Done — commits `7792920`–`18b2a47`, 2026-07-02
- **Where:** Admin → Settings → Access ("Enable Strict RSVP") → Admin → Guests (new tab)
- **Action:** Owner enters invited guests + a seat allocation each; admin reconciles against RSVPs to show who's replied vs outstanding, plus allocated-vs-confirmed headcount.
- **Resolution:** Owner-only `guests` table (RLS, no anon read); `reconcileGuests` fuzzy name-matches RSVPs↔invites (reuses the `norm_name` logic). New "Guests" tab (gated by the Strict RSVP switch) does CRUD + shows Invited/Seats/Confirmed/Outstanding tiles + an unmatched-RSVP notice. Public RSVP form untouched; party-size cap enforcement remains Enhancement 0005 (Deferred).

### Bug ID: 0004 — RSVP "Email" shown but never collected
- **Severity:** P3 · **Status:** Done — commit `caa05d1`, 2026-07-01
- **Where:** Guest site → RSVP form · Admin → RSVPs
- **Action:** Admin showed an Email column, but the RSVP form never asked for email — so it was always blank.
- **Resolution:** Added an optional Email field to the RSVP form (validated only when filled), threaded through `rsvpToRow`/`rowToRsvp` + a new `rsvps.email` column. Admin table/CSV/detail now populate. Shipped alongside deadline enforcement, edit-RSVP, named plus-ones, and dashboard stat pies.

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
