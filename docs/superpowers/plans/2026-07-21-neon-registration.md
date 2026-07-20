# Neon Self-Registration Funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email+password registration on sandbox → wizard-gated site creation on Neon → auto-approve redirects to her new subdomain; otherwise pending until console approval. Zero impact on existing (Supabase) clients.

**Architecture:** Client-side Neon Auth (Better-Auth REST) + SECURITY DEFINER RPCs on Neon decide create-vs-pending server-side; `loadClientData` gains a Supabase-miss → Neon fallback; one Pages Function (`/api/neon-admin`, Supabase-superadmin-gated, `NEON_DATABASE_URL` secret) powers console list/approve of Neon rows.

**Tech Stack:** React (existing SPA), Neon Data API (PostgREST) + Neon Auth, `@neondatabase/serverless` (Functions only), Supabase (control plane, unchanged).

**Spec:** `docs/superpowers/specs/2026-07-21-neon-registration-design.md`

**Key refs:** shard s1 = Neon project `proud-sound-95226693`; auth URL `https://ep-long-credit-aztdmow3.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth`; Data API `https://ep-long-credit-aztdmow3.apirest.c-3.ap-southeast-1.aws.neon.tech/neondb/rest/v1`. Reserved subdomains: `RESERVED_SUBDOMAINS` in `src/config/site.js` (+ `sandbox`, `celebrately` hardcoded into the SQL list below).

---

### Task 1: Neon SQL — registration functions (ALL 5 shards)

**Files:** none (DB migration via Neon MCP `run_sql_transaction` per project)

Projects: `proud-sound-95226693` (s1), `autumn-mud-64342047` (s2), `misty-heart-89423194` (s3), `damp-unit-31516352` (s4), `fancy-block-52725111` (s5).

- [ ] **Step 1: Apply this transaction to each of the 5 projects** (statements as separate array items):

```sql
alter table public.site_requests add column if not exists requested_by text;
create index if not exists site_requests_requested_by_idx on public.site_requests (requested_by);

create or replace function public.subdomain_free(p_sub text)
returns boolean language plpgsql stable security definer set search_path to 'public' as $fn$
declare s text := lower(btrim(coalesce(p_sub,'')));
begin
  if s !~ '^[a-z0-9](?:[a-z0-9-]{1,61})?[a-z0-9]$' then return false; end if;
  if s in ('www','app','admin','api','demo','mail','static','assets','cdn','sandbox','celebrately','register','apply') then return false; end if;
  if exists (select 1 from public.clients c where lower(c.subdomain) = s) then return false; end if;
  if exists (select 1 from public.site_requests r where lower(r.subdomain) = s and r.status = 'pending') then return false; end if;
  return true;
end $fn$;

create or replace function public.my_registration_state()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare v_uid text; v_sub text;
begin
  begin v_uid := auth.user_id(); exception when others then v_uid := null; end;
  if v_uid is null then return jsonb_build_object('state','anon'); end if;
  select c.subdomain into v_sub from public.profiles p join public.clients c on c.id = p.client_id where p.id = v_uid;
  if v_sub is not null then return jsonb_build_object('state','active','subdomain',v_sub); end if;
  select r.subdomain into v_sub from public.site_requests r where r.requested_by = v_uid and r.status = 'pending' limit 1;
  if v_sub is not null then return jsonb_build_object('state','pending','subdomain',v_sub); end if;
  return jsonb_build_object('state','none');
end $fn$;

create or replace function public.register_site(p_subdomain text, p_event_type text, p_template_key text, p_email text, p_partner_a text, p_partner_b text, p_content jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_uid text; v_sub text := lower(btrim(coalesce(p_subdomain,''))); v_auto boolean; v_client uuid;
begin
  begin v_uid := auth.user_id(); exception when others then v_uid := null; end;
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.client_id is not null)
     or exists (select 1 from public.site_requests r where r.requested_by = v_uid and r.status = 'pending') then
    raise exception 'you already have a site or a pending request' using errcode = '23505';
  end if;
  if not public.subdomain_free(v_sub) then
    raise exception 'that site address is taken or not allowed' using errcode = '23505';
  end if;
  if pg_column_size(coalesce(p_content, '{}'::jsonb)) > 200000 then
    raise exception 'content too large' using errcode = '22001';
  end if;
  select coalesce((value->>'enabled')::boolean, false) into v_auto from public.app_config where key = 'auto_approve_requests';
  if coalesce(v_auto, false) then
    insert into public.clients (subdomain, event_type, template_key, content, is_active, owner_email, status)
      values (v_sub, coalesce(nullif(p_event_type,''),'wedding'), coalesce(nullif(p_template_key,''),'classic'), coalesce(p_content,'{}'::jsonb), true, nullif(btrim(coalesce(p_email,'')),''), 'not_paid')
      returning id into v_client;
    insert into public.profiles (id, role, client_id) values (v_uid, 'owner', v_client)
      on conflict (id) do update set role = 'owner', client_id = excluded.client_id;
    return jsonb_build_object('result','created','subdomain',v_sub);
  else
    insert into public.site_requests (status, email, partner_a, partner_b, subdomain, template_key, content, requested_by)
      values ('pending', coalesce(nullif(btrim(p_email),''),'unknown@unknown'), coalesce(p_partner_a,''), coalesce(p_partner_b,''), v_sub, coalesce(nullif(p_template_key,''),'classic'), coalesce(p_content,'{}'::jsonb), v_uid);
    return jsonb_build_object('result','pending','subdomain',v_sub);
  end if;
end $fn$;

revoke all on function public.subdomain_free(text) from public;
revoke all on function public.my_registration_state() from public;
revoke all on function public.register_site(text,text,text,text,text,text,jsonb) from public;
grant execute on function public.subdomain_free(text) to authenticated, anonymous;
grant execute on function public.my_registration_state() to authenticated;
grant execute on function public.register_site(text,text,text,text,text,text,jsonb) to authenticated;
```

