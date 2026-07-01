# Guest List & RSVP Reconciliation — Design

**Date:** 2026-07-02
**Status:** Approved (design), pending implementation plan

## Goal

Let the client (owner) enter their invited guests with a per-guest seat **allocation**,
then reconcile that list against RSVPs to show **who hasn't replied yet** and an
**allocated-vs-confirmed headcount**. Gated behind a new **"Enable Strict RSVP"** switch.

The public RSVP form is **untouched** — it stays open to anyone. Enforcing the allocation
as a cap on the public form (and gating who may RSVP) is explicitly **out of scope** here;
it's tracked as **Enhancement 0005 (Deferred)** in `docs/WEDDING-STATUS.md` and the same
switch will be its on-ramp.

## Decisions (from brainstorming)

- **Invite unit = individual**, entered as first + last (+ optional middle to disambiguate).
  This matches RSVPs reliably via the existing fuzzy name logic.
- **Manual add** only in this version (add/edit/delete one at a time). Bulk import is a
  possible fast-follow, not in this plan.
- **`strictRsvp` switch** (Settings) gates the whole feature: the Guests tab shows only
  when it's ON. Default OFF, so existing clients are unaffected until they opt in.

## Current-state grounding

- Owner submissions (`rsvps`, `guestbook`, `quiz_answers`) are separate Supabase tables
  with RLS (`supabase/migrations/0005_owner_access.sql`); the owner reads/moderates only
  their own client's rows via `public.auth_client()`; superadmin manages all.
- The client `content` JSON is fetched by **anonymous** public visitors (`clients` row select
  in `loadClientData`), so anything stored there is world-readable. The guest list must NOT
  live there — it needs its own RLS-gated table.
- Fuzzy name matching already exists in SQL as `public.norm_name` +
  the first/last/middle-initial predicate (migrations `0007`/`0008`, reused by `rsvp_upsert`).
- Admin tabs are declared in `ADMIN_TABS` (`src/admin/manage.jsx`); `visibleAdminTabs`
  (`src/lib/roles.js`) hides `SUPERADMIN_ONLY` tabs from owners; `tabsForClient` filters by
  per-client module flags. `AdminApp` builds the final tab list and routes on `activeTab`.
- `loadAdminData` (`src/lib/api.js`) loads the owner's submissions into the store on mount;
  `Store.setSubmissions` holds server-owned lists (not persisted to localStorage).
- Settings live in `DEFAULT_SETTINGS` (`src/lib/store.jsx`) and round-trip through
  `stateToClientRow`/`clientToState` (`src/lib/mappers.js`); a plain new key just works.

## Components

### 1. `guests` table + RLS (migration)

```
guests(
  id uuid pk default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  middle_name text,
  allocation int not null default 1,
  email text,
  notes text,
  created_at timestamptz not null default now()
)
```

RLS (mirrors the `0005` owner/superadmin pattern, but owner gets **full CRUD** since guests
are owner-authored, unlike rsvps):
- `owner manage guests` — `for all to authenticated using (client_id = public.auth_client()) with check (client_id = public.auth_client())`.
- `superadmin manage guests` — `for all to authenticated using (public.auth_role() = 'superadmin') with check (...)`.
- **No anon policy** — anonymous visitors can't read the list.
- Enable RLS on the table.

### 2. `strictRsvp` setting

- Add `strictRsvp: false` to `DEFAULT_SETTINGS`.
- Add an **"Enable Strict RSVP"** toggle in Settings (Features/Access area) bound to it via
  the existing `set("strictRsvp")` + save path. Hint text: turning it on reveals the Guests
  tab for managing the invite list and tracking replies.

### 3. Store slice + API

- Store: add a `guests: []` array (server-owned — reset on hydrate like `rsvps`, not persisted
  to localStorage). Add `setGuests`, `addGuest`, `updateGuest`, `deleteGuest` methods, mirroring
  the existing RSVP/guestbook helpers (optimistic local update).
- API (`src/lib/api.js`): direct Supabase table ops (RLS enforces scope), mirroring
  `deleteGuestbookDb` etc.:
  - Load: extend `loadAdminData` to also `select * from guests ... order by created_at` and
    put the mapped rows in the store (only when a client is loaded; RLS scopes to owner/superadmin).
  - `addGuestDb(guest)` → insert, returns the new row (so the store gets the real `id`).
  - `updateGuestDb(id, patch)` → update.
  - `deleteGuestDb(id)` → delete.
