# RSVP Enhancements — Design

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan

## Goal

Close the highest-value gaps in the RSVP flow without adding new backend
infrastructure. Five features, all frontend + two small Supabase migrations.

Explicitly **out of scope** (owner deferred): guest confirmation email, guest-list /
invite gating, capacity limits, phone-format validation.

## Current state (grounding)

- Form: `src/features/rsvp.jsx` — `RSVPPage()`. Collects first/middle/last name, phone,
  status (attending/not_attending/maybe), count (1–8), diet, dietNotes, song, notes.
  Single `plusOne` text field shown when `count > 1`.
- Submit: `postRsvp()` in `src/lib/api.js` → `supabase.from("rsvps").insert(rsvpToRow())`.
  Duplicate check: `rsvpNameTaken()` RPC (fuzzy normalized name, migration `0008`).
- Mappers: `rsvpToRow()` / `rowToRsvp()` in `src/lib/mappers.js`.
- Admin: `RsvpsAdmin()` in `src/admin/manage.jsx` — table, filter tabs, search, CSV export,
  "email results" (Resend via login-gated `/api/send-email`), detail modal, delete.
- Settings: `DEFAULT_SETTINGS` in `src/lib/store.jsx`. `rsvpDeadline` is a free-text string
  (e.g. "August 15, 2026"). `weddingDate` is a real ISO string ("2026-09-19T15:00").
- **Key finding:** the admin already *renders* `r.email` (table, detail, CSV, results email,
  search) but the form never collects it and `rsvpToRow`/`rowToRsvp` drop it, so the column is
  always blank (test-case BUG-0004). Finishing email is small and self-contained.
- `SEED_RSVPS` rows already include an `email` field, so seed/admin already expect it.

## Features

### 1. Optional email field

- Add an optional `Email` input to the form (after Phone). Placed so it always shows
  (not gated behind `attending`).
- Never blocks submit. Validate format **only when non-empty** — reject an obviously
  malformed value (reuse a simple regex like `send-email.js`'s `EMAIL_RE`), but an empty
  field is always allowed.
- Wire through the data layer:
  - `rsvpToRow()` — add `email: r.email`.
  - `rowToRsvp()` — add `email: row.email`.
  - `postRsvp()` already spreads `form`, so no change beyond the mapper.
- Migration: `ALTER TABLE rsvps ADD COLUMN email text;` (nullable).
- Admin: no change — it already renders `r.email`. This auto-fixes the blank column.

### 3. Deadline enforcement

- Keep `rsvpDeadline` (free text) for display copy in the hero lead.
- Add a new optional setting `rsvpDeadlineDate` (ISO datetime string, same shape as
  `weddingDate`), defaulting to `""` in `DEFAULT_SETTINGS`.
- Admin Home tab: add a date/datetime input for `rsvpDeadlineDate` next to the existing
  `rsvpDeadline` text field.
- Public form (`RSVPPage`): if `rsvpDeadlineDate` is set and `Date.now() > deadline`,
  render a "RSVP is now closed" card instead of the form (mirror the success-card styling).
  If unset → form always open (backward-compatible for existing clients).
- **Client-side gate only** — bypassable via dev console. Accepted at this product tier;
  no server-side reject (would need a trigger/RLS change, out of scope).

### 5. Headcount / meal stats

- Add a summary bar at the top of `RsvpsAdmin` (above the filter tabs or the panel head):
  - Total responses
  - Attending head-count = sum of `count` for `status === "attending"`
  - Maybe count, declined count
  - Dietary breakdown: count per non-"None" diet value (e.g. "3 Vegetarian · 2 Vegan ·
    1 Halal") — for the caterer.
- Pure client-side, computed from the `rsvps` store with `useMemo`. Reuses the head-count
  reduction already present in `emailResults()`. No DB, no new API.

### 6. Edit / update RSVP

- Replace the current dead-end (dupe detected → "already RSVP'd" → redirect home).
- New flow: on `rsvpNameTaken()` true → `confirmDialog` "You've already RSVP'd — update
  your response?" with confirm = "Update", cancel = "Leave it". On confirm, keep the guest
  on the form and submit as an update.
- Anon guests cannot read their prior row (RLS), so **no pre-fill; update = overwrite**.
- New SECURITY DEFINER RPC `rsvp_upsert(p_client_id, p_first, p_middle, p_last, <all fields>)`:
  finds the fuzzy-name-matched row for the client (reuse the normalizer from migration `0008`)
  and UPDATEs it; if none, INSERTs. Returns nothing sensitive (row id or void).
  - `postRsvp()` gains an `update` path (or a new `upsertRsvp()`) that calls this RPC instead
    of a raw insert when the guest chose to update. Simpler alternative: always route through
    `rsvp_upsert` so insert and update share one path — decide during planning.
- Migration: add the `rsvp_upsert` function + grant `execute` to `anon`.
- Local echo: `Store.addRSVP` on insert; for an update, replace the matching in-memory row
  (or just re-add — the session admin view is best-effort; server is source of truth).

### 7. Plus-one names

- When `count > 1`, replace the single `plusOne` text field with `count − 1` dynamic name
  inputs, labelled "Guest 2", "Guest 3", … (guest 1 is the submitter).
- On submit, join the non-empty names comma-separated into the **existing** `plus_one` text
  column. No schema change; admin's `+ {plusOne}` display and CSV keep working unchanged.
- If `count` decreases, drop the trailing inputs; keep entered names for the remaining slots.

## Data / schema changes

1. Migration A: `ALTER TABLE rsvps ADD COLUMN email text;`
2. Migration B: `CREATE FUNCTION rsvp_upsert(...)` SECURITY DEFINER, reusing the `0008`
   name-normalization; `GRANT EXECUTE ... TO anon`.

## Files touched

- `src/features/rsvp.jsx` — email input, deadline-closed card, edit flow, dynamic plus-one inputs.
- `src/lib/mappers.js` — `email` in `rsvpToRow` / `rowToRsvp`.
- `src/lib/api.js` — email passthrough (mapper), `rsvp_upsert` call for the update path.
- `src/admin/manage.jsx` — stats summary bar; deadline-date input in Home settings.
- `src/lib/store.jsx` — `rsvpDeadlineDate: ""` default; possibly an update-in-place RSVP helper.
- `supabase/migrations/` — two new migration files.
- Tests: extend mapper tests (email round-trip), validation tests (optional email,
  malformed-email rejection), plus-one join, deadline gate.

## Testing

- Unit: `rsvpToRow`/`rowToRsvp` email round-trip; plus-one comma-join; email format
  validation (empty ok, malformed rejected); deadline gate boolean.
- Existing 51 tests must stay green.
- Manual: submit with/without email; submit after deadline (closed card); update flow
  overwrites; caterer stats match a hand count.

## Risks / accepted tradeoffs

- Deadline gate is client-side only (bypassable). Accepted.
- Edit overwrites without showing prior answers (no pre-fill). Accepted — avoids exposing
  RSVP data to anyone who knows a guest's name.
- Plus-one stored as a joined string, not structured rows — fine for display/CSV; not
  queryable per-name (not required).