- [ ] **Step 2: Mirror the current auto-approve flag into Neon s1** (read current value from Supabase `app_config.auto_approve_requests` first, then):

```sql
insert into public.app_config (key, value) values ('auto_approve_requests', '{"enabled": <CURRENT_VALUE>}'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
```

- [ ] **Step 3: RPC tests on s1 via MCP `run_sql`** (each must behave as stated):

```sql
select public.subdomain_free('demo');            -- false (reserved)
select public.subdomain_free('sandbox');         -- false (existing client)
select public.subdomain_free('maria-and-jose');  -- true
select public.my_registration_state();           -- {"state":"anon"} (no JWT on direct SQL)
select public.register_site('x','wedding','classic','a@b.c','A','B','{}'::jsonb); -- ERROR 'sign in first'
```

- [ ] **Step 4: End-to-end auth test via curl** — sign up a throwaway user against the s1 auth URL (`POST /sign-up/email`, cookie jar), `GET /get-session` → capture `set-auth-jwt`, then `POST {dataApi}/rpc/my_registration_state` with the JWT → expect `{"state":"none"}`; `POST {dataApi}/rpc/register_site` with a unique subdomain → expect `{"result":"created"...}` (flag currently ON) and verify `clients` + `profiles` rows via MCP; then DELETE the test client + profile rows via MCP SQL cleanup.

- [ ] **Step 5: Refresh Data API schema cache** — Neon console → s1 → Data API → Refresh schema cache (or note for user if console-only). Then re-run the rpc curl to confirm the new functions are visible.

### Task 2: Neon Auth trusted origins

- [ ] **Step 1:** MCP `configure_neon_auth` on `proud-sound-95226693`: `trusted_origins` = `["https://sandbox.celebrately.us", "http://localhost:5173"]`, keep email_password enabled + allow_sign_up true.
- [ ] **Step 2:** Verify with `get_neon_auth_config` — response shows the origins.

### Task 3: neonAuth client (src/lib/neon.js)

**Files:** Modify: `src/lib/neon.js`

- [ ] **Step 1: Append the authed client** (after the existing paged helper):

