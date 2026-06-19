# Event Website Platform — Design Spec

**Date:** 2026-06-20
**Status:** Draft for review
**Author:** Jeremy (with Claude)

---

## 1. Summary

A multi-tenant event-website platform. The first build is the author's own wedding,
which doubles as instance #1 and the sales showcase. The platform is then sold per
client across event types (weddings, birthdays, corporate events).

The operator (superadmin) creates each client and assigns them a pre-built theme.
Event owners and guests have accounts. Guests post public guestbook messages.

An existing client-side React prototype ("Evermore") already implements most of the
UI, theme engine, and guest pages using `localStorage`. This project migrates that
prototype to a real stack with persistence, authentication, and multi-tenancy.

---

## 2. Goals

- Ship the author's wedding site (v1) on a free, production-grade stack.
- Reuse the existing Evermore UI/theme/design work wherever possible.
- One codebase + one deployment serving many clients (target ~300).
- Free hosting and free database to start; pay only once at real revenue scale.
- Each client gets a visually distinct, pre-built theme (assigned by superadmin).
- Each client gets a permanent, no-expiry URL.

## 3. Out of scope (v1)

- Guest photo/video uploads (media wall) — **phase 2** (adds Cloudflare R2).
- Client self-serve theme editing — superadmin assigns themes in v1.
- Payments/billing — manual invoicing for the first clients.
- Native mobile app, AI photo tagging, face recognition, SMS, multi-language.

## 4. Users & roles

| Role | Who | Can do |
|---|---|---|
| **Superadmin** | Operator (you) | Create clients, assign themes, manage/moderate any client, global view |
| **Event owner** | Couple / client | Manage own event content, moderate own guestbook/RSVP |
| **Guest** | Attendee | Account; RSVP; post guestbook; take quiz; view own client's site |

Role scoping is enforced at the database layer via Supabase Row-Level Security (RLS),
not only in the UI.

## 5. Architecture

```
Browser (Vite + React SPA, served by Cloudflare Pages)
   │  reads hostname  →  client_id
   ▼
Supabase  (Postgres + Auth + RLS)        ← all reads/writes, scoped by client_id
   │
   └─ (phase 2) Cloudflare R2  for media files; links stored in Supabase
Resend            → transactional email (RSVP confirm, magic-link login)
Cloudflare Turnstile → spam protection on public forms
Cloudflare Worker (cron) → keep-alive ping so Supabase free tier never idle-pauses
```

- **Frontend:** Vite + React SPA. Chosen because the existing prototype is already a
  React SPA — this maximizes reuse and is the most Cloudflare-friendly build (plain
  static output, no adapter).
- **Hosting:** Cloudflare Pages (free tier allows commercial use, unlimited custom
  domains, no idle-pause, unlimited bandwidth).
- **Data + Auth:** Supabase (managed Postgres, built-in Auth, RLS). RLS handles the
  multi-tenant + multi-role security boundary, which is the highest-risk part of the
  app and the main reason to use Supabase over a hand-rolled auth layer.
- **Server functions (as needed):** Cloudflare Pages Functions / Workers.

## 6. Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **Vite + React** | Reuses existing Evermore React code |
| Routing | **React Router** | Replaces current hash router |
| Hosting | **Cloudflare Pages** | Free, commercial-OK, no pause |
| Database | **Supabase Postgres** | Free tier; 500 MB is ample for text data |
| Auth | **Supabase Auth** | Magic link + Google; low guest friction |
| Security | **Row-Level Security** | Per-tenant + per-role enforcement |
| Email | **Resend** | RSVP confirm, magic-link mail (free 3k/mo) |
| Spam | **Cloudflare Turnstile** | On RSVP/guestbook forms |
| QR codes | `qrcode-generator` (already used) | Client-side, no service |
| Media (phase 2) | **Cloudflare R2** | 10 GB free, no egress fees |
| Keep-alive | **Cloudflare Cron Worker** | Defeats Supabase idle-pause for $0 |

## 7. Data model (Supabase / Postgres)

```
clients
  id            uuid pk
  subdomain     text unique           -- e.g. "johnandjane"
  custom_domain text unique null
  event_type    text                  -- wedding | birthday | corporate
  template_key  text                  -- references a theme defined in code
  theme         jsonb                  -- color/font overrides (Tweaks)
  content       jsonb                  -- names, dates, story, schedule, venue, etc.
  is_active     boolean default true
  created_at    timestamptz default now()

profiles                              -- 1:1 with auth.users
  id            uuid pk references auth.users(id)
  role          text                  -- superadmin | owner | guest
  client_id     uuid null references clients(id)   -- owners/guests are scoped to one
  display_name  text

rsvps
  id, client_id fk, name, email, phone, attending bool,
  party_size int, dietary text, notes text, created_at

guestbook
  id, client_id fk, author_id fk null, name, message,
  status text default 'pending',      -- pending | approved | hidden
  created_at

quiz_answers
  id, client_id fk, author_id fk null, name, score int, answers jsonb, created_at
  -- quiz QUESTIONS live in clients.content (authored per client)

media   (phase 2)
  id, client_id fk, author_id fk null, r2_key text, kind text,
  status text, created_at
```

