# Guest List & RSVP Reconciliation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner enter invited guests with a seat allocation, then reconcile against RSVPs to show who hasn't replied + an allocated-vs-confirmed headcount — all behind an "Enable Strict RSVP" switch. Public RSVP form untouched.

**Architecture:** New owner-only `guests` Supabase table (RLS). A pure `src/lib/guests.js` helper matches guests↔RSVPs by the existing fuzzy name logic and produces reconciliation rows + a summary. A new admin "Guests" tab (shown only when `settings.strictRsvp`) does CRUD + shows the reconciliation. Cap enforcement on the public form is out of scope (tracked as Enhancement 0005).

**Tech Stack:** React (Vite), Vitest, Supabase (Postgres + RLS), Cloudflare Pages.

**Testing model:** Pure logic (mappers, reconcile) is TDD unit-tested. Table/RLS verified by a DB query; store/API/UI by build + manual checklist (repo has no React-render or DB integration tests).

---

## File structure

- Create `supabase/migrations/0011_guests.sql` — `guests` table + RLS.
- Create `src/lib/guests.js` — `normName`, `namePartsMatch`, `reconcileGuests`.
- Create `src/lib/__tests__/guests.test.js` — unit tests.
- Modify `src/lib/mappers.js` — add `guestToRow` / `rowToGuest`; extend `rowToRsvp` with name parts.
- Modify `src/lib/__tests__/mappers.test.js` — assertions for the above.
- Modify `src/lib/store.jsx` — `guests` slice (default, hydrate reset, setSubmissions, CRUD).
- Modify `src/lib/api.js` — `addGuestDb`/`updateGuestDb`/`deleteGuestDb`; load guests in `loadAdminData`.
- Modify `src/admin/manage.jsx` — `strictRsvp` toggle, `guests` tab registration + gating + routing, `GuestsAdmin` + `GuestForm` components, imports.

---

## Task 1: `guests` table + RLS migration

**Files:** Create `supabase/migrations/0011_guests.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Owner-managed invited-guest list with a per-guest seat allocation. Owner-only
-- (RLS) — never exposed to anon, so it can't be read from the public site. Used
-- by the admin "Guests" tab to reconcile against RSVPs (who replied, headcount).
create table if not exists public.guests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  middle_name text,
  allocation int not null default 1,
  email text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists guests_client_id_idx on public.guests(client_id);

alter table public.guests enable row level security;

-- Owner: full CRUD on their own client's guests (auth_client() = caller's client_id).
drop policy if exists "owner manage guests" on public.guests;
create policy "owner manage guests" on public.guests for all to authenticated
  using (client_id = public.auth_client()) with check (client_id = public.auth_client());

-- Superadmin: manage any client's guests.
drop policy if exists "superadmin manage guests" on public.guests;
create policy "superadmin manage guests" on public.guests for all to authenticated
  using (public.auth_role() = 'superadmin') with check (public.auth_role() = 'superadmin');
```

- [ ] **Step 2: Apply to the remote Supabase project**

⚠️ Live prod DB (project id `xprynknppsehuzqqdvue`). Creating a new table + RLS is non-destructive.
Load the MCP tools: ToolSearch `select:mcp__supabase__apply_migration,mcp__supabase__execute_sql`. Then `mcp__supabase__apply_migration` with project_id `xprynknppsehuzqqdvue`, name `0011_guests`, query = the SQL above.

- [ ] **Step 3: Verify table + RLS + that anon is blocked**

`mcp__supabase__execute_sql` (project_id `xprynknppsehuzqqdvue`):
```sql
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='guests') as cols,
  (select relrowsecurity from pg_class where oid='public.guests'::regclass) as rls_on,
  (select count(*) from pg_policies where schemaname='public' and tablename='guests') as policies;
```
Expected: `cols` = 8, `rls_on` = true, `policies` = 2.

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/0011_guests.sql
git commit -m "feat: guests table (invited list + allocation) with owner/superadmin RLS"
```

---

## Task 2: Mappers — guest mappers + rowToRsvp name parts

**Files:** Modify `src/lib/mappers.js`; Test `src/lib/__tests__/mappers.test.js`

- [ ] **Step 1: Add failing tests**

In `src/lib/__tests__/mappers.test.js`, add these three blocks at the end of the file (before the final line):

```javascript
describe("guestToRow", () => {
  it("maps camelCase guest -> snake_case columns + client_id", () => {
    expect(guestToRow({ firstName: "Jeremy", lastName: "Reyes", middleName: "P",
      allocation: 2, email: "j@ex.com", notes: "college" }, "c1")).toEqual({
      client_id: "c1", first_name: "Jeremy", last_name: "Reyes", middle_name: "P",
      allocation: 2, email: "j@ex.com", notes: "college",
    });
  });
});

