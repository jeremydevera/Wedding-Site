# Media Library Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Choose from library" option (alongside "Upload new") to the admin image uploader and track editor, so the owner can pick an image/mp3 already stored in Cloudflare R2 instead of re-uploading.

**Architecture:** A new auth-gated `GET /api/media` Pages Function lists the client's existing R2 objects via the `env.MEDIA` binding (mirrors `functions/api/upload.js` auth). A thin `listMedia()` client wrapper + pure key-parsing helpers feed a reusable `MediaLibrary` grid and a `MediaPickerModal` (top toggle: Upload new | Choose from library). Both call-sites (`ImageUploadField`, `TrackEditor`) open the modal; a picked file is stored as a bare R2 key exactly like an upload — no schema change.

**Tech Stack:** React 18, Vite, Cloudflare Pages Functions + R2 (`env.MEDIA`), Supabase auth (bearer token), vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-07-01-media-library-picker-design.md`

---

## File Structure

- **Create** `src/lib/mediaLibrary.js` — pure helpers: `libraryPrefix(clientId, type)`, `fileNameFromKey(key)`. No React/network. Shared by endpoint-side logic mirror and the frontend display.
- **Create** `functions/api/media.js` — `onRequestGet`: auth + `env.MEDIA.list` + shaped JSON. Self-contained like `upload.js`.
- **Create** `src/admin/MediaPicker.jsx` — `MediaLibrary` (grid/list, fetches) + `MediaPickerModal` (toggle wrapper). Kept out of the already-large `manage.jsx`.
- **Modify** `src/lib/api.js` — add `listMedia(clientId, type)` fetch wrapper (mirrors `uploadToR2` auth).
- **Modify** `src/admin/manage.jsx` — wire the modal into `ImageUploadField` (line 51) and `TrackEditor` (line 1758).
- **Modify** `src/styles/styles.css` — picker tab + grid styles.
- **Tests** `src/lib/__tests__/mediaLibrary.test.js`, `src/lib/__tests__/mediaEndpoint.test.js`, `src/admin/__tests__/mediaPicker.test.jsx`.

Commands: build `npm run build`, tests `npm test` (vitest, currently 51 passing).

---

## Task 1: Pure key helpers (`src/lib/mediaLibrary.js`)

**Files:**
- Create: `src/lib/mediaLibrary.js`
- Test: `src/lib/__tests__/mediaLibrary.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/lib/__tests__/mediaLibrary.test.js
import { describe, it, expect } from "vitest";
import { libraryPrefix, fileNameFromKey, MEDIA_TYPES } from "@/lib/mediaLibrary.js";

describe("libraryPrefix", () => {
  it("builds the owner/<type> prefix for a client", () => {
    expect(libraryPrefix("87e2", "image")).toBe("87e2/owner/image/");
    expect(libraryPrefix("87e2", "audio")).toBe("87e2/owner/audio/");
  });
  it("sanitizes clientId like upload.js and defaults empty to 'shared'", () => {
    expect(libraryPrefix("a/b c!", "image")).toBe("abc/owner/image/");
    expect(libraryPrefix("", "image")).toBe("shared/owner/image/");
    expect(libraryPrefix("!!!", "audio")).toBe("shared/owner/audio/");
  });
  it("defaults an unknown type to 'image'", () => {
    expect(libraryPrefix("x", "video")).toBe("x/owner/image/");
    expect(libraryPrefix("x", undefined)).toBe("x/owner/image/");
  });
  it("exposes the allowed types", () => {
    expect(MEDIA_TYPES).toEqual(["image", "audio"]);
  });
});

