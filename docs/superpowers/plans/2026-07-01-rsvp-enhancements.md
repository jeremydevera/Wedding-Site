# RSVP Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional email, deadline enforcement, caterer stats, edit-your-RSVP, and named plus-ones to the wedding RSVP flow — frontend + two small Supabase migrations, no new backend services.

**Architecture:** Pure, testable helpers live in a new `src/lib/rsvp.js` module (deadline check, plus-one join, optional-email validation, admin stats) and are consumed by the public form (`src/features/rsvp.jsx`) and the admin panel (`src/admin/manage.jsx`). Email is threaded through the existing `rsvpToRow`/`rowToRsvp` mappers plus a new `email` column. Editing reuses the existing fuzzy-name matcher via a new `rsvp_upsert` SECURITY DEFINER RPC (mirrors the shipped `rsvp_name_taken`).

**Tech Stack:** React (no JSX transform quirks — `React` global destructured), Vite, Vitest, Supabase (Postgres + RPC), Cloudflare Pages.

**Testing model:** All new *logic* is extracted into `src/lib/rsvp.js` and unit-tested (TDD). UI wiring and SQL are verified by build + manual checklist + a DB query, since the repo has no React-render or DB integration tests.

---

## File structure

- Create `src/lib/rsvp.js` — pure helpers: `isRsvpClosed`, `joinPlusOnes`, `isValidOptionalEmail`, `rsvpStats`.
- Create `src/lib/__tests__/rsvp.test.js` — unit tests for the above.
- Create `supabase/migrations/0009_rsvp_email.sql` — `email` column.
- Create `supabase/migrations/0010_rsvp_upsert.sql` — `rsvp_upsert` RPC.
- Modify `src/lib/mappers.js` — `email` in `rsvpToRow` + `rowToRsvp`.
- Modify `src/lib/__tests__/mappers.test.js` — email round-trip assertions.
- Modify `src/lib/api.js` — new `upsertRsvp()`.
- Modify `src/lib/store.jsx` — `rsvpDeadlineDate: ""` default.
- Modify `src/features/rsvp.jsx` — email field, deadline-closed card, edit flow, dynamic plus-one inputs.
- Modify `src/admin/manage.jsx` — deadline-date input (Home settings) + stats summary bar.

---

## Task 1: Pure RSVP helpers (`src/lib/rsvp.js`)

**Files:**
- Create: `src/lib/rsvp.js`
- Test: `src/lib/__tests__/rsvp.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/rsvp.test.js`:

```javascript
import { describe, it, expect } from "vitest";
import { isRsvpClosed, joinPlusOnes, isValidOptionalEmail, rsvpStats } from "@/lib/rsvp.js";

describe("isRsvpClosed", () => {
  it("is open when no deadline is set", () => {
    expect(isRsvpClosed("", 1_000)).toBe(false);
    expect(isRsvpClosed(null, 1_000)).toBe(false);
    expect(isRsvpClosed(undefined, 1_000)).toBe(false);
  });
  it("is open before the deadline, closed after", () => {
    const deadline = "2026-08-15T23:59";
    const before = Date.parse("2026-08-01T12:00");
    const after = Date.parse("2026-09-01T12:00");
    expect(isRsvpClosed(deadline, before)).toBe(false);
    expect(isRsvpClosed(deadline, after)).toBe(true);
  });
  it("stays open on an unparseable deadline string", () => {
    expect(isRsvpClosed("not a date", Date.parse("2099-01-01"))).toBe(false);
  });
});

describe("joinPlusOnes", () => {
  it("trims, drops blanks, and comma-joins", () => {
    expect(joinPlusOnes([" Bob ", "", "  ", "Cara"])).toBe("Bob, Cara");
  });
  it("returns an empty string for empty/undefined input", () => {
    expect(joinPlusOnes([])).toBe("");
    expect(joinPlusOnes(undefined)).toBe("");
  });
});

describe("isValidOptionalEmail", () => {
  it("allows an empty value (optional field)", () => {
    expect(isValidOptionalEmail("")).toBe(true);
    expect(isValidOptionalEmail("   ")).toBe(true);
    expect(isValidOptionalEmail(undefined)).toBe(true);
  });
  it("accepts a well-formed address and rejects a malformed one", () => {
    expect(isValidOptionalEmail("a@b.co")).toBe(true);
    expect(isValidOptionalEmail("nope")).toBe(false);
    expect(isValidOptionalEmail("a@b")).toBe(false);
  });
});

describe("rsvpStats", () => {
  const rows = [
    { status: "attending", count: 2, diet: "Vegetarian" },
    { status: "attending", count: 1, diet: "None" },
    { status: "attending", count: 3, diet: "Vegetarian" },
    { status: "maybe", count: 1, diet: "Vegan" },
    { status: "not_attending", count: 0, diet: "None" },
  ];
  it("counts parties, heads, maybe, declined", () => {
    const s = rsvpStats(rows);
    expect(s.total).toBe(5);
    expect(s.attendingParties).toBe(3);
    expect(s.attendingHeads).toBe(6); // 2 + 1 + 3
    expect(s.maybe).toBe(1);
    expect(s.declined).toBe(1);
  });
  it("tallies diets for attending guests, excluding None", () => {
    const s = rsvpStats(rows);
    expect(s.diets).toEqual({ Vegetarian: 2 });
  });
  it("handles empty input", () => {
    expect(rsvpStats([])).toMatchObject({ total: 0, attendingHeads: 0, diets: {} });
    expect(rsvpStats(undefined).total).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/rsvp.test.js`