**Templates are code, not data.** `template_key` points at a theme defined in the
codebase (ported from `themes.jsx`). The superadmin picks a key per client; theme
tweaks (accent/fonts) layer on top via `clients.theme`.

## 8. Multi-tenancy & domains

- Each request resolves the client from the **hostname** (`johnandjane.celebrate.app`
  → `clients.subdomain = "johnandjane"`), then loads that client's row.
- **Default URL:** one domain the operator owns (~$12/yr) with a wildcard
  `*.celebrate.app` attached to the single Cloudflare Pages project. Every client gets
  a free, permanent subdomain. Scales to 300+ at no per-client cost.
- **Optional custom domain:** a client may bring their own `.com` (their annual cost);
  it is attached to the same Pages project for free.
- **No-expiry note:** "permanent, free" applies to subdomains. A registered TLD domain
  inherently renews annually — that is unavoidable and is the client's cost when they
  want their own.

## 9. Auth & RLS

- Supabase Auth with **magic link** (email) and **Google** — passwordless to reduce
  guest signup friction.
- A `profiles` row carries `role` and `client_id`.
- RLS policy intent:
  - **guest:** read their own client's public content; insert `rsvps` / `guestbook` /
    `quiz_answers` scoped to that client; read their own rows.
  - **owner:** full read/write on rows where `client_id` = their client; moderate
    guestbook (set status).
  - **superadmin:** unrestricted across all clients.
- The Supabase anon key ships in the browser; therefore **RLS is the real security
  boundary** and must be written and tested before any real data exists.

## 10. Reuse & migration of the existing prototype

The current `Evermore` prototype (React via in-browser Babel, `localStorage` state,
single-tenant) is migrated, not discarded.

**Reuse near as-is:** `styles.css`, `themes.jsx` (the theme engine), `assets/`, the
component JSX (Button/Modal/Countdown/etc.), and page layouts (home, story, details,
schedule, venue, rsvp, gallery, guestbook, quiz, envelope hero).

**Refactor (mechanical):** convert the 12 `.jsx` files from shared globals/`window.*`
to ES modules (import/export) so Vite can build them; replace the hash router with
React Router.

**Rewrite (the core work):**
1. `store.jsx` `localStorage` → Supabase queries (every read/write).
2. Fake `adminPassword` → Supabase Auth + the three roles.
3. Single-tenant globals → multi-tenant (data scoped by `client_id`, resolved by
   subdomain, enforced by RLS).

## 11. Hosting & deployment

- GitHub repo → Cloudflare Pages, auto-deploy on push.
- Build command `npm run build`; output `dist`.
- Env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TURNSTILE_SITE_KEY`,
  `RESEND_API_KEY` (server-side only).
- A Cloudflare Cron Worker pings Supabase every few days so the free tier never
  idle-pauses.

## 12. Cost

| When | Cost |
|---|---|
| Author's wedding / early clients | **$0** (+ ~$12/yr for one platform domain) |
| Real scale (>~100k users or >500 MB data) | Supabase Pro ~$25/mo |
| Hosting (Cloudflare), any scale | $0 |

## 13. Risks & mitigations

- **Supabase idle-pause** (free tier sleeps after ~7 days) → keep-alive cron Worker.
- **Security via RLS** — anon key is public; an RLS mistake exposes cross-tenant data.
  Mitigation: write RLS first, test each role explicitly, do not hand-roll auth.
- **Migration effort** — the `store.jsx` → Supabase rewrite is the largest task and
  touches every feature; plan it as its own milestone.
- **Free domain myth** — no reliable way to own a real domain for free; budget the
  ~$12/yr and avoid Freenom-style TLDs.

## 14. v1 acceptance criteria

- Author's wedding site is live on Cloudflare under a subdomain.
- A guest can sign in, RSVP, post a guestbook message (visible after approval), and
  take the quiz.
- An event owner can sign in and moderate their guestbook / view RSVPs.
- The superadmin can create a client and assign a theme to it.
- All data persists in Supabase and is correctly scoped per client (RLS verified with
  a second test client — no cross-tenant leakage).

## 15. Phasing

- **Phase 1 (this spec):** wedding v1 + multi-tenant foundation + 3 roles + assign-theme.
- **Phase 2:** guest media wall (Cloudflare R2 + upload flow + moderation).
- **Phase 3:** client self-serve content/theme editing + Stripe billing.

---

## Open items

None blocking. Templates already exist as the `themes.jsx` engine in the current repo
and are reused directly.
