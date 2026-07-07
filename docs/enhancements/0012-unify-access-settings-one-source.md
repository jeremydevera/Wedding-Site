# Enhancement 0012 — Unify all Access settings into one shared source

**Status:** Pending · **Severity:** P3 · **Added:** 2026-07-07 · **Requested by:** Jeremy

## Problem

The Access tab exists in two places with **separate** implementations:

- Client side — `SettingsAdmin` in `src/admin/manage.jsx` (`tab === "access"` block).
- Superadmin side — `AccessFields` in `src/admin/superadmin.jsx` (Edit-client + Edit-request modals).

Only the **owner-edit grants** are single-sourced (`OWNER_EDIT_HOME` / `OWNER_EDIT_TABS`
in `src/lib/roles.js`). Every **other** Access setting — features/modules,
moderation toggles (auto-approve media/guestbook), site-wide switches (guest
uploads, public gallery, Strict RSVP) — is written twice. Adding a new one to
one screen does NOT reflect on the other; it must be added in both.

## Goal

Add-once, appears-everywhere for the **whole** Access tab, like grants already do.

## Approach (either works)

1. **Shared component (preferred):** make `AccessFields` the single Access UI and
   have the client's `SettingsAdmin` Access tab render it too (it already takes a
   `v` settings object + `set` patch fn + `omit`). Pass the client's live settings
   and `Store.updateSettings` as `set`. Delete the duplicated JSX in manage.jsx.
   - Watch: client side commits on Save (store-only `set`), superadmin side has its
     own save flow — keep `set` semantics per caller (store-only vs editForm patch).
   - Keep DEV-RULES R1: the client-side `set` must be `Store.updateSettings` so Save enables.
2. **Shared field list:** extract moderation/switch definitions into a data list in
   `roles.js` (like the grants) that both screens map over.

## Acceptance criteria

- [ ] Adding one new Access toggle appears in BOTH client Settings → Access and
      superadmin Edit-client → Access with no second edit.
- [ ] Client-side toggles still enable "Save changes" (DEV-RULES R1) and commit on Save.
- [ ] Superadmin Edit-client + Edit-request modals unchanged in behavior.
- [ ] `omit` still lets the request wizard skip its own Strict RSVP step.
