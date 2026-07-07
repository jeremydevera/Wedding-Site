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
- Next Bug ID: **0008**
- Next Enhancement ID: **0014**

---

## Pending

### Enhancement ID: 0013 — Crop for MP4 (video) media — envelope frame + track covers
- **Severity:** P3 · **Status:** Pending · **Added:** 2026-07-07 (requested by Jeremy)
- **Where:** Admin → Settings → Theme → Envelope Frame Photo · Home → Music playlist → Edit track → Cover image
- **Action:** MP4s upload as-is with no crop step (canvas CropModal can't re-encode video). Jeremy wants to crop videos too — position/zoom the MP4 inside the oval frame / square cover like images.
- **Plan:** No re-encode needed: reuse the CropModal pan/zoom UI over a paused `<video>` frame, but store crop PARAMS (`{x, y, zoom}`) in settings (e.g. `frameImageCrop`, track `artCrop`) instead of exporting pixels. Renderers apply the params as a CSS transform on the `<video>` inside its clipping box. GIFs keep the current behavior (crop flattens); videos get non-destructive param crop.

### Enhancement ID: 0012 — Unify all Access settings into one shared source
- **Severity:** P3 · **Status:** Pending · **Added:** 2026-07-07 (requested by Jeremy)
- **Where:** Admin → Settings → Access · Superadmin → Edit client → Access
- **Action:** Only owner-edit grants are single-sourced. Other Access settings (modules, moderation toggles, site-wide switches) are duplicated between `SettingsAdmin` (manage.jsx) and `AccessFields` (superadmin.jsx) — a new one must be added in both.
- **Plan:** See [enhancements/0012-unify-access-settings-one-source.md](enhancements/0012-unify-access-settings-one-source.md). Make `AccessFields` the single shared Access UI (client Settings renders it too), or extract the field list to roles.js like the grants.

### Enhancement ID: 0008 — Server-side notification read/cleared state (multi-device sync)
- **Severity:** P3 · **Status:** Pending · **Added:** 2026-07-03 (requested by Jeremy)
- **Where:** Admin → topbar bell (Notifications dropdown)
- **Action:** The bell's "seen" + "Clear" state lives in browser localStorage today — per device only. Clearing on the laptop doesn't clear on the phone, and wiping browser data un-clears everything. Move it server-side per user (GitHub/Slack style) so it syncs across devices.
- **Plan:** See [enhancements/0008-notification-state-sync.md](enhancements/0008-notification-state-sync.md). Two timestamp columns on `profiles` (`notif_seen_at`, `notif_cleared_at`) + write on open/clear + read at load, with localStorage as offline fallback.

### Bug ID: 0003 — Guest photo/video uploads don't save
- **Severity:** P2 · **Status:** Rejected (2026-06-26 — feature not used; gallery/upload dropped) · **Added:** 2026-06-25
- **Where:** Guest site → Upload (Share Photos) · Admin → Media
- **Action:** ~~Uploads only live on the phone that sent them.~~ Won't fix — the photo-upload/gallery feature is not used (gallery stays off via the platform kill switch).
- **Plan:** N/A — closed. If uploads are ever re-enabled, reopen: add a server table + save uploads so the gallery/admin sync.

---

## Done / History

### Enhancement ID: 0011 — Olive Envelope: more background tint colors + custom tint
- **Severity:** P2 · **Status:** Done — commit `637c225`, 2026-07-03 (requested by Jeremy)
- **Where:** Admin → Design → Envelope Background → Tint color
- **Action:** Tint color choices doubled (12 presets: adds Forest, Teal, Dusty Blue, Midnight, Rose, Amber) plus a "Custom" chip with a full color picker for any hex.
- **Resolution:** Custom builds the same top-to-bottom wash from the picked color (60% → darker 80%). `envTintCustom` persists in content JSON; invalid hex falls back to olive. All washes verified over the default background photo; 146 tests pass.

### Enhancement ID: 0010 — Olive Envelope: custom envelope color + terracotta + site colors follow
- **Severity:** P2 · **Status:** Done — commit `545008d`, 2026-07-03 (requested by Jeremy same day)
- **Where:** Admin → Design → Envelope Color (Olive Envelope theme)
- **Action:** Added a Terracotta (rust orange) preset, a "Custom" chip with a full color picker (any hex), and a "Match website colors" toggle so the page backgrounds/headings/buttons stop defaulting to green and take on the chosen envelope color.
- **Resolution:** Custom colors are solved at runtime into the filter chain that maps the olive artwork to the picked hex (cached). Site palette re-hues the envelope theme's oklch tokens (`envSitePalette`); olive or toggle-off keeps the classic green. 143 tests pass; presets + solver verified on artwork via screenshot grid. (Wax-seal color shift fixed same day by `d15cbb3` — seal cut-out below.)

### Bug ID: 0007 — Recolored envelope changed the wax seal color
- **Severity:** P2 · **Status:** Done — commit `d15cbb3`, 2026-07-03 (requested by Jeremy)
- **Where:** Guest site → Olive Envelope cover + opened envelope (with a non-olive envelope color)
- **Action:** Picking an envelope color also tinted the cream wax seal (pink on wine, grey on navy, flat white on light custom colors). The seal should always stay cream.
- **Resolution:** The color filter moved off the base envelope images onto a duplicate overlay masked with an ellipse cut-out over the seal — the unfiltered seal shows through. Covers the sealed cover, open front pocket, and the admin preview; seal position measured from the artwork pixels. Verified on wine/navy/rust/light-gold via screenshot grid.
- **Follow-up (`a9758d1`, same day):** a faint tinted rim still showed (the seal's glow extends past any mask). The seal is now its own image — cut out of both artworks into `seal-closed.png` / `seal-front.png` with a feathered edge and laid unfiltered on top — pixel-identical seal for every color; the mask hole remains as a load-failure fallback. Verified with zoomed screenshot grids.
- **Follow-up 2 (`a01f942`, same day):** color still visible — the seal's darker bottom edge made its true size 164×208px (bigger than first measured), and the open-envelope seal was placed in the wrong coordinate space (the front art is inset in its frame). Recut the seals at full extent, repositioned the open-envelope seal, and switched to recolor-everything + seal-on-top (no big mask hole — exposed base pixels were the source of every halo). Verified clean at high zoom, sealed + open, wine/gold/light-gold.

### Enhancement ID: 0009 — Olive Envelope: envelope paper color setting
- **Severity:** P2 · **Status:** Done — commit `d7b510e`, 2026-07-03
- **Where:** Admin → Design → Envelope Color (shows only when the Olive Envelope theme is selected)
- **Action:** Owners can recolor the envelope itself — 8 paper colors (Olive, Sage, Kraft, Dusty Blue, Navy, Wine, Blush, Charcoal) with a live preview.
- **Resolution:** CSS filter presets (`ENV_COLORS`) recolor the sealed cover + open front pocket only; the cream wax seal, card, flowers, heart, and falling leaves stay unchanged. `envColor` setting persists in content JSON (older clients default to Olive). Verified all 8 presets on the real artwork via Playwright screenshot grid; 135 tests pass.

### Bug ID: 0006 — Strict RSVP: duplicate first+last blocked a middle-less guest
- **Severity:** P2 · **Status:** Done — migration `0014` + commit `4ecc39d`, 2026-07-02
- **Where:** Guest site → RSVP form (Strict RSVP on)
- **Action:** Two registry entries "Joseph Celis" (middles L / R) + a guest RSVPing without a middle name got "we can't find your name" instead of being asked which one they are.
- **Resolution:** `rsvp_guest_allocation` now returns ok/ambiguous/not_found: several same-name candidates → "Which one are you?" dialog + inline "add your middle name" error; a single candidate matches even without a middle (wildcard; exact/initial beats wildcard). JS reconcile matcher mirrors the wildcard. Gate dialogs and the closed-RSVP card also dropped the check-icon seal. Verified against live demo data.

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
