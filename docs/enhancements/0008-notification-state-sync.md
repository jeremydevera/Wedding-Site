# Enhancement 0008 — Server-side notification read/cleared state

**Status:** Pending (next feature) · **Severity:** P3 · **Added:** 2026-07-03 · **Requested by:** Jeremy

## Problem

The admin topbar bell tracks two things in browser `localStorage` only:

- `evermore_notif_seen_<clientId>` — timestamp; items newer than it count toward the badge.
- `evermore_notif_cleared_<clientId>` — timestamp; items at/before it are hidden from the list ("Clear" button).

Because that state is per-browser:

1. Clearing on the laptop does **not** clear on the phone — each device shows its own badge.
2. Wiping browser data (or incognito) resurrects every old notification.
3. A new device shows *all* history as "new".

## Goal (GitHub/Slack pattern)

Notification read/cleared state lives **server-side per user**, so every signed-in
device agrees. No notification data is deleted — same semantics as today, just synced.

## Design

### Schema (one migration)

Two timestamp columns on the existing `public.profiles` row (no new table needed —
state is per user, one row each):

```sql
alter table public.profiles
  add column notif_seen_at    timestamptz,
  add column notif_cleared_at timestamptz;
```

RLS: users may `update` these columns on **their own** profile only (profiles
already has per-user policies — verify the update policy covers these columns,
or add a narrow one).

### Client changes (`NotificationBell` in `src/admin/manage.jsx` + `src/lib/api.js`)

- **Load:** fetch both timestamps with the profile/session at admin load; hydrate
  the bell from them instead of `localStorage`.
- **Open the panel** → `update profiles set notif_seen_at = now()` (fire-and-forget).
- **Click Clear** → `update profiles set notif_cleared_at = now(), notif_seen_at = now()`.
- **Fallback:** keep writing localStorage as a cache so the bell still works
  offline / while the profile fetch is in flight; server value wins when present.
- **Realtime bonus (optional):** subscribe to the profile row so clearing on the
  laptop clears the phone that's already open.

### Costs (accepted trade-offs)

- One extra `update` per panel-open and per clear (tiny, one row by primary key).
- One migration + RLS check.
- Slightly more client code (server read/write + fallback merge).

## Acceptance criteria

- [ ] Clear on device A → device B's bell (after reload or realtime push) shows no old items, badge 0.
- [ ] Opening the panel on A zeroes the badge on B after reload.
- [ ] Fresh browser/incognito shows the synced state, not full history.
- [ ] Signed-out/anonymous behavior unchanged (no writes).
- [ ] Existing localStorage state migrates gracefully (first server write wins thereafter).
- [ ] Tests: state merge (server vs local), write-on-open, write-on-clear, RLS denies cross-user update.
