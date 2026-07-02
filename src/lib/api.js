import { supabase } from "@/lib/supabase.js";
import { Store } from "@/lib/store.jsx";
import { resolveSubdomain } from "@/lib/tenant.js";
import { clientToState, stateToClientRow, rowToGuestbook, rowToRsvp, rowToQuizSub, rsvpToRow, guestbookToRow, quizToRow, guestToRow, rowToGuest } from "@/lib/mappers.js";
import { loadSession } from "@/lib/auth.js";

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
  return { status: d.status || "not_found", allocation: d.allocation == null ? null : Number(d.allocation) };
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
  Store.setSubmissions({
    rsvps: (rs.data || []).map(rowToRsvp),
    guestbook: (gb.data || []).map(rowToGuestbook),
    quizSubs: (qz.data || []).map(rowToQuizSub),
    guests: (gu.data || []).map(rowToGuest),
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
  let { data: { session } } = await supabase.auth.getSession();
  const expMs = session && session.expires_at ? session.expires_at * 1000 : 0;
  if (!session || (expMs && expMs - Date.now() < 60000)) {
    const { data: r } = await supabase.auth.refreshSession();
    if (r && r.session) session = r.session;
  }
  const token = session && session.access_token;
  if (!token) throw new Error("Your session expired — please sign in again.");
  return token;
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
export async function sendEmail({ to, subject, html }) {
  const token = await freshToken();
  const res = await fetch("/api/send-email", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ to, subject, html }),
  });
  if (!res.ok) {
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
