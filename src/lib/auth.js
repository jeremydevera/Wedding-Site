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
  // restored sessions must also open the drag-arrange admin gate — signIn() sets
  // this flag, but a reload restores the Supabase session without calling signIn
  if (p.role === "owner" || p.role === "superadmin") {
    try { sessionStorage.setItem("evermore_admin_session", "1"); } catch (e) {}
  }
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const p = await profileFor(data.user.id);
  Store.setAuth({ session: data.session, role: p.role, clientId: p.client_id, email: data.user.email });
  // keep the drag-arrange admin gate working (it reads this sessionStorage key)
  try { sessionStorage.setItem("evermore_admin_session", "1"); } catch (e) {}
  return p;
}

export async function signOut() {
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
