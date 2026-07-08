# Support Ticket Widget — Design

**Date:** 2026-07-08
**Goal:** Let a client (site owner) submit a help ticket from their admin console via a sticky floating "agent" button; the superadmin sees, tracks, and resolves tickets in the console.

## Decisions (brainstorming)
- **Placement:** Owner admin console only (logged-in owner). **Gated to the demo client for now** — the launcher renders only when the active client subdomain is `demo`; flip that single guard to roll out to all owners later.
- **Superadmin handling:** New "Support" view — list + status (Open/Resolved) + internal reply note. Owner sees their own tickets' status.
- **Notify:** In-console `SuperNotificationBell` + realtime (no email).

## Data — `support_tickets`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `created_at` | timestamptz | default now() |
| `client_id` | uuid → clients(id) | the owner's client (from their profile) |
| `submitter_email` | text | snapshot from auth |
| `submitter_name` | text | couple-names snapshot (nullable) |
| `subject` | text NOT NULL | short summary |
| `category` | text NOT NULL | Question \| Bug \| Design change \| Billing \| Other |
| `urgency` | text NOT NULL | Low \| Normal \| High (default Normal) |
| `message` | text NOT NULL | details |
| `context_url` | text | auto: subdomain + admin tab at submit time |
| `status` | text NOT NULL | open \| resolved (default open) |
| `admin_note` | text | superadmin internal reply/notes (nullable) |
| `resolved_at` | timestamptz | set when status → resolved |

**RLS (migration 0026):**
- Owner: `INSERT` where `client_id` = their `profiles.client_id`; `SELECT` own client's rows only.
- Superadmin: `SELECT` + `UPDATE` all (status/admin_note/resolved_at).
- Anon / other: denied (RLS default).
- Add to the realtime publication (same as `site_requests`) so the console bell updates live.
- `UPDATE` is superadmin-only — owners cannot change status or read `admin_note` of others (their own SELECT still returns their `admin_note`, which is fine — it's the reply meant for them).

## Architecture (isolated units)
1. **`src/lib/mappers.js` — `ticketToRow(form, clientId, auth)`** (pure): form → insert row (snapshots email/name/context, defaults). Unit-tested.
2. **`src/lib/api.js`**
   - `submitTicket(form)` — owner insert via `ticketToRow`.
   - `listTickets()` — superadmin select all (RLS-gated).
   - `setTicketStatus(id, status)` / `updateTicket(id, patch)` — superadmin update; stamps `resolved_at`.
   - `subscribeTicketsRealtime(cb)` — channel like `subscribeSiteRequestsRealtime`.
3. **`src/admin/SupportWidget.jsx`** — the sticky launcher + form modal (owner side).
   - Fixed launcher button (bottom-right): inline **agent SVG avatar** (headset persona, console-neutral) + "Need help?" label; a small **×** collapses it to a bubble for the session (sessionStorage).
   - Click → opens the form in the existing **`Modal`** (handles admin iOS scroll-lock correctly — avoids the fixed-input bug from CLAUDE.md). Fields: subject, category (Select), urgency (Select), message (Textarea). Submit → busy state (disabled + label swap, per the loading-feedback rule) → success toast, close.
   - Rendered from the AdminApp shell, **only when** `role === "owner"`-or-superadmin-viewing AND active subdomain === `demo` (demo-only gate).
4. **Superadmin "Support" view** in `superadmin.jsx` — new folder tab `support` with an open-count badge: table (couple/subdomain · subject · category · urgency · status · date). Row → detail modal: full message, `admin_note` textarea, Open/Resolved toggle, Save. Loading states on save.
5. **`SuperNotificationBell`** — include open-ticket count; subscribe to `support_tickets` realtime.

## Data flow
Owner fills form → `submitTicket` → RLS insert → realtime → superadmin bell + Support list. Superadmin resolves → `setTicketStatus` → owner's list shows Resolved.

## Error handling
- Insert failure → error toast, form stays open (no data loss).
- Missing required (subject/message) → inline validation before submit.
- List/update failure → toast; never crash the console.
- Demo gate absent/other client → widget simply doesn't render.

## Testing
- **RLS simulation** (Supabase `execute_sql`, rolled back): owner inserts own ✓; owner reading another client's ticket → 0 rows; anon insert/select → denied; superadmin reads all ✓.
- **`ticketToRow`** unit tests: snapshots, defaults (status=open, urgency=Normal), context string.
- **Smoke render**: `SupportWidget` (demo) + superadmin Support view mount without crashing (uses the render-crash safety net).

## Out of scope
- Email replies / threads (chose in-console note).
- Guest/public submissions (owner-only).
- File attachments.

## Files
- Create: `supabase/migrations/0026_support_tickets.sql`, `src/admin/SupportWidget.jsx`, tests.
- Modify: `src/lib/api.js`, `src/lib/mappers.js`, `src/admin/manage.jsx` (mount widget), `src/admin/superadmin.jsx` (Support view), `SuperNotificationBell`.
