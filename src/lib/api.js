import { supabase } from "@/lib/supabase.js";
import { Store } from "@/lib/store.jsx";
import { resolveSubdomain } from "@/lib/tenant.js";
import { clientToState, stateToClientRow, rowToGuestbook, rowToRsvp, rowToQuizSub, rsvpToRow, guestbookToRow, quizToRow, guestToRow, rowToGuest, ticketToRow } from "@/lib/mappers.js";
import { loadSession, createOwner } from "@/lib/auth.js";
import { DEFAULT_CLIENT_MODULES } from "@/lib/roles.js";

// Boot: load the active client + approved guestbook, hydrate the store cache.
export async function loadClientData() {
  const subdomain = resolveSubdomain();
  if (!subdomain) { // platform hub (bare apex) — no client site, just the admin login/console
    await loadSession();
    Store.hydrate({ clientId: null, notFound: false }); // no client context on the hub
    return;
  }
  const { data: client, error } = await supabase
    .from("clients").select("*").eq("subdomain", subdomain).eq("is_active", true).single();
  if (error || !client) {
    console.warn("[api] client not found for subdomain:", subdomain, error?.message);
    await loadSession(); // always resolve auth so admin doesn't hang on the loading gate
    // No active client for this subdomain (deleted / never existed / deactivated).
    // Flag it so the app shows an "unavailable" page instead of seed content.
    Store.hydrate({ clientId: null, notFound: true });
    return;
  }
  const state = clientToState(client);
  // The public guestbook lazy-loads its own pages on the Guestbook page
  // (infinite scroll), so boot no longer waits on fetching every message.
  Store.hydrate({ ...state, guestbook: [] });
  await loadSession();
}

export async function postRsvp(form) {
  const clientId = Store.get().clientId;
  const { error } = await supabase.from("rsvps").insert(rsvpToRow(form, clientId));
  if (error) throw error;
  Store.addRSVP(form); // local echo (admin view this session)
}

// Has someone already RSVP'd under this exact name for the current client?
// Uses a SECURITY DEFINER RPC that returns only a boolean — guests can't read
// the RSVP list itself (RLS). Fails open (returns false) so a check error never
// blocks a legitimate RSVP.
export async function rsvpNameTaken(first, middle, last) {
  const clientId = Store.get().clientId;
  if (!clientId || !(first || "").trim() || !(last || "").trim()) return false;
  const { data, error } = await supabase.rpc("rsvp_name_taken", {
    p_client_id: clientId, p_first: first || "", p_middle: middle || "", p_last: last || "",
  });
  if (error) { console.warn("[api] rsvp_name_taken failed:", error.message); return false; }
  return !!data;
}

// Update-or-insert an RSVP by fuzzy name match via the rsvp_upsert RPC. Used by
// the public form's "update my response" path (an anon guest can't UPDATE the
// rsvps table directly under RLS). `form` is the same shape passed to postRsvp.
export async function upsertRsvp(form) {
  const clientId = Store.get().clientId;
  const { error } = await supabase.rpc("rsvp_upsert", {
    p_client_id: clientId,
    p_first: form.firstName || "", p_middle: form.middleName || "", p_last: form.lastName || "",
    p_full_name: form.fullName || "", p_email: form.email || "", p_phone: form.phone || "",
    p_status: form.status, p_count: form.count || 0,
    p_plus_one: form.plusOne || "", p_diet: form.diet || "None", p_diet_notes: form.dietNotes || "",
    p_song: form.song || "", p_notes: form.notes || "",
    p_companions: Array.isArray(form.companions) ? form.companions : [],
  });
  if (error) throw error;
}

