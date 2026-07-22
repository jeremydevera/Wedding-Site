import { supabase } from "@/lib/supabase.js";
import { Store } from "@/lib/store.jsx";
import { neonAuth, authedRpc, neonAuthedSelect, NEON_SHARDS_KEY, FB_AUTH_FLAG_KEY, setNeonRegistry, resolveShardId, setActiveShard, fbAuthMode, setFbAuthMode } from "@/lib/neon.js";
import { resolveSubdomain } from "@/lib/tenant.js";

async function profileFor(userId) {
  const { data } = await supabase.from("profiles").select("role,client_id").eq("id", userId).single();
  return data || { role: "guest", client_id: null };
}

const gateFlag = () => { try { sessionStorage.setItem("evermore_admin_session", "1"); } catch (e) {} };

// my_registration_state with one retry — the first authed RPC right after a
// Neon-Auth sign-in can flake to {state:'anon'} while the JWT session warms up
// (observed live; Register.jsx does the same). Without the retry a legit owner's
// first admin sign-in gets treated as "no access". Returns null on hard failure.
async function regState() {
  let st = await authedRpc("my_registration_state").catch(() => null);
  if (st && st.state === "anon") {
    await new Promise((r) => setTimeout(r, 600));
    st = await authedRpc("my_registration_state").catch(() => null);
  }
  return st;
}

// Where does this owner belong? Resolves the admin URL of the client an owner
// profile points at (Supabase-side). Null if the client row can't be read.
export async function ownerHomeUrl(clientId) {
  if (!clientId) return null;
  try {
    const { data } = await supabase.from("clients").select("subdomain").eq("id", clientId).maybeSingle();
    return data?.subdomain ? `https://${data.subdomain}.celebrately.us/admin` : null;
  } catch (e) { return null; }
}

// Supabase sessions are per-origin (localStorage) — a cross-subdomain redirect
// would land the owner signed OUT and make her log in twice. Hand the session
// over in the URL FRAGMENT (never sent to any server; same pattern Supabase's
// own email-link flow uses) and consume it immediately on the other side.
function withSbHandoff(url) {
  try {
    const raw = localStorage.getItem(Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k)));
    const tok = JSON.parse(raw);
    const at = tok?.access_token, rt = tok?.refresh_token;
    if (at && rt) return `${url}#sbsess=${encodeURIComponent(btoa(JSON.stringify({ at, rt })))}`;
  } catch (e) { /* no handoff — she'll sign in on her own site */ }
  return url;
}

