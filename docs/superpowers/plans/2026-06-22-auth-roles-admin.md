# Auth, Roles & Superadmin Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fake client-side admin password with real Supabase Auth, gate the admin UI by role (superadmin sees everything incl. Settings; a client "owner" sees their event admin minus Settings/Clients and only on their own subdomain), and give the superadmin a dashboard to create clients, assign themes, and create/reset each client's owner login.

**Architecture:** Supabase Auth (email + password) is the auth engine. A `profiles` row (`role` ∈ guest|owner|superadmin, `client_id`) decides what a logged-in user can see/do. The browser only ever uses the anon key + the user's session; creating *owner accounts* (a privileged operation) happens in a Supabase **Edge Function** that runs with the service-role key and is callable only by a superadmin. RLS is the real authorization boundary (anon key is public).

**Tech Stack:** Vite + React, `@supabase/supabase-js` (auth + functions.invoke), Supabase Edge Functions (Deno), Postgres RLS, Vitest for pure helpers.

**Builds on:** `feat/supabase-guest-data` (Supabase client, `profiles`/`clients` tables, hydrate-cache store, `src/lib/api.js`). Branch this work off that or off `main` after it merges.

**Out of scope → Phase 2b (separate plan):** wiring each admin panel's *writes* (guestbook moderation, RSVP list, content/theme edits by **owners**) to Supabase + owner RLS write policies; media/R2 uploads. This plan lets the **superadmin** write the `clients` row (create/assign theme); owner *content* editing still persists locally until 2b.

---

## File structure

- `supabase/migrations/0002_auth.sql` — **new.** `handle_new_user` trigger, `auth_role()`/`auth_client()` helpers, RLS policies for profiles + superadmin-manage-clients.
- `supabase/functions/admin-create-owner/index.ts` — **new.** Edge Function: superadmin-only; creates/Resets an owner auth user + profile.
- `src/lib/auth.js` — **new.** `signIn`, `signOut`, `loadSession` (session + profile → store), `createOwner` (invokes edge fn).
- `src/lib/roles.js` — **new, pure + tested.** `visibleAdminTabs(role)`, `canEnterAdmin(profile, clientId)`.
- `src/lib/store.jsx` — **modify.** Add `auth: { ready, session, role, clientId, email }` + `Store.setAuth`.
- `src/admin/core.jsx` — **modify.** `AdminLogin` → email+password via Supabase; drop `ADMIN_SESSION`/`isAuthed` password check.
- `src/admin/manage.jsx` — **modify.** `AdminApp` uses session + role; tabs filtered via `visibleAdminTabs`; owner scoped; sign-out via Supabase.
- `src/admin/superadmin.jsx` — **new.** `ClientsAdmin` superadmin tab (list/create clients, assign theme/event_type, create/reset owner login).
- `vitest`-tested helpers under `src/lib/__tests__/`.

Roles map:
```
superadmin: role=superadmin, client_id=null  → any subdomain, all tabs incl Settings + Clients
owner:      role=owner,      client_id=<X>    → only when current site's clientId === X, tabs minus Settings/Clients
guest/none: → no admin access
```

---

### Task 1: Auth + RLS migration

**Files:**
- Create: `supabase/migrations/0002_auth.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/0002_auth.sql`:
```sql
-- Auto-create a profile (default role 'guest') whenever an auth user is created.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role) values (new.id, 'guest')
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- Helpers to read the caller's role/client without RLS recursion.
create or replace function public.auth_role()
returns text language sql security definer stable set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;
create or replace function public.auth_client()
returns uuid language sql security definer stable set search_path = public as $$
  select client_id from public.profiles where id = auth.uid()
$$;

-- Profiles: superadmin can read all (own-profile select policy already exists).
drop policy if exists "superadmin read profiles" on profiles;
create policy "superadmin read profiles" on profiles
  for select using (public.auth_role() = 'superadmin');

-- Clients: superadmin full write (anon "read active clients" select policy already exists).
drop policy if exists "superadmin manage clients" on clients;
create policy "superadmin manage clients" on clients
  for all using (public.auth_role() = 'superadmin')
  with check (public.auth_role() = 'superadmin');
```

- [ ] **Step 2: Run it in the Supabase SQL Editor**