// Strict RSVP: look up the invited guest's seat allocation by name via the
// rsvp_guest_allocation RPC (SECURITY DEFINER — returns a status object, never
// the list; and always not_found unless the client enabled strictRsvp).
// Returns { status: "ok"|"ambiguous"|"not_found", allocation: number|null }.
// "ambiguous" = several guests share the first+last name and the middle name
// didn't single one out. Throws on RPC error so the submit gate can distinguish
// "not on the list" from "couldn't check" — the live hint call-site catches.
export async function guestAllocation(first, middle, last) {
  const clientId = Store.get().clientId;
  if (!clientId || !(first || "").trim() || !(last || "").trim()) return { status: "not_found", allocation: null };
  const { data, error } = await supabase.rpc("rsvp_guest_allocation", {
    p_client_id: clientId, p_first: first || "", p_middle: middle || "", p_last: last || "",
  });
  if (error) throw error;
  const d = data || {};
  return {
    status: d.status || "not_found",
    allocation: d.allocation == null ? null : Number(d.allocation),
    guestStatus: d.guest_status || null,
  };
}
// Admin edit of a reply's status (owner-update RLS, 0016).
export async function updateRsvpStatusDb(id, status) {
  const { error } = await supabase.from("rsvps").update({ status }).eq("id", id);
  if (error) { console.warn("[api] rsvp status update failed:", error.message); throw error; }
}
// Admin edit of a reply's dietary preference (owner-update RLS, 0016).
export async function updateRsvpDietDb(id, diet, dietNotes) {
  const { error } = await supabase.from("rsvps").update({ diet: diet || "None", diet_notes: dietNotes || "" }).eq("id", id);
  if (error) { console.warn("[api] rsvp diet update failed:", error.message); throw error; }
}

export async function postGuestbook(entry) {
  const clientId = Store.get().clientId;
  if (!clientId) throw new Error("No client loaded");
  // The guestbook_set_status trigger decides the final status from the client's
  // autoApproveGuestbook flag (default false). We can't read the row back —
  // anon RLS only allows reading approved rows, so a `.select()` on a pending
  // insert errors even though the insert succeeded. Mirror the trigger instead.
  const auto = Store.get().settings?.autoApproveGuestbook === true;
  const status = auto ? "approved" : "pending";
  const { error } = await supabase.from("guestbook").insert(guestbookToRow(entry, clientId, status));
  if (error) throw error;
  if (status === "approved") {
    const id = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : `tmp_${Date.now()}`;
    Store.addGuestbook({ ...entry, id, status: "visible" });
  }
  return { status };
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
  const [rs, gb, qz, gu] = await Promise.all([
    supabase.from("rsvps").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
    supabase.from("guestbook").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
    supabase.from("quiz_answers").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
    supabase.from("guests").select("*").eq("client_id", clientId).order("created_at", { ascending: true }),
  ]);
  if (rs.error) console.warn("[api] rsvps load failed:", rs.error.message);
  if (gb.error) console.warn("[api] guestbook load failed:", gb.error.message);
  if (qz.error) console.warn("[api] quiz load failed:", qz.error.message);
  if (gu.error) console.warn("[api] guests load failed:", gu.error.message);
  // Preserve existing store data for any query that errored — don't wipe
  // previously-loaded rows with an empty array on a transient failure.
  const prev = Store.get();
  Store.setSubmissions({
    rsvps: rs.error ? (prev.rsvps || []) : (rs.data || []).map(rowToRsvp),
    guestbook: gb.error ? (prev.guestbook || []) : (gb.data || []).map(rowToGuestbook),
    quizSubs: qz.error ? (prev.quizSubs || []) : (qz.data || []).map(rowToQuizSub),
    guests: gu.error ? (prev.guests || []) : (gu.data || []).map(rowToGuest),
  });
}