```js
// ---- Neon Auth (Better Auth REST) — registered users ------------------------
// Cookie session lives on the neonauth domain (credentials: 'include'); the
// short-lived JWT for the Data API is captured from the `set-auth-jwt` response
// header of /get-session and cached until ~1 min before expiry.
let userTok = null; // { token, exp(ms) }
async function authFetch(path, { method = "GET", body } = {}) {
  const res = await fetch(`${shard().authUrl}${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const jwt = res.headers.get("set-auth-jwt");
  if (jwt) userTok = { token: jwt, exp: jwtExpMs(jwt) || Date.now() + 10 * 60_000 };
  let data = null;
  try { data = await res.json(); } catch { /* some endpoints return empty */ }
  if (!res.ok) {
    const err = new Error(data?.message || `auth error (${res.status})`);
    err.status = res.status; throw err;
  }
  return data;
}
export const neonAuth = {
  signUp: (email, password) => authFetch("/sign-up/email", { method: "POST", body: { email, password, name: email.split("@")[0] } }),
  signIn: (email, password) => authFetch("/sign-in/email", { method: "POST", body: { email, password } }),
  signOut: () => { userTok = null; return authFetch("/sign-out", { method: "POST", body: {} }).catch(() => null); },
  // null when signed out; { user } when signed in (also refreshes the JWT)
  session: async () => {
    try { const d = await authFetch("/get-session"); return d && d.user ? d : null; } catch { return null; }
  },
};
async function userToken() {
  if (userTok && Date.now() < userTok.exp - 60_000) return userTok.token;
  const s = await neonAuth.session(); // refreshes userTok via header
  if (!s || !userTok) throw new Error("not signed in");
  return userTok.token;
}
// Data API RPC with the signed-in user's JWT (RLS role: authenticated).
export async function authedRpc(fn, args) {
  const token = await userToken();
  const res = await fetch(`${shard().dataApiUrl}/rpc/${fn}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(args || {}),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).message || msg; } catch { /* keep */ }
    const err = new Error(msg); err.status = res.status; throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
```

- [ ] **Step 2:** `npm test` → 278 pass (no behavior change). `npm run build` → clean.
- [ ] **Step 3:** Commit `feat: neonAuth client (sign-up/in/out, session JWT, authed RPC)`.

### Task 4: ApplyWizard hooks (src/admin/apply.jsx)

**Files:** Modify: `src/admin/apply.jsx:210` (props), `:239-244` (availability), `:293-296` (submit)

- [ ] **Step 1:** Extend props — `export function ApplyWizard({ initial = null, onSave, onCancel, submitOverride = null, presetEmail = "", subCheck = null, draftKey = null })`.
- [ ] **Step 2:** Preset email + draft restore: change the `f` initializer to:

```js
  const [f, setF] = useState(() => {
    if (editing) return stateFromRequest(initial);
    if (draftKey) {
      try { const d = JSON.parse(localStorage.getItem(draftKey) || "null"); if (d && typeof d === "object") return { ...blankApplyState(), ...d, email: presetEmail || d.email }; } catch { /* ignore */ }
    }
    return { ...blankApplyState(), email: presetEmail };
  });
```

And persist on change (below the `set` helper):

```js
  useEffect(() => {
    if (!draftKey || editing) return;
    try { localStorage.setItem(draftKey, JSON.stringify(f)); } catch { /* quota */ }
  }, [f, draftKey, editing]);
```
- [ ] **Step 3:** Availability effect — replace the `checkRequestSubdomainFree(sub)` call with `(subCheck || checkRequestSubdomainFree)(sub)`.
- [ ] **Step 4:** Submit — replace `const res = await submitSiteRequest(requestPayload(f));` with `const res = await (submitOverride || submitSiteRequest)(requestPayload(f));` (rest unchanged; `submitOverride` may navigate away before returning).
- [ ] **Step 5:** `npm test` (278 pass — /apply behavior identical when new props absent), build clean, commit `feat: ApplyWizard submitOverride/presetEmail/subCheck hooks`.

### Task 5: Register page (new src/pages/Register.jsx + App.jsx route)

**Files:** Create: `src/pages/Register.jsx` · Modify: `src/app/App.jsx` (~line 471, beside the /apply route)

- [ ] **Step 1: Create `src/pages/Register.jsx`:**

```jsx
import React from "react";
import { neonAuth, authedRpc, neonRpc, NEON_FLAG_KEY } from "@/lib/neon.js";
import { getAppConfig, checkRequestSubdomainFree } from "@/lib/api.js";
import { ApplyWizard } from "@/admin/apply.jsx";
import { Button, Field, Input, toast } from "@/ui/components.jsx";
const { useState, useEffect } = React;

// Self-registration (Neon backend) — sandbox host only, behind USE NEON DATABASE.
// States: loading → off | auth | wizard | pending | redirect.
// The wizard is what creates the site; until it finishes there is no site, so
// nothing but the wizard (or the auth card / pending notice) ever renders here.
export function RegisterPage() {
  const [phase, setPhase] = useState("loading");
  const [email, setEmail] = useState("");
  const [pendingSub, setPendingSub] = useState("");

  async function resolvePhase() {
    const flag = await getAppConfig(NEON_FLAG_KEY).catch(() => null);
    if (flag?.enabled !== true) { setPhase("off"); return; }
    const s = await neonAuth.session();
    if (!s) { setPhase("auth"); return; }
    setEmail(s.user?.email || "");
    const st = await authedRpc("my_registration_state").catch(() => ({ state: "none" }));
    if (st.state === "active") { window.location.href = `https://${st.subdomain}.celebrately.us`; setPhase("redirect"); return; }
    if (st.state === "pending") { setPendingSub(st.subdomain || ""); setPhase("pending"); return; }
    setPhase("wizard");
  }
  useEffect(() => { resolvePhase(); }, []);

  // both databases must agree the address is free
  const subCheck = async (sub) => {
    const [supaFree, neonFree] = await Promise.all([
      checkRequestSubdomainFree(sub).catch(() => false),
      neonRpc("subdomain_free", { p_sub: sub }).then((v) => v === true).catch(() => false),
    ]);
    return supaFree && neonFree;
  };
  const submitOverride = async (p) => {
    const res = await authedRpc("register_site", {
      p_subdomain: p.subdomain, p_event_type: p.eventType || "wedding",
      p_template_key: p.templateKey || "classic", p_email: p.email || email,
      p_partner_a: p.partnerA || "", p_partner_b: p.partnerB || "", p_content: p.content || {},
    });
    try { localStorage.removeItem("neonRegDraft"); } catch { /* ignore */ }
    if (res?.result === "created") { window.location.href = `https://${res.subdomain}.celebrately.us`; return { approved: true }; }
    setPendingSub(res?.subdomain || p.subdomain); setPhase("pending");
    return { approved: false };
  };

  if (phase === "loading" || phase === "redirect") return <div style={{ padding: 60, textAlign: "center", color: "var(--muted)" }}>Loading…</div>;
  if (phase === "off") return <div style={{ padding: 60, textAlign: "center" }}><h2>Registration isn't open yet</h2><p style={{ color: "var(--muted)" }}>Please check back soon.</p></div>;
  if (phase === "auth") return <AuthCard onDone={resolvePhase} />;
  if (phase === "pending") return (
    <div style={{ maxWidth: 520, margin: "60px auto", padding: 24 }} className="card card--pad-lg">
      <h2>Request received 🎉</h2>
      <p>Your site <strong>{pendingSub}.celebrately.us</strong> is waiting for approval. You'll be able to open it right here once it's approved — check back soon.</p>
      <Button variant="ghost" onClick={async () => { await neonAuth.signOut(); setPhase("auth"); }}>Sign out</Button>
    </div>
  );
  // wizard — fullscreen, nothing else (the wizard creates the site).
  // draftKey: survives refresh/session expiry (spec edge case).
  return <ApplyWizard presetEmail={email} subCheck={subCheck} submitOverride={submitOverride} draftKey="neonRegDraft" />;
}

