# Superadmin "Medias" tab — design

**Date:** 2026-07-01
**Status:** Approved (design), pending spec review
**Scope:** Add a superadmin-only "Medias" tab to manage the celebrately.us (demo) client's Cloudflare R2 media — list, show in-use/unused, rename (display label), delete (unused only).

## Goal

The top superadmin, in the celebrately.us admin console, gets a **Medias** nav tab to manage the R2 files belonging to the celebrately.us / demo site:
- See every R2 object for that client, with a thumbnail/preview.
- See whether each file is **in use** or **unused** (and where it's used).
- **Rename** a file's display name (safe: a label, the underlying R2 key never changes).
- **Delete** a file — allowed only when it is **unused** (an in-use file can't be deleted, so a live page can't break).

## Context (verified in code)

- **R2**: Cloudflare Pages binding `env.MEDIA`. Objects served same-origin at `/r2/<key>` (`functions/r2/[[path]].js`), 1-year immutable cache. `mediaUrl(key)` (`src/lib/media.js`) turns a bare key into `/r2/<key>`.
- **Key scheme**: `{clientId}/{scope}/{type}/{purpose}/{shortid}-{safeName}` (e.g. `…/owner/image/hero/k3x9a-venue.jpg`, `…/owner/audio/playlist/…`). Set server-side in `functions/api/upload.js`.
- **List endpoint (exists)**: `GET /api/media?type=image|audio` → `{ items: [{ key, name, size, uploaded }] }`, newest first, across ALL clients (no client filter), token-checked only.
- **No delete / no rename endpoint exists.**
- **celebrately.us → "demo" client**: `resolveSubdomain()` returns `"demo"` for celebrately.us and demo.celebrately.us (`src/lib/tenant.js`); `loadClientData()` (`src/lib/api.js`) loads that `clients` row (by `subdomain`) into the store. So the currently-loaded client on celebrately.us IS the demo client — its `id` (clientId) and `content` are already in the store.
- **In-use references** live in `clients.content` for that client, in exactly these fields: `heroImage`, `frameImage`, `envBgImage`, `attire[].image`, `story[].img`, `playlist[].url`. All store **bare R2 keys**. (Guest-uploaded gallery/video-message files are localStorage-only and not in `content`; out of scope — for the demo client, R2 objects are the superadmin's own uploads, all reachable via these fields.)
- **Superadmin console**: tabs in `ADMIN_TABS` (`src/admin/manage.jsx`), superadmin-only set `SUPERADMIN_ONLY` (`src/lib/roles.js`), render switch `{activeTab === "x" && <X/>}`. Role gate via `auth.role === "superadmin"`.
- **Security**: existing Functions only verify a valid Supabase token (no role check). Superadmin RLS: SQL `public.auth_role()` (security-definer) returns the caller's role; callable as PostgREST RPC with the caller's JWT.

## Components

### 1. Nav + gating (`src/admin/manage.jsx`, `src/lib/roles.js`)
- Add `{ key: "medias", label: "Medias", icon: "camera" }` to `ADMIN_TABS`.
- Add `"medias"` to `SUPERADMIN_ONLY` in `roles.js` so only the superadmin sees it.
- Add render case `{activeTab === "medias" && <MediasAdmin />}`.
- Add an `Icon.camera` (or reuse an existing image/photo icon) if not present.

### 2. `MediasAdmin` component (`src/admin/manage.jsx`)
Data source: the currently-loaded client (celebrately.us = demo) from the store — its `clientId` and `content`.
- On mount, fetch `GET /api/media?type=image` and `?type=audio`; keep only items whose `key` starts with `"<clientId>/"`.
- Build `usedKeys: Map<key, whereLabel>` from `content` (the 6 fields → human label like "Hero image", "Playlist track", "Story photo", "Attire photo", "Frame overlay", "Envelope background").
- Read `content.mediaLabels` (`{ [key]: label }`) for display names.
- Render a list/grid: thumbnail (image via `mediaUrl(key)`; audio → file chip + inline `<audio>`), display name (label or `name`), size, uploaded date, **In use ("used in: <where>") / Unused** badge, and row actions:
  - **Rename** → inline edit / small modal; on save, upsert `content.mediaLabels[key]` and persist (see §4). Key/URL unchanged.
  - **Delete** → disabled + tooltip ("in use — can't delete") when used; else confirm dialog → call delete endpoint (§5) → remove row + success toast.
- Filters: type (All / Images / Audio) and usage (All / In use / Unused). Mirror `MediaAdmin`'s look (folders/seg + panel) and the existing admin toolbar/table styling.
- Empty/loading/error states; uses the `AdminSaveCtx` `run()` overlay for server ops.

### 3. In-use extractor (pure, unit-tested) — `src/lib/media-usage.js` (new)
`collectUsedKeys(content) → Map<key, whereLabel>`: reads the 6 fields, returns each referenced bare key mapped to a human label. Pure function, no I/O. Unit-tested with a sample content object (present keys, missing fields, empty arrays). Reused by both the UI and (optionally) documented for the delete endpoint's server-side check.

### 4. Rename = display label (no new endpoint)
- Labels stored in the demo client's `content.mediaLabels` object.
- Persist by updating that client row: `supabase.from("clients").update({ content: {...content, mediaLabels} }).eq("id", clientId)` (superadmin RLS permits). Update the store so the UI reflects immediately.
- The R2 object is never rewritten; the `/r2/<key>` URL and all existing references keep working.

### 5. Delete endpoint (new, role-gated) — `functions/api/media-delete.js`
`POST /api/media-delete { key }`:
1. Require `Authorization: Bearer <token>`; verify via `GET /auth/v1/user` (as existing Functions do).
2. Verify superadmin: `POST {SUPABASE_URL}/rest/v1/rpc/auth_role` with the caller's JWT → must equal `"superadmin"`; else `403`.
3. Load the owning client's `content` (client id = first path segment of `key`) via Supabase REST with the caller's token (superadmin RLS allows); recompute used keys; if `key` is in use → `409 { error: "in use" }`, do NOT delete.
4. `await env.MEDIA.delete(key)` → `200 { ok: true }`.
- Add route coverage (`/api/*` already routed in `public/_routes.json`).
- Only the delete Function gets the role gate; `upload.js` / `media.js` are left unchanged in this change.

## Data flow

1. Tab mounts → list R2 (image+audio) → filter to demo `clientId` → cross-reference `content` for used/unused + labels → render.
2. Rename → update `content.mediaLabels` → Supabase update on client row → store refresh.
3. Delete (unused only) → `POST /api/media-delete` → server re-verifies superadmin + not-in-use → `env.MEDIA.delete` → row removed.

## Error handling
- List fetch failure → error state + retry.
- Delete: `403` (not superadmin) and `409` (in use) surfaced as red toasts; the UI already disables delete for in-use, so `409` is a server-side backstop.
- Rename save failure → red toast, revert label in UI.

## Testing
- **Unit** (`vitest`): `collectUsedKeys(content)` — keys present, fields missing, empty arrays, duplicate keys; label lookup/merge (`mediaLabels` overrides raw name).
- **Manual on demo**: list shows demo R2 objects with correct in-use badges; rename shows label + persists across refresh; delete blocked for in-use, works for unused; verify a deleted key returns 404 at `/r2/<key>` and the row is gone.
- Full suite (`npm test`) stays green.

## Out of scope (YAGNI)
- Managing other clients' media (this tab is celebrately.us/demo only).
- True file rename (key change + reference rewrite).
- Bulk delete / multi-select.
- Reconciling guest-uploaded (localStorage-only) media.
- Adding role checks to `upload.js` / `media.js` (separate hardening).

## Open implementation detail
- Confirm the store field holding the loaded client's `id` (from `loadClientData`) to use as the `clientId` prefix; if not directly present, resolve it once via `supabase.from("clients").select("id").eq("subdomain","demo")`.