// Boot-time consumer for the handoff fragment. Called from loadSession before
// the session read; strips the fragment from history either way.
async function consumeSbHandoff() {
  const m = /[#&]sbsess=([^&]+)/.exec(window.location.hash || "");
  if (!m) return;
  try { window.history.replaceState(null, "", window.location.pathname + window.location.search); } catch (e) { /* ignore */ }
  try {
    const { at, rt } = JSON.parse(atob(decodeURIComponent(m[1])));
    if (at && rt) await supabase.auth.setSession({ access_token: at, refresh_token: rt });
  } catch (e) { /* bad/expired handoff — normal login form takes over */ }
}

// Apex helpers run OUTSIDE loadClientData's Neon branches, so the shard
// registry AND the Firebase-auth flag are unloaded there — resolve both before
// touching neonAuth. Direct supabase reads: importing getAppConfig from api.js
// would be an import cycle (api.js imports this file).
async function loadApexNeonCtx() {
  try {
    const [{ data: shards }, { data: fb }] = await Promise.all([
      supabase.from("app_config").select("value").eq("key", NEON_SHARDS_KEY).maybeSingle(),
      supabase.from("app_config").select("value").eq("key", FB_AUTH_FLAG_KEY).maybeSingle(),
    ]);
    setNeonRegistry(shards?.value || null);
    setFbAuthMode(fb?.value?.enabled === true);
  } catch (e) { /* builtin s1 fallback; fb mode stays as-is */ }
  setActiveShard(resolveShardId(""));
}

// ---- Neon admin auth (Better Auth via the first-party /api/auth proxy) --------
// A neonMode client authenticates its OWNER against Neon Auth, not Supabase.
// Ownership is proven server-side by my_registration_state() (state 'active' +
// the subdomain), so we don't need to read profiles from the client. The
// superadmin still uses Supabase + the console for Neon clients; this path is
// the client owner's own admin login.
async function loadNeonSession() {
  try {
    const s = await neonAuth.session();
    if (!s || !s.user) { Store.setAuth({ session: null, role: null, clientId: null, email: null }); return null; }
    // Platform owner: a Neon `profiles` row with role superadmin (created once
    // per shard via the console's ensure_superadmin action) grants the full
    // admin on ANY Neon client — same model as Supabase RLS superadmin.
    // Self-readable via RLS; owners/others simply get no row back.
    // Same warm-up flake as regState(): the first authed read after sign-in can
    // run as 'anon' (permission denied) — retry once on ERROR only. A clean
    // empty result is a legit non-superadmin, no retry (keeps owner sign-in fast).
    const readProf = () => neonAuthedSelect("profiles", `select=role&id=eq.${encodeURIComponent(s.user.id)}`).then((rows) => ({ ok: true, rows })).catch(() => ({ ok: false, rows: null }));
    let pr = await readProf();
    if (!pr.ok) { await new Promise((r) => setTimeout(r, 600)); pr = await readProf(); }
    const prof = pr.rows;
    if (prof && prof[0] && prof[0].role === "superadmin") {
      Store.setAuth({ session: s, role: "superadmin", clientId: Store.get().clientId, email: s.user.email });
      gateFlag();
      return { role: "superadmin", client_id: Store.get().clientId };
    }
    const st = await regState();
    if (st && st.state === "active" && st.subdomain === resolveSubdomain()) {
      Store.setAuth({ session: s, role: "owner", clientId: Store.get().clientId, email: s.user.email });
      gateFlag();
      return { role: "owner", client_id: Store.get().clientId };
    }
    // Signed into Neon Auth but not the owner of THIS site → no admin access here.
    Store.setAuth({ session: null, role: null, clientId: null, email: null });
    return null;
  } catch (e) {
    Store.setAuth({ session: null, role: null, clientId: null, email: null });
    return null;
  }
}

// Load the current session + profile into the store. Call once at boot.
export async function loadSession() {
  if (Store.get().neonMode) return void (await loadNeonSession());
  await consumeSbHandoff();
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) {
    // Apex /admin ONLY, with NO Supabase session: an existing NEON/Firebase
    // session (self-serve registrant) must not be shown the login form again —
    // route her onward: site owner → her admin; wizard unfinished → /register.
    // The BARE apex (/) never auto-redirects (owner request 2026-07-22: with the
    // shared session cookie it made celebrately.us itself unreachable for
    // signed-in owners). The superadmin (who also has a Neon profile) falls
    // through to the normal console login. /register itself never loops.
    if (!resolveSubdomain() && /^\/admin\/?$/.test(window.location.pathname)) {
      try {
        await loadApexNeonCtx();
        const s = await neonAuth.session();
        if (s && s.user) {
          const prof = await neonAuthedSelect("profiles", `select=role&id=eq.${encodeURIComponent(s.user.id)}`).catch(() => null);
          const isSA = prof && prof[0] && prof[0].role === "superadmin";
          if (!isSA) {
            const st = await regState();
            if (st?.state === "active" && st.subdomain) { window.location.assign(`https://${st.subdomain}.celebrately.us/admin`); return; }
            if (st?.state === "none") { window.location.assign("/register"); return; }
            // pending → fall through: the login form's messages cover it
          }
        }
      } catch (e2) { /* no Neon session — show the login form */ }
    }
    Store.setAuth({ session: null, role: null, clientId: null, email: null }); return;
  }
  const p = await profileFor(session.user.id);
  Store.setAuth({ session, role: p.role, clientId: p.client_id, email: session.user.email });
  // restored sessions must also open the drag-arrange admin gate — signIn() sets
  // this flag, but a reload restores the Supabase session without calling signIn
  if (p.role === "owner" || p.role === "superadmin") gateFlag();
}