function AuthCard({ onDone }) {
  const [mode, setMode] = useState("signup"); // signup | signin
  const [f, setF] = useState({ email: "", pw: "", pw2: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const email = f.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("Enter a valid email address.", "err");
    if (f.pw.length < 8) return toast("Password must be at least 8 characters.", "err");
    if (mode === "signup" && f.pw !== f.pw2) return toast("The two passwords don't match.", "err");
    setBusy(true);
    try {
      if (mode === "signup") await neonAuth.signUp(email, f.pw);
      else await neonAuth.signIn(email, f.pw);
      await onDone();
    } catch (e2) {
      const msg = e2?.message || "error";
      toast(mode === "signup" && /exist/i.test(msg) ? "That email already has an account — sign in instead." : "Couldn't " + (mode === "signup" ? "create the account" : "sign in") + ": " + msg, "err");
    } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} style={{ maxWidth: 420, margin: "60px auto", padding: 24 }} className="card card--pad-lg">
      <h2 style={{ marginTop: 0 }}>{mode === "signup" ? "Create your account" : "Welcome back"}</h2>
      <p style={{ color: "var(--muted)", marginTop: 4 }}>{mode === "signup" ? "Register, then set up your celebration site." : "Sign in to continue your setup."}</p>
      <Field label="Email" id="rg-email"><Input id="rg-email" type="email" value={f.email} onChange={set("email")} autoComplete="email" /></Field>
      <Field label="Password" id="rg-pw" hint="At least 8 characters"><Input id="rg-pw" type="password" value={f.pw} onChange={set("pw")} autoComplete={mode === "signup" ? "new-password" : "current-password"} /></Field>
      {mode === "signup" && <Field label="Confirm password" id="rg-pw2"><Input id="rg-pw2" type="password" value={f.pw2} onChange={set("pw2")} autoComplete="new-password" /></Field>}
      <Button variant="primary" block disabled={busy}>{busy ? "Working…" : (mode === "signup" ? "Create account" : "Sign in")}</Button>
      <p style={{ textAlign: "center", marginTop: 14, fontSize: 14 }}>
        {mode === "signup" ? "Already have an account? " : "New here? "}
        <a href="#" onClick={(e) => { e.preventDefault(); setMode(mode === "signup" ? "signin" : "signup"); }}>{mode === "signup" ? "Sign in" : "Create one"}</a>
      </p>
    </form>
  );
}
```

- [ ] **Step 2: Route in `src/app/App.jsx`** — import `RegisterPage` at top (`import { RegisterPage } from "@/pages/Register.jsx";`), then directly ABOVE the `/apply` block (App.jsx ~line 471) add:

```jsx
  // Neon self-registration — sandbox host only (flag re-checked inside the page).
  if (resolveSubdomain() === "sandbox" && /^\/register\/?$/.test(window.location.pathname)) {
    return (<><RegisterPage /><ToastHost /><ConfirmHost /></>);
  }
