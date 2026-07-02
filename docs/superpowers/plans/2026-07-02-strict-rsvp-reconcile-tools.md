# Strict RSVP Reconcile Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. (This session: executing inline — subagents disabled by user request.)

**Goal:** Add "Add to list" one-click adoption of unmatched RSVPs and an over-allocation highlight to the Guests admin tab.

**Architecture:** A pure `guestFromRsvp(rsvp)` helper (TDD, `src/lib/guests.js`) builds a guest draft from an RSVP; `GuestsAdmin` renders unmatched RSVPs as actionable rows using the existing `addGuestDb` + `Store.addGuest` + saving-overlay path, and marks Coming cells where the RSVP count exceeds the allocation. No DB/API changes.

**Tech Stack:** React (Vite), Vitest.

---

## File structure

- Modify `src/lib/guests.js` — add `guestFromRsvp`.
- Modify `src/lib/__tests__/guests.test.js` — TDD tests for it.
- Modify `src/admin/manage.jsx` — `GuestsAdmin` unmatched-notice rows + over-allocation mark.

---

## Task 1: `guestFromRsvp` helper (TDD)

**Files:**
- Modify: `src/lib/guests.js`
- Test: `src/lib/__tests__/guests.test.js`

- [ ] **Step 1: Add failing tests**

In `src/lib/__tests__/guests.test.js`, add `guestFromRsvp` to the import and append at the end of the file:

```javascript
describe("guestFromRsvp", () => {
  it("uses name parts and count when present", () => {
    expect(guestFromRsvp({ firstName: "Jeremy", middleName: "P", lastName: "Reyes", count: 3, email: "j@ex.com", status: "attending" }))
      .toEqual({ firstName: "Jeremy", middleName: "P", lastName: "Reyes", allocation: 3, email: "j@ex.com", notes: "" });
  });
  it("splits fullName when parts are missing (first / middle... / last)", () => {
    expect(guestFromRsvp({ fullName: "Maria Luisa Dela Cruz", count: 1 }))
      .toMatchObject({ firstName: "Maria", middleName: "Luisa Dela", lastName: "Cruz" });
    expect(guestFromRsvp({ fullName: "Ana Cruz" })).toMatchObject({ firstName: "Ana", middleName: "", lastName: "Cruz" });
    expect(guestFromRsvp({ fullName: "Prince" })).toMatchObject({ firstName: "Prince", middleName: "", lastName: "" });
  });
  it("defaults allocation to at least 1 and email/notes to empty", () => {
    expect(guestFromRsvp({ fullName: "Tom Okafor", count: 0 })).toMatchObject({ allocation: 1, email: "", notes: "" });
    expect(guestFromRsvp({ fullName: "Tom Okafor" }).allocation).toBe(1);
  });
});
```

