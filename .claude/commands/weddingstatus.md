---
description: Show pending wedding-site bugs & enhancements (action, plan, severity); add new ones
---

The bug/enhancement tracker lives at `docs/WEDDING-STATUS.md`. Read it first.

## If the user typed text after `/weddingstatus` (a new bug or enhancement)
Add it to the tracker before rendering:
1. Decide the **type** — Bug or Enhancement — from the text.
2. Assign the next ID from the "Next IDs" block (zero-padded 4 digits), then increment that counter in the file.
3. **Severity:** use what the user said (P1/P2/P3). If unstated, default **P2**; only ask if genuinely ambiguous.
4. If **you (Claude) found it** via testing or a scheduled run — not the user dictating it — prefix the title with `[APPROVAL]` so the user can validate it first.
5. Write a new block under `## Pending` with: Severity, Status: `Pending`, Added: today's date, **Where** (exact nav path), **Action** (one plain sentence), **Plan** (one plain sentence).
6. Save `docs/WEDDING-STATUS.md`.

## Always render the status report
Show all **Pending / In Progress / Deferred** items (skip `Done` unless the user asks for history). Group by severity — **P1 first, then P2, then P3**. For each item:

```
Bug ID: NNNN - <title>          (or)   Enhancement ID: NNNN - <title>
  Where:    <exact nav path, e.g. Admin → Settings → Venue>
  Action:   <one short, plain sentence — what's wrong / what to do>
  Plan:     <one short, plain sentence — the fix>
  Severity: P1|P2|P3 · Status: <status>
```

- Keep Action/Plan **simple and non-technical**; always include a **Where** nav path.
- Keep `[APPROVAL]` in any title that has it.
- End with a one-line summary: counts by severity + how many await `[APPROVAL]`.

## Notes
- Done items stay in the `## Done / History` section as the permanent record — never delete them; move an item there (with the commit/date) when it ships.
- This file is the source of truth and is committed to the repo so the history survives across sessions.
