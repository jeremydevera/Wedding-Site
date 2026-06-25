# Wedding Site — Test Plan / Scenarios

Comprehensive QA plan for the Celebrately / Evermore wedding site, derived from
the actual app so you don't have to think them up. Plain-language steps + exact
nav path. Run before a release or after touching a related area.

Legend: ✅ verified by Claude · ⬜ not yet · ⚠️ known issue (see WEDDING-STATUS.md)
Severity hint: 🔴 must-pass before release · 🟡 important · ⚪ nice-to-have

---

## A. Multi-tenant & routing

- **A1** 🔴 ⬜ `<subdomain>.celebrately.us` loads that client's theme + content.
- **A2** 🟡 ⬜ Bare apex / `demo` loads the demo showcase (theme picker in nav, not RSVP).
- **A3** 🟡 ⬜ `?client=<subdomain>` on pages.dev overrides the resolved client.
- **A4** 🟡 ⬜ Unknown subdomain → falls back to seed defaults, app still loads (doesn't hang on "Loading…").
- **A5** ⚪ ⬜ Deep-link to a path (`/rsvp`, `/venue`) loads that page directly (SPA fallback works).
- **A6** ⚪ ⬜ Browser back/forward moves between pages correctly; scroll resets to top.

## B. Themes & appearance (Admin → Settings → Theme)

- **B1** 🔴 ⬜ Each theme applies instantly when picked in the swatch grid (colors + fonts change).
- **B2** 🟡 ⬜ Theme list is scoped to the event type (wedding shows all; birthday/corporate show their subset).
- **B3** 🟡 ⬜ Normal vs Premium are split into two groups; envelope sits under Premium with the ★ badge.
- **B4** 🟡 ⬜ Changing theme resets accent + sets that theme's default fonts.
- **B5** 🟡 ⬜ Accent swatch override changes the accent without changing the theme.
- **B6** 🟡 ⬜ Headline/body font dropdowns change the rendered fonts.
- **B7** 🔴 ✅ Demo nav theme dropdown = preview only (reverts on refresh for logged-out visitors); owner/superadmin pick = saves. (2026-06-25)
- **B8** 🔴 ⬜ Pick theme → Save changes → reload → theme persisted (saved to Supabase, TC-C with B).

## C. Floating decorations (Admin → Settings → Theme → Home Decorations)

- **C1** 🔴 ✅ Decoration does NOT apply on Olive Envelope. Pick decor + style, save, switch to envelope, save → envelope shows only its own built-in leaf drift, not your decor. (2026-06-26)
- **C2** 🟡 ⬜ Switch back to a normal theme (decor ON) → your decoration shows again on home hero.
- **C3** 🟡 ⬜ Each decor style renders: Petals, Butterflies (GIF), Hearts, Fireflies, Leaves, Confetti.
- **C4** ⚪ ⬜ Butterfly sub-options: Single colour (+ colour picker), Assorted, Faded; flight (calm/flutter/energetic); count slider (4–24).
- **C5** 🟡 ⬜ Decoration only shows on Home, not other pages.
- **C6** 🟡 ⬜ Decoration off (toggle OFF) → no decoration anywhere.
- **C7** ⚪ ⬜ The settings "Preview" box reflects the chosen style/colour/count live.

## D. Olive Envelope theme + Arrange mode (premium)

- **D1** 🔴 ✅ Sealed envelope on load; page can't scroll; "Open the invitation" opens it + unlocks scroll. (2026-06-25)
- **D2** 🟡 ⬜ "A Love Letter From <names>" type-on animation plays (and the last letter isn't clipped).
- **D3** 🟡 ⬜ Envelope Frame Photo (Settings → Theme): uploaded square photo shows inside the oval frame; empty = default animated frame.
- **D4** 🟡 ⬜ Envelope Background: uploaded wide photo shows behind; empty = default; tint on/off, tint colour, tint strength (0–100) all change the wash.
- **D5** ⚪ ⬜ Envelope cover title size (16–34px) changes the cover name size; doesn't scale with viewport.
- **D6** 🟡 ⬜ Heart date matches the wedding date (DD.MM.YYYY).
- **D7** 🟡 ⬜ Arrange toggle only appears for premium (envelope) theme. Enabling shows "Arrange Now" beside View site.
- **D8** 🟡 ⬜ "Arrange Now" → home in arrange mode: can drag/resize invitation pieces; layout persists.
- **D9** ⚪ ⬜ Arrange button/mode is hidden for non-premium themes even if arrangeEnabled was left on.

## E. Sections / modules (Admin → Settings → Features)

- **E1** 🔴 ✅ Turning a section OFF hides it from nav, mobile menu, and footer. (2026-06-25)
- **E2** 🟡 ✅ Visiting a disabled section's URL → currently shows Home (⚠️ no "unavailable" notice — BUG-0005). (2026-06-25)
- **E3** 🔴 ✅ Gallery is globally Pending (greyed, can't enable); no Gallery/Upload/Share-Photos links anywhere. (2026-06-25)
- **E4** 🟡 ✅ Toggle labels read guest-facing ("Our Story", "RSVP"). (2026-06-25)
- **E5** 🟡 ⬜ Toggling a module also shows/hides its admin tab (e.g. disable Quiz → Quiz tab gone for owner).
- **E6** 🟡 ⬜ Save changes → reload → module flags persist.

## F. Home page

- **F1** 🔴 ⬜ Normal theme: hero shows names, tagline, date, countdown, welcome; RSVP CTA; schedule preview.
- **F2** 🟡 ⬜ Countdown counts down to the wedding date and is not negative/NaN.
- **F3** 🟡 ⬜ Hero photo: custom uploaded hero shows; empty = themed background.
- **F4** ⚪ ⬜ "Respond now" / "See full timeline" buttons navigate to RSVP / Schedule.

## G. Content pages

- **G1** 🟡 ✅ Details "Ceremony" card shows a real dash (not a raw `\u` code). (2026-06-25, BUG-0001 fixed)
- **G2** 🟡 ⬜ Details FAQ accordion opens/closes one item at a time.
- **G3** 🟡 ⬜ Story page lists milestones with photos (or placeholders).
- **G4** 🟡 ⬜ Schedule page renders all timeline items in order.
- **G5** 🔴 ⬜ Venue page map is centered on the saved pin; "Get Directions" opens Google Maps to it.

## H. RSVP (Guest site → RSVP)

- **H1** 🔴 ✅ Validation: blank name blocked; attending with 0 guests blocked; dietary "Other" needs a note. (2026-06-26)
- **H2** 🔴 ✅ Valid submit → confirmation screen; row reaches Admin → RSVPs + Dashboard counts. (2026-06-25)
- **H3** 🟡 ⬜ Count > 8 → "contact the couple" error (no submit).
- **H4** 🟡 ⬜ Notes > 1000 chars → error; textarea hard-caps at 1100.
- **H5** 🟡 ⬜ "Not attending" / "Maybe" → guest-count fields hide; confirmation copy differs.
- **H6** ⚪ ⬜ Count > 1 → "Names of your guests" field appears.
- **H7** ⚪ ⬜ Network failure on submit → graceful "Could not submit" error, no crash.
- **H8** ⚠️ ⬜ Admin RSVP "Email" column is always blank (form has no email — BUG-0004).

## I. Guestbook (Guest site → Guestbook · Admin → Guestbook)

- **I1** 🔴 ⬜ Submit: blank name/message blocked; >1000 chars blocked.
- **I2** 🔴 ⬜ Auto-approve ON → message shows publicly immediately. OFF → waits as Pending. (⚠️ new-client default mismatch — BUG-0002)
- **I3** 🟡 ⬜ Admin can approve / hide / delete; hidden never shows publicly.
- **I4** ⚪ ⬜ Empty guestbook shows "be the first" empty state.
- **I5** ⚪ ⬜ Export CSV downloads all entries.

## J. Quiz (Guest site → Quiz · Admin → Quiz)

- **J1** 🔴 ⬜ Name required to start; answer all questions → score + per-question review.
- **J2** 🟡 ⬜ Play appears on Admin → Quiz → Leaderboard, sorted by score.
- **J3** 🟡 ⬜ Admin: add / edit / delete / reorder questions; multiple-choice vs true-false; mark correct answer.
- **J4** ⚪ ⬜ Editing questions then replaying scores against the new answers.

## K. Media — upload, gallery, video message (Guest site)

- **K1** 🔴 ⬜ Upload requires a name + at least one file; progress bar; confirmation.
- **K2** 🟡 ⬜ File-type guard: photo page rejects videos and vice-versa; unsupported types rejected.
- **K3** 🟡 ⬜ Size guard: photo > 25MB rejected; video > 100MB rejected; max 10 files.
- **K4** 🟡 ⬜ Auto-approve media ON → appears in gallery instantly; OFF → waits in admin Media queue.
- **K5** 🟡 ⬜ Gallery filter (All/Photos/Videos); lightbox opens; video plays.
- **K6** ⚪ ⬜ Uploads disabled (master switch) → "Uploads are closed" screen.
- **K7** ⚪ ⬜ Gallery disabled → "gallery is private" screen.
- **K8** ⚠️ 🔴 ⬜ Uploads currently persist only on the uploading device (no server) — admin/other devices don't see them (BUG-0003).
- **K9** ⚪ ⬜ Private video message: only reaches admin (Media → Private), not the public gallery.

## L. Admin — auth, dashboard, moderation, settings (Admin sign in)

- **L1** 🔴 ✅ Wrong login rejected with a clear message, no crash. (2026-06-25)
- **L2** 🔴 ⬜ Owner sees only their own client's tabs; no Clients/Overview; can't reach another client.
- **L3** 🔴 ⬜ Settings → change a field → Save changes → reload → persists (Supabase).
- **L4** 🟡 ⬜ Dashboard stat cards count correctly and link to their tabs.
- **L5** 🟡 ⬜ RSVP/Guestbook moderation actions write through to the server (survive reload), not just local.
- **L6** 🟡 ⬜ CSV export (RSVPs, Guestbook) downloads correct columns.
- **L7** 🟡 ⬜ QR codes render + download PNG for each target page; URLs point at this site's origin.
- **L8** 🟡 ⬜ Image upload + crop (hero, story, envelope frame/bg): pick → crop modal pan/zoom → apply → image saves.
- **L9** ⚪ ⬜ Venue map preview in Settings updates as you change the pin.
- **L10** ⚪ ⬜ Sign out returns to the guest site.
- **L11** ⚪ ⬜ "Reset demo data" restores defaults after confirm.

## M. Superadmin (apex hub → Clients / Overview)

- **M1** 🔴 ⬜ Add client: subdomain validated (lowercase/dns, not reserved like demo/admin), event type + theme set, one row created.
- **M2** 🔴 ⬜ Add client with owner email + password → owner login provisioned (edge function); owner can sign in.
- **M3** 🟡 ⬜ Edit client: change subdomain, toggle modules, reset password / change email.
- **M4** 🟡 ⬜ Assign theme + change event type from the Clients list; theme list scopes to the new event type.
- **M5** 🟡 ⬜ Delete client → confirm → client + its RSVPs/guestbook/quiz removed (cascade).
- **M6** 🟡 ⬜ Overview shows platform totals (clients, logins, RSVPs, guestbook, quiz) + by-event-type bars.
- **M7** 🟡 ⬜ Superadmin "Open admin" on a client manages that client's full site admin.
- **M8** ⚪ ⬜ Invalid/reserved subdomain shows the validation toast; no row created.

## N. Responsive & accessibility

- **N1** 🔴 ✅ Mobile menu (hamburger) opens an opaque, readable drawer; closes on tap-out. (2026-06-25)
- **N2** 🟡 ⬜ Layout holds on phone width (no horizontal scroll) across pages.
- **N3** ⚪ ⬜ Reduced-motion: heavy animations (reveals, type-on) are tamed when the OS prefers reduced motion.

## O. Data & persistence

- **O1** 🔴 ⬜ Server data (RSVP/guestbook/quiz) is per-client and doesn't leak between tenants.
- **O2** 🟡 ⬜ Settings/content changes only persist after "Save changes" (not on every keystroke for the public site).
- **O3** ⚪ ⬜ A second device sees the same RSVPs/guestbook/quiz (server-backed) — but NOT media (BUG-0003).

---

### How to use this
- 🔴 rows are the release gate — run them every deploy.
- ⚠️ rows have a known open issue; expected result is "matches WEDDING-STATUS bug" until fixed.
- After Claude runs a scenario, it flips ⬜ → ✅ with a date here.