Expected: FAIL — "Failed to resolve import '@/lib/rsvp.js'".

- [ ] **Step 3: Write the implementation**

Create `src/lib/rsvp.js`:

```javascript
// ============================================================================
// rsvp.js — pure, framework-free RSVP helpers (deadline gate, plus-one join,
// optional-email validation, admin stats). Kept dependency-free so both the
// public form and the admin panel can import them and they stay unit-testable.
// ============================================================================

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// True once the RSVP window has passed. Open (false) when no deadline is set or
// the stored value can't be parsed, so existing clients without a date keep
// working. `now` is milliseconds (pass Date.now()); defaults to now if omitted.
export function isRsvpClosed(deadlineDate, now) {
  if (!deadlineDate) return false;
  const t = Date.parse(deadlineDate);
  if (Number.isNaN(t)) return false;
  return (now == null ? Date.now() : now) > t;
}

// Trim each guest name, drop blanks, comma-join. Stored in the existing
// `plus_one` text column so admin display + CSV keep working unchanged.
export function joinPlusOnes(names) {
  return (names || []).map((s) => (s || "").trim()).filter(Boolean).join(", ");
}

// Email is optional: an empty value is always valid; a non-empty value must look
// like an address (mirrors the server's EMAIL_RE in functions/api/send-email.js).
export function isValidOptionalEmail(email) {
  const v = (email || "").trim();
  return v === "" || EMAIL_RE.test(v);
}

// Caterer-facing tallies from the RSVP list. attendingHeads sums `count` across
// attending parties; diets counts each non-"None" diet among attending parties.
export function rsvpStats(rsvps) {
  const list = rsvps || [];
  const attending = list.filter((r) => r.status === "attending");
  const diets = {};
  for (const r of attending) {
    if (r.diet && r.diet !== "None") diets[r.diet] = (diets[r.diet] || 0) + 1;
  }
  return {
    total: list.length,
    attendingParties: attending.length,
    attendingHeads: attending.reduce((s, r) => s + (Number(r.count) || 0), 0),
    maybe: list.filter((r) => r.status === "maybe").length,
    declined: list.filter((r) => r.status === "not_attending").length,
    diets,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/rsvp.test.js`
