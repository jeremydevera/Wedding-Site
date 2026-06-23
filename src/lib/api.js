import { supabase } from "@/lib/supabase.js";
import { Store } from "@/lib/store.jsx";
import { resolveSubdomain } from "@/lib/tenant.js";
import { clientToState, stateToClientRow, rowToGuestbook, rowToRsvp, rowToQuizSub, rsvpToRow, guestbookToRow, quizToRow } from "@/lib/mappers.js";
import { loadSession } from "@/lib/auth.js";

// Boot: load the active client + approved guestbook, hydrate the store cache.
export async function loadClientData() {
  const subdomain = resolveSubdomain();
  const { data: client, error } = await supabase
    .from("clients").select("*").eq("subdomain", subdomain).eq("is_active", true).single();
  if (error || !client) {
    console.warn("[api] client not found for subdomain:", subdomain, error?.message);
    await loadSession(); // always resolve auth so admin doesn't hang on the loading gate
    Store.hydrate({}); // clears loading; falls back to seed defaults
    return;
  }
  const state = clientToState(client);
  const { data: gb, error: gbErr } = await supabase
    .from("guestbook").select("*").eq("client_id", client.id)
    .eq("status", "approved").order("created_at", { ascending: false });
  if (gbErr) console.warn("[api] guestbook fetch failed:", gbErr.message);
  // only replace guestbook when the fetch succeeded — a failed query must not wipe it
  Store.hydrate({ ...state, ...(gb ? { guestbook: gb.map(rowToGuestbook) } : { guestbook: [] }) });
  await loadSession();
}

export async function postRsvp(form) {
  const clientId = Store.get().clientId;
  const { error } = await supabase.from("rsvps").insert(rsvpToRow(form, clientId));
  if (error) throw error;
  Store.addRSVP(form); // local echo (admin view this session)
}

export async function postGuestbook(entry) {
  const clientId = Store.get().clientId;
  // status is decided server-side by the guestbook_set_status trigger (honors the
  // client's auto-approve), so the inserted value here is just a placeholder.
  const { data, error } = await supabase
    .from("guestbook").insert(guestbookToRow(entry, clientId, "pending")).select().single();
  if (error) throw error;
  if (data.status === "approved") {
    Store.addGuestbook({ ...entry, id: data.id, status: "visible" });
  }
  return { status: data.status };
}

export async function postQuiz(sub) {
  const clientId = Store.get().clientId;
  const { error } = await supabase.from("quiz_answers").insert(quizToRow(sub, clientId));
  if (error) throw error;
  Store.addQuizSub(sub); // local echo
}

// Admin: load the active client's submissions from the DB into the store.
// RLS scopes this to the owner's own client (or any client for a superadmin).
export async function loadAdminData() {
  const clientId = Store.get().clientId;
  if (!clientId) return;
  const [rs, gb, qz] = await Promise.all([
    supabase.from("rsvps").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
    supabase.from("guestbook").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
    supabase.from("quiz_answers").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
  ]);
  if (rs.error) console.warn("[api] rsvps load failed:", rs.error.message);
  if (gb.error) console.warn("[api] guestbook load failed:", gb.error.message);
  if (qz.error) console.warn("[api] quiz load failed:", qz.error.message);
  Store.setSubmissions({
    rsvps: (rs.data || []).map(rowToRsvp),
    guestbook: (gb.data || []).map(rowToGuestbook),
    quizSubs: (qz.data || []).map(rowToQuizSub),
  });
}

// Admin moderation — write-through to the DB (caller updates the store optimistically).
const GB_DB_STATUS = { visible: "approved", hidden: "hidden", pending: "pending" };
export async function setGuestbookStatusDb(id, storeStatus) {
  const { error } = await supabase.from("guestbook").update({ status: GB_DB_STATUS[storeStatus] || "pending" }).eq("id", id);
  if (error) { console.warn("[api] guestbook status update failed:", error.message); throw error; }
}
export async function deleteGuestbookDb(id) {
  const { error } = await supabase.from("guestbook").delete().eq("id", id);
  if (error) { console.warn("[api] guestbook delete failed:", error.message); throw error; }
}
export async function deleteRsvpDb(id) {
  const { error } = await supabase.from("rsvps").delete().eq("id", id);
  if (error) { console.warn("[api] rsvp delete failed:", error.message); throw error; }
}

// Persist the current client's settings + content (theme, names, schedule, story,
// modules, …) back to Supabase. RLS lets the superadmin save any client and an
// owner save their own.
export async function saveClientData() {
  const clientId = Store.get().clientId;
  if (!clientId) throw new Error("No client loaded");
  const { error } = await supabase.from("clients").update(stateToClientRow(Store.get())).eq("id", clientId);
  if (error) { console.warn("[api] save failed:", error.message); throw error; }
}
