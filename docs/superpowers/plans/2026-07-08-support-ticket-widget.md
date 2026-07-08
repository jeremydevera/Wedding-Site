# Support Ticket Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (subagents are disabled in this project — inline execution). Steps use `- [ ]`.

**Goal:** Sticky "agent" help button in the owner admin (demo-gated) that files a `support_tickets` row; superadmin lists/resolves tickets with a reply note; console bell pings on new tickets.

**Architecture:** New RLS-gated `support_tickets` table (owner insert/select own; superadmin select/update all; realtime). Pure `ticketToRow` mapper → `api.js` fns → `SupportWidget` launcher+Modal (owner) + superadmin "Support" folder view + bell count.

**Tech Stack:** Supabase (Postgres RLS, realtime), React, existing `Modal`/`Field`/`Select`/`Textarea`/`Button`/`toast`.

---

### Task 1: Table + RLS (migration 0026)

**Files:** Create `supabase/migrations/0026_support_tickets.sql`

- [ ] **Step 1: Author migration** — table per spec; RLS: owner insert/select own client (via `profiles.client_id`), superadmin (`profiles.role='superadmin'`) select+update all; add to `supabase_realtime` publication.
- [ ] **Step 2: Apply** via `mcp__supabase__apply_migration` name `support_tickets`.
- [ ] **Step 3: Verify RLS** (rolled-back `execute_sql`): seed a client + owner profile; owner inserts own → ok; select other client → 0 rows; anon → denied; superadmin select → all.

### Task 2: `ticketToRow` mapper (TDD)

**Files:** Modify `src/lib/mappers.js`; Test `src/lib/__tests__/ticketMapper.test.js`

- [ ] **Step 1 (RED):** test `ticketToRow({subject,category,urgency,message}, "c1", {email,partnerA,partnerB,subdomain,tab})` → `{client_id:"c1", submitter_email, submitter_name:"A & B", subject, category, urgency:"Normal" default, message, context_url:"demo /home", status:"open"}`.
- [ ] **Step 2:** run → fail.
- [ ] **Step 3 (GREEN):** implement mapper (snapshots, defaults status=open, urgency||"Normal", name from partnerA/partnerB filter+join " & ").
- [ ] **Step 4:** run → pass.
- [ ] **Step 5:** commit.

### Task 3: api.js functions

**Files:** Modify `src/lib/api.js`

- [ ] `submitTicket(form)` — `supabase.from("support_tickets").insert(ticketToRow(form, Store.get().clientId, {...auth, subdomain, tab}))`.
- [ ] `listTickets()` — select all order created_at desc.
- [ ] `setTicketStatus(id, status)` — update `{status, resolved_at: status==="resolved"? new Date().toISOString(): null}`.
- [ ] `updateTicket(id, patch)` — update patch (admin_note).
- [ ] `subscribeTicketsRealtime(cb)` — copy `subscribeSiteRequestsRealtime`, table `support_tickets`, channel `sa-support`.
- [ ] Commit.

### Task 4: SupportWidget (owner, demo-gated)

**Files:** Create `src/admin/SupportWidget.jsx`; Modify `src/admin/manage.jsx` (mount)

- [ ] Agent SVG avatar (headset) inline; fixed launcher bottom-right + "Need help?"; × collapses to bubble (sessionStorage `evermore_support_dismissed`).
- [ ] Click → `Modal` form: subject (Input), category (Select), urgency (Select), message (Textarea). Validate subject+message. Submit → busy (disabled + "Sending…") → `submitTicket` → toast success + close; error → toast, stay open.
- [ ] Mount in AdminApp shell **inside `<main>`** (near line 3537) when `clientId && resolveSubdomain()==="demo"`.
- [ ] Commit.

### Task 5: Superadmin Support view + bell

**Files:** Modify `src/admin/superadmin.jsx`, `src/admin/manage.jsx` (SuperNotificationBell)

- [ ] Load tickets in superadmin `load()` (`listTickets`, guard try/catch); add `support` folder button with open-count badge; realtime via `subscribeTicketsRealtime`.
- [ ] `view==="support"` table (couple/subdomain·subject·category·urgency·status·date) → detail Modal: message, `admin_note` Textarea, Open/Resolved toggle, Save (busy state) → `updateTicket` + `setTicketStatus`.
- [ ] `SuperNotificationBell`: also fetch `listTickets`, add open tickets to items + count.
- [ ] Commit.

### Task 6: Smoke tests + ship

**Files:** Modify `src/pages/__tests__/*` or new `src/admin/__tests__/supportWidget.test.jsx`

- [ ] Smoke-render `SupportWidget` (demo store) without crash; superadmin Support view mounts.
- [ ] `npm test` (all green) + `npm run build`.
- [ ] Commit + push; verify deploy (CF API commit+stages) + marker in served bundle.

## Self-review
- Spec coverage: table/RLS (T1), mapper (T2), api incl realtime (T3), widget+demo gate (T4), superadmin view+bell (T5), tests+deploy (T6). ✓
- Names consistent: `support_tickets`, `ticketToRow`, `submitTicket/listTickets/setTicketStatus/updateTicket/subscribeTicketsRealtime`. ✓
- Demo gate = `clientId && resolveSubdomain()==="demo"`. ✓
