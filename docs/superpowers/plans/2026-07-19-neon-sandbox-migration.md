# Neon sandbox migration — "USE NEON DATABASE" toggle

**Goal:** develop the Supabase→Neon migration on `sandbox.celebrately.us` behind a
superadmin Settings toggle **USE NEON DATABASE**. When ON, the *sandbox client only*
reads/writes Neon (Data API + Neon Auth + RLS). Demo/www/all real clients stay on
Supabase untouched. Architecture decision (owner, 2026-07-19): **straight to
Neon Data API + Neon Auth** (no interim server-proxy).

## Infra — DONE (2026-07-19, via Neon MCP)

- Neon project **celebrately** `proud-sound-95226693`, AWS **ap-southeast-1**, PG 18,
  scale-to-zero, free plan (512 MB limit).
- **Neon Auth** (Managed Better Auth) provisioned:
  - Auth URL: `https://ep-long-credit-aztdmow3.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth`
  - JWKS: `…/auth/.well-known/jwks.json`
  - Interactive tester: append `/reference` to the Auth URL.
- **Data API** (PostgREST) provisioned, validates Neon Auth JWTs:
  - `https://ep-long-credit-aztdmow3.apirest.c-3.ap-southeast-1.aws.neon.tech/neondb/rest/v1`
- **Schema ported** (92-statement transaction, all green): 11 tables, 11 functions,
  4 triggers, RLS on everything, 36 policies, grants for `authenticated` + `anonymous`.
- **Sandbox client seeded** with the SAME uuid as Supabase
  (`136387a6-2f73-43aa-a92c-21f66e552c88`, subdomain `sandbox`) so the toggle
  targets one client id on both backends.

## Port decisions (differ from Supabase — remember these)

- `auth.uid()` → **`auth.user_id()`** (JWT `sub` as *text*; Neon's `auth.uid()` exists
  but parses sub as uuid → NULL for Better Auth ids).
- **`profiles.id` is TEXT** (Better Auth user id), not uuid. Same for
  `guestbook.author_id`, `quiz_answers.author_id`, `email_send_log.user_id`.
  No FK to an auth.users table (Neon Auth lives in `neon_auth` schema).
- `rsvp_guard`'s Supabase `auth.role() in ('authenticated','service_role')` bypass →
  exception-safe `auth.user_id() is not null` check.
- Roles: `authenticated` (JWT) and `anonymous` (no JWT). Guests = anonymous; grants:
  SELECT clients/guestbook/app_config, INSERT rsvps/guestbook/quiz_answers,
  EXECUTE rsvp fns. `db_size_bytes()` = authenticated only.
- **Dropped:** `handle_new_user` trigger (was on Supabase `auth.users`). Profile rows
  must be created by app on first login OR manually. Superadmin bootstrap: sign up via
  Neon Auth, then `insert into profiles (id, role) values ('<better-auth-user-id>', 'superadmin')`.

## Known gaps (phase 3 or accepted)

- **Realtime**: none on Neon. Sandbox admin feed/bells degrade to manual refresh or polling.
- **site_requests INSERT** was via Supabase edge fn (service role) — not ported; sandbox
  doesn't need the /apply intake.
- Email-results path (`email_send_log` + /api/send-email) checks Supabase JWT — phase 2.
- **Schema cache**: Data API caches schema; after any DDL click **Refresh schema cache**
  (Neon console → Data API page). Tables were created after provisioning → needs one refresh
  before first REST call.

## Remaining work (frontend) — NOT started

1. **Client lib**: `npm i @neondatabase/neon-js` (supabase-js-style: `.from()`, `.rpc()`,
   `client.auth.*`; auto-injects Neon Auth JWT). ⚠️ published 0.6.2-beta needs the
   two-URL object form (`createClient({ auth: {url: AUTH_URL}, dataApi: {url: DATA_API_URL} })`
   — check SDK reference for exact shape) rather than single-URL form.
2. **SA Settings toggle** "USE NEON DATABASE (sandbox)" → Supabase `app_config`
   (same pattern as AUTO APPROVE flag). Supabase stays control plane; no chicken-egg.
3. **api.js adapter**: when `subdomain === 'sandbox'` AND flag on → route data calls
   through the neon-js client; else existing supabase path. Keep the mapper layer shared.
4. **Auth swap on sandbox**: login/session via Neon Auth (`client.auth`), sign up the
   superadmin, insert superadmin profile row (see bootstrap above).
5. **Health tab**: add Neon gauge — Neon API `GET /projects/{id}` fields
   `synthetic_storage_size` / `branch_logical_size_limit_bytes` (needs NEON_API_KEY secret),
   or `.rpc('db_size_bytes')` via Data API like Supabase.
6. Test matrix: guest RSVP (anonymous insert + fuzzy dedupe rpc), guestbook moderation,
   owner login + RLS isolation, superadmin console paths, strictRsvp allocation rpc.
7. Later: migration tooling (copy any client Supabase→Neon), realtime substitute, cutover.

## Env/refs

- Supabase (control plane + all prod clients): `xprynknppsehuzqqdvue`
- Neon org `org-patient-silence-25447695`; MCP connected in Claude Code (plugin:neon:neon)
- CF Pages project `wedding-site` (demo/www/apex hosts) — untouched by all of this
