# RSVP Middle-Name Initial-Match Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development). Steps use `- [ ]` checkboxes.

**Goal:** Stop two *different, both-full* middle names that share a first letter (e.g. `Ana` vs `Alma`) from matching in strict RSVP. Only match middles when they are equal, one side is empty (wildcard), or one side is a single initial of the other.

**Architecture:** The name-match logic exists in TWO places. The client (`src/lib/guests.js` `middleMatches`) is ALREADY correct (has the `length === 1` guard). The Postgres SECURITY DEFINER RSVP functions are WRONG — their 4th clause `left(norm(a),1) = left(norm(b),1)` has no length guard, so any two same-initial middles match. Fix = align the DB to the client via one new forward migration that `CREATE OR REPLACE`s the current version of each affected function with the guarded clause.

**Tech Stack:** Postgres (Supabase), plpgsql; verified via `mcp__supabase__execute_sql` simulation. No frontend change.

---

## Impact analysis (read first)

### The defect
- **DB (wrong)** — clause today:
  ```sql
  or left(public.norm_name(a), 1) = public.norm_name(b) ... -- i.e. left(a,1)=left(b,1), NO length guard
  ```
  → `Ana` vs `Alma` both normalize non-empty, both start `a` → **match**. Wrong.
- **Client (correct)** — `guests.js` `middleMatches`:
  ```js
  if (x[0] === y[0] && (x.length === 1 || y.length === 1)) return true; // initial only when ONE side is a single letter
  ```
  → `Ana` vs `Alma` → no match. Right.

So today: client reconcile says "no match / no reply", the DB gate ACCEPTS the submission → **client/DB disagreement** on top of the wrong accept.

### Blast radius (functions carrying the unguarded clause — current versions)
- `rsvp_guard` — **the gate** (0018). Wrong ACCEPT happens here. MUST fix.
- `rsvp_guest_allocation` — pre-submit allocation/ambiguity RPC (current: 0014, re-touched 0017). Fix so ambiguity detection matches the gate.
- `rsvp_upsert` — upsert path (current: 0015).
- `rsvp_name_taken` — duplicate-name detection (current: 0008).
- (Client `middleMatches` already correct — **no change**.)

### What changes for users after the fix
| Case | Before | After | Correct? |
|---|---|---|---|
| `Maria Ana Santos` vs `Maria Ana Santos` (equal) | match | match | ✅ unchanged |
| `Maria A Santos` (list) vs `Maria Ana Santos` (rsvp) — initial vs full | match | match | ✅ unchanged (one side len 1) |
| `Maria` (no middle) vs `Maria Cruz` — wildcard | match | match | ✅ unchanged |
| `Maria Ana Santos` vs `Maria Alma Santos` — two full, same initial | match (BUG) | **no match** | ✅ fixed |
| `Maria Ana` vs `Maria Bea` — different initial | no match | no match | ✅ unchanged |

### Risk of fixing
- **Low.** The only behavior that changes is the exact bug case (two full different middles, same first letter). Every legitimate match (equal / initial-vs-full / wildcard) is preserved.
- **Who could be surprised:** a guest whose list entry and reply have different full middles sharing an initial and who currently sneaks in. After the fix they get "not on the guest list" — which is the intended strict behavior; owner adds/edits the guest to resolve.
- **Fewer false ambiguities:** tightening removes spurious matches, so `rsvp_guest_allocation`'s "ambiguous" state fires less often (net improvement).
- **No data migration**; no rewrite of existing `rsvps` rows. Only future match decisions change.
- **No app rebuild / CF deploy** needed (DB-only). Client already correct.
- **Idempotent & reversible:** `CREATE OR REPLACE FUNCTION` — re-runnable; revert by replacing back.

### Deployment
One new migration `supabase/migrations/0024_rsvp_middle_initial_guard.sql`, applied to prod via `mcp__supabase__apply_migration`. Verify with a simulated insert (Ana vs Alma → reject; Ana vs A → accept).

---

## The guarded clause (used identically in every function)

Replace the middle-match OR-group with:
```sql
(
  public.norm_name(<A>) = public.norm_name(<B>)
  or public.norm_name(<A>) = ''
  or public.norm_name(<B>) = ''
  or (
    (length(public.norm_name(<A>)) = 1 or length(public.norm_name(<B>)) = 1)
    and left(public.norm_name(<A>), 1) = left(public.norm_name(<B>), 1)
  )
)
```
where `<A>`/`<B>` are the guest-side and rsvp-side middle expressions used in that function.

---

## Task 1: Reproduce the bug at the DB level (RED)

**Files:** none (verification via MCP `execute_sql` against prod, in a rolled-back transaction).

- [ ] **Step 1: Prove the wrong ACCEPT exists today.** Create a temp client + two guests (`Maria Ana Santos` alloc 1, and NO `Alma`), then simulate the strict path for an rsvp `Maria Alma Santos`. Expected TODAY: `rsvp_guard` finds the `Ana` row via the same-initial clause and does NOT reject → demonstrates the bug. Run inside `begin; … rollback;`.

## Task 2: Author the migration (GREEN)

**Files:** Create `supabase/migrations/0024_rsvp_middle_initial_guard.sql`

- [ ] **Step 1:** For each current function — `rsvp_guard` (from 0018), `rsvp_guest_allocation` (from 0014, honoring any 0017 changes), `rsvp_upsert` (from 0015), `rsvp_name_taken` (from 0008) — copy its LATEST full body and replace only the middle-match OR-group with the guarded clause above. Keep everything else (SECURITY DEFINER, `set search_path`, signatures, grants/revokes) identical.
- [ ] **Step 2:** Also add `set search_path = public` to `norm_name` if still missing (audit-3 bug #11) — safe to include here.

## Task 3: Apply + verify (GREEN)

- [ ] **Step 1:** `mcp__supabase__apply_migration` name `rsvp_middle_initial_guard`.
- [ ] **Step 2:** Re-run the Task-1 simulation. Expected AFTER: `Maria Alma Santos` → **reject** "This name is not on the guest list"; `Maria A Santos` (initial) → still matches `Maria Ana Santos`; wildcard + exact still match.
- [ ] **Step 3:** Confirm no other function still contains an unguarded `left(...,1) = left(...,1)` (grep the DB via `pg_get_functiondef`).

## Task 4: Commit

- [ ] `git add supabase/migrations/0024_rsvp_middle_initial_guard.sql && git commit -m "fix: strict RSVP middle match — same-initial only when one side is an initial"`

---

## Self-review notes
- Client needs no change (already guarded) — do NOT touch `guests.js` `middleMatches`.
- The fix reduces matches; it can never widen them, so it cannot create a NEW wrong-accept.
- `norm_name` accent-stripping (audit-3 #10/scenario 10) is a SEPARATE issue — not in scope here.