// Realtime: push new guest activity (RSVPs / guestbook / quiz) into the store
// as it happens, so the notification bell, tiles, and charts update without a
// refresh. One websocket channel per admin session; each INSERT triggers a
// debounced loadAdminData() re-fetch so row mapping/ordering stays in that one
// place (an event burst = one query). Delivery is RLS-gated server-side, and
// the client_id filter keeps other clients' events from even waking the
// debounce. Returns an unsubscribe fn for the mount effect's cleanup.
export function subscribeAdminRealtime() {
  const clientId = Store.get().clientId;
  if (!clientId) return () => {};
  let t = null;
  const refetch = () => {
    clearTimeout(t);
    t = setTimeout(() => { loadAdminData().catch((e) => console.warn("[api] realtime refetch failed:", e?.message)); }, 400);
  };
  const filter = `client_id=eq.${clientId}`;
  const ch = supabase
    .channel(`admin-feed-${clientId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "rsvps", filter }, refetch)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "guestbook", filter }, refetch)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "quiz_answers", filter }, refetch)
    // Status surfaced for diagnosis (SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT…);
    // supabase-js auto-rejoins with backoff, and the visibility catch-up below
    // re-syncs anything missed while the socket was down.
    .subscribe((status, err) => {
      console.info("[api] realtime:", status, err ? String(err) : "");
    });
  // Catch-up: refetch when the tab becomes visible again — covers events missed
  // while the laptop slept or the websocket was reconnecting.
  const onVisible = () => { if (document.visibilityState === "visible") refetch(); };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    clearTimeout(t);
    supabase.removeChannel(ch);
  };
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
// Admin edit of a reply's companion list (owner update policy, 0016). Keeps the
// legacy plus_one string and the head count in step with the array.
export async function updateRsvpCompanionsDb(id, companions) {
  const list = (companions || []).map((s) => (s || "").trim()).filter(Boolean);
  const patch = { companions: list, plus_one: list.join(", "), count: list.length + 1 };
  const { error } = await supabase.from("rsvps").update(patch).eq("id", id);
  if (error) { console.warn("[api] rsvp companions update failed:", error.message); throw error; }
  return { companions: list, plusOne: patch.plus_one, count: patch.count };
}

// Owner/superadmin guest-list CRUD (RLS scopes writes to the owner's client).
export async function addGuestDb(guest) {
  const clientId = Store.get().clientId;
  const { data, error } = await supabase.from("guests").insert(guestToRow(guest, clientId)).select().single();
  if (error) { console.warn("[api] guest insert failed:", error.message); throw error; }
  return rowToGuest(data);
}
export async function updateGuestDb(id, guest) {
  const clientId = Store.get().clientId;
  const { error } = await supabase.from("guests").update(guestToRow(guest, clientId)).eq("id", id);
  if (error) { console.warn("[api] guest update failed:", error.message); throw error; }
}
export async function deleteGuestDb(id) {
  const { error } = await supabase.from("guests").delete().eq("id", id);
  if (error) { console.warn("[api] guest delete failed:", error.message); throw error; }
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

// Upload any media file to Cloudflare R2 via the auth-gated /api/upload Pages
// Function. Requires a valid Supabase session (admins only). opts = { scope,
// purpose } (type is derived server-side from the content type). Returns
// { key, url } — callers store the bare `key`; render via mediaUrl().
// Return a valid access token, refreshing first if the session is missing or
// about to expire. getSession() alone can hand back an EXPIRED token — e.g. on a
// backgrounded mobile Safari tab where the auto-refresh timer never fired — which
// the auth-gated Functions then reject with 401 ("unauthorized"). Refresh here so
// uploads/emails always send a live token.
async function freshToken() {
  // valid(s, buffer) = has a token that won't expire within `buffer` ms.
  const valid = (s, buffer) => !!(s && s.access_token && (!s.expires_at || s.expires_at * 1000 - Date.now() > buffer));
  let { data: { session } } = await supabase.auth.getSession();
  // Refresh when missing or expiring within 60s. Keep the old session if the
  // refresh call fails (transient) but the old token still has time.
  if (!valid(session, 60000)) {
    try { const { data: r } = await supabase.auth.refreshSession(); if (r && r.session) session = r.session; } catch (_) {}
  }
  // Final guard: never send an expired/absent token — the auth-gated Functions
  // would just reject it as "unauthorized", which reads as a cryptic failure.
  // Throw a clear, actionable message so the caller can prompt a re-login.
  if (!valid(session, 0)) throw new Error("Your session expired — please log out and log back in, then try again.");
  return session.access_token;
}

export async function uploadToR2(file, opts, clientId) {
  const o = opts || {};
  const token = await freshToken();
  const form = new FormData();
  form.append("file", file);
  form.append("scope", o.scope || "owner");
  form.append("purpose", o.purpose || "misc");
  if (clientId) form.append("clientId", clientId);
  const res = await fetch("/api/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) {
    let msg = `upload failed (${res.status})`;
    try { const e = await res.json(); if (e && e.error) msg = e.error; } catch (_) {}
    throw new Error(msg);
  }
  return await res.json();
}

// Upload an audio file to R2. Returns { url, path } where url is the bare key
// (call-sites store it as the track url and render via mediaUrl()).
export async function uploadAudio(file, clientId) {
  const { key } = await uploadToR2(file, { scope: "owner", purpose: "playlist" }, clientId);
  return { url: key, path: key, key };
}

// List this client's existing R2 media of one type ("image" | "audio") via the
// auth-gated /api/media Function. Returns [{ key, name, size, uploaded }] newest
// first. Requires a valid Supabase session (admins only). Pass { usage: true }
// (superadmin only) to also annotate each item with inUse/usedBy — whether the
// key is referenced in the owning client's content.
export async function listMedia(clientId, type, opts) {
  const token = await freshToken();
  const qs = new URLSearchParams({ clientId: clientId || "", type: type || "image" });
  if (opts && opts.usage) qs.set("usage", "1");
  const res = await fetch(`/api/media?${qs}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let msg = `library load failed (${res.status})`;
    try { const e = await res.json(); if (e && e.error) msg = e.error; } catch (_) {}
    throw new Error(msg);
  }
  const body = await res.json();
  return Array.isArray(body.items) ? body.items : [];
}

