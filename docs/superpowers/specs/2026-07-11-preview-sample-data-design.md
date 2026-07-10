# Show-to-Home previews: sample-data fallback

**Date:** 2026-07-11 · **Requested by:** Jeremy · **Status:** Approved
**Scope:** accessV2 Show-to-Home modals only (Schedule, Details, FAQ, Venue & Map, Music playlist, Entourage).

## Problem

A new client with no content opens a Show-to-Home modal and the live preview
renders empty — they can't see what the section will look like.

## Decision

Render-time fallback constants (`V2_SAMPLES`), used exclusively by the modal
preview components:

- **Fallback rule:** per module, all-or-nothing — the preview uses the client's
  real list when it has ≥1 item; only a completely empty list falls back to the
  full sample set. Never mixed.
- **Tag (option A, Jeremy's pick):** when samples are in use, a grey pill pinned
  to the preview frame reads "Sample data — your real content will appear
  here." Real data shows no tag.
- **Scope guarantee:** samples are constants referenced only by the preview
  render inside `ShowToHomeModal` sims. They are never written to the Store,
  never part of Save payloads, never rendered on the public site — leak-proof
  by construction. Behavior is permanent (same in prod).

## Sample content

- Schedule: 3 events (3:00 PM Wedding Ceremony · 6:00 PM Dinner · 9:00 PM Party).
- Detail cards: 3 (Parking, Dress Code, Gifts).
- FAQ: 3 realistic Q/As.
- Venue: one pin ("Manila Cathedral, Intramuros, Manila") for the map embed.
- Music: 2 tracks (title/artist only, empty url — play is a no-op).
- Entourage: 2 groups (Principal Sponsors, Bridesmaids) with sample names.

## Rejected approaches

- Injecting samples into the client store when empty — one bug away from
  publishing dummy data.
- Seeding sample content at client creation — pollutes real data.

## Testing

Render tests: empty module → preview shows samples + tag; module with real
data → real items, no tag. Full suite must stay green (legacy untouched —
feature lives entirely inside accessV2 modal code).
