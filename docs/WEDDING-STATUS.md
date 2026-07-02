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
- Next Enhancement ID: **0008**

---

## Pending

### Bug ID: 0003 — Guest photo/video uploads don't save
- **Severity:** P2 · **Status:** Rejected (2026-06-26 — feature not used; gallery/upload dropped) · **Added:** 2026-06-25
- **Where:** Guest site → Upload (Share Photos) · Admin → Media
- **Action:** ~~Uploads only live on the phone that sent them.~~ Won't fix — the photo-upload/gallery feature is not used (gallery stays off via the platform kill switch).
- **Plan:** N/A — closed. If uploads are ever re-enabled, reopen: add a server table + save uploads so the gallery/admin sync.

---

## Done / History

### Enhancement ID: 0007 — One RSVPs tab (Guests tab merged in)
- **Severity:** P3 · **Status:** Done — 2026-07-02
- **Where:** Admin sidebar → RSVPs
- **Action:** RSVPs and Guests as two sidebar items was confusing — same concept, two places.
- **Resolution:** Single "RSVPs" tab that adapts to the Strict RSVP switch. Strict off = classic replies view (unchanged). Strict on = guest-list view (tiles, All/Replied/Outstanding/Unmatched) plus a "Replies" folder embedding the full classic view (search, CSV, email results, detail, delete). Guests tab removed from the sidebar.

### Bug ID: 0002 — Guestbook messages hidden on new clients
- **Severity:** P2 · **Status:** Done — migration `0013`, 2026-07-02
- **Where:** Admin → Settings → Access ("Auto-approve guestbook messages" toggle)
- **Action:** New client's guest messages stayed pending even though the toggle looked ON.
- **Resolution:** The `guestbook_set_status` trigger defaulted a missing `autoApproveGuestbook` key to false while the toggle's default is true. Migration `0013` aligns the server default to true. Verified with a live trigger probe (insert on a key-less client → `approved`), probe row removed.

### Bug ID: 0005 — Turned-off section just showed Home
- **Severity:** P3 · **Status:** Done — 2026-07-02
- **Where:** Guest site → a switched-off section link (e.g. /guestbook when disabled)
- **Action:** Opening a turned-off section silently rendered the homepage with no message.
- **Resolution:** `App.jsx` now renders a `SectionUnavailable` card ("<Section> isn't available" + Back home) for blocked routes instead of swapping in Home. Nav/footer still hide disabled links; this covers direct links, bookmarks, and stale QR codes.

### Enhancement ID: 0006 — Strict RSVP reconcile tools (adopt unmatched + over-allocation mark)
- **Severity:** P3 · **Status:** Done — 2026-07-02
- **Where:** Admin → Guests (with Strict RSVP on)
- **Action:** Enabling Strict RSVP with pre-existing RSVPs left cleanup manual: unmatched RSVPs had to be retyped into the guest list, and grandfathered over-allocation replies weren't visible.
- **Resolution:** Each unmatched RSVP in the Guests-tab notice now has an "Add to list" button (creates the guest from the RSVP's name/count/email via `guestFromRsvp`); the Coming column marks counts above the allocation with a red "N over" flag.

### Enhancement ID: 0005 — Strict RSVP gate + party-size cap per invite
- **Severity:** P2 · **Status:** Done — 2026-07-02
- **Where:** Guest site → RSVP form (with Strict RSVP on in Settings → Access)
- **Action:** With Strict RSVP on: a name not on the guest list is told it isn't in the registry and can't submit; a matched guest's party size is capped at their seat allocation (live hint "Your invitation reserves N seats", capped picker, and submit re-check).
- **Resolution:** `rsvp_guest_allocation` RPC (SECURITY DEFINER; returns only a number; dead unless the client enabled strictRsvp) + form gate/cap in `rsvp.jsx`. Strict off = form unchanged. Verified against live data (matched name → allocation, unknown → null).

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
