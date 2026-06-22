import { supabase } from "@/lib/supabase.js";
import { Store } from "@/lib/store.jsx";
import { resolveSubdomain } from "@/lib/tenant.js";
import { clientToState, rowToGuestbook, rsvpToRow, guestbookToRow, quizToRow } from "@/lib/mappers.js";

// Boot: load the active client + approved guestbook, hydrate the store cache.
export async function loadClientData() {
  const subdomain = resolveSubdomain();
  const { data: client, error } = await supabase
    .from("clients").select("*").eq("subdomain", subdomain).eq("is_active", true).single();
  if (error || !client) {
    console.warn("[api] client not found for subdomain:", subdomain, error?.message);
    Store.hydrate({}); // clears loading; falls back to seed defaults
    return;
  }
  const state = clientToState(client);
  const { data: gb } = await supabase
    .from("guestbook").select("*").eq("client_id", client.id)
    .eq("status", "approved").order("created_at", { ascending: false });
  Store.hydrate({ ...state, guestbook: (gb || []).map(rowToGuestbook) });
}

export async function postRsvp(form) {
  const clientId = Store.get().clientId;
  const { error } = await supabase.from("rsvps").insert(rsvpToRow(form, clientId));
  if (error) throw error;
  Store.addRSVP(form); // local echo (admin view this session)
}

export async function postGuestbook(entry) {
  const clientId = Store.get().clientId;
  const autoApprove = Store.get().settings.autoApproveGuestbook;
  const status = autoApprove ? "approved" : "pending";
  const { data, error } = await supabase
    .from("guestbook").insert(guestbookToRow(entry, clientId, status)).select().single();
  if (error) throw error;
  if (status === "approved") {
    Store.addGuestbook({ ...entry, id: data.id, status: "visible" });
  }
  return { status };
}

export async function postQuiz(sub) {
  const clientId = Store.get().clientId;
  const { error } = await supabase.from("quiz_answers").insert(quizToRow(sub, clientId));
  if (error) throw error;
  Store.addQuizSub(sub); // local echo
}
