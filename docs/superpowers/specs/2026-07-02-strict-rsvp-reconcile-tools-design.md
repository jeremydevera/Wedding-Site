# Strict RSVP Reconcile Tools — Design

**Date:** 2026-07-02
**Status:** Approved (design agreed in conversation), pending implementation plan

## Goal

Smooth the "enable Strict RSVP with pre-existing RSVPs" workflow with two small
Guests-tab tools:

1. **"Add to list" on unmatched RSVPs** — one click creates a guest entry from an
   existing RSVP (name parts + count as the allocation) instead of retyping it.
2. **Over-allocation highlight** — flag guests whose confirmed RSVP count exceeds
   their seat allocation (grandfathered rows from before strict was enabled).

No DB or API changes — both features are pure admin-UI over existing data
(`reconcileGuests` output + `addGuestDb`). Existing RSVPs stay grandfathered.

## Current state (grounding)

- `GuestsAdmin` (`src/admin/manage.jsx:224`) already computes `recon =
  reconcileGuests(guests, rsvps)` and renders `recon.unmatchedRsvps` as a plain
  comma-joined sentence (line ~270-274) — informative but actionless.
- The guests table renders `Coming` as `x.rsvp.count` for attending rows (line ~303)
  with no comparison against `g.allocation`.
- RSVP objects carry `firstName/middleName/lastName` (added in the guest-list work),
  but rows submitted before migration `0008` may have only `fullName`.
- `saveGuest` handles insert via `addGuestDb` + `Store.addGuest` with a toast +
  saving overlay (`run`).

## Design

### 1. Pure helper: `guestFromRsvp(rsvp)` in `src/lib/guests.js`

Builds a guest draft from an RSVP:
- Name: use `firstName/middleName/lastName` when present; otherwise split
  `fullName` — first token → firstName, last token → lastName, middle tokens →
  middleName (single-token names become firstName with lastName `""`).
- `allocation`: `max(1, Number(rsvp.count) || 1)` — their replied party size.
- `email`: `rsvp.email || ""`, `notes: ""`.
Returns `{ firstName, middleName, lastName, allocation, email, notes }`.
Unit-tested (TDD).

### 2. Unmatched notice → actionable rows

Replace the comma-joined sentence with one row per unmatched RSVP: the name plus
an **"Add to list"** button. Click → `guestFromRsvp(rsvp)` → same insert path as
`saveGuest` (overlay, error toast, success toast). After the insert the store
updates, `reconcileGuests` recomputes, and the row disappears from the notice
(auto-matches). Keep the lead-in line ("N RSVPs don't match…").

### 3. Over-allocation highlight

In the guests table, when `x.status === "attending"` and
`Number(x.rsvp.count) > Number(g.allocation)`, render the Coming cell
emphasized: count in a warning color + an "over" tag, `title="More than the
allocated seats"`. Pure render logic, computed inline from data already on hand.

## Out of scope

- Auto-resolving unmatched RSVPs, editing the RSVP itself, bulk import.
- Any change to the public form, RPCs, or tables.

## Testing

- Unit (TDD): `guestFromRsvp` — name parts passthrough, fullName splitting
  (1/2/3+ tokens), allocation default + from count, email default.
- Existing 114 tests stay green; build passes.
- Manual: unmatched RSVP → Add to list → appears as guest, notice row gone,
  status flips to matched; guest with allocation 1 + attending count 3 shows the
  over-allocation mark.