export async function signIn(email, password) {
  if (Store.get().neonMode) {
    let fbErr = null;
    try {
      await neonAuth.signIn(email, password);         // Firebase (or legacy Neon Auth)
      const p = await loadNeonSession();
      if (p) return p;
      // Signed in fine but this isn't her site — send her HOME instead of a
      // dead "no access" (the shared fb-session cookie keeps her signed in).
      const st = await regState();
      if (st?.state === "active" && st.subdomain && st.subdomain !== resolveSubdomain()) {
        window.location.assign(`https://${st.subdomain}.celebrately.us/admin`);
        return { role: "owner", client_id: null, redirecting: true };
      }
      throw new Error("This account doesn't have access to this site's admin.");
    } catch (e1) {
      if (e1 && /doesn't have access/.test(e1.message || "")) throw e1;
      fbErr = e1;
    }
    // Cross-backend: a SUPABASE-era owner (e.g. demo@) typed her password on a
    // Firebase site's login. Sign her into Supabase and send her to HER site.
    try {
      const { data: d2, error: e2 } = await supabase.auth.signInWithPassword({ email, password });
      if (!e2 && d2?.user) {
        const p2 = await profileFor(d2.user.id);
        if (p2.role === "owner" && p2.client_id) {
          const url = await ownerHomeUrl(p2.client_id);
          if (url) { window.location.assign(withSbHandoff(url)); return { ...p2, redirecting: true }; }
        }
        await supabase.auth.signOut().catch(() => {});
      }
    } catch (e3) { /* fall through to the Firebase error */ }
    throw fbErr;
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // A self-serve owner's account lives in FIREBASE, not Supabase, so the
    // Supabase sign-in fails (apex AND Supabase-era client logins). Try the
    // Firebase side — if the account owns a live site, send her to HER OWN
    // admin (the shared .celebrately.us session cookie keeps her signed in).
    {
      try {
        await loadApexNeonCtx();
        const ns = await neonAuth.signIn(email, password);
        // Superadmin guard (mirror loadNeonSession): the SA also has a Neon
        // account (ensure_superadmin). If they signed in with their NEON password
        // at the apex, regState would say 'none' (SA owns no client site) and we'd
        // wrongly bounce them to /register. Never route the SA to registration —
        // sign the Neon session back out and surface the Supabase error so they
        // retry with their console (Supabase) password.
        const suid = ns?.user?.id;
        if (suid) {
          const prof = await neonAuthedSelect("profiles", `select=role&id=eq.${encodeURIComponent(suid)}`).catch(() => null);
          if (prof && prof[0] && prof[0].role === "superadmin") { await neonAuth.signOut().catch(() => {}); throw error; }
        }
        const st = await regState();
        if (st?.state === "active" && st.subdomain) {
          window.location.assign(`https://${st.subdomain}.celebrately.us/admin`);
          return { role: "owner", client_id: null, redirecting: true };
        }
        if (st?.state === "pending") throw new Error("Your site is waiting for approval — check back soon.");
        // Signed in fine but no site yet — she registered and stopped before
        // finishing the wizard. Send her back to /register to continue (the
        // shared session cookie + saved draft resume exactly where she left off).
        // Without this she fell through to "wrong email or password" despite a
        // successful sign-in. Only from the apex — on a client's login a
        // site-less account is just a wrong account.
        if (!resolveSubdomain()) { window.location.assign("/register"); return { role: "guest", client_id: null, redirecting: true }; }
        await neonAuth.signOut().catch(() => {});
        throw error;
      } catch (e2) {
        if (e2 && e2.message && /waiting for approval/.test(e2.message)) throw e2;
        // Registered but never entered the emailed code — the password was RIGHT,
        // so "wrong email or password" would gaslight her. Say what to do instead.
        if (e2 && e2.message && /not verified/i.test(e2.message)) {
          throw new Error("Your email isn't verified yet — go to celebrately.us/register, sign in, and enter the 6-digit code we emailed you.");
        }
        /* fall through to the original Supabase error */
      }
    }
    throw error;
  }
  const p = await profileFor(data.user.id);
  // Owner signing in at the apex or on someone ELSE's site: correct behavior is
  // landing on HER OWN admin, not a "can't manage this site" wall (owner request
  // 2026-07-22). Session rides along in the URL fragment.
  if (p.role === "owner" && p.client_id && p.client_id !== Store.get().clientId) {
    const url = await ownerHomeUrl(p.client_id);
    if (url) { window.location.assign(withSbHandoff(url)); return { ...p, redirecting: true }; }
  }
  Store.setAuth({ session: data.session, role: p.role, clientId: p.client_id, email: data.user.email });
  gateFlag();
  return p;
}

// "Forgot your password?" from the login screen. Supabase-side accounts
// (superadmin + existing Supabase owners) get a reset link. Enumeration-safe:
// Supabase always resolves without revealing whether the email exists, and we
// never surface an error to the caller — the UI shows the same neutral message
// regardless. Neon self-serve owners set their password via the emailed link
// from approval, so this covers the accounts that have a password to reset.
export async function requestPasswordReset(email) {
  const addr = (email || "").trim();
  if (!addr) return;
  try {
    await supabase.auth.resetPasswordForEmail(addr, { redirectTo: `${window.location.origin}/admin` });
  } catch (e) { /* enumeration-safe: never leak success/failure */ }
}

// Google login (Firebase). On a Neon client's admin: sign in + require owner/SA
// of THIS site. On the apex hub: route like the password fallback — owner with a
// live site → her admin; unfinished → /register; SA → refuse (console uses the
// admin password). Supabase client sites: not supported, actionable error.
export async function signInGoogle() {
  if (Store.get().neonMode) {
    await neonAuth.signInGoogle();
    const p = await loadNeonSession();
    if (!p) {
      const st = await regState();
      if (st?.state === "active" && st.subdomain && st.subdomain !== resolveSubdomain()) {
        window.location.assign(`https://${st.subdomain}.celebrately.us/admin`);
        return { role: "owner", client_id: null, redirecting: true };
      }
      await neonAuth.signOut().catch(() => {});
      throw new Error("That Google account doesn't have access to this site's admin.");
    }
    return p;
  }
  if (resolveSubdomain()) throw new Error("Google login isn't available for this site — sign in with your email & password.");
  await loadApexNeonCtx();
  if (!fbAuthMode()) throw new Error("Google login isn't available yet — sign in with your email & password.");
  const ns = await neonAuth.signInGoogle();
  const suid = ns?.user?.id;
  if (suid) {
    const prof = await neonAuthedSelect("profiles", `select=role&id=eq.${encodeURIComponent(suid)}`).catch(() => null);
    if (prof && prof[0] && prof[0].role === "superadmin") {
      await neonAuth.signOut().catch(() => {});
      throw new Error("That's the platform admin's Google account — sign in below with your admin email & password.");
    }
  }
  const st = await regState();
  if (st?.state === "active" && st.subdomain) {
    window.location.assign(`https://${st.subdomain}.celebrately.us/admin`);
    return { role: "owner", client_id: null, redirecting: true };
  }
  if (st?.state === "pending") throw new Error("Your site is waiting for approval — check back soon.");
  window.location.assign("/register");
  return { role: "guest", client_id: null, redirecting: true };
}

export async function signOut() {
  if (Store.get().neonMode) {
    try { await neonAuth.signOut(); } catch (e) { /* ignore */ }
    try { sessionStorage.removeItem("evermore_admin_session"); } catch (e) {}
    Store.setAuth({ session: null, role: null, clientId: null, email: null });
    return;
  }
  // clear locally even if the network call fails, and never reject
  try { await supabase.auth.signOut(); } catch (e) { /* ignore */ }
  try { sessionStorage.removeItem("evermore_admin_session"); } catch (e) {}
  Store.setAuth({ session: null, role: null, clientId: null, email: null });
}

// Invoke the superadmin edge function with a FRESHLY-REFRESHED access token.
// getSession() refreshes an expired token before we read it, and we attach it
// explicitly — otherwise a long-open console sends a stale JWT and the function
// rejects with 401 (seen in prod: password resets silently failed). Also surface
// the function's JSON `{error}` body, which supabase-js hides behind a generic
// "non-2xx" FunctionsHttpError.
async function invokeOwnerFn(body) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const { data, error } = await supabase.functions.invoke("admin-create-owner", {
    body,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
  if (error) {
    let msg = error.message || "Request failed";
    try { const detail = await error.context?.json?.(); if (detail?.error) msg = detail.error; } catch (_) {}
    if (!token || /unauthor|forbidden|jwt|token/i.test(msg)) msg = "Your session expired — sign in again, then retry.";
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

// Superadmin-only: create the owner, or reset an existing owner's password.
export async function createOwner({ email, password, client_id }) {
  return invokeOwnerFn({ email, password, client_id });
}

// Superadmin-only: change an existing owner's login email.
export async function updateOwnerEmail({ old_email, new_email }) {
  return invokeOwnerFn({ action: "update_email", old_email, new_email });
}

// Superadmin-only: delete an owner's auth account (its profile cascades).
// Pass any of email / user_id / client_id; the function resolves the user.
export async function deleteOwner({ email, user_id, client_id }) {
  return invokeOwnerFn({ action: "delete_owner", email, user_id, client_id });
}

// Superadmin-only: email the owner a "set your password" (recovery) link + their
// site link — the same message auto-approve sends. Used on MANUAL approval so
// the client can set their own password. Sent server-side (needs service role +
// Resend); the owner login itself is still created separately (createOwner).
export async function sendSetupEmail({ email, subdomain, name }) {
  return invokeOwnerFn({ action: "send_setup_email", email, subdomain, name });
}