describe("fileNameFromKey", () => {
  it("strips the last path segment's <shortid>- prefix (8 hex)", () => {
    expect(fileNameFromKey("87e2/owner/image/hero/k3x9a1b2-venue.jpg")).toBe("venue.jpg");
  });
  it("strips a Date.now() numeric shortid fallback", () => {
    expect(fileNameFromKey("87e2/owner/audio/playlist/1719800000000-song.mp3")).toBe("song.mp3");
  });
  it("returns the raw last segment when there is no shortid prefix", () => {
    expect(fileNameFromKey("87e2/owner/image/hero/venue.jpg")).toBe("venue.jpg");
    expect(fileNameFromKey("plain.png")).toBe("plain.png");
  });
  it("is safe on empty / non-string input", () => {
    expect(fileNameFromKey("")).toBe("");
    expect(fileNameFromKey(null)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/mediaLibrary.test.js`
Expected: FAIL — cannot resolve `@/lib/mediaLibrary.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/mediaLibrary.js
// Pure helpers for the media library picker — no React, no network.
// The key format (set by functions/api/upload.js) is:
//   <clientId>/<scope>/<type>/<purpose>/<shortid>-<name>
// where <shortid> is 8 hex chars (crypto.randomUUID) or a Date.now() fallback.

export const MEDIA_TYPES = ["image", "audio"];

// Mirror upload.js's clientId sanitization + the fixed owner scope, so the
// prefix matches exactly what upload wrote.
export function libraryPrefix(clientId, type) {
  const cid = String(clientId || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) || "shared";
  const t = MEDIA_TYPES.includes(type) ? type : "image";
  return `${cid}/owner/${t}/`;
}

// Human filename: last path segment with the "<shortid>-" prefix removed.
export function fileNameFromKey(key) {
  if (!key || typeof key !== "string") return "";
  const seg = key.split("/").pop() || "";
  return seg.replace(/^([0-9a-f]{8}|[0-9]{9,})-/i, "");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/mediaLibrary.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mediaLibrary.js src/lib/__tests__/mediaLibrary.test.js
git commit -m "feat(media-library): pure key helpers (prefix + filename)"
```

---

## Task 2: List endpoint (`functions/api/media.js`)

**Files:**
- Create: `functions/api/media.js`
- Test: `src/lib/__tests__/mediaEndpoint.test.js` (under src/ so vitest includes it; imports the function by relative path)

- [ ] **Step 1: Write the failing test**

```js
// src/lib/__tests__/mediaEndpoint.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { onRequestGet } from "../../../functions/api/media.js";

function req(url, headers = {}) { return new Request(url, { headers }); }
const AUTH = { authorization: "Bearer good-token" };

function envWith(objects, extra = {}) {
  return { MEDIA: { list: vi.fn().mockResolvedValue({ objects, truncated: false, cursor: undefined }) }, ...extra };
}

beforeEach(() => {
  // auth verify → Supabase /auth/v1/user returns ok
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("GET /api/media", () => {
  it("401 when no bearer token", async () => {
    const res = await onRequestGet({ request: req("https://x/api/media?clientId=c1&type=image"), env: envWith([]) });
    expect(res.status).toBe(401);
  });

  it("503 when the R2 binding is missing", async () => {
    const res = await onRequestGet({ request: req("https://x/api/media?clientId=c1&type=image", AUTH), env: {} });
    expect(res.status).toBe(503);
  });

  it("lists with the correct prefix and returns shaped, newest-first items", async () => {
    const env = envWith([
      { key: "c1/owner/image/hero/aaaaaaaa-old.jpg", size: 10, uploaded: "2026-01-01T00:00:00Z" },
      { key: "c1/owner/image/story/bbbbbbbb-new.jpg", size: 20, uploaded: "2026-06-01T00:00:00Z" },
    ]);
    const res = await onRequestGet({ request: req("https://x/api/media?clientId=c1&type=image", AUTH), env });
    expect(env.MEDIA.list).toHaveBeenCalledWith(expect.objectContaining({ prefix: "c1/owner/image/" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((i) => i.name)).toEqual(["new.jpg", "old.jpg"]); // newest first
    expect(body.items[0]).toMatchObject({ key: "c1/owner/image/story/bbbbbbbb-new.jpg", size: 20 });
  });

  it("uses the audio prefix when type=audio", async () => {
    const env = envWith([]);
    await onRequestGet({ request: req("https://x/api/media?clientId=c1&type=audio", AUTH), env });
    expect(env.MEDIA.list).toHaveBeenCalledWith(expect.objectContaining({ prefix: "c1/owner/audio/" }));
  });

  it("defaults an unknown type to image", async () => {
    const env = envWith([]);
    await onRequestGet({ request: req("https://x/api/media?clientId=c1&type=video", AUTH), env });
    expect(env.MEDIA.list).toHaveBeenCalledWith(expect.objectContaining({ prefix: "c1/owner/image/" }));
  });

  it("follows the cursor when the listing is truncated", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ objects: [{ key: "c1/owner/image/a/xxxxxxxx-1.jpg", size: 1, uploaded: "2026-01-01T00:00:00Z" }], truncated: true, cursor: "C1" })
      .mockResolvedValueOnce({ objects: [{ key: "c1/owner/image/a/yyyyyyyy-2.jpg", size: 1, uploaded: "2026-02-01T00:00:00Z" }], truncated: false });
    const env = { MEDIA: { list } };
    const res = await onRequestGet({ request: req("https://x/api/media?clientId=c1&type=image", AUTH), env });
    const body = await res.json();
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "C1" }));
    expect(body.items).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/mediaEndpoint.test.js`
Expected: FAIL — cannot resolve `../../../functions/api/media.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// functions/api/media.js
// Cloudflare Pages Function — GET /api/media?clientId=<id>&type=image|audio
// Auth-gated listing of the client's existing R2 media (binding: env.MEDIA).
// Mirrors functions/api/upload.js auth + key conventions. Returns bare keys the
// caller renders via mediaUrl(); no file bodies. Scoped to /api/* via _routes.json.

const TYPES = new Set(["image", "audio"]);

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

// Mirror of src/lib/mediaLibrary.js (kept inline so the Function stays
// self-contained, matching upload.js). Change both together.
function fileNameFromKey(key) {
  const seg = String(key || "").split("/").pop() || "";
  return seg.replace(/^([0-9a-f]{8}|[0-9]{9,})-/i, "");
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.MEDIA) return json({ error: "storage not configured" }, 503);

  const SUPABASE_URL = env.SUPABASE_URL || "https://xprynknppsehuzqqdvue.supabase.co";
  const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwcnlua25wcHNlaHV6cXFkdnVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwODg1OTUsImV4cCI6MjA5NzY2NDU5NX0._S3xdNXBm6d4SI8MO0MNoZ3bT8uspEd8lrdVm29Efgo";

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "unauthorized" }, 401);
  try {
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    });
    if (!who.ok) return json({ error: "unauthorized" }, 401);
  } catch {
    return json({ error: "auth check failed" }, 502);
  }

  const url = new URL(request.url);
  const clientId = String(url.searchParams.get("clientId") || "shared").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) || "shared";
  const typeParam = String(url.searchParams.get("type") || "image");
  const type = TYPES.has(typeParam) ? typeParam : "image";
  const prefix = `${clientId}/owner/${type}/`;

  const objects = [];
  try {
    let cursor;
    do {
      const page = await env.MEDIA.list({ prefix, cursor });
      for (const o of page.objects || []) objects.push(o);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  } catch (e) {
    return json({ error: "list failed", detail: String(e && e.message || e) }, 500);
  }

  const items = objects
    .map((o) => ({ key: o.key, name: fileNameFromKey(o.key), size: o.size, uploaded: o.uploaded }))
    .sort((a, b) => new Date(b.uploaded).getTime() - new Date(a.uploaded).getTime());

  return json({ items });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/mediaEndpoint.test.js`
Expected: PASS (6 cases).

- [ ] **Step 5: Commit**

```bash
git add functions/api/media.js src/lib/__tests__/mediaEndpoint.test.js
git commit -m "feat(media-library): GET /api/media lists client R2 objects"
```

---

## Task 3: Client fetch wrapper (`listMedia` in `src/lib/api.js`)

**Files:**
- Modify: `src/lib/api.js` (add after `uploadAudio`, ~line 137)

No dedicated test (thin auth+fetch glue, mirrors the untested `uploadToR2`; exercised via the component test in Task 5 with a mocked `fetch`).

- [ ] **Step 1: Add the wrapper**

```js
// List this client's existing R2 media of one type ("image" | "audio") via the
// auth-gated /api/media Function. Returns [{ key, name, size, uploaded }] newest
// first. Requires a valid Supabase session (admins only).
export async function listMedia(clientId, type) {
  const { data } = await supabase.auth.getSession();
  const token = data && data.session && data.session.access_token;
  if (!token) throw new Error("Not signed in");
  const qs = new URLSearchParams({ clientId: clientId || "", type: type || "image" });
  const res = await fetch(`/api/media?${qs}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let msg = `library load failed (${res.status})`;
    try { const e = await res.json(); if (e && e.error) msg = e.error; } catch (_) {}
    throw new Error(msg);
  }
  const body = await res.json();
  return Array.isArray(body.items) ? body.items : [];
}
```

- [ ] **Step 2: Verify existing tests still pass (no regression)**

Run: `npm test`
Expected: PASS (51 tests) — this only adds an export.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.js
git commit -m "feat(media-library): listMedia() client wrapper for /api/media"
```

---

## Task 4: Picker UI (`src/admin/MediaPicker.jsx`)

**Files:**
- Create: `src/admin/MediaPicker.jsx`
- Test: `src/admin/__tests__/mediaPicker.test.jsx`

`MediaLibrary` is store-free (takes `clientId` as a prop) so it is directly testable. `MediaPickerModal` wraps it with the top toggle and an "Upload new" pane that delegates to the caller via `onUploadNew`.

- [ ] **Step 1: Write the failing test**

```jsx
// src/admin/__tests__/mediaPicker.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/api.js", () => ({ listMedia: vi.fn() }));
import { listMedia } from "@/lib/api.js";
import { MediaLibrary } from "@/admin/MediaPicker.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("MediaLibrary", () => {
  it("renders a grid from the fetched items and fires onPick with the key", async () => {
    listMedia.mockResolvedValue([
      { key: "c1/owner/image/hero/aaaaaaaa-venue.jpg", name: "venue.jpg", size: 10, uploaded: "2026-06-01T00:00:00Z" },
    ]);
    const onPick = vi.fn();
    render(<MediaLibrary type="image" clientId="c1" onPick={onPick} />);
    const cell = await screen.findByRole("button", { name: /venue\.jpg/i });
    fireEvent.click(cell);
    expect(onPick).toHaveBeenCalledWith("c1/owner/image/hero/aaaaaaaa-venue.jpg");
  });

  it("shows an empty state when there are no items", async () => {
    listMedia.mockResolvedValue([]);
    render(<MediaLibrary type="image" clientId="c1" onPick={() => {}} />);
    expect(await screen.findByText(/no uploads yet/i)).toBeTruthy();
  });

  it("shows an error state when the fetch fails", async () => {
    listMedia.mockRejectedValue(new Error("boom"));
    render(<MediaLibrary type="audio" clientId="c1" onPick={() => {}} />);
    expect(await screen.findByText(/couldn.t load|boom/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/admin/__tests__/mediaPicker.test.jsx`
Expected: FAIL — cannot resolve `@/admin/MediaPicker.jsx`.

- [ ] **Step 3: Write minimal implementation**

```jsx
// src/admin/MediaPicker.jsx
// Reusable media library picker: a grid/list of the client's existing R2 files
// (images or audio), plus a modal wrapper with an Upload-new | Choose-from-library
// toggle. Picking returns the bare R2 key (stored/rendered exactly like an upload).
import React, { useEffect, useState } from "react";
import { Modal, Button } from "@/ui/components.jsx";
import { mediaUrl } from "@/lib/media.js";
import { listMedia } from "@/lib/api.js";

export function MediaLibrary({ type, clientId, onPick }) {
  const [state, setState] = useState({ status: "loading", items: [], error: "" });
  useEffect(() => {
    let live = true;
    setState({ status: "loading", items: [], error: "" });
    listMedia(clientId, type)
      .then((items) => { if (live) setState({ status: "ready", items, error: "" }); })
      .catch((e) => { if (live) setState({ status: "error", items: [], error: (e && e.message) || "error" }); });
    return () => { live = false; };
  }, [clientId, type]);

  if (state.status === "loading") return <p className="medialib__msg">Loading…</p>;
  if (state.status === "error") return <p className="medialib__msg medialib__msg--err">Couldn’t load your library: {state.error}</p>;
  if (!state.items.length) return <p className="medialib__msg">No uploads yet — switch to “Upload new”.</p>;

  if (type === "audio") {
    return (
      <ul className="medialib medialib--audio">
        {state.items.map((it) => (
          <li key={it.key} className="medialib__row">
            <button type="button" className="medialib__pick" onClick={() => onPick(it.key)}>{it.name}</button>
            <audio src={mediaUrl(it.key)} controls preload="none" />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="medialib medialib--grid">
      {state.items.map((it) => (
        <button type="button" key={it.key} className="medialib__cell" onClick={() => onPick(it.key)} aria-label={it.name} title={it.name}>
          <img src={mediaUrl(it.key)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <span className="medialib__name">{it.name}</span>
        </button>
      ))}
    </div>
  );
}

// open/onClose control the modal. onUploadNew is called when the user clicks the
// button on the "Upload new" tab (the caller triggers its own file input / crop).
// uploading + uploadLabel let the caller reflect upload progress in this modal.
export function MediaPickerModal({ open, onClose, type, clientId, onPick, onUploadNew, uploading, uploadLabel }) {
  const [tab, setTab] = useState("upload");
  useEffect(() => { if (open) setTab("upload"); }, [open]);
  return (
    <Modal open={open} onClose={onClose} label="Media">
      <div className="medialib__tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "upload"} className={"medialib__tab" + (tab === "upload" ? " is-on" : "")} onClick={() => setTab("upload")}>Upload new</button>
        <button type="button" role="tab" aria-selected={tab === "library"} className={"medialib__tab" + (tab === "library" ? " is-on" : "")} onClick={() => setTab("library")}>Choose from library</button>
      </div>
      {tab === "upload" ? (
        <div className="medialib__upload">
          <Button variant="primary" disabled={uploading} onClick={onUploadNew}>{uploading ? "Uploading…" : (uploadLabel || "Choose a file")}</Button>
          <p className="medialib__msg">Pick a file from your device.</p>
        </div>
      ) : (
        <MediaLibrary type={type} clientId={clientId} onPick={(key) => { onPick(key); onClose(); }} />
      )}
    </Modal>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/admin/__tests__/mediaPicker.test.jsx`
Expected: PASS (3 cases). If `@testing-library/jest-dom` matchers are needed they are not — the tests use truthy assertions and `findBy*` which throw on absence.

- [ ] **Step 5: Commit**

```bash
git add src/admin/MediaPicker.jsx src/admin/__tests__/mediaPicker.test.jsx
git commit -m "feat(media-library): MediaLibrary grid + MediaPickerModal toggle"
```

---

## Task 5: Wire into `ImageUploadField`

**Files:**
- Modify: `src/admin/manage.jsx:51-106` (`ImageUploadField`)
- Modify: `src/admin/manage.jsx:10` (import)

- [ ] **Step 1: Add the import**

At line 10, extend the existing `@/lib/api.js` import to include `listMedia` is NOT needed here (MediaPicker imports it). Instead add the component import near the other admin imports (top of file, after existing imports):

```jsx
import { MediaPickerModal } from "@/admin/MediaPicker.jsx";
```

- [ ] **Step 2: Add picker state + handlers inside `ImageUploadField`**

Replace the component body's action area. Add a `pickerOpen` state near the other `useState`s (after line 55 `const [busy, setBusy] = useState(false);`):

```jsx
  const [pickerOpen, setPickerOpen] = useState(false);
```

- [ ] **Step 3: Replace the actions + hidden input + modal block**

Replace lines 96-103 (`<div className="imgup__actions">` through the `<input …/>`) and the trailing `<CropModal …/>` with:

```jsx
        <div className="imgup__actions">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPickerOpen(true)}>{Icon.upload({})} {busy ? "Uploading…" : (value ? "Replace" : "Add photo")}</Button>
          {value && !busy && <Button variant="ghost" size="sm" onClick={() => setCropSrc(value)}>{Icon.crop({})} Crop</Button>}
          {value && !busy && <Button variant="ghost" size="sm" onClick={() => onChange("")}>Remove</Button>}
        </div>
        <input ref={ref} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { setPickerOpen(false); pick(e.target.files[0]); }} />
      </div>
      <MediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        type="image"
        clientId={clientId}
        uploadLabel={value ? "Replace photo" : "Choose a photo"}
        onUploadNew={() => ref.current && ref.current.click()}
        onPick={(key) => onChange(key)}
      />
      <CropModal open={!!cropSrc} src={cropSrc} aspect={aspect} frameSrc={framePreview} onCancel={() => setCropSrc(null)} onApply={applyCrop} />
```

Note: `applyCrop` (line 65) already calls `setCropSrc(null)`; add `setPickerOpen(false)` as its first line so the picker closes after an upload completes:

```jsx
  async function applyCrop(dataUrl) {
    setPickerOpen(false);
    setCropSrc(null);
    setBusy(true);
```

- [ ] **Step 4: Verify the suite still passes**

Run: `npm test`
Expected: PASS (54 tests: 51 + 3 new). No ImageUploadField-specific render test is added (it depends on CropModal/toast/URL.createObjectURL); it is covered by the build + manual/e2e check in Task 8.

- [ ] **Step 5: Commit**

```bash
git add src/admin/manage.jsx
git commit -m "feat(media-library): add library picker to ImageUploadField"
```

---

## Task 6: Wire into `TrackEditor`

**Files:**
- Modify: `src/admin/manage.jsx:1758-1801` (`TrackEditor`)

- [ ] **Step 1: Add picker state**

After line 1763 (`const fileRef = useRef(null);`) add:

```jsx
  const [pickerOpen, setPickerOpen] = useState(false);
```

- [ ] **Step 2: Close the picker after a successful audio upload**

In `onReplace` (line 1765), after `setF((p) => ({ ...p, url }));` add `setPickerOpen(false);`:

```jsx
      const { url } = await uploadAudio(file, clientId);
      setF((p) => ({ ...p, url }));
      setPickerOpen(false);
```

- [ ] **Step 3: Replace the "Audio file" field's action block**

Replace lines 1789-1795 (the `<Field label="Audio file" …>` block) with:

```jsx
      <Field label="Audio file" id="trk-audio" hint="Upload a new file, or reuse one from your library">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {f.url ? <audio src={mediaUrl(f.url)} controls preload="none" style={{ width: "100%", height: 38 }} /> : <span style={{ color: "var(--muted)", fontSize: 13 }}>No audio yet</span>}
          <input ref={fileRef} type="file" accept={AUDIO_ACCEPT} style={{ display: "none" }} onChange={(e) => onReplace(e.target.files)} />
          <div><Button variant="ghost" size="sm" disabled={uploading} onClick={() => setPickerOpen(true)}>{uploading ? "Uploading…" : (f.url ? "Replace audio" : "Add audio")}</Button></div>
        </div>
      </Field>
      <MediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        type="audio"
        clientId={clientId}
        uploadLabel={f.url ? "Replace audio" : "Choose audio"}
        uploading={uploading}
        onUploadNew={() => fileRef.current && fileRef.current.click()}
        onPick={(key) => setF((p) => ({ ...p, url: key }))}
      />
```

(`MediaPickerModal` is already imported from Task 5.)

- [ ] **Step 4: Verify the suite still passes**

Run: `npm test`
Expected: PASS (54 tests).

- [ ] **Step 5: Commit**

```bash
git add src/admin/manage.jsx
git commit -m "feat(media-library): add library picker to TrackEditor"
```

---

## Task 7: Picker styles (`src/styles/styles.css`)

**Files:**
- Modify: `src/styles/styles.css` (append a new block; place near the `.imgup` styles — grep `\.imgup` for the location)

- [ ] **Step 1: Add styles**

```css
/* ── Media library picker (admin) ─────────────────────────────────────────── */
.medialib__tabs { display: flex; gap: 6px; margin-bottom: 16px; border-bottom: 1px solid var(--line); }
.medialib__tab { appearance: none; background: none; border: 0; border-bottom: 2px solid transparent; padding: 8px 4px; margin-bottom: -1px; cursor: pointer; color: var(--muted); font: inherit; font-size: 14px; }
.medialib__tab.is-on { color: var(--ink); border-bottom-color: var(--accent); font-weight: 600; }
.medialib__upload { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px 0; }
.medialib__msg { color: var(--muted); font-size: 13px; padding: 8px 0; }
.medialib__msg--err { color: oklch(0.55 0.16 25); }
.medialib--grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; max-height: 60vh; overflow-y: auto; }
.medialib__cell { display: flex; flex-direction: column; gap: 4px; padding: 0; background: none; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; cursor: pointer; text-align: left; }
.medialib__cell:hover { border-color: var(--ink); }
.medialib__cell img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; background: var(--surface-2); }
.medialib__name { font-size: 11px; color: var(--muted); padding: 4px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.medialib--audio { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; max-height: 60vh; overflow-y: auto; }
.medialib__row { display: flex; flex-direction: column; gap: 6px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
.medialib__pick { align-self: flex-start; background: none; border: 0; padding: 0; cursor: pointer; font: inherit; font-weight: 600; color: var(--ink); }
.medialib__pick:hover { color: var(--accent); }
.medialib__row audio { width: 100%; height: 34px; }
```

- [ ] **Step 2: Build to confirm no CSS/JS errors**

Run: `npm run build`
Expected: `built in …` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/styles/styles.css
git commit -m "feat(media-library): picker tab + grid styles"
```

---

## Task 8: Full verification + deploy

**Files:** none (verification only)

- [ ] **Step 1: Full test + build**

Run: `npm test && npm run build`
Expected: 54 tests PASS; build succeeds.

- [ ] **Step 2: Manual smoke (local, Playwright or dev server)**

Run: `npm run dev`, sign in to `/admin`, open a Hero image field → "Add photo/Replace" → modal shows **Upload new | Choose from library** tabs; library tab lists existing images; clicking one sets the field. Repeat for a track in the Music tab (audio list + ▶ preview). Verify "Upload new" still uploads+crops (images) / uploads (audio).

- [ ] **Step 3: Push (auto-deploy) and verify per CLAUDE.md**

```bash
git push origin main
```

Then verify via the CF Pages API that `latest_deployment.deployment_trigger.metadata.commit_hash` matches the pushed commit and all `stages` are `success`; confirm the served bundle responds to `GET /api/media` with 401 when unauthenticated (behavior marker):

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://demo.celebrately.us/api/media?clientId=x&type=image"   # expect 401
```

- [ ] **Step 4: Final confirmation**

Report: tests (54), deploy commit + stage status, and the `/api/media` 401 check. Note if anything was skipped.

---

## Self-Review

**Spec coverage:**
- Live R2 list endpoint → Task 2. ✅
- Type-only filter, owner scope → `libraryPrefix` Task 1 + endpoint Task 2. ✅
- Top toggle Upload new | Choose from library → `MediaPickerModal` Task 4, wired Tasks 5–6. ✅
- Reusable picker, image grid + audio list w/ preview, loading/empty/error → Task 4. ✅
- Integration at both call-sites, picked key stored like an upload → Tasks 5–6. ✅
- Auth mirrors upload (401 public), 503 no binding, cursor pagination, newest-first, filename parse → Task 2. ✅
- No schema change (bare key into existing content fields) → Tasks 5–6 use `onChange(key)` / `setF url`. ✅
- Tests: endpoint + helpers + picker component → Tasks 1,2,4. ✅
- Out of scope (delete/rename/video) → not implemented. ✅

**Placeholder scan:** none — every code step is complete.

**Type/name consistency:** `libraryPrefix`, `fileNameFromKey`, `MEDIA_TYPES`, `listMedia(clientId, type)` → `{items:[{key,name,size,uploaded}]}`, `<MediaLibrary type clientId onPick>`, `<MediaPickerModal open onClose type clientId onPick onUploadNew uploading uploadLabel>` — used identically across tasks. `onRequestGet` signature `{ request, env }` matches upload.js.
