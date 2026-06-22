# Supabase Guest Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public site load its content from Supabase by subdomain, and make guest RSVP / guestbook / quiz submissions persist to Supabase (visible across all devices) — no auth required, using the anon/publishable key + the RLS already in place.

**Architecture:** Keep the existing synchronous in-memory `Store` as a **cache**. On boot, resolve the client by subdomain, fetch its row + approved guestbook from Supabase, and `Store.hydrate(...)` the cache (components stay synchronous — no change to how they read). Guest submissions go through a thin async API layer that **writes to Supabase, then echoes into the cache**. This isolates all network code to two new files and a few store additions; the React components barely change.

**Tech Stack:** Vite + React 18, `@supabase/supabase-js` (already installed), Vitest (added here) for unit-testing the pure mapping/resolver functions.

**Out of scope (separate follow-up plans):** auth + login + the 3 roles, admin *writing* content to Supabase (admin stays local-only this plan), owner/superadmin RLS policies, media uploads + R2.

---

## File structure

- `src/lib/supabase.js` — Supabase client (exists).
- `src/lib/tenant.js` — **new.** Pure `subdomainFromHost(hostname, search)` + `resolveSubdomain()` wrapper.
- `src/lib/mappers.js` — **new.** Pure functions mapping DB rows ↔ app shapes (`clientToState`, `rsvpToRow`, `guestbookToRow`, `quizToRow`, `rowToGuestbook`).
- `src/lib/api.js` — **new.** Async Supabase calls used by the app: `loadClientData()`, `postRsvp()`, `postGuestbook()`, `postQuiz()`. Wraps supabase + updates `Store`.
- `src/lib/store.jsx` — **modify.** Add `loading`/`clientId` to state, add `Store.hydrate(patch)`.
- `src/app/App.jsx` — **modify.** Boot effect calls `loadClientData()`; show a loading gate until hydrated.
- `src/features/rsvp.jsx` — **modify.** Submit calls `postRsvp` (async) instead of `Store.addRSVP`.
- `src/features/social.jsx` — **modify.** Guestbook submit calls `postGuestbook`; quiz submit calls `postQuiz`.
- `vitest.config.js`, `package.json` — **modify.** Add Vitest.

DB columns (from the SQL already run): `clients(id, subdomain, event_type, template_key, theme jsonb, content jsonb, is_active)`, `rsvps(client_id, full_name, phone, status, count, plus_one, diet, diet_notes, song, notes)`, `guestbook(client_id, author_id, name, relationship, message, status)`, `quiz_answers(client_id, author_id, name, score, total, answers jsonb)`.

---

### Task 0: Add Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.js`
- Create: `src/lib/__tests__/smoke.test.js`

- [ ] **Step 1: Install Vitest**

Run: `npm i -D vitest`
Expected: added to devDependencies.

- [ ] **Step 2: Add test script**

In `package.json` `"scripts"`, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create vitest config (jsdom not needed for pure fns)**

Create `vitest.config.js`:
```js
import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["src/**/*.test.{js,jsx}"] },
});
```

- [ ] **Step 4: Smoke test**

Create `src/lib/__tests__/smoke.test.js`:
```js
import { describe, it, expect } from "vitest";
describe("vitest", () => { it("runs", () => expect(1 + 1).toBe(2)); });
```

- [ ] **Step 5: Run + verify pass**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.js src/lib/__tests__/smoke.test.js
git commit -m "test: add vitest"
```

---

### Task 1: Tenant resolver

**Files:**
- Create: `src/lib/tenant.js`
- Test: `src/lib/__tests__/tenant.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/tenant.test.js`:
```js
import { describe, it, expect } from "vitest";
import { subdomainFromHost } from "@/lib/tenant.js";