// Delete an R2 object by its bare key via the auth-gated DELETE /api/media
// Function. Superadmin media manager only. Returns true on success, throws on
// error. When the server hard-blocks the delete because the file is still
// referenced by a client (HTTP 409), the thrown Error carries code "in_use" and
// usedBy (the client's subdomain) so the UI can show a specific block message.
export async function deleteFromR2(key) {
  const token = await freshToken();
  const res = await fetch("/api/media", {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) {
    let msg = `delete failed (${res.status})`, data = null;
    try { data = await res.json(); if (data && data.error) msg = data.error; } catch (_) {}
    const err = new Error(msg);
    if (res.status === 409) { err.code = "in_use"; err.usedBy = data && data.usedBy; }
    throw err;
  }
  return true;
}

// Send an HTML email via the auth-gated /api/send-email Function (Resend).
// Used by the RSVP "Email results" action. Requires a valid admin session.
export async function sendEmail({ to, subject, html, attachments }) {
  const token = await freshToken();
  const res = await fetch("/api/send-email", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ to, subject, html, ...(attachments ? { attachments } : {}) }),
  });
  if (!res.ok) {
    // A 401 here means the token was rejected server-side (revoked/expired
    // session). Show the same actionable re-login message, not raw "unauthorized".
    if (res.status === 401) throw new Error("Your session expired — please log out and log back in, then try again.");
    let msg = `send failed (${res.status})`;
    try { const e = await res.json(); if (e && e.error) msg = e.error; } catch (_) {}
    throw new Error(msg);
  }
  return await res.json();
}

