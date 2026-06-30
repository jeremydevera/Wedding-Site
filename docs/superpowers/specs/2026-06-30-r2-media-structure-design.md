# R2 media structure — design

**Date:** 2026-06-30
**Status:** Approved (design), pending implementation plan
**Bucket:** `celebrately-medias` (R2, APAC) · **Public host:** `https://media.celebrately.us` (custom domain, live)

## Problem

Media now uploads to R2 via the auth-gated `/api/upload` Pages Function, but:

1. **Flat keys.** Objects are keyed `<clientId>/<kind>/<ts>-<name>` where `kind` is only `audio`/`image`/`video`. No separation of the couple's curated assets from (future) guest uploads, and no per-purpose grouping.
2. **Stored as a relative URL.** The DB stores `/r2/<key>`, which only resolves in a web browser on our origin. Planned **native iOS/Android apps** have no origin, so a relative path can't be loaded.
3. **Served through a Function hop** (`/r2/<key>`), which is slower than a CDN and ties media access to a web host.

## Goals

- Clean, never-mixed separation by media type, scalable across many clients, easy per-client management.
- Same scheme works identically for web + iOS + Android.
- Files served from a fast, stable, absolute CDN URL.
- No breakage of existing stored values during the transition.

## Decisions (chosen)

- **Owner/guest split + type + purpose** key layout.
- **Store the bare key**, resolve to an absolute URL at render time.
- **Serve from `media.celebrately.us`** (R2 custom domain, public, CDN-cached).

## Design

### 1. Object key layout

```
<clientId>/<scope>/<type>/<purpose>/<shortid>-<name>
```

- `scope`: `owner` (couple's curated assets) | `guest` (moderated guest uploads)
- `type`: `image` | `audio` | `video`
- `purpose`: `hero` | `attire` | `story` | `frame` | `envbg` | `playlist` | `gallery` | `message`
- `shortid`: a short random token (collision-safe; also avoids leaking sort order)
- `name`: sanitized original filename (readability)

Examples:
```
87e2…/owner/image/hero/k3x9a-venue.jpg
87e2…/owner/image/attire/k3xa2-men.jpg
87e2…/owner/audio/playlist/k3xb7-song.mp3
87e2…/guest/image/gallery/k3xc1-IMG_2201.jpg   (moderated)
87e2…/guest/video/message/k3xd5-clip.mp4
```

(`type` is always one of `image|audio|video`. Legacy guest media tagged `type: "photo"` maps to `image`.)

Rationale: client-first isolates each wedding (find / audit / bulk-delete by one prefix); the owner/guest split lets guest uploads be moderated, rate-limited, or wiped without touching curated assets; type guarantees mp3 / image / video never share a folder; purpose keeps it tidy and lets an app fetch exactly what a screen needs.

### 2. Store the key, resolve at render

- The DB stores **only the bare key** (`87e2…/owner/image/hero/k3x9a-venue.jpg`) — never `/r2/…`, never an absolute URL.
- A single resolver, `mediaUrl(stored)`, builds the URL at render time:
  - bare key → `https://media.celebrately.us/<key>`
  - legacy value already absolute (`http…`), data URL (`data:…`), or proxy path (`/r2/…`) → returned unchanged (backward-compat).
- `MEDIA_BASE` is a single constant (`https://media.celebrately.us`). Web and both apps each prepend their own base to the same stored key — so the host can change with zero data migration.

### 3. Serving

- R2 bucket public access via the **`media.celebrately.us`** custom domain (done, SSL active). CDN-cached; objects are immutable (unique keys) → far-future `Cache-Control`.
- The existing `/r2/<key>` Pages Function stays **only** as a fallback for already-stored legacy `/r2/…` values; new media never uses it.
- `r2.dev` public dev URL stays disabled.

### 4. Upload Function (`functions/api/upload.js`)

- Inputs (multipart): `scope`, `type`, `purpose`, plus `file` **or** `sourceUrl` (unchanged auth: valid Supabase session; 25 MB cap; audio/image/video content-type allowlist).
- Sanitize each segment against a fixed allowlist (reject unknown scope/type/purpose → `misc`/`owner` fallback) so callers can't write arbitrary paths.
- Build `<clientId>/<scope>/<type>/<purpose>/<shortid>-<name>`; `put` to R2.
- **Return the bare `key`** (callers store that). Keep returning `url` too for any caller still expecting it, but clients should store `key`.

### 5. Client changes

- Uploaders pass their purpose:
  - hero → `owner/image/hero`, frame → `owner/image/frame`, envBg → `owner/image/envbg`
  - attire → `owner/image/attire`, story → `owner/image/story`
  - playlist → `owner/audio/playlist`
  - (future) gallery photo/video → `guest/image|video/gallery`; video-message → `guest/video/message`
- Every media render site (`<img src>`, `<audio src>`, vinyl disk art, attire, hero, story, etc.) passes the stored value through `mediaUrl()`.
- `ImageUploadField` / `uploadAudio` / `migrateClientMediaToR2` store the returned `key`.

### 6. Migration of existing media

The demo client still holds **2 base64 attire images + 2 Supabase-hosted audio tracks** (~3 MB row); the earlier "Move media to R2" was never run. Re-point the migration to the new layout:
- base64 image → `owner/image/<purpose>` (hero/attire/story by field)
- Supabase audio → `owner/audio/playlist`
- any already-stored `/r2/<key>` → re-key into the new layout (optional cleanup; resolver handles them regardless)
- Idempotent; stores bare keys.

## Out of scope (YAGNI)

- Image resizing / thumbnail variants (revisit if app perf needs it).
- R2 lifecycle/expiry rules.
- Signed/expiring URLs (wedding media is already on a public site; public-by-URL is acceptable).
- D1 / moving DB off Supabase.

## Security

- Upload auth unchanged: `/api/upload` requires a valid Supabase session (admins only; guests are anonymous).
- Public read by URL is acceptable — the same media is already shown on a public wedding site; keys are unguessable enough (random `shortid`) to avoid trivial enumeration, and there's no list permission on the public domain.

## Verification plan

- Unit: `mediaUrl()` resolves bare keys to `media.celebrately.us` and passes through `data:` / `http` / `/r2/` unchanged.
- Build + existing suite stays green.
- Live: after deploy, upload one image + one audio in admin → confirm the stored value is a bare key, the object appears under the new prefix in R2, and `https://media.celebrately.us/<key>` returns 200 + correct content-type.
- Confirm demo home renders all media (hero/attire/playlist) and the content row shrinks after migration.
- **Render check, not just HTTP 200** (lesson from the white-screen incident): verify the page actually paints with no console errors.