describe("subdomainFromHost", () => {
  it("uses ?client override first", () => {
    expect(subdomainFromHost("anything.com", "?client=acme")).toBe("acme");
  });
  it("localhost -> demo", () => {
    expect(subdomainFromHost("localhost", "")).toBe("demo");
  });
  it("project.pages.dev (3 parts) -> demo", () => {
    expect(subdomainFromHost("wedding-site.pages.dev", "")).toBe("demo");
  });
  it("client.project.pages.dev (4 parts) -> client", () => {
    expect(subdomainFromHost("johnandjane.wedding-site.pages.dev", "")).toBe("johnandjane");
  });
  it("custom domain client.celebrate.app -> client", () => {
    expect(subdomainFromHost("johnandjane.celebrate.app", "")).toBe("johnandjane");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/lib/__tests__/tenant.test.js`
Expected: FAIL — cannot resolve `@/lib/tenant.js`.

- [ ] **Step 3: Implement**

Create `src/lib/tenant.js`:
```js
// Resolve which client a request is for, from the hostname.
// Pure + testable: pass hostname + search string explicitly.
export function subdomainFromHost(hostname, search = "") {
  const override = new URLSearchParams(search).get("client");
  if (override) return override;
  if (hostname === "localhost" || hostname.endsWith(".local") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return "demo";
  }
  const parts = hostname.split(".");
  if (hostname.endsWith("pages.dev")) {
    // project.pages.dev = 3 parts (no client); client.project.pages.dev = 4
    return parts.length >= 4 ? parts[0] : "demo";
  }
  // custom domain: client.celebrate.app -> first label; bare apex -> demo
  return parts.length > 2 ? parts[0] : "demo";
}

export function resolveSubdomain() {
  return subdomainFromHost(window.location.hostname, window.location.search);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/lib/__tests__/tenant.test.js`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenant.js src/lib/__tests__/tenant.test.js
git commit -m "feat: tenant subdomain resolver"
```

---

### Task 2: Row ↔ app-shape mappers

**Files:**
- Create: `src/lib/mappers.js`
- Test: `src/lib/__tests__/mappers.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/mappers.test.js`:
```js
import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, SEED_SCHEDULE } from "@/lib/store.jsx";
import { clientToState, rsvpToRow, guestbookToRow, quizToRow, rowToGuestbook } from "@/lib/mappers.js";

describe("clientToState", () => {
  it("maps template_key->settings.theme and event_type->eventType, falls back to defaults", () => {
    const st = clientToState({
      id: "c1", subdomain: "demo", event_type: "wedding", template_key: "envelope",
      theme: { themeAccent: "#abc" }, content: { partnerA: "Al", partnerB: "Bo" },
    });
    expect(st.clientId).toBe("c1");
    expect(st.settings.theme).toBe("envelope");
    expect(st.settings.eventType).toBe("wedding");
    expect(st.settings.themeAccent).toBe("#abc");
    expect(st.settings.partnerA).toBe("Al");
    // unspecified field falls back to default
    expect(st.settings.tagline).toBe(DEFAULT_SETTINGS.tagline);
    // arrays fall back to seed when content lacks them
    expect(st.schedule).toEqual(SEED_SCHEDULE);
  });
  it("uses content arrays when present", () => {
    const st = clientToState({ id: "c1", subdomain: "d", event_type: "wedding", template_key: "classic",
      theme: {}, content: { schedule: [{ time: "1", title: "x", desc: "", loc: "" }] } });
    expect(st.schedule).toHaveLength(1);
  });
});

describe("rsvpToRow", () => {
  it("maps camelCase form -> snake_case columns + client_id", () => {
    expect(rsvpToRow({ fullName: "Jane", phone: "5", status: "attending", count: 2,
      plusOne: "Bob", diet: "Vegan", dietNotes: "", song: "s", notes: "n" }, "c1")).toEqual({
      client_id: "c1", full_name: "Jane", phone: "5", status: "attending", count: 2,
      plus_one: "Bob", diet: "Vegan", diet_notes: "", song: "s", notes: "n",
    });
  });
});

describe("guestbookToRow", () => {
  it("includes client_id + status", () => {
    expect(guestbookToRow({ name: "A", relationship: "Aunt", message: "hi" }, "c1", "approved"))
      .toEqual({ client_id: "c1", name: "A", relationship: "Aunt", message: "hi", status: "approved" });
  });
});

describe("quizToRow", () => {
  it("maps score/total/answers", () => {
    expect(quizToRow({ name: "A", score: 3, total: 5, answers: { q1: 1 } }, "c1"))
      .toEqual({ client_id: "c1", name: "A", score: 3, total: 5, answers: { q1: 1 } });
  });
});

describe("rowToGuestbook", () => {
  it("maps DB row to app guestbook entry with status 'visible'", () => {
    const e = rowToGuestbook({ id: "g1", name: "A", relationship: "Aunt", message: "hi",
      status: "approved", created_at: "2026-01-01T00:00:00Z" });
    expect(e.id).toBe("g1");
    expect(e.status).toBe("visible");
    expect(typeof e.createdAt).toBe("number");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/lib/__tests__/mappers.test.js`
Expected: FAIL — cannot resolve `@/lib/mappers.js`.

- [ ] **Step 3: Implement**

Create `src/lib/mappers.js`:
```js
import { DEFAULT_SETTINGS, SEED_SCHEDULE, SEED_STORY, SEED_FAQ, SEED_QUIZ } from "@/lib/store.jsx";

// clients row -> the in-memory store state shape
export function clientToState(client) {
  const content = client.content || {};
  const theme = client.theme || {};
  const { schedule, story, faq, quiz, ...contentRest } = content;
  return {
    clientId: client.id,
    settings: {
      ...DEFAULT_SETTINGS,
      ...contentRest,
      ...theme,
      theme: client.template_key,
      eventType: client.event_type,
    },
    schedule: schedule || SEED_SCHEDULE,
    story: story || SEED_STORY,
    faq: faq || SEED_FAQ,
    quiz: quiz || SEED_QUIZ,
  };
}

export function rsvpToRow(r, clientId) {
  return {
    client_id: clientId,
    full_name: r.fullName, phone: r.phone, status: r.status, count: r.count,
    plus_one: r.plusOne, diet: r.diet, diet_notes: r.dietNotes, song: r.song, notes: r.notes,
  };
}

export function guestbookToRow(e, clientId, status) {
  return { client_id: clientId, name: e.name, relationship: e.relationship, message: e.message, status };
}

export function quizToRow(s, clientId) {
  return { client_id: clientId, name: s.name, score: s.score, total: s.total, answers: s.answers };
}

export function rowToGuestbook(row) {
  return {
    id: row.id, name: row.name, relationship: row.relationship, message: row.message,
    status: "visible", createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
  };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/lib/__tests__/mappers.test.js`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mappers.js src/lib/__tests__/mappers.test.js
git commit -m "feat: db row <-> app shape mappers"
```

---

### Task 3: Store additions (hydrate, loading, clientId)

**Files:**
- Modify: `src/lib/store.jsx`

- [ ] **Step 1: Add `loading` + `clientId` to default state**

In `defaultState()` return object (`src/lib/store.jsx:112-124`), add two fields:
```js
  return {
    settings: { ...DEFAULT_SETTINGS },
    schedule: SEED_SCHEDULE,
    story: SEED_STORY,
    faq: SEED_FAQ,
    quiz: SEED_QUIZ,
    guestbook: SEED_GUESTBOOK,
    rsvps: SEED_RSVPS,
    media: SEED_MEDIA,
    quizSubs: [],
    clientId: null,
    loading: true,
  };
```

- [ ] **Step 2: Add `hydrate` to the `Store` object**

In `src/lib/store.jsx`, inside `export const Store = { ... }` (after `set(...)`, ~line 169), add:
```js
  hydrate(patch) {
    _state = {
      ..._state,
      ...patch,
      settings: { ..._state.settings, ...(patch.settings || {}) },
      loading: false,
    };
    emit(); // do NOT persist hydrated server data to localStorage
  },
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/lib/store.jsx
git commit -m "feat: Store.hydrate + loading/clientId state"
```

---

### Task 4: Async API layer

**Files:**
- Create: `src/lib/api.js`

- [ ] **Step 1: Implement the API**

Create `src/lib/api.js`:
```js
import { supabase } from "@/lib/supabase.js";
import { Store } from "@/lib/store.jsx";
import { resolveSubdomain } from "@/lib/tenant.js";
import { clientToState, rowToGuestbook, rsvpToRow, guestbookToRow, quizToRow } from "@/lib/mappers.js";

// Boot: load the active client + approved guestbook, hydrate the store cache.
export async function loadClientData() {
  const subdomain = resolveSubdomain();
  const { data: client, error } = await supabase
    .from("clients").select("*").eq("subdomain", subdomain).eq("is_active", true).single();
  if (error || !client) {
    console.warn("[api] client not found for subdomain:", subdomain, error?.message);
    Store.hydrate({}); // clears loading; falls back to seed defaults
    return;
  }
  const state = clientToState(client);
  const { data: gb } = await supabase
    .from("guestbook").select("*").eq("client_id", client.id)
    .eq("status", "approved").order("created_at", { ascending: false });
  Store.hydrate({ ...state, guestbook: (gb || []).map(rowToGuestbook) });
}

export async function postRsvp(form) {
  const clientId = Store.get().clientId;
  const { error } = await supabase.from("rsvps").insert(rsvpToRow(form, clientId));
  if (error) throw error;
  Store.addRSVP(form); // local echo (admin view this session)
}

export async function postGuestbook(entry) {
  const clientId = Store.get().clientId;
  const autoApprove = Store.get().settings.autoApproveGuestbook;
  const status = autoApprove ? "approved" : "pending";
  const { data, error } = await supabase
    .from("guestbook").insert(guestbookToRow(entry, clientId, status)).select().single();
  if (error) throw error;
  if (status === "approved") {
    Store.addGuestbook({ ...entry, id: data.id, status: "visible" });
  }
  return { status };
}

export async function postQuiz(sub) {
  const clientId = Store.get().clientId;
  const { error } = await supabase.from("quiz_answers").insert(quizToRow(sub, clientId));
  if (error) throw error;
  Store.addQuizSub(sub); // local echo
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.js
git commit -m "feat: supabase api layer (load + submit)"
```

---

### Task 5: Boot wiring + loading gate

**Files:**
- Modify: `src/app/App.jsx`

- [ ] **Step 1: Import the loader**

At the top of `src/app/App.jsx` (with the other `@/` imports), add:
```js
import { loadClientData } from "@/lib/api.js";
```

- [ ] **Step 2: Call it on mount + gate render in `App`**

In the `App` component (`src/app/App.jsx`), add a boot effect and a loading gate. Insert near the top of the component body:
```js
  React.useEffect(() => { loadClientData().catch((e) => console.error("load failed", e)); }, []);
  if (settings && Store.get().loading) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--ink-soft)" }}>Loading…</div>;
  }
```
(Place the `if (...loading)` return after `const { settings } = useStore();` so the component re-renders when `hydrate` flips `loading` to false. `useStore()` already subscribes the component to store changes.)

- [ ] **Step 3: Run dev + verify loads from DB**

Run: `npm run dev`, open `http://localhost:5173/?client=demo`
Expected: brief "Loading…" then the site renders. (Demo client has empty `content` → falls back to seed defaults, so it looks identical — that's correct; Task 9 seeds real content.)
Check the browser console: no errors.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/app/App.jsx
git commit -m "feat: boot-load client data from supabase with loading gate"
```

---

### Task 6: RSVP submit → Supabase

**Files:**
- Modify: `src/features/rsvp.jsx`

- [ ] **Step 1: Import the API**

In `src/features/rsvp.jsx` imports, add:
```js
import { postRsvp } from "@/lib/api.js";
```

- [ ] **Step 2: Make submit async + call postRsvp**

In `src/features/rsvp.jsx`, the `submit` function currently calls `Store.addRSVP({...})`. Replace that call (and make `submit` async) so the row goes to Supabase:
```js
  async function submit(e) {
    e.preventDefault();
    const er = validate();
    if (Object.keys(er).length) { setErrors(er); return; }
    try {
      await postRsvp({ ...form, count: attending ? parseInt(form.count, 10) : 0 });
      setSubmitted(true);
    } catch (err) {
      setErrors({ notes: "Could not submit right now. Please try again." });
    }
  }
```
(Remove the old `Store.addRSVP(...)` + `setSubmitted(true)` lines this replaces. Keep the rest of the handler.)

- [ ] **Step 3: Verify in dev across two browsers**

Run: `npm run dev`. In a normal window open `/?client=demo#/rsvp`, submit an RSVP. In a **private** window open the Supabase dashboard → Table Editor → `rsvps`: the row is there. (Two devices/browsers both write to the same DB — this is the real persistence.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/features/rsvp.jsx
git commit -m "feat: RSVP submits to supabase"
```

---

### Task 7: Guestbook submit + load → Supabase

**Files:**
- Modify: `src/features/social.jsx`

- [ ] **Step 1: Import the API**

In `src/features/social.jsx` imports, add:
```js
import { postGuestbook } from "@/lib/api.js";
```

- [ ] **Step 2: Route guestbook submit through postGuestbook**

In `src/features/social.jsx`, find the `GuestbookPage` submit handler that calls `Store.addGuestbook({...})`. Replace it so it writes to Supabase and tells the guest whether it's pending moderation:
```js
    try {
      const { status } = await postGuestbook({ name, relationship, message });
      setSent(status === "approved" ? "posted" : "pending");
      // reset fields
    } catch (err) {
      setSent("error");
    }
```
Make that handler `async`. Use the existing local state that shows the success message; add a "pending review" message branch when `status === "pending"`. (The list on the page renders `guestbook` entries with `status === "visible"`, already hydrated from approved rows on boot.)

- [ ] **Step 3: Verify in dev**

Run: `npm run dev`, open `/?client=demo#/guestbook`. Submit a message.
- Demo client `autoApproveGuestbook` defaults to `true` → message inserts as `approved` and appears immediately.
- In Supabase Table Editor → `guestbook`: the row exists with `status='approved'`.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/features/social.jsx
git commit -m "feat: guestbook submits to supabase + loads approved"
```

---

### Task 8: Quiz submit → Supabase

**Files:**
- Modify: `src/features/social.jsx`

- [ ] **Step 1: Import postQuiz**

Extend the import in `src/features/social.jsx`:
```js
import { postGuestbook, postQuiz } from "@/lib/api.js";
```

- [ ] **Step 2: Route quiz submit through postQuiz**

In `QuizPage`, the submit/score handler currently calls `Store.addQuizSub({...})`. Replace with an async call:
```js
    try {
      await postQuiz({ name, score, total, answers });
      setDone(true);
    } catch (err) {
      setError("Could not save your score. Please try again.");
    }
```
(Make the handler `async`; keep score computation as-is. `score`, `total`, `answers` are already computed in this handler.)

- [ ] **Step 3: Verify in dev**

Run: `npm run dev`, open `/?client=demo#/quiz`, complete the quiz.
In Supabase → Table Editor → `quiz_answers`: a row with name/score/total/answers.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/features/social.jsx
git commit -m "feat: quiz submits to supabase"
```

---

### Task 9: Seed the demo client's content + end-to-end verify

**Files:**
- Create: `supabase/seed-demo-content.sql` (documentation/repeatable seed)

- [ ] **Step 1: Write the seed SQL**

Create `supabase/seed-demo-content.sql`:
```sql
-- Populate the demo client's content so the public site loads real data.
update clients set
  template_key = 'classic',
  theme = '{}'::jsonb,
  content = jsonb_build_object(
    'partnerA','Jeremy','partnerB','Irish',
    'weddingDate','2026-09-19T15:00','weddingDateLabel','Saturday, September 19, 2026',
    'tagline','We''re getting married',
    'venueName','Somewhere in Lipa, Batangas','venueAddress','Lipa, Batangas, Philippines',
    'ceremonyTime','3:00 PM','receptionTime','5:30 PM',
    'rsvpDeadline','August 15, 2026','hashtag','#JeremyAndIrish2026',
    'autoApproveGuestbook', true
  )
where subdomain = 'demo';
```

- [ ] **Step 2: Run it in Supabase SQL editor**

Paste the file contents into SQL Editor → Run. Expected: "Success. Rows: 1".

- [ ] **Step 3: Verify the site reflects DB content**

Run: `npm run dev`, open `/?client=demo`. Names/date/venue now come from the DB row. Change `partnerA` in the DB → reload → the site shows the new name. This proves the read path is live.

- [ ] **Step 4: Full guest flow across two browsers**

In two different browsers (or normal + private):
- Submit an RSVP in browser A → appears in Supabase `rsvps`.
- Post a guestbook message in browser A → appears in browser B's guestbook after reload (both read the same approved rows).
- Complete the quiz → row in `quiz_answers`.
This is the acceptance check: guest data is shared/persisted, not per-device.

- [ ] **Step 5: Commit**

```bash
git add supabase/seed-demo-content.sql
git commit -m "chore: demo client content seed + e2e guest-data verified"
```

---

## What this delivers / what's next

**Delivered:** the public site is driven by Supabase per subdomain, and RSVP/guestbook/quiz submissions persist server-side and are shared across all visitors — using the anon key + existing RLS. No auth needed.

**Not yet (follow-up plans, in order):**
1. **Auth + roles** — magic-link login, `profiles` role (guest/owner/superadmin), session in the store.
2. **Admin over Supabase** — admin moderation (approve/hide guestbook, view RSVPs) and content/theme editing **write to Supabase**; add owner/superadmin RLS write policies (and verify per-tenant isolation with a 2nd test client).
3. **Media + R2** — guest photo/video uploads to R2, URLs in `media` table.

## Self-review notes

- **Spec coverage:** read path (Task 4/5), RSVP (6), guestbook (7), quiz (8), tenant resolution (1), data mapping (2) — all covered. Admin/auth/media explicitly deferred with reasons.
- **Status mapping:** DB uses `approved`/`pending`; app display uses `visible`. `rowToGuestbook` maps `approved→visible`; `postGuestbook` writes `approved` when `autoApproveGuestbook` else `pending`. Consistent across Tasks 2/4/7.
- **Sync→async:** handled by the hydrate-cache pattern — only submit handlers become `async`; component reads stay synchronous.
- **No localStorage drift:** `hydrate` does NOT persist server data to localStorage (Step in Task 3), so the cache reflects the DB, not stale local writes.
