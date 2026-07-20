# Neon self-registration funnel — design spec (2026-07-21)

Owner-approved design. Production-ready, **zero impact on existing clients**: the
new funnel is an additive path; every existing client keeps the unchanged
Supabase route.

## Goal

A couple can register (email + password), sign in, complete the setup wizard
(the wizard IS what creates the site — nothing exists before it finishes), and:

- **AUTO APPROVE ON** → site created immediately on Neon → redirect to
  `https://{subdomain}.celebrately.us`, nav tabs visible (her wizard's modules).
- **AUTO APPROVE OFF** → pending request saved; she sees a "waiting for
  approval" screen on every login until the superadmin approves in the console.

Neon database only. Register UI lives on `sandbox.celebrately.us` for now.

## Safety guarantees (non-negotiable)

1. `loadClientData` resolves **Supabase first — path unchanged**. The Neon
   lookup runs ONLY on Supabase miss AND `use_neon_db` flag ON. Existing
   subdomains can never reach it.
2. `/register` route mounts only when `subdomain === 'sandbox'` AND flag ON.
3. `/apply`, demo, all real clients, existing admin/auth: untouched.
4. Kill switch: USE NEON DATABASE unchecked → funnel gone, Neon-served sites
   stop resolving. No redeploy.

## Components

### A. neonAuth (src/lib/neon.js additions)
- `signUp(email, pw)`, `signIn(email, pw)`, `signOut()`, `getSession()` against
  the shard's Neon Auth REST (`/sign-up/email`, `/sign-in/email`,
  `/sign-out`, `/get-session`), `credentials: 'include'` (cookie session).
- JWT captured from `set-auth-jwt` response header; cached in memory; expired →
  re-fetch via `getSession()`. `authedRest()`/`authedRpc()` = Data API calls
  with the user JWT (vs the existing anonymous helpers).
- Config: add `https://sandbox.celebrately.us` to Neon Auth trusted origins
  (MCP `configure_neon_auth`), email+password sign-up enabled.
- **Accepted phase-1 risk:** no email verification (no SMTP). Auto-approve OFF
  is the spam guard.

### B. /register page (new src/pages/Register.jsx, route in App.jsx)
State machine after mount:
1. **No session** → auth card: Create account (email / password ≥8 / confirm)
   ⇄ Sign in toggle. Password fields masked. Submit buttons with busy labels.
2. **Session** → `authedRpc('my_registration_state')` →
   - `none` → **ApplyWizard fullscreen** (reuse existing component; subdomain
     availability = Neon `subdomain_free` RPC + existing Supabase
     `checkRequestSubdomainFree`; both must be free). No nav, no site chrome.
   - `pending` → pending screen (request summary + sign out).
   - `active` → `window.location = https://{sub}.celebrately.us`.
3. Wizard finish → `authedRpc('register_site', payload)`. Server decides
   auto-vs-pending (reads the flag mirrored in NEON app_config — client cannot
   tamper). Response `{result: 'created', subdomain}` → redirect;
   `{result: 'pending'}` → pending screen.
4. Wizard draft persisted to localStorage (`neonRegDraft:{userId}`) so session
   expiry or refresh never loses work; cleared on success.

### C. Neon SQL (migration on ALL 5 shards — R-rule)
- `alter table site_requests add column requested_by text` (+ index).
- `subdomain_free(p_sub text) returns boolean` — SECURITY DEFINER; false if
  taken by clients (any is_active) OR pending site_requests OR reserved list.
- `my_registration_state() returns jsonb` — `{state: none|pending|active,
  subdomain}` from profiles.client_id / pending request by `auth.user_id()`.
- `register_site(p_subdomain text, p_event_type text, p_template_key text,
  p_content jsonb) returns jsonb` — SECURITY DEFINER; validates: authenticated
  (`auth.user_id() is not null`), subdomain regex `^[a-z0-9](-?[a-z0-9]){2,62}$`,
  reserved list, uniqueness (clients + pending requests), ONE site/request per
  user, `pg_column_size(p_content) < 200000`. Reads `app_config.auto_approve_requests`
  (Neon copy): enabled → insert clients (status `not_paid`, is_active true,
  content = p_content) + upsert profiles (id=auth.user_id(), role `owner`,
  client_id) → `{result:'created', subdomain}`; else insert site_requests
  (status pending, requested_by) → `{result:'pending'}`.
- Grants: execute on the three fns to `authenticated` ONLY (not anonymous).

### D. Routing fallback (src/lib/api.js)
`loadClientData`: after Supabase miss (`error || !client`), if flag ON → resolve
shard via registry (`bySubdomain` → default) → Neon clients lookup by subdomain →
found: hydrate neonMode site (guest writes already neonMode-aware). Not found →
existing notFound behavior.

### E. Console integration (superadmin)
- **New Pages Function `functions/api/neon-admin.js`**: verifies caller's
  Supabase JWT is superadmin (cf-health pattern), connects to Neon s1 via
  `@neondatabase/serverless` + `NEON_DATABASE_URL` secret. Actions:
  `list_requests`, `approve_request` (create client + profile from request,
  mark approved — idempotent on subdomain), `reject_request`, `list_clients`,
  `set_status`, `toggle_donate`, `set_active`, `set_config` (mirror
  auto-approve flag into Neon app_config).
- **Requests tab**: Neon pending rows merged, tagged `Neon`; Approve/Reject
  wired to the function. R4 parity columns present.
- **Clients tab**: Neon clients merged, tagged `Neon`; status select, donate
  toggle, active toggle work via the proxy. Edit (design wizard) for Neon
  clients = **later phase** (button hidden/disabled with tooltip).
- **Platform settings Save**: also mirrors `auto_approve_requests` to Neon via
  `set_config` (best-effort; toast on failure).

### F. Dependencies / secrets
- npm: `@neondatabase/serverless` (Functions only; tree-shaken from client).
- CF Pages secret: `NEON_DATABASE_URL` (s1 pooled connection string). Local
  dev: same key in `.dev.vars` (gitignored).

## Edge cases

- Duplicate email → Better Auth 4xx surfaced inline ("account already exists —
  sign in instead").
- Password < 8 → inline error before request.
- Subdomain taken in EITHER database or reserved → inline error at the wizard
  subdomain step AND re-checked server-side at register_site.
- Double submit → one-site-per-user check makes second call error cleanly.
- Session expired at wizard submit → one silent getSession retry → else back to
  sign-in (draft preserved).
- Flag flipped mid-wizard → server reads flag at submit time (authoritative).
- Auto-approve flag mirror drift → register_site trusts NEON copy only; console
  Save keeps them in sync; failure toasts loudly.

## Testing

- RPC-level: MCP SQL tests on s1 — register (auto on/off), duplicate user,
  duplicate subdomain, reserved name, anonymous rejected.
- Unit (vitest): register state machine reducer + subdomain validator.
- E2E manual on sandbox: both approval paths end-to-end incl. console approve.
- Existing suite (278) stays green; `npm run build` clean.

## Out of scope (explicit)

- Neon owner ADMIN editing (her /admin) — later phase.
- Email verification / SMTP — later phase.
- Registrations target shard s1 only (registry supports more later).
- Realtime console notifications for Neon requests — manual refresh.
