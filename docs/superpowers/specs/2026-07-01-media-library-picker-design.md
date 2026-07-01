# Media Library Picker — Design Spec

**Date:** 2026-07-01
**Status:** Approved (design), pending spec review → implementation plan

## Problem

When setting an image (Hero, Story photos, Attire, Envelope background, Frame, …)
or a song (Track editor), the admin can currently only **upload a new file**.
There is no way to **reuse** a file already uploaded to Cloudflare R2. The owner
wants a "Choose from library" option that lists their existing R2 media so they
can pick one instead of re-uploading — for **both images and audio (mp3)**.

## Decisions (from brainstorming)

1. **Library source: live R2 list.** A new auth-gated `GET /api/media` enumerates
   the client's actual objects in the R2 bucket (`env.MEDIA.list`). Shows every
   file ever uploaded for that client — a true library, including files no longer
   referenced anywhere. (Rejected alternative: deriving the list from keys saved
   in `clients.content` — would hide replaced/unused uploads.)
2. **Filter: type only.** An image field lists **all** the client's images
   regardless of original purpose; the track editor lists **all** their audio.
   Maximizes cross-field reuse. Scope fixed to `owner` (guest uploads excluded).
3. **UI: top toggle inside the existing modal.** Two tabs — `Upload new`
   (the current crop/upload flow, default) and `Choose from library` (the grid).

## Architecture

Three units, each independently testable.

### Unit A — List endpoint: `functions/api/media.js`

New Cloudflare Pages Function, `GET /api/media?clientId=<id>&type=image|audio`.
Mirrors the auth + conventions of `functions/api/upload.js`:

- **Auth:** require `Authorization: Bearer <token>`; verify with
  `GET ${SUPABASE_URL}/auth/v1/user` (same anon-key fallback as upload.js).
  401 if missing/invalid. This blocks the public exactly like upload.
- **Params:**
  - `clientId` — sanitized `String(...).replace(/[^a-zA-Z0-9-]/g, "").slice(0,64) || "shared"` (identical to upload.js line 43).
  - `type` — allow-list `{"image","audio"}`; default `image`. (No `video` in v1.)
- **List:** `env.MEDIA.list({ prefix: `${clientId}/owner/${type}/` })`.
  R2 `list` returns `{ objects: [{ key, size, uploaded, httpMetadata }], truncated, cursor }`.
  Loop on `cursor` while `truncated` to gather all (a single client is unlikely to
  exceed the 1000-object page, but handle it for safety).
- **Response:** `{ items: [{ key, name, size, uploaded }] }`, newest first
  (sort by `uploaded` desc). `name` = the human filename: take the last path
  segment after `/`, then strip the leading `<shortid>-` (8 hex/alnum chars + `-`)
  → e.g. `k3x9a1b2-venue.jpg` → `venue.jpg`.
- **503** if `env.MEDIA` is unbound (same guard as upload.js).
- Falls under the existing `/api/*` route in `public/_routes.json`; no routing change.

### Unit B — Picker component: `<MediaLibrary type clientId onPick />`

New reusable React component (rendered inside the existing `Modal`). Location:
alongside `ImageUploadField` in `src/admin/manage.jsx` (or a sibling module if
that file is already large — decide during planning).

- On mount / when opened: `fetch('/api/media?clientId=…&type=…')` with the Bearer
  token (via `supabase.auth.getSession()`), same as `uploadToR2`.
- **Images** (`type="image"`): responsive thumbnail grid; each cell is a button
  showing `<img src={mediaUrl(item.key)}>` + filename on hover/below.
- **Audio** (`type="audio"`): list rows — filename + a small ▶ button that
  previews via a hidden `<audio src={mediaUrl(item.key)}>`; row click selects.
- **States:** loading (spinner), empty (`No uploads yet — switch to "Upload new".`),
  error (message + keep the Upload-new tab usable).
- **Pick:** calls `onPick(item.key)` with the **bare key** and closes the picker.

### Unit C — Integration (two call-sites)

Add the `Upload new | Choose from library` toggle to:

1. **`ImageUploadField`** (`src/admin/manage.jsx:51`). On library pick, set the
   field value to the chosen key directly — the file is already uploaded and
   (if it was cropped) already cropped, so **no re-crop**. Existing upload/crop
   path is unchanged under the "Upload new" tab.
2. **Track editor** (`src/admin/manage.jsx:1770`, uses `uploadAudio`). On library
   pick, set the track's `url` to the chosen audio key. Title/artist remain
   manually entered, exactly as today.

## Data flow

Picking is **indistinguishable from uploading** downstream: both yield a bare R2
key. That key is stored into the same content field (`heroImage`, `story[].img`,
`playlist[].url`, …) → persisted to `clients.content` via `saveClientData()` →
rendered through `mediaUrl(key)` → served by `functions/r2/[[path]].js`. **No new
persistence, no schema change.**

## Security

- Same auth surface as upload: a valid Supabase session is required; the endpoint
  is unusable by the public/guests.
- `clientId` is a request param (as with upload). This is not a hardening
  regression — it matches the existing upload trust model, and RLS/session already
  govern what the signed-in user can save. The endpoint only *lists* keys under a
  prefix (no data mutation, no file bodies returned — just key/size/date).
- Only `owner` scope is listed, so guest-submitted media never appears in the
  admin picker.

## Error handling & edge cases

- List fetch fails → inline error in the picker; "Upload new" tab still works.
- Empty library → prompt to upload.
- `>1000` objects → cursor pagination loop (handled server-side).
- Filename parse: if a key has no `<shortid>-` prefix (legacy/migrated), fall back
  to the raw last segment.
- Broken thumbnail (object deleted out-of-band) → `<img onError>` hides the cell.

## Testing (vitest, alongside the existing 51)

- **Endpoint** (unit, mocked `env.MEDIA.list`): builds the correct prefix per
  `type`; rejects a bad `type`; returns `name` with the shortid stripped; sorts
  newest-first; 401 without a token; 503 without the binding.
- **Picker** (component, mocked `fetch`): renders a grid from a stubbed item list;
  `onPick` fires with the exact key on click; empty and error states render.

## Out of scope (v1) — candidates for later

- Deleting / renaming files from the library (would need a `DELETE /api/media`).
- Video media in the picker.
- Cross-client / shared media libraries.

## Files touched

- **New:** `functions/api/media.js`, `docs/superpowers/specs/2026-07-01-media-library-picker-design.md`, tests.
- **Edit:** `src/admin/manage.jsx` (`ImageUploadField` + track editor + new picker
  component/toggle), possibly `src/lib/api.js` (a small `listMedia(clientId, type)`
  helper mirroring `uploadToR2`), and `src/styles/styles.css` (picker grid styles).
