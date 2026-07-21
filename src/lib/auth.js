import { supabase } from "@/lib/supabase.js";
import { Store } from "@/lib/store.jsx";
import { neonAuth, authedRpc, neonAuthedSelect, NEON_SHARDS_KEY, setNeonRegistry, resolveShardId, setActiveShard } from "@/lib/neon.js";
import { resolveSubdomain } from "@/lib/tenant.js";

async function profileFor(userId) {
  const { data } = await supabase.from("profiles").select("role,client_id").eq("id", userId).single();
  return data || { role: "guest", client_id: null };
}

const gateFlag = () => { try { sessionStorage.setItem("evermore_admin_session", "1"); } catch (e) {} };

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
    const prof = await neonAuthedSelect("profiles", `select=role&id=eq.${encodeURIComponent(s.user.id)}`).catch(() => null);
    if (prof && prof[0] && prof[0].role === "superadmin") {
      Store.setAuth({ session: s, role: "superadmin", clientId: Store.get().clientId, email: s.user.email });
      gateFlag();
      return { role: "superadmin", client_id: Store.get().clientId };
    }
    const st = await authedRpc("my_registration_state").catch(() => null);
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
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) { Store.setAuth({ session: null, role: null, clientId: null, email: null }); return; }
  const p = await profileFor(session.user.id);
  Store.setAuth({ session, role: p.role, clientId: p.client_id, email: session.user.email });
  // restored sessions must also open the drag-arrange admin gate — signIn() sets
  // this flag, but a reload restores the Supabase session without calling signIn
  if (p.role === "owner" || p.role === "superadmin") gateFlag();
}

export async function signIn(email, password) {
  if (Store.get().neonMode) {
    await neonAuth.signIn(email, password);           // sets the Data API JWT via proxied header
    const p = await loadNeonSession();
    if (!p) throw new Error("This account doesn't have access to this site's admin.");
    return p;
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Apex (celebrately.us/admin) only: a self-serve owner's account lives in
    // NEON Auth, not Supabase, so the Supabase sign-in fails. Try Neon — if the
    // account owns a live site, send her to HER OWN admin (her subdomain; the
    // shared .celebrately.us session cookie means she lands signed in).
    if (!resolveSubdomain()) {
      try {
        // Apex never runs loadClientData's Neon branch, so the shard registry is
        // unloaded here — resolve it (default shard) before hitting Neon Auth.
        // Direct supabase read: importing getAppConfig from api.js would be an
        // import cycle (api.js imports this file).
        try {
          const { data } = await supabase.from("app_config").select("value").eq("key", NEON_SHARDS_KEY).maybeSingle();
          setNeonRegistry(data?.value || null);
          setActiveShard(resolveShardId(""));
        } catch (e3) { /* builtin s1 fallback */ }
        await neonAuth.signIn(email, password);
        const st = await authedRpc("my_registration_state").catch(() => null);
        if (st?.state === "active" && st.subdomain) {
          window.location.assign(`https://${st.subdomain}.celebrately.us/admin`);
          return { role: "owner", client_id: null, redirecting: true };
        }
        if (st?.state === "pending") throw new Error("Your site is waiting for approval — check back soon.");
      } catch (e2) {
        if (e2 && e2.message && /waiting for approval/.test(e2.message)) throw e2;
        /* fall through to the original Supabase error */
      }
    }
    throw error;
  }
  const p = await profileFor(data.user.id);
  Store.setAuth({ session: data.session, role: p.role, clientId: p.client_id, email: data.user.email });
  gateFlag();
  return p;
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