// Have the Function pull a remote file into R2 server-side (no browser CORS).
// Used by the migration to move existing Supabase-hosted audio.
async function uploadUrlToR2(sourceUrl, opts, clientId) {
  const o = opts || {};
  const token = await freshToken();
  const form = new FormData();
  form.append("sourceUrl", sourceUrl);
  form.append("scope", o.scope || "owner");
  form.append("purpose", o.purpose || "misc");
  if (clientId) form.append("clientId", clientId);
  const res = await fetch("/api/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) { let m = `upload failed (${res.status})`; try { const e = await res.json(); if (e.error) m = e.error; } catch (_) {} throw new Error(m); }
  return await res.json();
}

// One-time migration: move the active client's existing media into R2 (new key
// layout) and rewrite the stored references to bare keys. Idempotent — base64
// images and remote (Supabase) audio are migrated; anything already a key /
// /r2/ / on the media domain is left alone, so it's safe to re-run.
const isData = (u) => typeof u === "string" && u.startsWith("data:");
const isRemote = (u) => typeof u === "string" && /^https?:\/\//i.test(u);
const onMediaDomain = (u) => typeof u === "string" && u.includes("media.celebrately.us");
export function hasLegacyMedia(state) {
  const s = state || Store.get();
  if (["heroImage", "frameImage", "envBgImage"].some((k) => isData(s.settings && s.settings[k]))) return true;
  if ((s.attire || []).some((g) => isData(g.image))) return true;
  if ((s.story || []).some((r) => isData(r.img))) return true;
  if ((s.playlist || []).some((t) => isRemote(t.url) && !onMediaDomain(t.url))) return true;
  return false;
}

export async function migrateClientMediaToR2(onProgress) {
  const st = Store.get();
  const clientId = st.clientId;
  let migrated = 0, failed = 0;
  const tick = () => { migrated++; if (onProgress) onProgress(migrated); };

  // base64 image -> upload from the browser, returns the bare key
  const imgToKey = async (dataUrl, purpose, hint) => {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], `${hint || "image"}.jpg`, { type: blob.type || "image/jpeg" });
    return (await uploadToR2(file, { scope: "owner", purpose }, clientId)).key;
  };

  // settings images
  const settings = { ...st.settings };
  const purposeOf = { heroImage: "hero", frameImage: "frame", envBgImage: "envbg" };
  for (const k of ["heroImage", "frameImage", "envBgImage"]) {
    if (isData(settings[k])) { try { settings[k] = await imgToKey(settings[k], purposeOf[k], k); tick(); } catch (e) { failed++; } }
  }
  // attire images
  const attire = (st.attire || []).map((g) => ({ ...g }));
  for (const g of attire) { if (isData(g.image)) { try { g.image = await imgToKey(g.image, "attire", g.name || "attire"); tick(); } catch (e) { failed++; } } }
  // story images
  const story = (st.story || []).map((r) => ({ ...r }));
  for (const r of story) { if (isData(r.img)) { try { r.img = await imgToKey(r.img, "story", r.title || "story"); tick(); } catch (e) { failed++; } } }
  // audio (remote Supabase URL) -> server-side pull, returns the bare key
  const playlist = (st.playlist || []).map((t) => ({ ...t }));
  for (const t of playlist) {
    if (isRemote(t.url) && !onMediaDomain(t.url)) { try { t.url = (await uploadUrlToR2(t.url, { scope: "owner", purpose: "playlist" }, clientId)).key; tick(); } catch (e) { failed++; } }
  }

  Store.set({ attire, story, playlist });
  Store.updateSettings(settings);
  await saveClientData();
  return { migrated, failed };
}

// --- Self-serve registration (apex /register page) ---------------------------
// Both call the public self-signup Edge Function (no session required).
export async function checkSubdomainFree(subdomain) {
  const { data, error } = await supabase.functions.invoke("self-signup", {
    body: { action: "check_subdomain", subdomain },
  });
  if (error) throw error;
  return !!(data && data.available);
}

