# Feature Permissions v2 — one table, per-module levels (sandbox trial)

**Date:** 2026-07-11 · **Requested by:** Jeremy · **Status:** Approved design
**Trial scope:** `sandbox.celebrately.us` only, behind a per-client `accessV2` flag.

## Goal

Replace the two separate control surfaces — Settings → Features (module on/off)
and Settings → Access (owner-edit grants) — with ONE per-client table where the
superadmin sets a single level per module:

| Level | Guest site | Client-owner admin | Who edits content |
|-------|-----------|--------------------|-------------------|
| **None** | Section hidden (nav + route) | No tab | Nobody (feature absent) |
| **View** | Section live | No tab | Superadmin only |
| **Edit** | Section live | Tab with full CRUD + "Home section" panel | Owner (and superadmin) |

Also restructures the client admin so each feature's home-page presence is
controlled inside that feature's own tab instead of the Home tab's folders.

## Safety constraint (hard requirement)

There are ~20 live clients on one shared bundle. **No behavioral change for any
client without `accessV2`.** All new logic branches on the flag; legacy clients
must execute today's code paths and render today's UI exactly. (The bundle
itself necessarily changes — the guarantee is behavioral, enforced by the flag
plus the existing test suite staying green.) Rollback = unset the flag.

## Data model

New key in client `content`:

```json
"accessV2": true,
"features": {
  "home": "edit", "story": "none", "details": "edit", "schedule": "edit",
  "venue": "edit", "guestbook": "edit", "quiz": "edit",
  "entourage": "edit", "music": "none"
}
```

- Levels: `"none" | "view" | "edit"`.
- **RSVP is not stored** — always `edit` (core feature of the system).
- **Home floor is `view`** — the resolver never returns `none` for `home`
  (the landing page always renders). New-client default for home is `edit`.
- Absent key in the map = the new-client default for that module (below).
- Attire is NOT a row — its content moves inside the **Details** module.
- FAQ stays part of Details. The home "timeline glimpse" belongs to Schedule.

**New-client defaults** (used when seeding approvals/requests and for absent keys):
home `edit` · story `none` · details `edit` · schedule `edit` · venue `edit` ·
guestbook `edit` · quiz `edit` · entourage `edit` · music `none`.

## Resolver — single source of truth

`featureLevel(settings, key)` in `src/lib/roles.js`:

1. Platform kill-switch (`DISABLED_MODULES`) → `none`, always.
2. `key === "rsvp"` → `edit`, always.
3. `settings.accessV2 === true` → read `settings.features[key]`, falling back
   to the new-client default; clamp `home` to at least `view`.
4. Legacy (no flag) → derive from today's model so behavior is identical:
   `moduleEnabled(modules, key)` false → `none`. Enabled and the module has a
   grant key (OWNER_EDIT_HOME / OWNER_EDIT_TABS): grant on → `edit`, off →
   `view`. Enabled with no grant concept (guestbook, quiz — owners always get
   those tabs today when the module is on) → `edit`.

Consumers:
- **Guest site** (nav links, routes, home sections): show when level ≠ `none`.
- **Owner admin tabs**: show when level = `edit`.
- **Superadmin**: sees everything regardless (unchanged).

## Superadmin UI — Edit client (and request approval editor)

For accessV2 clients the Features + Access toggle lists are replaced by one
table: rows = Home, Our Story, Details (attire inside), Schedule, Venue & Map,
Guestbook, Quiz, Entourage, Music playlist. One None/View/Edit segmented
control per row; Home renders View/Edit only; an RSVP row renders locked
"Edit — core". The request-approval editor seeds the table with the defaults.
Legacy clients keep the current editors untouched.

## Client admin restructure (accessV2 only)

- **Home tab** shrinks to Couple & Event + Invitation (the hero/landing content).
- **Music playlist** and **Entourage** become top-level tabs.
- **Attire** moves into the **Details** tab.
- Home-timeline controls move into **Schedule**; the Google-Maps home folder
  moves into **Venue & Map**.
- Every module tab gains a standard **"Home section" panel**:
  - "Show on home page" checkbox
  - Small header (eyebrow) + big header (title) overrides
  - Module-specific layout options (timeline vertical/horizontal, maps-to-show)
  - That module's **tab rename** field (replaces Settings → "Rename tabs")
- Owners see a module tab only at Edit. View/None = no tab (per Jeremy: "if
  it's view, don't show the nav tab to the client; only admin can CRUD").
- **Client Settings** loses the Features and Access folders; keeps Theme,
  Account, and RSVP options (strict RSVP, require phone, deadline) since RSVP
  has no content tab.

## Sandbox trial & rollout

- `accessV2: true` set on sandbox via SQL only. No other client gets the flag.
- Legacy UI paths remain fully intact; flag off = instant rollback.
- Later (separate effort, after trial sign-off): migration script mapping
  `modules` + `ownerEdit` → `features` for all clients, then legacy-path removal.

## Testing

- Unit: `featureLevel` — accessV2 map reads, defaults for absent keys, home
  floor, rsvp lock, kill-switch, and the legacy derivation matching today's
  `moduleEnabled`/grant behavior exactly.
- Unit/render: owner tab visibility both models; guest nav gating both models.
- Existing suite (251 tests) must stay green untouched — that is the
  "no production behavior change" proof.
- Playwright on sandbox: table edits flow to owner tabs + guest nav; View
  module live on site with no owner tab; Home-section panel headers render on
  the public home page.

## Out of scope

- Migrating the 20 live clients (post-trial).
- New feature types beyond the current module list.
- Per-guest permissions.