```

- [ ] **Step 3:** `npm test` (278 pass), `npm run build` clean.
- [ ] **Step 4:** Commit `feat: /register on sandbox — Neon auth card + wizard-gated site creation`.

### Task 6: Routing fallback — her site renders (src/lib/api.js)

**Files:** Modify: `src/lib/api.js` (inside `loadClientData`, the existing `if (error || !client)` miss branch)

- [ ] **Step 1:** In `loadClientData`, replace the body of the Supabase-miss branch so it tries Neon before giving up (existing behavior preserved when flag off / not found):

```js
  if (error || !client) {
    // Supabase miss — Neon-registered sites (flag ON) resolve here. Existing
    // clients ALWAYS resolve above; this branch cannot affect them.
    try {
      const [flag, shardCfg] = await Promise.all([
        getAppConfig(NEON_FLAG_KEY), getAppConfig(NEON_SHARDS_KEY).catch(() => null),
      ]);
      if (flag?.enabled === true) {
        setNeonRegistry(shardCfg);
        setActiveShard(resolveShardId(subdomain));
        const rows = await neonSelect("clients", `select=*&subdomain=eq.${encodeURIComponent(subdomain)}&is_active=eq.true&limit=1`);
        const nc = rows && rows[0];
        if (nc) {
          Store.hydrate({ ...clientToState(nc), guestbook: [], neonMode: true });
          await loadSession();
          return;
        }
      }
    } catch (e2) { console.warn("[neon] fallback lookup failed:", e2?.message); }
    console.warn("[api] client not found for subdomain:", subdomain, error?.message);
    await loadSession(); // always resolve auth so admin doesn't hang on the loading gate
    Store.hydrate({ clientId: null, notFound: true });
    return;
  }
```

- [ ] **Step 2:** `npm test` (278 pass), build clean.
- [ ] **Step 3:** Commit `feat: unknown-subdomain Neon fallback — registered sites resolve (flag-gated)`.

### Task 7: Console proxy (functions/api/neon-admin.js)

**Files:** Create: `functions/api/neon-admin.js` · Modify: `package.json` (dep)

- [ ] **Step 1:** `npm i @neondatabase/serverless`
- [ ] **Step 2:** Fetch the s1 **pooled** connection string via Neon MCP `get_connection_string` and append to `.dev.vars` as `NEON_DATABASE_URL=...` (gitignored; NOT in chat).
- [ ] **Step 3:** Create `functions/api/neon-admin.js`:

```js
// Superadmin console ↔ Neon bridge. The console authenticates with SUPABASE
// (superadmin JWT — verified below, same pattern as cf-health); Neon rows are
// read/written via the NEON_DATABASE_URL secret. POST {action, ...params}.
import { neon } from "@neondatabase/serverless";

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