Paste the file contents → Run. Expected: "Success. No rows returned".

- [ ] **Step 3: Bootstrap the superadmin account (manual, one-time)**

In Supabase dashboard → **Authentication → Users → Add user**: create your account (email + password, "Auto-confirm" on). Then in SQL Editor:
```sql
update profiles set role = 'superadmin', client_id = null
where id = (select id from auth.users where email = 'YOUR_EMAIL_HERE');
```
Verify: `select role from profiles where id = (select id from auth.users where email='YOUR_EMAIL_HERE');` → `superadmin`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0002_auth.sql
git commit -m "feat(db): auth trigger, role helpers, RLS for profiles + clients"
```

---

### Task 2: Role helpers (pure, tested)

**Files:**
- Create: `src/lib/roles.js`
- Test: `src/lib/__tests__/roles.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/roles.test.js`:
```js
import { describe, it, expect } from "vitest";
import { visibleAdminTabs, canEnterAdmin } from "@/lib/roles.js";

const TABS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "guestbook", label: "Guestbook" },
  { key: "media", label: "Media" },
  { key: "settings", label: "Settings" },
];

describe("visibleAdminTabs", () => {
  it("superadmin keeps all tabs + gains clients", () => {
    const keys = visibleAdminTabs("superadmin", TABS).map((t) => t.key);
    expect(keys).toContain("settings");
    expect(keys).toContain("media");
    expect(keys).toContain("clients");
  });
  it("owner loses settings, media, and never sees clients", () => {
    const keys = visibleAdminTabs("owner", TABS).map((t) => t.key);
    expect(keys).not.toContain("settings");
    expect(keys).not.toContain("media");
    expect(keys).not.toContain("clients");
    expect(keys).toContain("guestbook");
  });
});