Expected: PASS — 4 describe blocks, all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rsvp.js src/lib/__tests__/rsvp.test.js
git commit -m "feat: pure RSVP helpers (deadline gate, plus-one join, email validate, stats)"
```

---

## Task 2: Thread email through the mappers

**Files:**
- Modify: `src/lib/mappers.js` (`rsvpToRow` ~line 55, `rowToRsvp` ~line 84)
- Test: `src/lib/__tests__/mappers.test.js`

- [ ] **Step 1: Add failing assertions**

In `src/lib/__tests__/mappers.test.js`, replace the `rsvpToRow` describe block (currently lines ~41-49) with:

```javascript
describe("rsvpToRow", () => {
  it("maps camelCase form -> snake_case columns + client_id, including email", () => {
    expect(rsvpToRow({ fullName: "Jane", email: "jane@ex.com", phone: "5", status: "attending", count: 2,
      plusOne: "Bob", diet: "Vegan", dietNotes: "", song: "s", notes: "n" }, "c1")).toMatchObject({
      client_id: "c1", full_name: "Jane", email: "jane@ex.com", phone: "5", status: "attending", count: 2,
      plus_one: "Bob", diet: "Vegan", diet_notes: "", song: "s", notes: "n",
    });
  });
});
```

And replace the `rowToRsvp` describe block (currently lines ~81-90) with:

```javascript
describe("rowToRsvp", () => {
  it("maps snake_case columns -> camelCase form, including email", () => {
    const r = rowToRsvp({ id: "r1", full_name: "Jane", email: "jane@ex.com", phone: "5", status: "attending", count: 2,
      plus_one: "Bob", diet: "Vegan", diet_notes: "no nuts", song: "s", notes: "n",
      created_at: "2026-01-01T00:00:00Z" });
    expect(r).toMatchObject({ id: "r1", fullName: "Jane", email: "jane@ex.com", phone: "5", status: "attending",
      count: 2, plusOne: "Bob", diet: "Vegan", dietNotes: "no nuts", song: "s", notes: "n" });
    expect(typeof r.createdAt).toBe("number");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/__tests__/mappers.test.js`
Expected: FAIL — received object missing `email` in both blocks.

- [ ] **Step 3: Implement the mapper changes**

In `src/lib/mappers.js`, in `rsvpToRow` add `email` (after `full_name`):

```javascript
export function rsvpToRow(r, clientId) {
  return {
    client_id: clientId,
    full_name: r.fullName, email: r.email, first_name: r.firstName, middle_name: r.middleName, last_name: r.lastName,
    phone: r.phone, status: r.status, count: r.count,
    plus_one: r.plusOne, diet: r.diet, diet_notes: r.dietNotes, song: r.song, notes: r.notes,
  };
}
```

In `rowToRsvp` add `email` (after `fullName`):

```javascript
export function rowToRsvp(row) {
  return {
    id: row.id, fullName: row.full_name, email: row.email, phone: row.phone, status: row.status, count: row.count,
    plusOne: row.plus_one, diet: row.diet, dietNotes: row.diet_notes, song: row.song, notes: row.notes,
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
git commit -m "feat: thread guest email through rsvpToRow/rowToRsvp mappers"
```

---

## Task 3: `email` column migration

**Files:**
- Create: `supabase/migrations/0009_rsvp_email.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0009_rsvp_email.sql`:

```sql
-- Optional guest email on RSVPs. The admin UI already renders this column
-- (table, detail, CSV, results email); the public form + mappers now collect it.
alter table public.rsvps
  add column if not exists email text;
```

- [ ] **Step 2: Apply to the remote Supabase project**

⚠️ This writes to the live prod DB (project ref `xprynknppsehuzqqdvue`). Adding a nullable column is non-destructive.

Apply with the Supabase MCP `apply_migration` tool:
- name: `0009_rsvp_email`
- query: the SQL above.

- [ ] **Step 3: Verify the column exists**

Run via Supabase MCP `execute_sql`:

```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'rsvps' and column_name = 'email';
```

Expected: one row — `email | text`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0009_rsvp_email.sql
git commit -m "feat: add nullable email column to rsvps"
```

---

## Task 4: `rsvp_upsert` RPC migration

**Files:**
- Create: `supabase/migrations/0010_rsvp_upsert.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0010_rsvp_upsert.sql`:

```sql
-- Insert-or-update an RSVP by fuzzy name match (same predicate as
-- rsvp_name_taken, migration 0008). Lets an anonymous guest UPDATE their own
-- prior response without RLS read access to the rsvps table. SECURITY DEFINER;
-- callers pass the same client_id + name parts used for the duplicate check.
create or replace function public.rsvp_upsert(
  p_client_id uuid, p_first text, p_middle text, p_last text,
  p_full_name text, p_email text, p_phone text, p_status text, p_count int,
  p_plus_one text, p_diet text, p_diet_notes text, p_song text, p_notes text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  select r.id into v_id from public.rsvps r
   where r.client_id = p_client_id
     and public.norm_name(r.first_name) = public.norm_name(p_first)
     and public.norm_name(r.last_name)  = public.norm_name(p_last)
     and (
       public.norm_name(r.middle_name) = public.norm_name(p_middle)
       or (
         public.norm_name(r.middle_name) <> '' and public.norm_name(p_middle) <> ''
         and left(public.norm_name(r.middle_name), 1) = left(public.norm_name(p_middle), 1)
         and (length(public.norm_name(r.middle_name)) = 1 or length(public.norm_name(p_middle)) = 1)
       )
     )
   limit 1;

  if v_id is null then
    insert into public.rsvps
      (client_id, full_name, first_name, middle_name, last_name, email, phone, status, count, plus_one, diet, diet_notes, song, notes)
    values
      (p_client_id, p_full_name, p_first, p_middle, p_last, p_email, p_phone, p_status, p_count, p_plus_one, p_diet, p_diet_notes, p_song, p_notes);
  else
    update public.rsvps set
      full_name = p_full_name, email = p_email, phone = p_phone, status = p_status,
      count = p_count, plus_one = p_plus_one, diet = p_diet, diet_notes = p_diet_notes,
      song = p_song, notes = p_notes
    where id = v_id;
  end if;
end;
$$;

revoke all on function public.rsvp_upsert(uuid,text,text,text,text,text,text,text,int,text,text,text,text,text) from public;
grant execute on function public.rsvp_upsert(uuid,text,text,text,text,text,text,text,int,text,text,text,text,text) to anon, authenticated;
```

- [ ] **Step 2: Apply to the remote Supabase project**

⚠️ Live prod DB. Adding a function + grant is non-destructive.

Apply with Supabase MCP `apply_migration`:
- name: `0010_rsvp_upsert`
- query: the SQL above.

- [ ] **Step 3: Verify the function exists and anon can execute it**

Run via Supabase MCP `execute_sql`:

```sql
select p.proname,
       has_function_privilege('anon', p.oid, 'execute') as anon_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'rsvp_upsert';
```

Expected: one row — `rsvp_upsert | t`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0010_rsvp_upsert.sql
git commit -m "feat: rsvp_upsert RPC for anon guest RSVP edits (fuzzy name match)"
```

---

## Task 5: `upsertRsvp()` client helper

**Files:**
- Modify: `src/lib/api.js` (add after `rsvpNameTaken`, ~line 51)

- [ ] **Step 1: Add the function**

In `src/lib/api.js`, immediately after the `rsvpNameTaken` function (line ~51), add:

```javascript
// Update-or-insert an RSVP by fuzzy name match via the rsvp_upsert RPC. Used by
// the public form's "update my response" path (an anon guest can't UPDATE the
// rsvps table directly under RLS). `form` is the same shape passed to postRsvp.
export async function upsertRsvp(form) {
  const clientId = Store.get().clientId;
  const { error } = await supabase.rpc("rsvp_upsert", {
    p_client_id: clientId,
    p_first: form.firstName || "", p_middle: form.middleName || "", p_last: form.lastName || "",
    p_full_name: form.fullName || "", p_email: form.email || "", p_phone: form.phone || "",
    p_status: form.status, p_count: form.count || 0,
    p_plus_one: form.plusOne || "", p_diet: form.diet || "None", p_diet_notes: form.dietNotes || "",
    p_song: form.song || "", p_notes: form.notes || "",
  });
  if (error) throw error;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (no unused/syntax errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.js
git commit -m "feat: upsertRsvp client helper calling rsvp_upsert RPC"
```

---

## Task 6: `rsvpDeadlineDate` default setting

**Files:**
- Modify: `src/lib/store.jsx` (`DEFAULT_SETTINGS`, ~line 33)

- [ ] **Step 1: Add the default**

In `src/lib/store.jsx`, in `DEFAULT_SETTINGS`, add `rsvpDeadlineDate` right after the `rsvpDeadline` line (line 33):

```javascript
  rsvpDeadline: "August 15, 2026",
  // ISO datetime (like weddingDate). When set and in the past, the public RSVP
  // form closes. Blank = always open (backward-compatible for existing clients).
  rsvpDeadlineDate: "",
```

- [ ] **Step 2: Verify tests + build still pass**

Run: `npx vitest run src/lib/__tests__/mappers.test.js && npm run build`
Expected: PASS + build ok. (`clientToState` falls back to `DEFAULT_SETTINGS`, so the new key propagates to existing clients.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/store.jsx
git commit -m "feat: rsvpDeadlineDate default setting (blank = form stays open)"
```

---

## Task 7: Email field on the public form

**Files:**
- Modify: `src/features/rsvp.jsx` (imports, form state ~line 17, `validate` ~line 33, JSX ~line 121)

- [ ] **Step 1: Update imports**

At the top of `src/features/rsvp.jsx`, change the api import (line 4) and add the helpers import:

```javascript
import { postRsvp, rsvpNameTaken, upsertRsvp } from "@/lib/api.js";
import { isRsvpClosed, joinPlusOnes, isValidOptionalEmail } from "@/lib/rsvp.js";
```

- [ ] **Step 2: Add `email` to form state**

Change the `useState` initializer (lines 17-20) to include `email` and swap `plusOne` for `guestNames` (used in Task 9):

```javascript
  const [form, setForm] = useState({
    firstName: "", middleName: "", lastName: "", email: "", phone: "", status: "attending", count: 1,
    guestNames: [], diet: "None", dietNotes: "", song: "", notes: "",
  });
```

- [ ] **Step 3: Validate email only when non-empty**

In `validate()` (after the `lastName` check, ~line 36), add:

```javascript
    if (!isValidOptionalEmail(form.email)) er.email = "Please enter a valid email, or leave it blank.";
```

- [ ] **Step 4: Add the email input to the JSX**

In the form, insert an Email field between the Middle name field and the Phone field (after the `r-middle` Field block, ~line 120):

```javascript
            <Field label="Email" hint="Optional — so the couple can reach you about the day" error={errors.email} id="r-email">
              <Input id="r-email" type="email" inputMode="email" value={form.email} onChange={set("email")} />
            </Field>
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/features/rsvp.jsx
git commit -m "feat: optional email field on the RSVP form (validated only when filled)"
```

---

## Task 8: Named plus-one inputs

**Files:**
- Modify: `src/features/rsvp.jsx` (plus-one JSX ~line 150, `submit` ~line 52)

- [ ] **Step 1: Replace the single plus-one input with dynamic name inputs**

Replace the `form.count > 1` block (currently lines ~150-154, the single `r-plus` Input) with:

```javascript
                {form.count > 1 && (
                  <Field label="Names of your guests" hint="So we can set the table">
                    <div style={{ display: "grid", gap: 8 }}>
                      {Array.from({ length: form.count - 1 }, (_, i) => (
                        <Input
                          key={i}
                          aria-label={`Guest ${i + 2} name`}
                          placeholder={`Guest ${i + 2}`}
                          value={(form.guestNames && form.guestNames[i]) || ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setForm((f) => {
                              const g = [...(f.guestNames || [])];
                              g[i] = v;
                              return { ...f, guestNames: g };
                            });
                          }}
                        />
                      ))}
                    </div>
                  </Field>
                )}
```

- [ ] **Step 2: Build the joined `plusOne` at submit time**

In `submit()`, replace the payload construction. The current block (lines ~52-68) computes `fullName` then calls `postRsvp`. Replace from the `const fullName` line down to the `postRsvp` call with:

```javascript
    const fullName = [form.firstName, form.middleName, form.lastName].map((s) => s.trim()).filter(Boolean).join(" ");
    const count = attending ? parseInt(form.count, 10) : 0;
    const plusOne = joinPlusOnes((form.guestNames || []).slice(0, Math.max(0, count - 1)));
    const payload = { ...form, fullName, count, plusOne };
    setSubmitting(true);
    try {
      // Block a duplicate RSVP under the same name (checked server-side; the guest
      // list itself is never exposed). A real same-named guest can add a middle name.
      if (await rsvpNameTaken(form.firstName, form.middleName, form.lastName)) {
        setSubmitting(false);
        await confirmDialog({
          title: "You've already RSVP'd",
          message: `Looks like ${fullName} has already responded. We've got you down — thank you!`,
          confirmLabel: "OK",
          okOnly: true,
        });
        go("home");
        return;
      }
      await postRsvp(payload);
```

> Note: the success-card copy at line ~90 reads `form.count`. Leave it — for a declining guest `form.count` still shows their picker value but the card branch only renders the guest count when `attending`. No change needed.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/features/rsvp.jsx
git commit -m "feat: collect named plus-one guests, stored comma-joined in plus_one"
```

---

## Task 9: Deadline-closed card + edit/update flow

**Files:**
- Modify: `src/features/rsvp.jsx` (deadline gate before the form return ~line 104; `submit` dupe branch from Task 8)

- [ ] **Step 1: Add the deadline-closed screen**

In `RSVPPage`, immediately after the `if (submitted) { ... }` block (before `return (` at line ~104), add:

```javascript
  if (isRsvpClosed(settings.rsvpDeadlineDate, Date.now())) {
    return (
      <div className="fade-up">
        <section className="block">
          <div className="container container--narrow">
            <div className="card card--pad-lg confirm">
              <div className="confirm__seal">{Icon.check({})}</div>
              <h2 className="confirm__title">RSVPs are now closed</h2>
              <p className="confirm__text">
                Thank you! The RSVP window closed on {settings.rsvpDeadline}. If you still
                need to reach us, please contact the couple directly.
              </p>
              <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                <Button variant="ghost" onClick={() => go("home")}>Back home</Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }
```

- [ ] **Step 2: Turn the dupe dead-end into an update offer**

Change the `submit` signature to accept a force flag (line ~47):

```javascript
  async function submit(e, forceUpdate) {
```

Then replace the dupe branch added in Task 8 (the `if (await rsvpNameTaken(...))` block) with a version that offers an update and, on the update path, calls `upsertRsvp`:

```javascript
      // Duplicate name? Offer to update the existing response instead of blocking.
      // Anon guests can't read their prior row (RLS), so an update overwrites
      // (no pre-fill) via the rsvp_upsert RPC.
      if (!forceUpdate && (await rsvpNameTaken(form.firstName, form.middleName, form.lastName))) {
        setSubmitting(false);
        const wantsUpdate = await confirmDialog({
          title: "You've already RSVP'd",
          message: `${fullName} has already responded. Would you like to update your response?`,
          confirmLabel: "Update it",
        });
        if (wantsUpdate) return submit(e, true);
        go("home");
        return;
      }
      if (forceUpdate) await upsertRsvp(payload);
      else await postRsvp(payload);
```

> This replaces the single `await postRsvp(payload);` line from Task 8 Step 2 as well — the insert now lives in the `else` branch. The rest of the `try` (setSubmitted, scroll) and the `catch`/`finally` are unchanged.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/features/rsvp.jsx
git commit -m "feat: close RSVP form past deadline; offer edit/update on duplicate name"
```

---

## Task 10: Deadline-date input in admin Home settings

**Files:**
- Modify: `src/admin/manage.jsx` (Couple & Event settings, ~lines 1435-1438)

- [ ] **Step 1: Add the datetime input, move Hashtag to its own row**

Replace the field-row containing "RSVP deadline" + "Hashtag" (lines ~1435-1438) with:

```javascript
              <div className="field-row field-row--2">
                <Field label="RSVP deadline (display text)" id="s-rsvp" hint="Shown on the RSVP page"><Input id="s-rsvp" value={f.rsvpDeadline} onChange={set("rsvpDeadline")} /></Field>
                <Field label="RSVP closes at" id="s-rsvpd" hint="After this the form closes. Blank = stays open."><Input id="s-rsvpd" type="datetime-local" value={f.rsvpDeadlineDate || ""} onChange={set("rsvpDeadlineDate")} /></Field>
              </div>
              <Field label="Hashtag" id="s-hash"><Input id="s-hash" value={f.hashtag} onChange={set("hashtag")} /></Field>
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds. (`f` is the settings working copy; `rsvpDeadlineDate` now exists via Task 6, and `set()`/save persist it through `stateToClientRow`'s content spread.)

- [ ] **Step 3: Commit**

```bash
git add src/admin/manage.jsx
git commit -m "feat: admin setting to set the RSVP close date/time"
```

---

## Task 11: Caterer stats summary bar in the admin RSVP panel

**Files:**
- Modify: `src/admin/manage.jsx` (imports near top; `RsvpsAdmin` ~lines 189-265)

- [ ] **Step 1: Import `rsvpStats`**

Near the other `@/lib/...` imports at the top of `src/admin/manage.jsx`, add:

```javascript
import { rsvpStats } from "@/lib/rsvp.js";
```

- [ ] **Step 2: Compute stats in `RsvpsAdmin`**

In `RsvpsAdmin`, right after `const pg = usePaged(filtered, 10);` (line ~207), add:

```javascript
  const stats = React.useMemo(() => rsvpStats(rsvps), [rsvps]);
  const dietSummary = Object.entries(stats.diets).map(([d, n]) => `${n} ${d}`).join(" · ");
```

- [ ] **Step 3: Render the summary bar**

In the returned JSX, immediately after the opening `<div>` of the component's return (line ~265, before the `{/* Status filter as folder tabs ... */}` comment), add:

```javascript
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: "10px 4px 16px", color: "var(--muted)", fontSize: 14 }}>
        <span><strong style={{ color: "var(--ink)" }}>{stats.total}</strong> responses</span>
        <span><strong style={{ color: "var(--ink)" }}>{stats.attendingHeads}</strong> guests coming <span style={{ opacity: 0.7 }}>({stats.attendingParties} parties)</span></span>
        <span><strong style={{ color: "var(--ink)" }}>{stats.maybe}</strong> maybe</span>
        <span><strong style={{ color: "var(--ink)" }}>{stats.declined}</strong> declined</span>
        {dietSummary && <span>Dietary: {dietSummary}</span>}
      </div>
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/admin/manage.jsx
git commit -m "feat: caterer stats bar (heads, maybe, declined, dietary) atop RSVP admin"
```

---

## Task 12: Full verification + deploy

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all tests PASS (the prior 51 plus the new `rsvp.test.js`; none removed).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds, no warnings about missing exports.

- [ ] **Step 3: Manual smoke checklist (`npm run dev`, RSVP page)**

- [ ] Submit with a blank email → succeeds. Submit with `nope` in email → inline "valid email" error, no submit.
- [ ] Set count = 3 → two named-guest inputs appear ("Guest 2", "Guest 3"); names save and show in admin as `+ Name, Name`.
- [ ] In admin Home settings, set "RSVP closes at" to a past datetime, save → RSVP page shows "RSVPs are now closed". Set it blank/future → form returns.
- [ ] RSVP once, then submit again with the same name → "update your response?" dialog → confirm → response overwritten (verify one row, updated values, in the admin panel after reload).
- [ ] Admin RSVP panel shows the stats bar with correct heads / maybe / declined / dietary tallies.

- [ ] **Step 4: Deploy (per CLAUDE.md "deploy always")**

The per-task commits are already on `main`'s working branch. Push:

```bash
git push origin main
```

Then verify via the **CF Pages API** (not the local bundle hash): confirm `latest_deployment.deployment_trigger.metadata.commit_hash` matches the pushed commit and all `stages[].status` are `success`. Then grep a marker in the served bundle, e.g.:

```bash
curl -s https://demo.celebrately.us/assets/index-*.js | grep -o "RSVPs are now closed"
```

Expected: the marker string is present (deploy carried the change).

- [ ] **Step 5: Update the status tracker**

Note in `docs/WEDDING-STATUS.md` that BUG-0004 (blank admin email column) is resolved and the RSVP enhancements shipped.

---

## Self-review notes

- **Spec coverage:** #1 email → Tasks 2,3,7. #3 deadline → Tasks 1,6,9,10. #5 stats → Tasks 1,11. #6 edit → Tasks 4,5,9. #7 plus-one → Tasks 1,8. All five spec features have tasks.
- **Type consistency:** helper names (`isRsvpClosed`, `joinPlusOnes`, `isValidOptionalEmail`, `rsvpStats`) are identical across `src/lib/rsvp.js`, its test, and both consumers. RPC name `rsvp_upsert` and its 14 params match between `0010_rsvp_upsert.sql` and `upsertRsvp()`. `rsvpDeadlineDate` key matches across store default, admin input, and the form gate. `guestNames` (form state) → joined into `plusOne` → `plus_one` column, consistently.
- **Deferred decision resolved:** the spec's "insert vs upsert routing" is settled — new guests use `postRsvp` (plain insert, existing RLS), only the confirmed-update path uses `upsertRsvp`/`rsvp_upsert`.
- **No placeholders:** every code step shows full code; every command has an expected result.
