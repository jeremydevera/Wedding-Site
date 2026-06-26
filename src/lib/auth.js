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

// Superadmin-only: create the owner, or reset an existing owner's password.
export async function createOwner({ email, password, client_id }) {
  const { data, error } = await supabase.functions.invoke("admin-create-owner", {
    body: { email, password, client_id },
  });
  if (error) throw error;
  return data;
}

// Superadmin-only: change an existing owner's login email.
export async function updateOwnerEmail({ old_email, new_email }) {
  const { data, error } = await supabase.functions.invoke("admin-create-owner", {
    body: { action: "update_email", old_email, new_email },
  });
  if (error) throw error;
  return data;
}

// Superadmin-only: delete an owner's auth account (its profile cascades).
// Pass any of email / user_id / client_id; the function resolves the user.
export async function deleteOwner({ email, user_id, client_id }) {
  const { data, error } = await supabase.functions.invoke("admin-create-owner", {
    body: { action: "delete_owner", email, user_id, client_id },
  });
  if (error) throw error;
  return data;
}