export async function selfSignup({ email, password, partnerA, partnerB, weddingDate, subdomain }) {
  const { data, error } = await supabase.functions.invoke("self-signup", {
    body: { email, password, partnerA, partnerB, weddingDate, subdomain },
  });
  // functions.invoke surfaces non-2xx as FunctionsHttpError with the payload in context
  if (error) {
    let msg = "Could not create your site.";
    try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (_) {}
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data; // { ok, subdomain, clientId }
}

// --- Prospect intake (/apply wizard + superadmin Requests inbox) -------------
export async function checkRequestSubdomainFree(subdomain) {
  const { data, error } = await supabase.functions.invoke("site-request", {
    body: { action: "check_subdomain", subdomain },
  });
  if (error) throw error;
  return !!(data && data.available);
}

export async function submitSiteRequest({ email, partnerA, partnerB, eventType, subdomain, templateKey, content }) {
  const { data, error } = await supabase.functions.invoke("site-request", {
    // eventType is additive — the edge fn defaults missing/unknown values to "wedding".
    body: { email, partnerA, partnerB, eventType, subdomain, templateKey, content },
  });
  if (error) {
    let msg = "Could not submit your request.";
    try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (_) {}
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data; // { ok, id }
}

// --- Support tickets (owner sticky widget + superadmin console) --------------
// Owner files a ticket from their admin; RLS scopes insert/select to their own
// client. `tab` is the admin tab they were on (context for the superadmin).
export async function submitTicket(form, tab) {
  const st = Store.get();
  const ctx = {
    email: st.auth?.email || st.settings?.ownerEmail || "",
    partnerA: st.settings?.partnerA, partnerB: st.settings?.partnerB,
    subdomain: resolveSubdomain() || "", tab: tab || "",
  };
  const { error } = await supabase.from("support_tickets").insert(ticketToRow(form, st.clientId, ctx));
  if (error) throw error;
}

// Superadmin: list all tickets (RLS returns all for superadmin).
export async function listTickets() {
  const { data, error } = await supabase.from("support_tickets").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Superadmin: flip status; stamp resolved_at on resolve, clear it on reopen.
export async function setTicketStatus(id, status) {
  const { error } = await supabase.from("support_tickets")
    .update({ status, resolved_at: status === "resolved" ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

// Superadmin: permanently remove a ticket (RLS delete policy is superadmin-only).
export async function deleteTicket(id) {
  const { error } = await supabase.from("support_tickets").delete().eq("id", id);
  if (error) throw error;
}

// Superadmin: save the internal reply note (or any partial patch).
export async function updateTicket(id, patch) {
  const { error } = await supabase.from("support_tickets").update(patch).eq("id", id);
  if (error) throw error;
}

// --- Support ticket thread (owner ⇄ superadmin replies) ---------------------
// Messages on a ticket, oldest-first. RLS returns only rows the caller may see
// (own-client owner, or any for superadmin).
export async function listTicketMessages(ticketId) {
  const { data, error } = await supabase.from("support_ticket_messages")
    .select("*").eq("ticket_id", ticketId).order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

// Append a reply to a ticket. senderRole ('owner'|'superadmin') is pinned to the
// caller's actual role (RLS also enforces this). An owner reply reopens the
// ticket via the support_reopen_after_owner_msg trigger.
export async function postTicketMessage(ticketId, body, attachmentUrl) {
  const st = Store.get();
  const role = st.auth?.role === "superadmin" ? "superadmin" : "owner";
  const senderName = role === "superadmin"
    ? "Support"
    : ([st.settings?.partnerA, st.settings?.partnerB].filter(Boolean).join(" & ") || st.auth?.email || "Client");
  const { error } = await supabase.from("support_ticket_messages")
    .insert({ ticket_id: ticketId, sender_role: role, sender_name: senderName, body: (body || "").trim(), attachment_url: attachmentUrl || null });
  if (error) throw error;
}

// Upload one support screenshot to R2 and return its bare key (render with
// mediaUrl). Owners write under their own client; the superadmin passes the
// ticket's client_id (the upload Function lets superadmin write any tenant).
export async function uploadSupportImage(file, clientId) {
  const { key } = await uploadToR2(file, { scope: "owner", purpose: "support" }, clientId || Store.get().clientId);
  return key;
}

// Live thread updates: push new replies for ONE ticket (both the superadmin
// modal and the owner viewer subscribe while open). Unique topic per call.
let _msgChanSeq = 0;
export function subscribeTicketMessagesRealtime(ticketId, onChange) {
  let t = null;
  const ping = () => { clearTimeout(t); t = setTimeout(onChange, 250); };
  const ch = supabase
    .channel(`tk-msgs-${ticketId}-${++_msgChanSeq}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_ticket_messages", filter: `ticket_id=eq.${ticketId}` }, ping)
    .subscribe();
  return () => { clearTimeout(t); supabase.removeChannel(ch); };
}

// Superadmin bell: recent CLIENT replies (superadmin's own replies aren't
// notifications). RLS returns all rows only for the superadmin.
export async function listRecentClientReplies(limit = 20) {
  const { data, error } = await supabase.from("support_ticket_messages")
    .select("*").eq("sender_role", "owner").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

// Owner bell + Support tab badge: recent SUPERADMIN replies on the caller's OWN
// tickets. RLS scopes support_ticket_messages to the owner's own tickets, so
// this returns only replies addressed to this client. Mirror of
// listRecentClientReplies (the superadmin side). Drives the "the superadmin
// replied" notification independently of the ticket's status — a reply that
// doesn't flip status to waiting_reply still notifies.
export async function listRecentSupportReplies(limit = 20) {
  const { data, error } = await supabase.from("support_ticket_messages")
    .select("*").eq("sender_role", "superadmin").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

// Realtime for ALL ticket messages (superadmin bell) — unique topic per call.
export function subscribeAllTicketMessagesRealtime(onChange) {
  let t = null;
  const ping = () => { clearTimeout(t); t = setTimeout(onChange, 400); };
  const ch = supabase
    .channel(`sa-tk-msgs-${++_msgChanSeq}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_ticket_messages" }, ping)
    .subscribe();
  return () => { clearTimeout(t); supabase.removeChannel(ch); };
}

// Realtime for the console bell — same debounce pattern as site requests.
// DEFECT-2026-07-09-B: the channel topic MUST be unique per subscriber.
// supabase-js caches channels by topic; with a fixed "sa-support" name the
// SECOND subscriber (bell + Clients console both subscribe) got the already-
// subscribed channel back and `.on(...)` threw "cannot add postgres_changes
// callbacks after subscribe()" — a render-time crash = white console.
// Guarded by src/lib/__tests__/ticketsRealtime.test.js.
let _tixChanSeq = 0;
export function subscribeTicketsRealtime(onChange) {
  let t = null;
  const ping = () => { clearTimeout(t); t = setTimeout(onChange, 400); };
  const ch = supabase
    .channel(`sa-support-${++_tixChanSeq}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets" }, ping)
    .subscribe();
  return () => { clearTimeout(t); supabase.removeChannel(ch); };
}

// Superadmin: list + resolve intake requests (RLS-gated to superadmin).
export async function listSiteRequests() {
  const { data, error } = await supabase.from("site_requests").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function setSiteRequestStatus(id, status) {
  const { error } = await supabase.from("site_requests").update({ status }).eq("id", id);
  if (error) throw error;
}

// Superadmin: fix up a request before approving (typo'd names/subdomain/email).
export async function updateSiteRequest(id, patch) {
  const { error } = await supabase.from("site_requests").update(patch).eq("id", id);
  if (error) throw error;
}

// Superadmin: permanently remove a request row (typed-confirmation in the UI).
// Deleting a request never touches a client site created from it.
export async function deleteSiteRequest(id) {
  const { error } = await supabase.from("site_requests").delete().eq("id", id);
  if (error) throw error;
}

// Realtime for the console bell: new /apply submissions push over websocket
// (publication 0020; RLS delivers only to superadmin). Debounced like the
// owner-side feed; returns an unsubscribe fn for the effect cleanup.
let _reqChanSeq = 0;
export function subscribeSiteRequestsRealtime(onChange) {
  let t = null;
  const ping = () => { clearTimeout(t); t = setTimeout(onChange, 400); };
  const ch = supabase
    // unique topic per subscriber — fixed topics crash the second subscriber
    // (Bug 0009 / DEFECT-2026-07-09-B class)
    .channel(`sa-site-requests-${++_reqChanSeq}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "site_requests" }, ping)
    .subscribe((status, err) => { console.info("[api] sa realtime:", status, err ? String(err) : ""); });
  return () => { clearTimeout(t); supabase.removeChannel(ch); };
}

// Superadmin approve: create the client site from a request's payload, then
// mark the request approved. Owner credentials are set afterwards with the
// existing Credentials tool in the Clients tab.
// Idempotent + convergent: the insert and the status update are two separate
// writes (no cross-table transaction available from the client), so a failure
// between them used to leave the site created but the request stuck "pending" —
// re-approval then died forever on the unique-subdomain constraint. We now look
// for an existing client with that subdomain first and skip the insert if it's
// already there, and we treat a duplicate-subdomain insert error as
// already-created; either way we always converge on marking the request
// approved.
export async function approveSiteRequest(reqRow) {
  const c = reqRow.content || {};
  // Event type comes from the request's content (wizard v2+); older rows have
  // none and stay weddings. Birthdays store the event title in partner_a and
  // get no couple hashtag.
  const eventType = c.eventType === "birthday" ? "birthday" : "wedding";
  const content = {
    partnerA: reqRow.partner_a,
    partnerB: reqRow.partner_b,
    ...(eventType === "wedding"
      ? { hashtag: `#${((reqRow.partner_a || "") + "And" + (reqRow.partner_b || "")).replace(/[^A-Za-z0-9]/g, "")}` }
      : {}),
    ...(c.phone ? { phone: c.phone } : {}),
    ...(c.weddingDate ? { weddingDate: c.weddingDate } : {}),
    ...(c.weddingDateLabel ? { weddingDateLabel: c.weddingDateLabel } : {}),
    ...(c.venueName ? { venueName: c.venueName } : {}),
    ...(c.venueAddress ? { venueAddress: c.venueAddress } : {}),
    ...(c.mapQuery ? { mapQuery: c.mapQuery } : {}),
    ...(c.mapLat != null ? { mapLat: c.mapLat } : {}),
    ...(c.mapLng != null ? { mapLng: c.mapLng } : {}),
    ...(Array.isArray(c.schedule) && c.schedule.length ? { schedule: c.schedule } : {}),
    ...(Array.isArray(c.entourage) && c.entourage.length ? { entourage: c.entourage } : {}),
    strictRsvp: c.strictRsvp === true,
    // Starter copy for the home page (BASE_SETTINGS blanks these for real
    // clients, so without seeding here a new site launches with an empty
    // invitation + welcome). Owner/superadmin edits them in Home afterwards.
    ...(eventType === "birthday" ? {
      welcome: "One big day, all our favorite people. Find everything you need below.",
      inviteTitle: "You're invited to the celebration",
      inviteBody: "We can't wait to celebrate with the people we love most. Here's everything you need for the big day.",
    } : {
      welcome: "Two families, one celebration. We would be honored to have you with us as we say \u201cI do.\u201d Find everything you need below.",
      inviteTitle: "You're invited to celebrate love",
      inviteBody: "We can't wait to celebrate the start of our forever, surrounded by the people we love most. Thank you for being part of our story \u2014 here's a little about how we got here, and what our wedding day will hold.",
    }),
    // Default features for a freshly approved site: Details, Schedule, Venue,
    // RSVP only — Story/Guestbook/Quiz (and the shelved gallery) start OFF and
    // the superadmin enables them per client. If the request already carries a
    // modules map (preconfigured in the edit-request Access tab), respect it.
    modules: (c.modules && typeof c.modules === "object") ? c.modules : { ...DEFAULT_CLIENT_MODULES },
    // New registered sites open with falling petals (Classic Ivory is the wizard's
    // default theme). Owner can change decor/theme anytime in admin.
    decorOn: true,
    decorStyle: "petals",
    onboarded: true, // they already provided setup via the wizard
  };
  // A prior approval may have created the client but failed to flip the status;
  // reuse that row instead of colliding on the unique subdomain.
  const { data: existing } = await supabase.from("clients")
    .select("id").eq("subdomain", reqRow.subdomain).maybeSingle();
  let created = existing || null;
  if (!created) {
    const { data, error } = await supabase.from("clients")
      .insert({ subdomain: reqRow.subdomain, event_type: eventType, template_key: reqRow.template_key || "classic", owner_email: reqRow.email, content })
      .select("id").single();
    if (error) {
      // Unique-subdomain violation (Postgres 23505) = the client already exists
      // from an earlier partial approval; recover its id and proceed.
      if (error.code === "23505") {
        const { data: dup, error: lookupErr } = await supabase.from("clients")
          .select("id").eq("subdomain", reqRow.subdomain).single();
        if (lookupErr) throw error; // couldn't recover — surface the original insert error
        created = dup;
      } else {
        throw error;
      }
    } else {
      created = data;
    }
  }
  // Auto-provision the owner login with the platform's starter password so a
  // fresh site is immediately sign-in-able (owner request). Skipped when the
  // client already has a login (idempotent re-approve). Failure does NOT block
  // the approval — the caller surfaces it so the superadmin sets it manually.
  let loginError = "";
  try {
    const { data: fresh } = await supabase.from("clients").select("owner_email").eq("id", created.id).maybeSingle();
    if (!fresh || !fresh.owner_email) {
      await createOwner({ email: reqRow.email, password: "Password123+", client_id: created.id });
    }
  } catch (e) {
    loginError = e?.message || "owner login could not be created";
  }
  await setSiteRequestStatus(reqRow.id, "approved");
  return { ...created, loginError };
}