describe("rowToGuest", () => {
  it("maps snake_case row -> camelCase guest with numeric createdAt", () => {
    const g = rowToGuest({ id: "g1", first_name: "Jeremy", last_name: "Reyes", middle_name: "P",
      allocation: 2, email: "j@ex.com", notes: "college", created_at: "2026-01-01T00:00:00Z" });
    expect(g).toMatchObject({ id: "g1", firstName: "Jeremy", lastName: "Reyes", middleName: "P",
      allocation: 2, email: "j@ex.com", notes: "college" });
    expect(typeof g.createdAt).toBe("number");
  });
});

describe("rowToRsvp name parts", () => {
  it("exposes first/middle/last so guests can be matched", () => {
    const r = rowToRsvp({ id: "r1", full_name: "Jeremy P Reyes", first_name: "Jeremy",
      middle_name: "P", last_name: "Reyes", status: "attending", count: 2 });
    expect(r).toMatchObject({ firstName: "Jeremy", middleName: "P", lastName: "Reyes" });
  });
});
```

Add `guestToRow, rowToGuest` to the existing import at the top of the test file:
```javascript
import { clientToState, stateToClientRow, rsvpToRow, guestbookToRow, quizToRow, rowToGuestbook, rowToRsvp, rowToQuizSub, guestToRow, rowToGuest } from "@/lib/mappers.js";
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/__tests__/mappers.test.js`
Expected: FAIL — `guestToRow`/`rowToGuest` are not exported; `rowToRsvp` lacks name parts.

- [ ] **Step 3: Implement**

In `src/lib/mappers.js`, extend `rowToRsvp` to include name parts (add after `fullName: row.full_name, email: row.email,`):
```javascript
export function rowToRsvp(row) {
  return {
    id: row.id, fullName: row.full_name, email: row.email,
    firstName: row.first_name, middleName: row.middle_name, lastName: row.last_name,
    phone: row.phone, status: row.status, count: row.count,
    plusOne: row.plus_one, diet: row.diet, dietNotes: row.diet_notes, song: row.song, notes: row.notes,
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
  };
}
```

Add the two guest mappers (anywhere among the other mappers, e.g. after `rowToRsvp`):
```javascript
export function guestToRow(g, clientId) {
  return {
    client_id: clientId,
    first_name: g.firstName, last_name: g.lastName, middle_name: g.middleName,
    allocation: g.allocation, email: g.email, notes: g.notes,
  };
}