async function requireSuperadmin(env, request) {
  const SUPABASE_URL = env.SUPABASE_URL || "https://xprynknppsehuzqqdvue.supabase.co";
  const ANON = env.SUPABASE_ANON_KEY;
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || !ANON) return null;
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, authorization: `Bearer ${token}` } });
  if (!who.ok) return null;
  const uid = (await who.json())?.id;
  if (!uid) return null;
  const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}&select=role`, { headers: { apikey: ANON, authorization: `Bearer ${token}` } });
  const rows = pr.ok ? await pr.json() : [];
  return rows?.[0]?.role === "superadmin" ? uid : null;
}

export async function onRequestPost({ request, env }) {
  if (!(await requireSuperadmin(env, request))) return json({ error: "forbidden" }, 403);
  if (!env.NEON_DATABASE_URL) return json({ error: "NEON_DATABASE_URL not configured" }, 500);
  const sql = neon(env.NEON_DATABASE_URL);
  const body = await request.json().catch(() => ({}));
  try {
    switch (body.action) {
      case "list_requests":
        return json({ rows: await sql`select id, created_at, status, email, partner_a, partner_b, subdomain, template_key, requested_by from site_requests where status = 'pending' order by created_at desc` });
      case "list_clients":
        return json({ rows: await sql`select id, subdomain, event_type, is_active, owner_email, status, created_at, (content->>'hideDonateAd')::boolean as hide_donate from clients order by created_at desc` });
      case "approve_request": {
        const [r] = await sql`select * from site_requests where id = ${body.id} and status = 'pending'`;
        if (!r) return json({ error: "request not found or not pending" }, 404);
        const [existing] = await sql`select id from clients where lower(subdomain) = lower(${r.subdomain})`;
        if (existing) return json({ error: "subdomain already taken" }, 409);
        const [c] = await sql`insert into clients (subdomain, event_type, template_key, content, is_active, owner_email, status)
          values (${r.subdomain}, 'wedding', ${r.template_key}, ${r.content}, true, ${r.email}, 'not_paid') returning id, subdomain`;
        if (r.requested_by) await sql`insert into profiles (id, role, client_id) values (${r.requested_by}, 'owner', ${c.id})
          on conflict (id) do update set role = 'owner', client_id = excluded.client_id`;
        await sql`update site_requests set status = 'approved' where id = ${r.id}`;
        return json({ ok: true, subdomain: c.subdomain });
      }
      case "reject_request":
        await sql`update site_requests set status = 'rejected' where id = ${body.id}`;
        return json({ ok: true });
      case "set_status":
        await sql`update clients set status = ${body.status} where id = ${body.id}`;
        return json({ ok: true });
      case "set_active":
        await sql`update clients set is_active = ${body.active === true} where id = ${body.id}`;
        return json({ ok: true });
      case "toggle_donate": {
        const [c] = await sql`select content from clients where id = ${body.id}`;
        if (!c) return json({ error: "client not found" }, 404);
        const hidden = !(c.content && c.content.hideDonateAd === true);
        await sql`update clients set content = content || ${JSON.stringify({ hideDonateAd: hidden })}::jsonb where id = ${body.id}`;
        return json({ ok: true, hidden });
      }
      case "set_config":
        await sql`insert into app_config (key, value) values (${body.key}, ${JSON.stringify(body.value)}::jsonb)
          on conflict (key) do update set value = excluded.value, updated_at = now()`;
        return json({ ok: true });
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: e.message || "neon error" }, 500);
  }
}
```

- [ ] **Step 4:** `npm run build` clean; commit `feat: /api/neon-admin — superadmin bridge to Neon (requests, clients, config)`.
- [ ] **Step 5 (USER):** Add CF Pages secret `NEON_DATABASE_URL` (exact value handed over out-of-chat; dashboard → wedding-site → Settings → Variables and Secrets → Add → Encrypt → Save). Console features 500 with a clear error until then.

### Task 8: Console UI — Neon rows in Requests + Clients tabs (src/admin/superadmin.jsx)

**Files:** Modify: `src/admin/superadmin.jsx` (ClientsPanel)

- [ ] **Step 1: Loader + helper** — inside ClientsPanel (near `load()`), add:

