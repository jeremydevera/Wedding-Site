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
