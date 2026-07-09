# Request default features — Design

**Date:** 2026-07-10
**Goal:** A site request with no saved feature list must show and save the platform default — Details, Schedule, Venue, RSVP on; Story, Guestbook, Quiz, gallery off — instead of "assume everything on."

## Root cause
- The /apply wizard never writes `content.modules` on a request.
- `openReqEdit` (superadmin edit-request Access tab) seeds checkboxes with `c.modules?.[m] !== false` → absent map = every feature checked (incl. Our Story).
- Saving that tab writes the all-on map into the request; approval then honors it, overriding the approval-time default added earlier.

## Fix (single source of truth)
1. `src/lib/roles.js`: `export const DEFAULT_CLIENT_MODULES = { details: true, schedule: true, venue: true, rsvp: true, story: false, guestbook: false, quiz: false, gallery: false }`.
2. `src/lib/api.js` `approveSiteRequest`: replace the inline default map with the constant (behavior identical).
3. `src/admin/superadmin.jsx` `openReqEdit`: when `c.modules` is missing, seed the Access checkboxes from the constant; when present, keep the existing `!== false` semantics (hand-picked maps unchanged).
4. Request details (eye) modal: if it renders features for a map-less request, read the same constant.
5. Existing clients and requests with explicit maps: untouched.

## Test
- Unit: fresh request (no modules) → editor seed has story/guestbook/quiz false, four defaults true; request with explicit map unchanged.
- Full suite + build; deploy verified via CF API + served marker.