```js
  const [neonReqs, setNeonReqs] = useState([]);
  const [neonClients, setNeonClients] = useState([]);
  async function neonAdmin(action, params = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/neon-admin", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` },
      body: JSON.stringify({ action, ...params }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `neon-admin ${res.status}`);
    return j;
  }
  async function loadNeon() {
    try {
      const [rq, cl] = await Promise.all([neonAdmin("list_requests"), neonAdmin("list_clients")]);
      setNeonReqs(rq.rows || []); setNeonClients(cl.rows || []);
    } catch (e) { console.warn("[neon-admin] load failed:", e.message); }
  }
```

Call `loadNeon()` wherever `load()` runs on mount (same `useEffect`).

- [ ] **Step 2: Requests tab** — after the Supabase pending rows `.map(...)`, render Neon pending rows in the same `<tbody>` (tag + approve/reject via proxy):

```jsx
                {neonReqs.map((r) => (
                  <tr key={"n-" + r.id}>
                    <td><strong>{r.partner_a}{r.partner_b ? ` & ${r.partner_b}` : ""}</strong> <span className="tag" style={{ marginLeft: 6 }}>Neon</span></td>
                    <td className="client-domain">{r.subdomain}.celebrately.us</td>
                    <td>{r.email}</td>
                    <td><span style={{ color: "var(--muted)" }}>—</span></td>
                    <td><span style={{ color: "var(--muted)" }}>—</span></td>
                    <td><span style={{ color: "var(--muted)" }}>—</span></td>
                    <td><span style={{ color: "var(--muted)" }}>—</span></td>
                    <td>
                      <div className="row-actions">
                        <Button variant="primary" size="sm" disabled={busy} onClick={async () => {
                          const ok = await confirmDialog({ title: "Approve this site?", message: `Create ${r.subdomain}.celebrately.us on Neon?`, confirmLabel: "Approve & create" });
                          if (!ok) return;
                          setBusy(true);
                          try { await neonAdmin("approve_request", { id: r.id }); toast("Site created on Neon.", "success"); await loadNeon(); }
                          catch (e) { toast("Approve failed: " + e.message, "err"); }
                          finally { setBusy(false); }
                        }}>Approve</Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={async () => {
                          const ok = await confirmDialog({ title: "Reject this request?", message: `Reject ${r.subdomain}.celebrately.us?`, confirmLabel: "Reject", danger: true });
                          if (!ok) return;
                          try { await neonAdmin("reject_request", { id: r.id }); await loadNeon(); } catch (e) { toast("Failed: " + e.message, "err"); }
                        }}>Reject</Button>
                      </div>
                    </td>
                  </tr>
                ))}
```

Also update the Requests pending-count badge on the folder tab to `requests.filter(...).length + neonReqs.length` and the empty-state condition to require `neonReqs.length === 0` too.

- [ ] **Step 3: Clients tab** — after the Supabase `pg.pageItems.map(...)` rows, render Neon clients (tagged; status/donate/active via proxy; no edit):

```jsx
                  {neonClients.map((c) => (
                    <tr key={"n-" + c.id}>
                      <td></td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <span className={"sa-dot" + (c.is_active ? "" : " sa-dot--off")} title={c.is_active ? "Active" : "Disabled"} />
                          <div>
                            <span className="tag" style={{ marginRight: 8 }}>Neon</span>
                            <a className="client-domain client-domain--link" href={clientUrl(c.subdomain)} target="_blank" rel="noreferrer">{c.subdomain}.{PLATFORM_DOMAIN}</a>
                          </div>
                        </div>
                      </td>
                      <td style={{ maxWidth: 200 }}>{c.owner_email ? <span className="client-domain" style={{ fontSize: 13 }}>{c.owner_email}</span> : <span style={{ color: "var(--muted)", fontSize: 13 }}>no login</span>}</td>
                      <td><span style={{ color: "var(--muted)" }}>—</span></td>
                      <td>
                        <select value={c.status || "not_paid"} disabled={busy} aria-label={`Status for ${c.subdomain}`}
                          onChange={async (e) => { try { await neonAdmin("set_status", { id: c.id, status: e.target.value }); await loadNeon(); } catch (e2) { toast("Failed: " + e2.message, "err"); } }}
                          style={{ fontSize: 13, fontWeight: 600, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--line)", background: "transparent",
                            color: (c.status || "not_paid") === "paid" ? "#1d7a3d" : (c.status || "not_paid") === "demo" ? "#3b6fb5" : "#a05a1a" }}>
                          <option value="not_paid">Not Paid</option><option value="paid">Paid</option><option value="demo">Demo</option>
                        </select>
                      </td>
                      <td>
                        <button className={"tag" + (c.hide_donate ? " tag--hidden" : "")} style={{ cursor: "pointer", border: 0 }}
                          onClick={async () => { try { await neonAdmin("toggle_donate", { id: c.id }); await loadNeon(); } catch (e2) { toast("Failed: " + e2.message, "err"); } }}>
                          {c.hide_donate ? "Off" : "On"}</button>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className={"icon-btn" + (c.is_active ? "" : " icon-btn--danger")} title={c.is_active ? "Disable site" : "Enable site"}
                            onClick={async () => { try { await neonAdmin("set_active", { id: c.id, active: !c.is_active }); await loadNeon(); } catch (e2) { toast("Failed: " + e2.message, "err"); } }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M12 3.5v8" /><path d="M6.6 6.8a8 8 0 1 0 10.8 0" /></svg>
                          </button>
                          <a className="icon-btn" href={clientUrl(c.subdomain)} target="_blank" rel="noreferrer" title="Open live site">{Icon.arrow({})}</a>
                        </div>
                      </td>
                    </tr>
                  ))}
