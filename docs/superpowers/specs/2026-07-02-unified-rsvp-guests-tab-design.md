# Unified RSVPs/Guests Tab — Design + Plan

**Date:** 2026-07-02 · **Status:** Approved in conversation ("okay looks good")

## Goal

One sidebar tab ("RSVPs") instead of two. The tab adapts to the Strict RSVP switch:
- **Strict OFF** → today's RsvpsAdmin exactly (open form, replies table, All/Yes/Maybe/No,
  search, CSV, email results, detail, delete). No guest-list UI anywhere.
- **Strict ON** → today's GuestsAdmin (guest-list-first: tiles, All/Replied/Outstanding/
  Unmatched) **plus a new "Replies" folder** that renders the full classic RsvpsAdmin, so
  enabling strict never costs the reply tools (CSV/email/detail/delete/songs/diets).

Status semantics (confirmed with owner): reply statuses map 1:1 — Yes=Attending,
Maybe=Maybe, No=Declined — and strict mode adds the fourth state "No reply"
(Outstanding), which the open mode cannot have. Replied/Outstanding lumping kept;
per-status slicing lives in the Replies folder.

## Changes (single file: `src/admin/manage.jsx` + tab registration)

1. `ADMIN_TABS`: remove the `guests` entry (tab merged away).
2. `AdminApp`: remove the `if (!settings.strictRsvp) tabs = tabs.filter(...)` gating line
   (nothing to gate — the one tab adapts).
3. Routing: `{activeTab === "rsvps" && (settings.strictRsvp ? <GuestsAdmin /> : <RsvpsAdmin />)}`;
   delete the `guests` route.
4. `GuestsAdmin`: folder tabs become All / Replied / Outstanding / Unmatched / **Replies**
   (`counts.replies = rsvps.length`). When the Replies folder is active, render
   `<RsvpsAdmin />` below the folders (its own sub-folders/toolbar/modals compose like the
   Settings/Quiz sub-tab pattern); otherwise render the existing guests panel. Summary
   tiles stay visible on all folders. The GuestForm modal stays mounted regardless.

No DB/API/store changes. Existing tests unaffected (the guests tab was strict-gated and
default-off, so no test asserts it).

## Verify

Build + full suite green; deploy; served-bundle marker `"replies"` folder key; manual:
strict off → classic tab; strict on → tiles + 5 folders; Replies folder shows classic
table with CSV/email intact; sidebar has no Guests item in either mode.
