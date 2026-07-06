# Dev rules — read before adding admin controls

Hard rules for this codebase. Violating one is a bug. Check this list when
adding or reviewing admin UI.

---

## R1 — Every settings control must enable "Save changes"

Any admin control that edits a **persisted setting** (a key that ends up in the
client row) MUST write through **`Store.updateSettings({ key: value })`** — the
same setter the dirty-tracker watches.

**Why:** the Save button is gated by `dirty` in `AdminApp`
(`src/admin/manage.jsx`): `dirty = savedRef.current != null && snapshot() !==
savedRef.current`, where `snapshot()` = `JSON.stringify(stateToClientRow(Store.get()))`.
A control only enables Save if its change makes `stateToClientRow` output differ
from the last saved snapshot.

**Do:**
- `onChange={(e) => Store.updateSettings({ mapStyle: e.target.value })}` — store
  update → re-render → dirty flips → Save enables. ✅

**Do NOT:**
- Write to component-local `useState` only (never reaches the store → Save never
  enables). ❌
- Use `Store.previewSettings(...)` for a real setting — it's in-memory/ephemeral
  and deliberately does NOT persist or mark dirty (it's only for the theme
  live-preview iframe). ❌
- Add a new key that `stateToClientRow` drops. New setting keys flow through
  `...rest` automatically; the only stripped keys are `CONTENT_SECRET_KEYS`
  (`src/lib/mappers.js`). Don't add a setting to that list unless it must never
  persist. ❌

**Exception — auto-save folders:** a few Home sub-folders auto-save via
`toggleShow` (which calls `persistChanges()` immediately) and have **no** Save
button. That's intentional there. But any panel that shows a **Save changes**
button must use `Store.updateSettings` (store-only) for its controls, never
`toggleShow`, so Save governs the commit. (See the Couple & Event fix.)

**Verify after adding any settings control:** change it, confirm the Save button
enables, click Save, reload — the value persists.

---

## R2 — Superadmin-only tools stay gated

The R2 media library "Choose from library" tab, and the owner-edit content tabs,
are gated by `auth.role`/grants. See `docs/BY-DESIGN.md`. Don't expose them to
owners.