```

- [ ] **Step 4:** `npm test` (278 pass), build clean, commit `feat: console — Neon requests approve/reject + Neon clients (tagged) in Clients tabs`.

### Task 9: Platform settings mirrors the flag to Neon (src/admin/manage.jsx)

**Files:** Modify: `src/admin/manage.jsx` (PlatformSettings `save`)

- [ ] **Step 1:** In `PlatformSettings.save()`, after the `setAppConfig` loop succeeds, mirror auto-approve to Neon (best-effort, loud on failure):

```js
      if (flags.auto_approve_requests !== saved.auto_approve_requests) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch("/api/neon-admin", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` },
            body: JSON.stringify({ action: "set_config", key: "auto_approve_requests", value: { enabled: flags.auto_approve_requests } }),
          });
          if (!res.ok) throw new Error(`neon mirror ${res.status}`);
        } catch (e2) {
          toast("Saved, but the Neon copy of auto-approve did NOT update: " + (e2.message || "error"), "err");
        }
      }
```

(`supabase` needs importing in manage.jsx if absent — check top imports; it is already imported there.)

- [ ] **Step 2:** `npm test`, build, commit `feat: platform auto-approve flag mirrors to Neon (registration reads Neon copy)`.

### Task 10: E2E verification + deploy

- [ ] **Step 1:** Full suite + build: `npm test` (278) + `npm run build`.
- [ ] **Step 2:** Push (auto-deploy); poll for new bundle hash; grep marker `Create your account`.
- [ ] **Step 3:** E2E (auto-approve ON): register throwaway user on `sandbox.celebrately.us/register` → wizard → finish → redirected to `{sub}.celebrately.us`, site renders with her modules; RSVP submit lands in Neon (verify via MCP).
- [ ] **Step 4:** E2E (auto-approve OFF): second throwaway → wizard → pending screen; console Requests shows Neon-tagged row → Approve → her subdomain renders; re-login shows redirect. (Steps 3–4 need the user in the loop for browser actions; MCP verifies rows.)
- [ ] **Step 5:** Cleanup test users/sites via MCP SQL; update `docs/BY-DESIGN.md` (no email verification phase-1; Neon clients read-only edit in console) + memory; final commit.

---

## EXECUTION COMPLETE (2026-07-21)

All 10 tasks done via subagent-driven development (per-task spec + quality
reviews, final integration review). 15 commits. Post-review hardening beyond
the original plan:
- register auth card: submit button type + password clearing on mode toggle
- loadClientData fallback: try-scope narrowed (no double-hydrate)
- approve path: atomic + shared `_enrich_site_content` /
  `approve_site_request(uuid)` SQL fns on ALL 5 shards — auto and console
  approvals now produce fully-enriched sites (names, hashtag, welcome/invite
  copy, modules default, accessV2, onboarded), verified live on s1
- console Neon mutations: runBusy + disabled guards; flag mirror surfaces
  server error body

Known follow-ups (tracked, non-blocking): Neon rows unpaginated in console;
Requests-tab approve/reject busy-label; flag-mirror drift not persisted
(toast-only); Register.jsx doesn't read the shard registry (s1 fixed);
draft key not per-user; iOS Safari third-party-cookie session check pending;
`subdomain_free` can't see Supabase (client-side dual check only).
