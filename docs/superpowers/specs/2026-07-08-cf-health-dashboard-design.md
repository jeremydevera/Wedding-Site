# Cloudflare Health Dashboard (superadmin) — Design

**Date:** 2026-07-08
**Goal:** Give the superadmin a Health tab that shows Cloudflare usage/health (router requests vs the 10M/mo Workers limit, Pages Functions, R2, zone traffic) so another Error 1027 is seen coming, not discovered by an outage.

## Decisions (from brainstorming)
- **Scope:** Full ops view — router requests today + month-to-date vs 10M limit; split router / Functions / R2; 7-day request trend; 5xx errors; edge cache-hit %; per-day table; R2 storage size + object count + ops.
- **Placement:** New **Health tab** in superadmin (not a panel on the overview).
- **Token:** A read-only Cloudflare API token, stored as a **Pages secret**, never in the browser.
  - Originally "Claude creates + wires it," but: (a) my CF credential is **unauthorized** to create account tokens, and (b) a Pages project `PATCH` has **unconfirmed merge-vs-replace** semantics — a replace would wipe existing secrets (`RESEND_API_KEY`, `SUPABASE_*`) whose values can't be read back. So token creation + env wiring is **manual via the dashboard** (zero wipe risk, token never passes through chat). The code ships first and self-activates once the env vars exist.

## Architecture
Three isolated units:

1. **`shapeHealth(gql, opts)` — pure transformer** (`functions/api/_cf-health-shape.js`, importable by the Function and by tests).
   - Input: the parsed CF GraphQL `data` object (accounts[0] + zones[0]) + `{ limit }`.
   - Output: stable payload the UI renders. No network, no `env` — fully unit-testable with a fixture.
   - Payload:
     ```
     { configured:true, updatedAt:<iso>, limitMonth:10000000,
       router:{ today, month }, functions:{ today, month },
       r2:{ opsToday, storageBytes, objects },
       zone:{ reqToday, cacheHitPct, err5xx, status:[{code,count}] },
       series:[{ date, router, functions }]  // last 7 days
     }
     ```
   - Missing/partial datasets degrade to `0`/`null` (never throw): free-plan retention or a denied dataset shows blanks, not an error.

2. **`functions/api/cf-health.js` — server endpoint** (`onRequestGet`).
   - Auth: extract bearer, `requireSuperadmin(SUPABASE_URL, SUPABASE_ANON_KEY, token)` mirrored from `functions/api/media.js`. Fail closed — 401 no token, 403 not superadmin. Non-superadmin never reaches Cloudflare.
   - Config: reads `env.CF_ANALYTICS_TOKEN` (secret), `env.CF_ACCOUNT_ID`, `env.CF_ZONE_ID` (plain; hardcoded fallbacks OK — account/zone ids are not secret). No token → `200 { configured:false }` (UI shows a setup notice, not an error).
   - Cache: check `caches.default` for a fixed internal key `https://cf-health.internal/v1`. Hit → return cached JSON. Miss → query CF, `cache.put` with `cache-control: max-age=300` (5 min). This bounds CF GraphQL calls to ≤1 per 5 min regardless of how many superadmins refresh, and keeps this endpoint's own request cost trivial.
   - Query: one POST to `https://api.cloudflare.com/client/v4/graphql` (Bearer = the read-only token). One document with aliases: `workersInvocationsAdaptive` (router by `scriptName`, and all-scripts total) for today + month + 7-day series; `pagesFunctionsInvocationsAdaptiveGroups`; `httpRequestsAdaptiveGroups` (zone: requests, cachedRequests, edgeResponseStatus for 5xx + cache-hit); `r2StorageAdaptiveGroups` + `r2OperationsAdaptiveGroups`. Date bounds computed at runtime (`Date` is available in the Pages runtime).
   - Upstream failure (non-200 / GraphQL `errors`): `200 { configured:true, error:"upstream" }` so the UI shows a soft message instead of a hard failure. Never leak the token or raw upstream body.

3. **`src/admin/CloudflareHealth.jsx` — UI** + a new tab wired into `superadmin.jsx`.
   - On mount and on **Refresh**: `GET /api/cf-health` with `Authorization: Bearer <session access_token>` (from `supabase.auth.getSession()`, freshly refreshed, same pattern as `auth.js` `invokeOwnerFn`).
   - States: **loading** (skeleton/spinner — per the loading-feedback rule), **error** (soft retry), **not-configured** (shows the setup steps), **ready**.
   - Renders: month %-bar vs 10M (green < 60%, amber 60–85%, red > 85%); today's router / Functions / R2 numbers; 7-day sparkline (inline SVG, no new dependency); 5xx + cache-hit %; per-day table; R2 storage + objects + ops; "updated Xm ago."

## Data flow
UI (session bearer) → `/api/cf-health` → requireSuperadmin → cache check → CF GraphQL (read-only token) → `shapeHealth` → JSON → UI render.

## Error handling
- Not superadmin → 401/403, no CF call.
- No token env → `{configured:false}` → setup notice.
- CF error → `{error:"upstream"}` → soft UI message + Refresh.
- Partial data → zeros/blanks, never a crash.

## Testing (TDD)
- Unit-test `shapeHealth` against a captured GraphQL fixture: correct totals, 7-day series length/order, cache-hit %, 5xx sum, partial-data degradation to 0.
- Unit-test the %-bar threshold/format helper (green/amber/red + `1.2M`/`128,293` formatting).
- Network/GraphQL string + auth = manual verification against live CF after deploy.

## Manual setup (one-time, user)
1. **Create token** — CF dashboard → My Profile → API Tokens → Create Token → Custom:
   - *Account* · **Account Analytics** · Read → resource = the Celebrately account.
   - *Zone* · **Analytics** · Read → zone = `celebrately.us`.
   - (optional) *Account* · **Workers R2 Storage** · Read.
   - Create → copy the token value once.
2. **Add Pages env vars** — Workers & Pages → `wedding-site` → Settings → Variables and Secrets → Add (do this for **Production**; Preview optional):
   - `CF_ANALYTICS_TOKEN` = the token, **Encrypt** (secret).
   - `CF_ACCOUNT_ID` = `4acf69efbeed54838dc0d5f004769933`.
   - `CF_ZONE_ID` = `3de2f4733d9e76517db51bf1a44314a2`.
   - Save, then redeploy (or trigger a deploy) so Functions pick them up.

## Out of scope / upgrade path
- **Scheduled snapshots into Supabase** (persistent history beyond CF retention) — deferred; live query is enough now. The per-day table depth is bound by CF's retention window.

## Files
- Create: `functions/api/_cf-health-shape.js`, `functions/api/cf-health.js`, `src/admin/CloudflareHealth.jsx`, `functions/api/__tests__/cf-health-shape.test.js` (or co-located under `src/lib/__tests__` if the runner scopes there).
- Modify: `src/admin/superadmin.jsx` (add the Health tab).