Import line becomes:
```javascript
import { normName, namePartsMatch, reconcileGuests, guestFromRsvp } from "@/lib/guests.js";
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/__tests__/guests.test.js`
Expected: FAIL — `guestFromRsvp` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/guests.js`, append:

```javascript
// Build a guest-list draft from an existing RSVP ("Add to list" on unmatched
// RSVPs). Prefers stored name parts; falls back to splitting fullName (first
// token / middle tokens / last token). Their replied party size becomes the
// allocation (min 1).
export function guestFromRsvp(rsvp) {
  const r = rsvp || {};
  let first = (r.firstName || "").trim();
  let middle = (r.middleName || "").trim();
  let last = (r.lastName || "").trim();
  if (!first && !last) {
    const parts = (r.fullName || "").trim().split(/\s+/).filter(Boolean);
    first = parts[0] || "";
    last = parts.length > 1 ? parts[parts.length - 1] : "";
    middle = parts.slice(1, -1).join(" ");
  }
  return {
    firstName: first, middleName: middle, lastName: last,
    allocation: Math.max(1, Number(r.count) || 1),
    email: r.email || "", notes: "",
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/__tests__/guests.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/guests.js src/lib/__tests__/guests.test.js
git commit -m "feat: guestFromRsvp helper (guest draft from an unmatched RSVP)"
```

---

## Task 2: Actionable unmatched-RSVP rows + over-allocation mark

**Files:**
- Modify: `src/admin/manage.jsx` (`GuestsAdmin`, ~lines 224-323; import line for `@/lib/guests.js`)

- [ ] **Step 1: Import the helper**

Change the existing import:
```javascript
import { reconcileGuests } from "@/lib/guests.js";
```
to:
```javascript
import { reconcileGuests, guestFromRsvp } from "@/lib/guests.js";
```

- [ ] **Step 2: Add an adopt handler in `GuestsAdmin`**

Immediately after the `removeGuest(g)` function (ends ~line 259), add:

```javascript
  // "Add to list": create a guest entry straight from an unmatched RSVP. Once
  // inserted, reconcileGuests recomputes and the row leaves the notice.
  async function adoptRsvp(r) {
    try {
      await run(async () => {
        const row = await addGuestDb(guestFromRsvp(r));
        Store.addGuest(row);
      });
      toast("Added to the guest list", "success");
    } catch (e) {
      toast("Couldn't add: " + (e && e.message || "error"), "err");
    }
  }
```

- [ ] **Step 3: Replace the unmatched notice with actionable rows**

Replace:
```javascript
      {recon.unmatchedRsvps.length > 0 && (
        <div className="card" style={{ padding: "12px 16px", marginBottom: 16, border: "1px solid var(--line)", borderRadius: 10, fontSize: 14 }}>
          <strong>{recon.unmatchedRsvps.length}</strong> RSVP{recon.unmatchedRsvps.length > 1 ? "s" : ""} don&rsquo;t match an invited guest: {recon.unmatchedRsvps.map((r) => r.fullName).join(", ")}. Add them, or fix a name spelling.
        </div>
      )}
```
with:
```javascript
      {recon.unmatchedRsvps.length > 0 && (
        <div className="card" style={{ padding: "12px 16px", marginBottom: 16, border: "1px solid var(--line)", borderRadius: 10, fontSize: 14 }}>
          <div style={{ marginBottom: 8 }}>
            <strong>{recon.unmatchedRsvps.length}</strong> RSVP{recon.unmatchedRsvps.length > 1 ? "s" : ""} don&rsquo;t match an invited guest — add them, or fix a name spelling:
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {recon.unmatchedRsvps.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span><strong>{r.fullName}</strong>{r.status === "attending" && r.count > 0 ? <span style={{ color: "var(--muted)" }}> · {r.count} {r.count > 1 ? "guests" : "guest"}</span> : null}</span>
                <Button variant="ghost" size="sm" onClick={() => adoptRsvp(r)}>Add to list</Button>
              </div>
            ))}
          </div>
        </div>
      )}
```

- [ ] **Step 4: Over-allocation mark on the Coming cell**

Replace the Coming cell:
```javascript
                    <td>{x.status === "attending" ? x.rsvp.count : "—"}</td>
```
with:
```javascript
                    <td>{x.status === "attending"
                      ? (Number(x.rsvp.count) > Number(g.allocation)
                        ? <span style={{ color: "var(--danger, #a33)", fontWeight: 700 }} title="More than the allocated seats">{x.rsvp.count} <span style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase" }}>over</span></span>
                        : x.rsvp.count)
                      : "—"}</td>
```

- [ ] **Step 5: Verify build + full tests**

Run: `npm run build && npm test`
Expected: build succeeds; all tests pass (117 after Task 1).

- [ ] **Step 6: Commit**

```bash
git add src/admin/manage.jsx
git commit -m "feat: adopt unmatched RSVPs into the guest list + over-allocation mark"
```

---

## Task 3: Verify + deploy

- [ ] **Step 1: Full suite + build** — `npm test && npm run build` → all green.
- [ ] **Step 2: Manual smoke** (`npm run dev`): unmatched RSVP shows its own row + "Add to list"; click → guest appears, notice row gone, status matched; guest with allocation < attending count shows "N over" in Coming.
- [ ] **Step 3: Tracker** — add a Done entry (Enhancement 0006) to `docs/WEDDING-STATUS.md`.
- [ ] **Step 4: Push + verify** — `git push origin main`; confirm via CF Pages API (commit + stages success); grep served bundle for `Add to list`.

---

## Self-review notes

- Spec coverage: helper → T1; actionable notice → T2 steps 2-3; over-alloc mark → T2 step 4; testing/deploy → T1 TDD + T3. Full.
- Type consistency: `guestFromRsvp` returns exactly the `GuestForm`/`addGuestDb` field shape (`firstName/middleName/lastName/allocation/email/notes`); `adoptRsvp` uses the same insert pattern as `saveGuest` (addGuestDb → Store.addGuest inside `run`).
- `Button` supports `size="sm"` (used by AdminDashboard "View all"). `r.id` exists on both server rows and local echoes (uid).
- No placeholders.