describe("canEnterAdmin", () => {
  it("superadmin enters any client", () => {
    expect(canEnterAdmin({ role: "superadmin", clientId: null }, "c1")).toBe(true);
  });
  it("owner enters only their own client", () => {
    expect(canEnterAdmin({ role: "owner", clientId: "c1" }, "c1")).toBe(true);
    expect(canEnterAdmin({ role: "owner", clientId: "c2" }, "c1")).toBe(false);
  });
  it("guest/none cannot enter", () => {
    expect(canEnterAdmin({ role: "guest", clientId: null }, "c1")).toBe(false);
    expect(canEnterAdmin(null, "c1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/lib/__tests__/roles.test.js`
Expected: FAIL — cannot resolve `@/lib/roles.js`.

- [ ] **Step 3: Implement**

Create `src/lib/roles.js`:
```js
// Settings, Media + Clients are superadmin-only (clients also filtered below).
const SUPERADMIN_ONLY = new Set(["settings", "media"]);

export function visibleAdminTabs(role, allTabs) {
  if (role === "superadmin") {
    const hasClients = allTabs.some((t) => t.key === "clients");
    return hasClients ? allTabs : [...allTabs, { key: "clients", label: "Clients", icon: "grid" }];
  }
  if (role === "owner") {
    return allTabs.filter((t) => !SUPERADMIN_ONLY.has(t.key) && t.key !== "clients");
  }
  return [];
}

export function canEnterAdmin(profile, currentClientId) {
  if (!profile) return false;
  if (profile.role === "superadmin") return true;
  if (profile.role === "owner") return !!currentClientId && profile.clientId === currentClientId;
  return false;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/lib/__tests__/roles.test.js`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/roles.js src/lib/__tests__/roles.test.js
git commit -m "feat: role helpers for admin tab gating + access"
```

---

### Task 3: Auth state in the store

**Files:**
- Modify: `src/lib/store.jsx`

- [ ] **Step 1: Add `auth` to default state**

In `defaultState()` (`src/lib/store.jsx`), add to the returned object:
```js
    auth: { ready: false, session: null, role: null, clientId: null, email: null },
```

- [ ] **Step 2: Add `Store.setAuth`**

Inside `export const Store = { ... }`, after `hydrate(...)`, add:
```js
  setAuth(auth) {
    _state = { ..._state, auth: { ready: true, ...auth } };
    emit(); // session is not persisted to localStorage; Supabase manages it
  },
```

- [ ] **Step 3: Verify build + tests**

Run: `npm run build && npm test`
Expected: build OK, 14 tests pass (12 + 2 new files' tests already counted; roles adds tests).

- [ ] **Step 4: Commit**

```bash
git add src/lib/store.jsx
git commit -m "feat: auth state + Store.setAuth"
```

---

### Task 4: Auth library

**Files:**
- Create: `src/lib/auth.js`

- [ ] **Step 1: Implement**

Create `src/lib/auth.js`:
```js
import { supabase } from "@/lib/supabase.js";
import { Store } from "@/lib/store.jsx";

async function profileFor(userId) {
  const { data } = await supabase.from("profiles").select("role,client_id").eq("id", userId).single();
  return data || { role: "guest", client_id: null };
}

// Load the current session + profile into the store. Call once at boot.
export async function loadSession() {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) { Store.setAuth({ session: null, role: null, clientId: null, email: null }); return; }
  const p = await profileFor(session.user.id);
  Store.setAuth({ session, role: p.role, clientId: p.client_id, email: session.user.email });
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const p = await profileFor(data.user.id);
  Store.setAuth({ session: data.session, role: p.role, clientId: p.client_id, email: data.user.email });
  return p;
}

export async function signOut() {
  await supabase.auth.signOut();
  Store.setAuth({ session: null, role: null, clientId: null, email: null });
}

// Superadmin-only: create or reset a client's owner login (via Edge Function).
export async function createOwner({ email, password, clientId }) {
  const { data, error } = await supabase.functions.invoke("admin-create-owner", {
    body: { email, password, client_id: clientId },
  });
  if (error) throw error;
  return data;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth.js
git commit -m "feat: auth lib (signIn/signOut/loadSession/createOwner)"
```

---

### Task 5: Load session at boot

**Files:**
- Modify: `src/lib/api.js`

- [ ] **Step 1: Call loadSession inside loadClientData**

In `src/lib/api.js`, import auth and load the session alongside the client. At the top:
```js
import { loadSession } from "@/lib/auth.js";
```
At the **end of** `loadClientData()` (after the `Store.hydrate(...)` call), add:
```js
  await loadSession();
```
This ensures the store knows the logged-in role/clientId after boot (App already calls `loadClientData()` on mount).

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.js
git commit -m "feat: load auth session during boot"
```

---

### Task 6: Real login (replace fake password)

**Files:**
- Modify: `src/admin/core.jsx`

- [ ] **Step 1: Rewrite AdminLogin to use Supabase**

In `src/admin/core.jsx`, replace the `AdminLogin` component body so it collects **email + password** and calls `signIn`. Add `import { signIn } from "@/lib/auth.js";` at top. New component:
```js
export function AdminLogin({ onAuthed }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr("");
    try { await signIn(email.trim(), pw); onAuthed && onAuthed(); }
    catch (e2) { setErr("Wrong email or password."); }
    finally { setBusy(false); }
  }
  return (
    <div className="admin-login">
      <div className="card card--pad-lg" style={{ maxWidth: 380, margin: "10vh auto" }}>
        <h2 style={{ marginTop: 0 }}>Sign in</h2>
        <form onSubmit={submit} noValidate>
          <Field label="Email" id="a-email"><Input id="a-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" /></Field>
          <Field label="Password" id="a-pw" error={err}><Input id="a-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Button type="submit" variant="primary" block disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
        </form>
        <button className="admin__navlink" style={{ marginTop: 14 }} onClick={() => go("home")}>← Back to website</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Remove the fake-password machinery**

In `src/admin/core.jsx`, delete `export function isAuthed()` and the `ADMIN_SESSION` usage in login. Keep the `ADMIN_SESSION` export ONLY if nothing else uses it — grep: `grep -rn "ADMIN_SESSION\|isAuthed" src` and remove remaining references (handled in Task 7 for manage.jsx). Note `drag-arrange.js` imports `ADMIN_SESSION`; leave the export in place for that, but it no longer gates admin.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: success (manage.jsx still references isAuthed — fixed next task; if build/runtime breaks, proceed to Task 7 immediately).

- [ ] **Step 4: Commit**

```bash
git add src/admin/core.jsx
git commit -m "feat: email+password login via Supabase Auth"
```

---

### Task 7: Role-gate the admin shell

**Files:**
- Modify: `src/admin/manage.jsx`

- [ ] **Step 1: Swap fake auth for session + role gating in AdminApp**

In `src/admin/manage.jsx`, update imports:
```js
import { AdminDashboard, AdminLogin, QRCanvas, downloadCSV, downloadQR, fmtDate } from "@/admin/core.jsx";
import { signOut } from "@/lib/auth.js";
import { visibleAdminTabs, canEnterAdmin } from "@/lib/roles.js";
import { ClientsAdmin } from "@/admin/superadmin.jsx";
```
Replace the `AdminApp` component's auth/tab logic. The new top of `AdminApp`:
```js
export function AdminApp() {
  const { settings, auth, clientId } = useStore();
  const [tab, setTab] = useState("dashboard");

  if (!auth.ready) return <div style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>…</div>;
  if (!auth.session) return <AdminLogin onAuthed={() => setTab("dashboard")} />;
  const profile = { role: auth.role, clientId: auth.clientId };
  if (!canEnterAdmin(profile, clientId)) {
    return (
      <div className="card card--pad-lg" style={{ maxWidth: 420, margin: "10vh auto", textAlign: "center" }}>
        <h2>No access</h2>
        <p style={{ color: "var(--ink-soft)" }}>This account can't manage this site.</p>
        <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
      </div>
    );
  }
  const tabs = visibleAdminTabs(auth.role, ADMIN_TABS);
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "dashboard";
  const title = (tabs.find((t) => t.key === activeTab) || { label: "Admin" }).label;
```
Then in the render: map over `tabs` (not `ADMIN_TABS`) in BOTH the sidebar `nav` and the `admin__mobilebar`; use `activeTab` for the active-class checks and the body switch; replace every `sessionStorage.removeItem(ADMIN_SESSION); setAuthed(false); go("home")` sign-out with `signOut().then(() => go("home"))`; and add the clients panel to the body switch:
```js
          {activeTab === "clients" && <ClientsAdmin />}
```

- [ ] **Step 2: Verify build**

Run: `npm run build && npm test`
Expected: build OK, tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/admin/manage.jsx
git commit -m "feat: role-gated admin shell (owner hides Settings/Clients, scoped to own client)"
```

---

### Task 8: Edge Function — create/reset owner login

**Files:**
- Create: `supabase/functions/admin-create-owner/index.ts`

- [ ] **Step 1: Write the function**

Create `supabase/functions/admin-create-owner/index.ts`:
```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const authHeader = req.headers.get("Authorization") || "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1. verify the CALLER is a superadmin (using their JWT)
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await caller.auth.getUser();
  if (!u?.user) return new Response("Unauthorized", { status: 401 });
  const { data: prof } = await caller.from("profiles").select("role").eq("id", u.user.id).single();
  if (prof?.role !== "superadmin") return new Response("Forbidden", { status: 403 });

  // 2. create/update the owner with the service role
  const { email, password, client_id } = await req.json();
  if (!email || !password || !client_id) return new Response("Bad request", { status: 400 });
  const admin = createClient(url, service);
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  let userId = created?.user?.id;
  if (error) {
    // user may already exist — find and reset their password instead
    const { data: list } = await admin.auth.admin.listUsers();
    const existing = list.users.find((x) => x.email === email);
    if (!existing) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    userId = existing.id;
    await admin.auth.admin.updateUserById(userId, { password });
  }
  await admin.from("profiles").upsert({ id: userId, role: "owner", client_id });
  return new Response(JSON.stringify({ ok: true, userId }), { headers: { "Content-Type": "application/json" } });
});
```

- [ ] **Step 2: Deploy the function**

Run (requires the Supabase CLI, logged in + linked to the project):
```bash
npx supabase functions deploy admin-create-owner --project-ref xprynknppsehuzqqdvue
```
`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are injected automatically for deployed functions. Expected: "Deployed Function admin-create-owner".

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/admin-create-owner/index.ts
git commit -m "feat(edge): admin-create-owner (superadmin-only owner provisioning)"
```

---

### Task 9: Superadmin Clients dashboard

**Files:**
- Create: `src/admin/superadmin.jsx`

- [ ] **Step 1: Implement ClientsAdmin**

Create `src/admin/superadmin.jsx`:
```js
import React from "react";
import { supabase } from "@/lib/supabase.js";
import { createOwner } from "@/lib/auth.js";
import { THEMES } from "@/themes";
import { themesForEvent } from "@/config/eventTypes.js";
import { Button, Field, Input, Select, SectionHead, toast } from "@/ui/components.jsx";
const { useState, useEffect } = React;

export function ClientsAdmin() {
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState({ subdomain: "", event_type: "wedding", template_key: "classic" });
  const [cred, setCred] = useState({ client_id: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase.from("clients").select("*").order("created_at", { ascending: false });
    setClients(data || []);
  }
  useEffect(() => { load(); }, []);

  async function createClient(e) {
    e.preventDefault();
    if (busy || !form.subdomain.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("clients").insert({ ...form, subdomain: form.subdomain.trim().toLowerCase() });
    setBusy(false);
    if (error) return toast("Create failed: " + error.message);
    setForm({ subdomain: "", event_type: "wedding", template_key: "classic" });
    toast("Client created"); load();
  }
  async function assignTheme(id, template_key) {
    const { error } = await supabase.from("clients").update({ template_key }).eq("id", id);
    if (error) return toast("Update failed"); toast("Theme assigned"); load();
  }
  async function setOwner(e) {
    e.preventDefault();
    if (busy || !cred.client_id || !cred.email || !cred.password) return;
    setBusy(true);
    try { await createOwner(cred); toast("Owner login set"); setCred({ client_id: "", email: "", password: "" }); }
    catch (e2) { toast("Failed: " + (e2.message || "error")); }
    finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <SectionHead eyebrow="Superadmin" title="Clients" />

      <form onSubmit={createClient} className="field-row field-row--2" style={{ alignItems: "end" }}>
        <Field label="Subdomain" id="c-sub"><Input id="c-sub" value={form.subdomain} onChange={(e) => setForm((f) => ({ ...f, subdomain: e.target.value }))} placeholder="johnandjane" /></Field>
        <Field label="Event type" id="c-evt">
          <Select id="c-evt" value={form.event_type} onChange={(e) => setForm((f) => ({ ...f, event_type: e.target.value, template_key: themesForEvent(e.target.value)[0] }))}>
            {["wedding", "birthday", "corporate"].map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Button type="submit" variant="primary" disabled={busy}>Create client</Button>
      </form>

      <table className="admin-table" style={{ marginTop: 20, width: "100%" }}>
        <thead><tr><th>Subdomain</th><th>Type</th><th>Theme</th></tr></thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id}>
              <td>{c.subdomain}</td>
              <td>{c.event_type}</td>
              <td>
                <Select value={c.template_key} onChange={(e) => assignTheme(c.id, e.target.value)}>
                  {themesForEvent(c.event_type).filter((k) => THEMES[k]).map((k) => <option key={k} value={k}>{THEMES[k].label}</option>)}
                </Select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <SectionHead eyebrow="Access" title="Set a client's owner login" />
      <form onSubmit={setOwner} className="field-row field-row--2" style={{ alignItems: "end" }}>
        <Field label="Client" id="o-client">
          <Select id="o-client" value={cred.client_id} onChange={(e) => setCred((c) => ({ ...c, client_id: e.target.value }))}>
            <option value="">Select…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.subdomain}</option>)}
          </Select>
        </Field>
        <Field label="Owner email" id="o-email"><Input id="o-email" type="email" value={cred.email} onChange={(e) => setCred((c) => ({ ...c, email: e.target.value }))} placeholder="owner@theirdomain" /></Field>
        <Field label="Password" id="o-pw"><Input id="o-pw" value={cred.password} onChange={(e) => setCred((c) => ({ ...c, password: e.target.value }))} /></Field>
        <Button type="submit" variant="primary" disabled={busy}>Set owner login</Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build && npm test`
Expected: build OK, tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/admin/superadmin.jsx
git commit -m "feat: superadmin Clients dashboard (create client, assign theme, set owner login)"
```

---

### Task 10: Per-client module flags (toggle modules on/off per client)

Superadmin toggles modules per client (`clients.content.modules`, e.g. `{ guestbook:false }`). A disabled module is hidden from the public nav + its route is blocked, and from the owner's admin tabs. Superadmin always sees everything. Default = on (absent key ⇒ enabled).

**Files:**
- Modify: `src/lib/roles.js`
- Test: `src/lib/__tests__/roles.test.js`
- Modify: `src/app/App.jsx` (nav + route gating)
- Modify: `src/admin/manage.jsx` (owner tab gating)
- Modify: `src/admin/superadmin.jsx` (toggle UI)

- [ ] **Step 1: Add the failing test for `moduleEnabled`**

Append to `src/lib/__tests__/roles.test.js`:
```js
import { moduleEnabled } from "@/lib/roles.js";

describe("moduleEnabled", () => {
  it("defaults to on when no modules map or key absent", () => {
    expect(moduleEnabled(undefined, "guestbook")).toBe(true);
    expect(moduleEnabled({}, "quiz")).toBe(true);
  });
  it("respects explicit flags", () => {
    expect(moduleEnabled({ quiz: false }, "quiz")).toBe(false);
    expect(moduleEnabled({ quiz: false, guestbook: true }, "guestbook")).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/lib/__tests__/roles.test.js`
Expected: FAIL — `moduleEnabled` not exported.

- [ ] **Step 3: Implement helper + owner module-tab filter**

Add to `src/lib/roles.js`:
```js
// Per-client module flags. modules = { guestbook:false, quiz:true, ... }; absent key = on.
export function moduleEnabled(modules, key) {
  if (!modules || !(key in modules)) return true;
  return !!modules[key];
}

// Admin tabs that correspond to a toggleable module (others — dashboard/qr — always show).
const TAB_MODULE = { rsvps: "rsvp", guestbook: "guestbook", quiz: "quiz", schedule: "schedule" };

// Filter already-role-gated tabs by the client's module flags (owners only; superadmin keeps all).
export function tabsForClient(tabs, role, modules) {
  if (role === "superadmin") return tabs;
  return tabs.filter((t) => !TAB_MODULE[t.key] || moduleEnabled(modules, TAB_MODULE[t.key]));
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/lib/__tests__/roles.test.js`
Expected: all passed.

- [ ] **Step 5: Gate the public nav + routes in App.jsx**

In `src/app/App.jsx`, import `moduleEnabled` and update `visibleNav` to also respect flags. Change its signature/body:
```js
import { hasSection } from "@/config/eventTypes.js";
import { moduleEnabled } from "@/lib/roles.js";

function visibleNav(eventType, modules) {
  return NAV_LINKS.filter((l) => l.key === "home" || (hasSection(eventType, l.key) && moduleEnabled(modules, l.key)));
}
```
Update the three `visibleNav(settings.eventType)` call sites to `visibleNav(settings.eventType, settings.modules)`. Then **block the route** for a disabled module — after `const Page = ROUTES[route] || Home;` add:
```js
  const routeBlocked = route !== "home" && route !== "admin" && !moduleEnabled(settings.modules, route);
  const ActivePage = routeBlocked ? Home : Page;
```
and render `<ActivePage />` instead of `<Page />` in the non-admin branch (so guests can't reach a disabled module by typing its URL).

- [ ] **Step 6: Gate owner admin tabs in manage.jsx**

In `src/admin/manage.jsx`, import `tabsForClient` and apply it after the role filter in `AdminApp`:
```js
import { visibleAdminTabs, canEnterAdmin, tabsForClient } from "@/lib/roles.js";
```
```js
  const roleTabs = visibleAdminTabs(auth.role, ADMIN_TABS);
  const tabs = tabsForClient(roleTabs, auth.role, settings.modules);
```
(`settings.modules` is already in the store — `clientToState` spreads `content` into `settings`, so `content.modules` lands at `settings.modules`.)

- [ ] **Step 7: Add module toggles to the superadmin dashboard**

In `src/admin/superadmin.jsx`, add a per-client module toggle UI. Add the module list + a save handler:
```js
const MODULES = ["story", "details", "schedule", "venue", "gallery", "guestbook", "quiz", "rsvp"];

async function toggleModule(c, key, on) {
  const modules = { ...(c.content?.modules || {}), [key]: on };
  const content = { ...(c.content || {}), modules };
  const { error } = await supabase.from("clients").update({ content }).eq("id", c.id);
  if (error) return toast("Update failed");
  load();
}
```
Render, per client row (or in an expandable panel), a checkbox per module:
```jsx
{MODULES.map((m) => (
  <label key={m} style={{ marginRight: 12 }}>
    <input type="checkbox"
      checked={(c.content?.modules?.[m]) !== false}
      onChange={(e) => toggleModule(c, m, e.target.checked)} /> {m}
  </label>
))}
```
(`!== false` makes absent default to checked/on.)

- [ ] **Step 8: Verify build + tests**

Run: `npm run build && npm test`
Expected: build OK, tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/roles.js src/lib/__tests__/roles.test.js src/app/App.jsx src/admin/manage.jsx src/admin/superadmin.jsx
git commit -m "feat: per-client module flags (hide module from owner admin + public site)"
```

---

### Task 11: End-to-end verification

- [ ] **Step 1: Superadmin path**

`npm run dev`; open `/?client=demo#/admin`. Sign in with your superadmin email/password.
- Expect: all tabs incl **Settings** and **Clients**.
- In **Clients**: create a client `testclient` (wedding); assign it a theme; set an owner login (`owner@testclient` + a password).
- Verify in Supabase: `clients` has `testclient`; `auth.users` has the owner; `profiles` row for the owner has `role='owner'` and `client_id` = testclient's id.

- [ ] **Step 2: Owner path (scoping + hidden Settings/Media + module flags)**

As superadmin, in **Clients**, disable the **quiz** module for `testclient`. Then open `/?client=testclient#/admin`, sign in as `owner@testclient`.
- Expect: admin loads, **no Settings tab, no Media tab, no Clients tab**, and **no Quiz tab** (module disabled).
- Visit `/?client=testclient#/quiz` (public) → not shown in nav and the route falls back to Home (guests can't reach a disabled module).
- Re-enable quiz as superadmin → Quiz tab + public quiz reappear.
- Open `/?client=demo#/admin` while signed in as that owner → **"No access"** (owner is scoped to testclient).

- [ ] **Step 3: Negative path**

Signed out → `/admin` shows the login. Wrong password → "Wrong email or password."

- [ ] **Step 4: Build + tests + commit a verification note**

Run: `npm run build && npm test` (all green). No code commit needed if Steps 1-3 pass; otherwise file fixes against the failing task.

---

## What this delivers / what's next

**Delivered:** real Supabase Auth login; superadmin (you) with a universal login + full admin (incl. **Settings** and **Media**, both superadmin-only) + a Clients dashboard to create clients, assign themes, create/reset each client's owner login, **and toggle which modules each client gets**; owners who log in only on their own subdomain, never see Settings/Media/Clients, and only see modules the superadmin enabled (a disabled module is hidden from their admin AND from the public site/nav/route). RLS enforces that only a superadmin can write `clients`.

**Next — Phase 2b (separate plan):** wire owner-facing admin *writes* to Supabase (guestbook moderation, RSVP list/export, content + theme edits by owners) with owner RLS write policies scoped by `auth_client()`, and verify per-tenant isolation with a second client. Then Phase 3: media uploads → R2.

## Self-review notes

- **Spec coverage:** real login (Task 6), role-gated Settings hidden for owner (Tasks 2,7), superadmin universal + sees Settings (Task 7), superadmin sets own creds (Task 1 Step 3 bootstrap), sets client creds via dashboard (Tasks 8,9), superadmin dashboard (Task 9). All requested items covered.
- **Security:** anon key public → RLS is the boundary; owner-account creation is service-role and gated to superadmin inside the Edge Function (verifies caller's `profiles.role`). `auth_role()`/`auth_client()` are `security definer` to avoid RLS recursion.
- **Type/name consistency:** `Store.setAuth({session,role,clientId,email})` ↔ `auth.{role,clientId}` read in `AdminApp`; `visibleAdminTabs(role, allTabs)` / `canEnterAdmin(profile, clientId)` signatures match their tests and call sites; `createOwner({email,password,clientId})` ↔ edge body `{email,password,client_id}`.
- **Deferred explicitly:** owner content/moderation persistence + media (Phase 2b/3) — owners can log in and navigate, but their *content writes* still hit the local store until 2b; called out so it isn't mistaken as done.