- Mappers (`src/lib/mappers.js`): `guestToRow` (camel→snake + client_id) and `rowToGuest`
  (snake→camel + `createdAt`), matching the existing `rsvpToRow`/`rowToRsvp` style.

### 4. Reconciliation helper (pure, testable) — `src/lib/guests.js`

```
normName(s)                      // lowercase, strip non-[a-z0-9] — mirrors SQL norm_name
namePartsMatch(a, b)             // {first,last,middle} vs {first,last,middle}:
                                 //   normFirst==normFirst && normLast==normLast &&
                                 //   (middle equal OR one side is the other's initial)
reconcileGuests(guests, rsvps)   // ->
  {
    rows: [{ guest, rsvp|null, status }],   // status: 'attending'|'maybe'|'not_attending'|'none'
    summary: { invited, seatsAllocated, replied, outstanding,
               confirmedHeads, maybe, declined },
    unmatchedRsvps: [rsvp, ...]             // RSVPs matching no guest
  }
```

- `confirmedHeads` = Σ `count` over matched RSVPs with status `attending`.
- `replied` = guests with a matched RSVP (any status); `outstanding` = the rest.
- First match wins if multiple RSVPs match one guest (rare; note it, don't crash).

### 5. Guests admin tab

- Register `{ key: "guests", label: "Guests", icon: "user" }` in `ADMIN_TABS`.
- **Gating:** the tab appears only when `settings.strictRsvp` is true. Implement in
  `AdminApp`'s tab-list computation (filter out `guests` unless `strictRsvp`), for all roles.
- Route: `activeTab === "guests" && <GuestsAdmin />`.
- `GuestsAdmin` component:
  - Summary tiles at top (reuse `.stat` styling): Invited · Seats allocated · Confirmed heads · Outstanding.
  - Add-guest form: first, last, optional middle, allocation (number ≥ 1), optional email, optional notes.
  - Filter tabs: All / Replied / Outstanding.
  - Table: name (+ allocation), reply status tag, RSVP count if attending, edit + delete row actions.
  - If any `unmatchedRsvps`: a small notice ("N RSVPs don't match an invited guest") so the owner
    can fix a typo or add the guest.
  - Server ops wrapped in the admin saving overlay (the `run`/`AdminSaveCtx` pattern used by RsvpsAdmin).

## Data flow

Owner toggles Strict RSVP on → Guests tab appears → owner adds guests (writes to `guests` via
RLS, store updates) → `loadAdminData` also pulls `guests` + `rsvps` → `reconcileGuests` (client-side,
memoized) drives the table + summary. No public-site code path touches `guests`.

## Out of scope (tracked as Enhancement 0005, Deferred)

- Capping the public RSVP count picker at the guest's allocation.
- Gating who may RSVP (name-select / invite code) — decision still pending.
- Bulk paste/CSV import of guests.
- Manual RSVP↔guest linking for names the fuzzy match misses (v1 surfaces them as unmatched).

## Testing

- Unit (`src/lib/__tests__/guests.test.js`): `normName`; `namePartsMatch` (exact, middle-initial,
  spacing/punctuation, mismatch); `reconcileGuests` (matched attending/maybe/declined, no-reply,
  unmatched RSVP, summary math incl. confirmedHeads, empty inputs).
- Unit (mappers): `guestToRow`/`rowToGuest` round-trip.
- Existing 99 tests must stay green.
- Manual: toggle Strict RSVP → Guests tab shows/hides; add a guest, submit a matching RSVP →
  guest flips to Attending + counts update; submit an unmatched-name RSVP → appears in the
  unmatched notice; headcount matches a hand count.

## Risks / accepted tradeoffs

- Name-only matching: an RSVP whose name doesn't fuzzy-match its invite shows as outstanding +
  unmatched. Accepted for v1 (surfaced, not auto-resolved); manual linking is deferred.
- No cap enforcement yet, so the allocation is advisory (headcount/planning) until Enhancement 0005.
- `strictRsvp` off by default keeps every existing client exactly as-is.