export function rowToGuest(row) {
  return {
    id: row.id, firstName: row.first_name, lastName: row.last_name, middleName: row.middle_name,
    allocation: row.allocation, email: row.email, notes: row.notes,
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/__tests__/mappers.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/mappers.js src/lib/__tests__/mappers.test.js
git commit -m "feat: guest mappers + expose rsvp name parts for matching"
```

---

## Task 3: Reconciliation helper `src/lib/guests.js`

**Files:** Create `src/lib/guests.js`; Test `src/lib/__tests__/guests.test.js`

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/guests.test.js`:

```javascript
import { describe, it, expect } from "vitest";
import { normName, namePartsMatch, reconcileGuests } from "@/lib/guests.js";

describe("normName", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(normName("  De Vera! ")).toBe("devera");
    expect(normName(null)).toBe("");
  });
});

describe("namePartsMatch", () => {
  const g = { first: "Jeremy", last: "Reyes", middle: "Perez" };
  it("matches on first+last when middles are equal or absent", () => {
    expect(namePartsMatch(g, { first: "jeremy", last: "reyes", middle: "Perez" })).toBe(true);
    expect(namePartsMatch({ first: "A", last: "B", middle: "" }, { first: "a", last: "b", middle: "" })).toBe(true);
  });
  it("treats a middle initial as matching the full middle", () => {
    expect(namePartsMatch(g, { first: "Jeremy", last: "Reyes", middle: "P" })).toBe(true);
  });
  it("rejects a different last name", () => {
    expect(namePartsMatch(g, { first: "Jeremy", last: "Cruz", middle: "Perez" })).toBe(false);
  });
});

describe("reconcileGuests", () => {
  const guests = [
    { id: "g1", firstName: "Jeremy", lastName: "Reyes", middleName: "", allocation: 2 },
    { id: "g2", firstName: "Maria", lastName: "Cruz", middleName: "", allocation: 4 },
    { id: "g3", firstName: "Tom", lastName: "Okafor", middleName: "", allocation: 1 },
  ];
  const rsvps = [
    { id: "r1", fullName: "Jeremy Reyes", firstName: "Jeremy", lastName: "Reyes", middleName: "", status: "attending", count: 2 },
    { id: "r2", fullName: "Tom Okafor", firstName: "Tom", lastName: "Okafor", middleName: "", status: "not_attending", count: 0 },
    { id: "r3", fullName: "Gate Crasher", firstName: "Gate", lastName: "Crasher", middleName: "", status: "attending", count: 3 },
  ];
  it("assigns status per guest and finds outstanding + unmatched", () => {
    const { rows, summary, unmatchedRsvps } = reconcileGuests(guests, rsvps);
    const byId = Object.fromEntries(rows.map((x) => [x.guest.id, x]));
    expect(byId.g1.status).toBe("attending");
    expect(byId.g2.status).toBe("none");     // no RSVP
    expect(byId.g3.status).toBe("not_attending");
    expect(summary.invited).toBe(3);
    expect(summary.seatsAllocated).toBe(7);  // 2 + 4 + 1
    expect(summary.replied).toBe(2);
    expect(summary.outstanding).toBe(1);
    expect(summary.confirmedHeads).toBe(2);  // only g1 attending, count 2
    expect(summary.declined).toBe(1);
    expect(unmatchedRsvps.map((r) => r.id)).toEqual(["r3"]);
  });
  it("handles empty inputs", () => {
    expect(reconcileGuests([], []).summary).toMatchObject({ invited: 0, seatsAllocated: 0, confirmedHeads: 0 });
    expect(reconcileGuests(undefined, undefined).rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/__tests__/guests.test.js`
Expected: FAIL — "Failed to resolve import '@/lib/guests.js'".

- [ ] **Step 3: Implement**

Create `src/lib/guests.js`:

```javascript
// ============================================================================
// guests.js — pure helpers for the owner's invited-guest list. normName mirrors
// the SQL public.norm_name (migrations 0007/0008); reconcileGuests matches guests
// to RSVPs by fuzzy name and produces per-guest status + a headcount summary.
// ============================================================================

// Lowercase + strip everything but letters/digits (mirrors SQL norm_name).
export function normName(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Middle names match if equal, or if one side is an initial of the other.
function middleMatches(a, b) {
  const x = normName(a), y = normName(b);
  if (x === y) return true;
  if (x && y && x[0] === y[0] && (x.length === 1 || y.length === 1)) return true;
  return false;
}

// Same predicate as rsvp_name_taken: normalized first + last equal, middle equal
// or an initial. `a`/`b` are { first, last, middle }.
export function namePartsMatch(a, b) {
  return normName(a.first) === normName(b.first)
    && normName(a.last) === normName(b.last)
    && middleMatches(a.middle, b.middle);
}

// Match each guest to at most one RSVP (first unused match wins) and compute a
// caterer/planning summary. Returns { rows, summary, unmatchedRsvps }.
export function reconcileGuests(guests, rsvps) {
  const gs = guests || [];
  const rs = (rsvps || []).map((r, i) => ({ r, i }));
  const used = new Set();

  const rows = gs.map((g) => {
    const hit = rs.find(({ r, i }) => !used.has(i) && namePartsMatch(
      { first: g.firstName, last: g.lastName, middle: g.middleName },
      { first: r.firstName, last: r.lastName, middle: r.middleName },
    ));
    if (hit) used.add(hit.i);
    const rsvp = hit ? hit.r : null;
    const status = rsvp ? rsvp.status : "none";
    return { guest: g, rsvp, status };
  });

  const unmatchedRsvps = rs.filter(({ i }) => !used.has(i)).map(({ r }) => r);
  const replied = rows.filter((x) => x.rsvp).length;
  const confirmedHeads = rows.reduce(
    (s, x) => s + (x.status === "attending" ? (Number(x.rsvp.count) || 0) : 0), 0);

  const summary = {
    invited: gs.length,
    seatsAllocated: gs.reduce((s, g) => s + (Number(g.allocation) || 0), 0),
    replied,
    outstanding: gs.length - replied,
    confirmedHeads,
    maybe: rows.filter((x) => x.status === "maybe").length,
    declined: rows.filter((x) => x.status === "not_attending").length,
  };

  return { rows, summary, unmatchedRsvps };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/__tests__/guests.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/guests.js src/lib/__tests__/guests.test.js
git commit -m "feat: reconcileGuests helper (fuzzy match guests to RSVPs + summary)"
```

---

## Task 4: Store guests slice

**Files:** Modify `src/lib/store.jsx`

- [ ] **Step 1: Add `guests: []` to defaultState**

In `defaultState()`, add a `guests` array next to `rsvps` (after the `rsvps: SEED_RSVPS,` line):
```javascript
    rsvps: SEED_RSVPS,
    guests: [], // owner-managed invited list (server-owned; loaded from DB in admin)
```

- [ ] **Step 2: Reset `guests` on hydrate**

In `hydrate(patch)`, the reset line currently reads `rsvps: [], quizSubs: [],`. Change it to:
```javascript
      rsvps: [], quizSubs: [], guests: [],
```

- [ ] **Step 3: Handle `guests` in setSubmissions**

In `setSubmissions({ rsvps, guestbook, quizSubs })`, change the signature and body to also accept `guests`:
```javascript
  setSubmissions({ rsvps, guestbook, quizSubs, guests }) {
    _state = {
      ..._state,
      ...(rsvps !== undefined ? { rsvps } : {}),
      ...(guestbook !== undefined ? { guestbook } : {}),
      ...(quizSubs !== undefined ? { quizSubs } : {}),
      ...(guests !== undefined ? { guests } : {}),
    };
    emit();
  },
```

- [ ] **Step 4: Add guest CRUD methods**

In the `Store` object, right after the `deleteRSVP(id) { ... },` method, add:
```javascript
  addGuest(guest) {
    _state = { ..._state, guests: [{ ...guest }, ...(_state.guests || [])] };
    persist();
    emit();
  },
  updateGuest(id, patch) {
    _state = { ..._state, guests: (_state.guests || []).map((g) => (g.id === id ? { ...g, ...patch } : g)) };
    persist();
    emit();
  },
  deleteGuest(id) {
    _state = { ..._state, guests: (_state.guests || []).filter((g) => g.id !== id) };
    persist();
    emit();
  },
```

- [ ] **Step 5: Verify**

Run: `npx vitest run && npm run build`
Expected: all tests PASS, build succeeds.

- [ ] **Step 6: Commit**
```bash
git add src/lib/store.jsx
git commit -m "feat: guests store slice (default, hydrate reset, setSubmissions, CRUD)"
```

---

## Task 5: API — guest DB ops + load

**Files:** Modify `src/lib/api.js`

- [ ] **Step 1: Import the guest mappers**

In `src/lib/api.js`, add `guestToRow, rowToGuest` to the existing `@/lib/mappers.js` import:
```javascript
import { clientToState, stateToClientRow, rowToGuestbook, rowToRsvp, rowToQuizSub, rsvpToRow, guestbookToRow, quizToRow, guestToRow, rowToGuest } from "@/lib/mappers.js";
```

- [ ] **Step 2: Load guests in loadAdminData**

In `loadAdminData`, extend the `Promise.all` and the `setSubmissions` call. Replace the existing block:
```javascript
  const [rs, gb, qz] = await Promise.all([
    supabase.from("rsvps").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
    supabase.from("guestbook").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
    supabase.from("quiz_answers").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
  ]);
  if (rs.error) console.warn("[api] rsvps load failed:", rs.error.message);
  if (gb.error) console.warn("[api] guestbook load failed:", gb.error.message);
  if (qz.error) console.warn("[api] quiz load failed:", qz.error.message);
  Store.setSubmissions({
    rsvps: (rs.data || []).map(rowToRsvp),
    guestbook: (gb.data || []).map(rowToGuestbook),
    quizSubs: (qz.data || []).map(rowToQuizSub),
  });
```
with:
```javascript
  const [rs, gb, qz, gu] = await Promise.all([
    supabase.from("rsvps").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
    supabase.from("guestbook").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
    supabase.from("quiz_answers").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
    supabase.from("guests").select("*").eq("client_id", clientId).order("created_at", { ascending: true }),
  ]);
  if (rs.error) console.warn("[api] rsvps load failed:", rs.error.message);
  if (gb.error) console.warn("[api] guestbook load failed:", gb.error.message);
  if (qz.error) console.warn("[api] quiz load failed:", qz.error.message);
  if (gu.error) console.warn("[api] guests load failed:", gu.error.message);
  Store.setSubmissions({
    rsvps: (rs.data || []).map(rowToRsvp),
    guestbook: (gb.data || []).map(rowToGuestbook),
    quizSubs: (qz.data || []).map(rowToQuizSub),
    guests: (gu.data || []).map(rowToGuest),
  });
```

- [ ] **Step 3: Add guest DB ops**

After `deleteRsvpDb` in `src/lib/api.js`, add:
```javascript
// Owner/superadmin guest-list CRUD (RLS scopes writes to the owner's client).
export async function addGuestDb(guest) {
  const clientId = Store.get().clientId;
  const { data, error } = await supabase.from("guests").insert(guestToRow(guest, clientId)).select().single();
  if (error) { console.warn("[api] guest insert failed:", error.message); throw error; }
  return rowToGuest(data);
}
export async function updateGuestDb(id, guest) {
  const clientId = Store.get().clientId;
  const { error } = await supabase.from("guests").update(guestToRow(guest, clientId)).eq("id", id);
  if (error) { console.warn("[api] guest update failed:", error.message); throw error; }
}
export async function deleteGuestDb(id) {
  const { error } = await supabase.from("guests").delete().eq("id", id);
  if (error) { console.warn("[api] guest delete failed:", error.message); throw error; }
}
```

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**
```bash
git add src/lib/api.js
git commit -m "feat: guest DB ops (add/update/delete) + load guests in loadAdminData"
```

---

## Task 6: `strictRsvp` setting + toggle

**Files:** Modify `src/lib/store.jsx`, `src/admin/manage.jsx`

- [ ] **Step 1: Add the default**

In `DEFAULT_SETTINGS` (`src/lib/store.jsx`), add after the `rsvpDeadlineDate: "",` line:
```javascript
  // Master switch for the invited-guest list feature. When on, the admin gains a
  // "Guests" tab to manage invites + track replies. Public RSVP form is unaffected.
  strictRsvp: false,
```

- [ ] **Step 2: Add the toggle in Settings → Access**

In `src/admin/manage.jsx`, in the "Access & Toggles" panel, add a toggle after the "Show public gallery" line:
```javascript
          <AdminToggle label="Show public gallery" desc="Hide the gallery from guests entirely if you prefer." checked={f.galleryEnabled} onChange={(v) => setKey("galleryEnabled", v)} />
          <AdminToggle label="Enable Strict RSVP" desc="Track an invited-guest list with seat allocations, and see who hasn't replied. Adds a Guests tab. (The public RSVP form stays open for now.)" checked={f.strictRsvp === true} onChange={(v) => setKey("strictRsvp", v)} />
```

- [ ] **Step 3: Verify**

Run: `npx vitest run && npm run build`
Expected: tests PASS, build succeeds.

- [ ] **Step 4: Commit**
```bash
git add src/lib/store.jsx src/admin/manage.jsx
git commit -m "feat: Enable Strict RSVP setting + Settings toggle"
```

---

## Task 7: Guests tab — registration, gating, routing

**Files:** Modify `src/admin/manage.jsx`

- [ ] **Step 1: Register the tab**

In `ADMIN_TABS`, add a Guests entry right after the `rsvps` entry:
```javascript
  { key: "rsvps", label: "RSVPs", icon: "mail" },
  { key: "guests", label: "Guests", icon: "user" },
```

- [ ] **Step 2: Gate the tab on `strictRsvp`**

In `AdminApp`, immediately after the `if/else` that assigns `tabs` (right before `const activeTab = ...`), add:
```javascript
  if (!settings.strictRsvp) tabs = tabs.filter((t) => t.key !== "guests");
```

- [ ] **Step 3: Route to GuestsAdmin**

In the `AdminSaveCtx.Provider` block, add a route right after the `rsvps` route:
```javascript
          {activeTab === "rsvps" && <RsvpsAdmin />}
          {activeTab === "guests" && <GuestsAdmin />}
```

- [ ] **Step 4: Verify build (component added next task — expect a reference error only if run)**

Run: `npm run build`
Expected: build FAILS with "GuestsAdmin is not defined" — that's expected; Task 8 defines it. Do NOT commit yet. (If you prefer, do Steps 1–3 and Task 8 together, then build once.)

> To keep commits green, this task's commit is deferred to the end of Task 8.

---

## Task 8: `GuestsAdmin` + `GuestForm` components

**Files:** Modify `src/admin/manage.jsx`

- [ ] **Step 1: Add imports**

Add `reconcileGuests` import near the other `@/lib` imports at the top of `src/admin/manage.jsx`:
```javascript
import { reconcileGuests } from "@/lib/guests.js";
```
And add the guest DB ops to the existing `@/lib/api.js` import (append to the destructured list):
```javascript
import { loadAdminData, saveClientData, setGuestbookStatusDb, deleteGuestbookDb, deleteRsvpDb, uploadAudio, uploadToR2, migrateClientMediaToR2, hasLegacyMedia, sendEmail, addGuestDb, updateGuestDb, deleteGuestDb } from "@/lib/api.js";
```

- [ ] **Step 2: Add the components**

Add these two components immediately before `export function RsvpsAdmin() {` in `src/admin/manage.jsx`:

```javascript
// Modal body: add or edit one invited guest.
function GuestForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => { const v = e && e.target ? e.target.value : e; setF((s) => ({ ...s, [k]: v })); };
  const valid = f.firstName.trim() && f.lastName.trim();
  async function submit() {
    if (!valid || saving) return;
    setSaving(true);
    try { await onSave(f); } finally { setSaving(false); }
  }
  return (
    <div>
      <SectionHead eyebrow="Guest" title={f.id ? "Edit guest" : "Add guest"} />
      <div className="field-row field-row--2">
        <Field label="First name" required id="g-first"><Input id="g-first" value={f.firstName} onChange={set("firstName")} /></Field>
        <Field label="Last name" required id="g-last"><Input id="g-last" value={f.lastName} onChange={set("lastName")} /></Field>
      </div>
      <div className="field-row field-row--2">
        <Field label="Middle name" hint="Optional — tells apart same-named guests" id="g-mid"><Input id="g-mid" value={f.middleName} onChange={set("middleName")} /></Field>
        <Field label="Seats allocated" hint="Total incl. this guest (2 = guest + 1)" id="g-alloc"><Input id="g-alloc" type="number" min={1} value={f.allocation} onChange={set("allocation")} /></Field>
      </div>
      <Field label="Email" hint="Optional" id="g-email"><Input id="g-email" type="email" value={f.email || ""} onChange={set("email")} /></Field>
      <Field label="Notes" hint="Optional" id="g-notes"><Input id="g-notes" value={f.notes || ""} onChange={set("notes")} /></Field>
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <Button variant="primary" block disabled={!valid || saving} onClick={submit}>{saving ? "Saving…" : "Save guest"}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// Guests tab — invited-list CRUD + reconciliation against RSVPs (who replied,
// headcount). Shown only when settings.strictRsvp is on (gated in AdminApp).
export function GuestsAdmin() {
  const { guests, rsvps } = useStore();
  const { run } = React.useContext(AdminSaveCtx);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const blank = { firstName: "", lastName: "", middleName: "", allocation: 2, email: "", notes: "" };

  const recon = React.useMemo(() => reconcileGuests(guests, rsvps), [guests, rsvps]);
  const byId = React.useMemo(() => new Map(recon.rows.map((x) => [x.guest.id, x])), [recon]);
  const S = recon.summary;
  const STAT_LABEL = { attending: "Attending", maybe: "Maybe", not_attending: "Declined" };

  const hasReply = (g) => { const x = byId.get(g.id); return !!(x && x.rsvp); };
  const bySearch = guests.filter((g) => !q || `${g.firstName} ${g.lastName}`.toLowerCase().includes(q.toLowerCase()));
  const filtered = bySearch.filter((g) => filter === "all" ? true : filter === "replied" ? hasReply(g) : !hasReply(g));
  const pg = usePaged(filtered, 10);

  async function saveGuest(form) {
    const payload = { ...form, allocation: Math.max(1, parseInt(form.allocation, 10) || 1) };
    await run(async () => {
      if (form.id) { await updateGuestDb(form.id, payload); Store.updateGuest(form.id, payload); }
      else { const row = await addGuestDb(payload); Store.addGuest(row); }
    });
    setEditing(null);
    toast("Guest saved", "success");
  }
  function removeGuest(g) {
    confirmDialog({ title: "Remove guest?", message: `Remove ${g.firstName} ${g.lastName} from the invite list?`, confirmLabel: "Remove", danger: true })
      .then((ok) => { if (ok) run(async () => { await deleteGuestDb(g.id); Store.deleteGuest(g.id); }).then(() => toast("Guest removed", "success"), () => toast("Couldn't remove")); });
  }

  return (
    <div>
      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginBottom: 20 }}>
        <div className="stat"><div className="stat__label">Invited</div><div className="stat__value">{S.invited}</div><div className="stat__sub">guests</div></div>
        <div className="stat"><div className="stat__label">Seats allocated</div><div className="stat__value">{S.seatsAllocated}</div><div className="stat__sub">total seats</div></div>
        <div className="stat"><div className="stat__label">Confirmed</div><div className="stat__value">{S.confirmedHeads}</div><div className="stat__sub">heads coming</div></div>
        <div className="stat"><div className="stat__label">Outstanding</div><div className="stat__value">{S.outstanding}</div><div className="stat__sub">no reply yet</div></div>
      </div>

      {recon.unmatchedRsvps.length > 0 && (
        <div className="card" style={{ padding: "12px 16px", marginBottom: 16, border: "1px solid var(--line)", borderRadius: 10, fontSize: 14 }}>
          <strong>{recon.unmatchedRsvps.length}</strong> RSVP{recon.unmatchedRsvps.length > 1 ? "s" : ""} don&rsquo;t match an invited guest: {recon.unmatchedRsvps.map((r) => r.fullName).join(", ")}. Add them, or fix a name spelling.
        </div>
      )}

      <div className="folders">
        {[["all", "All"], ["replied", "Replied"], ["outstanding", "Outstanding"]].map(([v, l]) => (
          <button key={v} className={"folder" + (filter === v ? " folder--active" : "")} onClick={() => setFilter(v)}>{l}</button>
        ))}
      </div>

      <div className="panel">
        <div className="panel__head">
          <div className="panel__title">Guests <span style={{ color: "var(--muted)", fontSize: 15 }}>({filtered.length})</span></div>
          <div className="admin-toolbar"><div className="admin-toolbar__end">
            <Button variant="primary" className="admin-toolbar__action" onClick={() => setEditing({ ...blank })}>Add guest</Button>
            <div className="search-box">{Icon.search({})}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" /></div>
          </div></div>
        </div>
        <div className="panel__body--flush table-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Allocation</th><th>Status</th><th>Coming</th><th></th></tr></thead>
            <tbody>
              {pg.pageItems.map((g) => {
                const x = byId.get(g.id) || { status: "none", rsvp: null };
                return (
                  <tr key={g.id}>
                    <td><strong>{g.firstName} {g.lastName}</strong>{g.middleName ? <span style={{ color: "var(--muted)" }}> ({g.middleName})</span> : null}</td>
                    <td>{g.allocation}</td>
                    <td>{x.status === "none"
                      ? <span style={{ color: "var(--muted)" }}>No reply</span>
                      : <span className={"tag tag--" + x.status}>{STAT_LABEL[x.status]}</span>}</td>
                    <td>{x.status === "attending" ? x.rsvp.count : "—"}</td>
                    <td><div className="row-actions">
                      <button className="icon-btn" onClick={() => setEditing({ ...blank, ...g })} aria-label="Edit">{Icon.eye({})}</button>
                      <button className="icon-btn icon-btn--danger" onClick={() => removeGuest(g)} aria-label="Remove">{Icon.trash({})}</button>
                    </div></td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>No guests yet. Add your invited guests to track replies.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={pg.page} totalPages={pg.totalPages} total={pg.total} perPage={pg.perPage} start={pg.start} onPage={pg.setPage} noun="guests" />
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} label="Guest">
        {editing && <GuestForm initial={editing} onSave={saveGuest} onCancel={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}
```

- [ ] **Step 2: Verify build + full tests**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all tests PASS.

- [ ] **Step 3: Commit (covers Task 7 + Task 8)**
```bash
git add src/admin/manage.jsx
git commit -m "feat: Guests admin tab (invited list CRUD + reply reconciliation)"
```

---

## Task 9: Full verification + deploy

**Files:** none (verification) + `docs/WEDDING-STATUS.md`

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all PASS (99 prior + the new guests/mappers tests).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual smoke checklist (`npm run dev`)**

- [ ] With Strict RSVP OFF (default): no "Guests" tab in the admin sidebar.
- [ ] Settings → Access → toggle "Enable Strict RSVP" on, Save → "Guests" tab appears.
- [ ] Add a guest (First "Jeremy", Last "Reyes", allocation 2) → row shows "No reply", allocation 2; summary Invited 1 / Seats 2 / Outstanding 1.
- [ ] Submit a public RSVP as "Jeremy Reyes", attending, 2 → Guests row flips to "Attending", Coming = 2, Confirmed heads = 2, Outstanding = 0.
- [ ] Submit a public RSVP as a name NOT on the list → "unmatched RSVP" notice appears.
- [ ] Filter tabs All / Replied / Outstanding narrow the list correctly.

- [ ] **Step 4: Update the tracker**

In `docs/WEDDING-STATUS.md`, move Enhancement 0004 to Done/History with the resolution (guest list + reconciliation shipped; note Enhancement 0005 cap enforcement still Deferred).

- [ ] **Step 5: Deploy**
```bash
git add docs/WEDDING-STATUS.md
git commit -m "docs: mark guest-list reconciliation (Enhancement 0004) done"
git push origin main
```
Verify via the **CF Pages API** (commit hash matches + all stages `success`), then grep a marker in the served bundle:
```bash
curl -s https://demo.celebrately.us/assets/index-*.js | LC_ALL=C grep -c "Enable Strict RSVP"
```
Expected: `1`.

---

## Self-review notes

- **Spec coverage:** guests table+RLS → T1. strictRsvp setting+toggle → T6. store slice → T4. api+load → T5. mappers → T2. reconcile helper → T3. Guests tab (gated) + UI → T7/T8. Testing → T2/T3 unit + T9 manual. All spec sections covered.
- **Type consistency:** `guestToRow`/`rowToGuest` field names align across mappers, store, api, and `GuestForm`/`GuestsAdmin` (`firstName/lastName/middleName/allocation/email/notes`). `reconcileGuests` return shape (`rows`/`summary`/`unmatchedRsvps`, `summary.confirmedHeads` etc.) matches its consumer in `GuestsAdmin`. RSVP objects gain `firstName/middleName/lastName` (T2) which `reconcileGuests` relies on (T3) — ordering is correct (T2 before T3's consumer T8).
- **Green-commit note:** Task 7 intentionally defers its commit to end of Task 8 (the tab route references a component defined in T8), so the tree only commits when it builds. Called out explicitly, not a placeholder.
- **No placeholders:** every code step shows full code; commands have expected results.
