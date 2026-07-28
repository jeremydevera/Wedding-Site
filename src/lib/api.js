import { supabase } from "@/lib/supabase.js";
import { neonSelect, neonInsert, neonRpc, neonAuthedSelect, neonAuthedInsert, neonAuthedUpdate, neonAuthedDelete, NEON_FLAG_KEY, NEON_SHARDS_KEY, FB_AUTH_FLAG_KEY, setFbAuthMode, setNeonRegistry, resolveShardId, setActiveShard } from "@/lib/neon.js";
import { Store } from "@/lib/store.jsx";
import { resolveSubdomain } from "@/lib/tenant.js";
import { clientToState, stateToClientRow, rowToGuestbook, rowToRsvp, rowToQuizSub, rsvpToRow, guestbookToRow, quizToRow, guestToRow, rowToGuest, ticketToRow } from "@/lib/mappers.js";
import { loadSession, createOwner, sendSetupEmail, adminBridgeToken } from "@/lib/auth.js";
import { DEFAULT_CLIENT_MODULES } from "@/lib/roles.js";

// Columns the ANONYMOUS role may read from clients (matches the Neon column
// grant — owner_email is deliberately excluded so guests can't harvest login
// emails). select=* would fail under column-level grants; keep this list in
// step with the grant in /api/neon-admin harden_minors.
const NEON_CLIENT_COLS = "id,subdomain,event_type,template_key,theme,content,is_active,created_at,status";

// Boot: load the active client + approved guestbook, hydrate the store cache.
export async function loadClientData() {
  const subdomain = resolveSubdomain();
  if (!subdomain) { // platform hub (bare apex) — no client site, just the admin login/console
    await loadSession();
    Store.hydrate({ clientId: null, notFound: false }); // no client context on the hub
    return;
  }
  // Neon + Firebase is the platform's ONLY backend now (Supabase retired). Every
  // client resolves from Neon; the shard registry (future s2…) is read from Neon
  // app_config with a builtin s1 fallback, so a registry miss still serves s1.
  setFbAuthMode(true);
  const shardCfg = await getAppConfig(NEON_SHARDS_KEY).catch(() => null);
  if (shardCfg) setNeonRegistry(shardCfg);
  setActiveShard(resolveShardId(subdomain));
  let client = null;
  try {
    const rows = await neonSelect("clients", `select=${NEON_CLIENT_COLS}&subdomain=eq.${encodeURIComponent(subdomain)}&is_active=eq.true&limit=1`);
    client = (rows && rows[0]) || null;
  } catch (e) { console.warn("[neon] client lookup failed:", e?.message); }
  if (client) {
    // The public guestbook lazy-loads its own pages (infinite scroll), so boot
    // no longer waits on fetching every message.
    Store.hydrate({ ...clientToState(client), guestbook: [], neonMode: true });
    await loadSession();
    return;
  }
  console.warn("[api] client not found for subdomain:", subdomain);
  await loadSession(); // always resolve auth so admin doesn't hang on the loading gate
  // No active client for this subdomain (deleted / never existed / deactivated).
  // Flag it so the app shows an "unavailable" page instead of seed content.
  Store.hydrate({ clientId: null, notFound: true });
}

// True when the loaded site is being served from Neon (sandbox + flag).
const onNeon = () => Store.get().neonMode === true;

export async function postRsvp(form) {
  const clientId = Store.get().clientId;
  if (onNeon()) {
    await neonInsert("rsvps", rsvpToRow(form, clientId));
    Store.addRSVP(form);
    return;
  }
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
  const args = { p_client_id: clientId, p_first: first || "", p_middle: middle || "", p_last: last || "" };
  if (onNeon()) {
    try { return !!(await neonRpc("rsvp_name_taken", args)); }
    catch (e) { console.warn("[api] neon rsvp_name_taken failed:", e.message); return false; } // fail open, same as below
  }
  const { data, error } = await supabase.rpc("rsvp_name_taken", args);
  if (error) { console.warn("[api] rsvp_name_taken failed:", error.message); return false; }
  return !!data;
}

// Update-or-insert an RSVP by fuzzy name match via the rsvp_upsert RPC. Used by
// the public form's "update my response" path (an anon guest can't UPDATE the
// rsvps table directly under RLS). `form` is the same shape passed to postRsvp.
export async function upsertRsvp(form) {
  const clientId = Store.get().clientId;
  if (onNeon()) {
    await neonRpc("rsvp_upsert", {
      p_client_id: clientId,
      p_first: form.firstName || "", p_middle: form.middleName || "", p_last: form.lastName || "",
      p_full_name: form.fullName || "", p_email: form.email || "", p_phone: form.phone || "",
      p_status: form.status, p_count: form.count || 0,
      p_plus_one: form.plusOne || "", p_diet: form.diet || "None", p_diet_notes: form.dietNotes || "",
      p_song: form.song || "", p_notes: form.notes || "",
      p_companions: Array.isArray(form.companions) ? form.companions : [],
    });
    return;
  }
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
  const args = { p_client_id: clientId, p_first: first || "", p_middle: middle || "", p_last: last || "" };
  if (onNeon()) {
    const d = (await neonRpc("rsvp_guest_allocation", args)) || {};
    return {
      status: d.status || "not_found",
      allocation: d.allocation == null ? null : Number(d.allocation),
      guestStatus: d.guest_status || null,
    };
  }
  const { data, error } = await supabase.rpc("rsvp_guest_allocation", args);
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
  if (onNeon()) { await neonAuthedUpdate("rsvps", `id=eq.${id}`, { status }); return; }
  const { error } = await supabase.from("rsvps").update({ status }).eq("id", id);
  if (error) { console.warn("[api] rsvp status update failed:", error.message); throw error; }
}
// Admin edit of a reply's dietary preference (owner-update RLS, 0016).
export async function updateRsvpDietDb(id, diet, dietNotes) {
  if (onNeon()) { await neonAuthedUpdate("rsvps", `id=eq.${id}`, { diet: diet || "None", diet_notes: dietNotes || "" }); return; }
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
  if (onNeon()) {
    await neonInsert("guestbook", guestbookToRow(entry, clientId, status));
  } else {
    const { error } = await supabase.from("guestbook").insert(guestbookToRow(entry, clientId, status));
    if (error) throw error;
  }
  if (status === "approved") {
    const id = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : `tmp_${Date.now()}`;
    Store.addGuestbook({ ...entry, id, status: "visible" });
  }
  return { status };
}

export async function postQuiz(sub) {
  const clientId = Store.get().clientId;
  if (onNeon()) {
    await neonInsert("quiz_answers", quizToRow(sub, clientId));
    Store.addQuizSub(sub);
    return;
  }
  const { error } = await supabase.from("quiz_answers").insert(quizToRow(sub, clientId));
  if (error) throw error;
  Store.addQuizSub(sub); // local echo
}

// Admin: load the active client's submissions from the DB into the store.
// RLS scopes this to the owner's own client (or any client for a superadmin).
export async function loadAdminData() {
  const clientId = Store.get().clientId;
  if (!clientId) return;
  if (onNeon()) {
    // Owner JWT → RLS scopes each read to this client. Any query that errors
    // keeps the previously-loaded rows (same as the Supabase path below).
    const q = (t, ord) => neonAuthedSelect(t, `select=*&client_id=eq.${clientId}&order=${ord}`).catch((e) => { console.warn(`[api] neon ${t} load failed:`, e.message); return null; });
    const [rs, gb, qz, gu] = await Promise.all([
      q("rsvps", "created_at.desc"), q("guestbook", "created_at.desc"),
      q("quiz_answers", "created_at.desc"), q("guests", "created_at.asc"),
    ]);
    const prev = Store.get();
    Store.setSubmissions({
      rsvps: rs ? rs.map(rowToRsvp) : (prev.rsvps || []),
      guestbook: gb ? gb.map(rowToGuestbook) : (prev.guestbook || []),
      quizSubs: qz ? qz.map(rowToQuizSub) : (prev.quizSubs || []),
      guests: gu ? gu.map(rowToGuest) : (prev.guests || []),
    });
    return;
  }
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
  // Neon has no realtime channel — poll instead (45s, hidden tabs skipped) plus
  // an immediate catch-up when the tab becomes visible again. Keeps the bell,
  // tiles and RSVP list near-live without a websocket. Avoid opening a stale
  // Supabase channel for a Neon client.
  if (onNeon()) {
    const tick = () => { if (document.visibilityState === "visible") loadAdminData().catch(() => {}); };
    const iv = setInterval(tick, 45_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", tick); };
  }
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
  const st = GB_DB_STATUS[storeStatus] || "pending";
  if (onNeon()) { await neonAuthedUpdate("guestbook", `id=eq.${id}`, { status: st }); return; }
  const { error } = await supabase.from("guestbook").update({ status: st }).eq("id", id);
  if (error) { console.warn("[api] guestbook status update failed:", error.message); throw error; }
}
export async function deleteGuestbookDb(id) {
  if (onNeon()) { await neonAuthedDelete("guestbook", `id=eq.${id}`); return; }
  const { error } = await supabase.from("guestbook").delete().eq("id", id);
  if (error) { console.warn("[api] guestbook delete failed:", error.message); throw error; }
}
export async function deleteRsvpDb(id) {
  if (onNeon()) { await neonAuthedDelete("rsvps", `id=eq.${id}`); return; }
  const { error } = await supabase.from("rsvps").delete().eq("id", id);
  if (error) { console.warn("[api] rsvp delete failed:", error.message); throw error; }
}
// Admin edit of a reply's companion list (owner update policy, 0016). Keeps the
// legacy plus_one string and the head count in step with the array.
export async function updateRsvpCompanionsDb(id, companions) {
  const list = (companions || []).map((s) => (s || "").trim()).filter(Boolean);
  const patch = { companions: list, plus_one: list.join(", "), count: list.length + 1 };
  if (onNeon()) { await neonAuthedUpdate("rsvps", `id=eq.${id}`, patch); return { companions: list, plusOne: patch.plus_one, count: patch.count }; }
  const { error } = await supabase.from("rsvps").update(patch).eq("id", id);
  if (error) { console.warn("[api] rsvp companions update failed:", error.message); throw error; }
  return { companions: list, plusOne: patch.plus_one, count: patch.count };
}

// Owner/superadmin guest-list CRUD (RLS scopes writes to the owner's client).
export async function addGuestDb(guest) {
  const clientId = Store.get().clientId;
  if (onNeon()) { const rows = await neonAuthedInsert("guests", guestToRow(guest, clientId)); return rowToGuest(Array.isArray(rows) ? rows[0] : rows); }
  const { data, error } = await supabase.from("guests").insert(guestToRow(guest, clientId)).select().single();
  if (error) { console.warn("[api] guest insert failed:", error.message); throw error; }
  return rowToGuest(data);
}
export async function updateGuestDb(id, guest) {
  const clientId = Store.get().clientId;
  if (onNeon()) { await neonAuthedUpdate("guests", `id=eq.${id}`, guestToRow(guest, clientId)); return; }
  const { error } = await supabase.from("guests").update(guestToRow(guest, clientId)).eq("id", id);
  if (error) { console.warn("[api] guest update failed:", error.message); throw error; }
}
export async function deleteGuestDb(id) {
  if (onNeon()) { await neonAuthedDelete("guests", `id=eq.${id}`); return; }
  const { error } = await supabase.from("guests").delete().eq("id", id);
  if (error) { console.warn("[api] guest delete failed:", error.message); throw error; }
}

// Persist the current client's settings + content (theme, names, schedule, story,
// modules, …) back to Supabase. RLS lets the superadmin save any client and an
// owner save their own.
export async function saveClientData() {
  const clientId = Store.get().clientId;
  if (!clientId) throw new Error("No client loaded");
  if (onNeon()) { await neonAuthedUpdate("clients", `id=eq.${clientId}`, stateToClientRow(Store.get())); return; }
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
  // Firebase is the only auth now. Send the caller's fresh Firebase ID token;
  // the auth-gated Functions verify it with Google and resolve the Neon tenant.
  // Dynamic import avoids a load-time cycle with firebase.js.
  try {
    const { firebaseUserToken } = await import("@/lib/firebase.js");
    const fb = await firebaseUserToken();
    if (fb) return fb;
  } catch (_) { /* no Firebase session */ }
  // Never send an absent token — the auth-gated Functions would reject it as
  // "unauthorized". Throw a clear, actionable message so the caller re-logs in.
  throw new Error("Your session expired — please log out and log back in, then try again.");
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

// ── Global app config (public read, superadmin write via RLS) ──────────────
// One key/value JSON row per setting. Used by the "Donate to Dev" tab so the
// superadmin can manage the dev's QR images once for every client.
export async function getAppConfig(key) {
  try {
    const rows = await neonSelect("app_config", `select=value&key=eq.${encodeURIComponent(key)}&limit=1`);
    return rows && rows[0] ? rows[0].value : null;
  } catch (_) { return null; }
}
export async function setAppConfig(key, value) {
  // Superadmin write via the Neon bridge (verifies the console's Firebase token).
  const token = await adminBridgeToken();
  const res = await fetch("/api/neon-admin", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "set_config", key, value }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `set_config ${res.status}`);
  return true;
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
// Subdomain availability is checked against Neon (reserved_subdomains + clients +
// pending site_requests are all covered by the subdomain_free RPC).
export async function checkRequestSubdomainFree(subdomain) {
  try { return (await neonRpc("subdomain_free", { p_sub: subdomain })) === true; }
  catch { return false; }
}

// The raw /apply intake was a Supabase edge function. Self-registration now runs
// on Neon at celebrately.us/register (Register.jsx → register_site).
export async function submitSiteRequest() {
  throw new Error("Please register your site at celebrately.us/register.");
}

// --- Support tickets (owner sticky widget + superadmin console) --------------
// Owner files a ticket from their admin; RLS scopes insert/select to their own
// client. `tab` is the admin tab they were on (context for the superadmin).
// Tickets live in BOTH stores during/after the Neon migration: Neon clients file
// into Neon (RLS-scoped by their Firebase login), legacy Supabase clients into
// Supabase. Rows carry `_src` so mutations route back to the store they came
// from, and the superadmin console reads both. `neonAdminRpc` is the apex
// bridge — the console holds a SUPABASE superadmin JWT, not a Neon one.
const TICKET_SRC_NEON = "neon";
async function neonAdminRpc(action, params = {}) {
  const token = await adminBridgeToken();
  const res = await fetch("/api/neon-admin", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...params }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `neon-admin ${res.status}`);
  return j;
}
// Superadmin on the apex console (no client loaded) — the only caller that must
// merge BOTH stores. An owner is always scoped to their own client's backend.
const isApexSuperadmin = () => Store.get().auth?.role === "superadmin" && !Store.get().clientId;
const onNeonTicket = (t) => t && t._src === TICKET_SRC_NEON;

export async function submitTicket(form, tab) {
  const st = Store.get();
  const ctx = {
    email: st.auth?.email || st.settings?.ownerEmail || "",
    partnerA: st.settings?.partnerA, partnerB: st.settings?.partnerB,
    subdomain: resolveSubdomain() || "", tab: tab || "",
  };
  const row = ticketToRow(form, st.clientId, ctx);
  if (onNeon()) { await neonAuthedInsert("support_tickets", row); return; }
  const { error } = await supabase.from("support_tickets").insert(row);
  if (error) throw error;
}

// Owner: their own tickets (RLS-scoped). Superadmin console: every ticket from
// BOTH stores, newest first, each tagged with `_src`.
export async function listTickets() {
  if (onNeon()) {
    const rows = await neonAuthedSelect("support_tickets", "select=*&order=created_at.desc");
    return (rows || []).map((t) => ({ ...t, _src: TICKET_SRC_NEON }));
  }
  // Apex superadmin (no client loaded) → every ticket via the Neon bridge.
  const rows = (await neonAdminRpc("list_tickets")).rows || [];
  return rows.map((t) => ({ ...t, _src: TICKET_SRC_NEON }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// Superadmin: flip status; stamp resolved_at on resolve, clear it on reopen.
export async function setTicketStatus(id, status, ticket) {
  if (onNeonTicket(ticket)) { await neonAdminRpc("set_ticket_status", { id, status }); return; }
  const { error } = await supabase.from("support_tickets")
    .update({ status, resolved_at: status === "resolved" ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

// Superadmin: permanently remove a ticket (RLS delete policy is superadmin-only).
export async function deleteTicket(id, ticket) {
  if (onNeonTicket(ticket)) { await neonAdminRpc("delete_ticket", { id }); return; }
  const { error } = await supabase.from("support_tickets").delete().eq("id", id);
  if (error) throw error;
}

// Superadmin: save the internal reply note (or any partial patch).
export async function updateTicket(id, patch, ticket) {
  if (onNeonTicket(ticket)) { await neonAdminRpc("update_ticket", { id, patch }); return; }
  const { error } = await supabase.from("support_tickets").update(patch).eq("id", id);
  if (error) throw error;
}

// --- Support ticket thread (owner ⇄ superadmin replies) ---------------------
// Messages on a ticket, oldest-first. RLS returns only rows the caller may see
// (own-client owner, or any for superadmin).
export async function listTicketMessages(ticketId, ticket) {
  if (onNeon()) {
    return await neonAuthedSelect("support_ticket_messages", `select=*&ticket_id=eq.${ticketId}&order=created_at.asc`) || [];
  }
  if (onNeonTicket(ticket)) return (await neonAdminRpc("list_ticket_messages", { ticket_id: ticketId })).rows || [];
  const { data, error } = await supabase.from("support_ticket_messages")
    .select("*").eq("ticket_id", ticketId).order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

// Append a reply to a ticket. senderRole ('owner'|'superadmin') is pinned to the
// caller's actual role (RLS also enforces this). An owner reply reopens the
// ticket via the support_reopen_after_owner_msg trigger.
export async function postTicketMessage(ticketId, body, attachmentUrl, ticket) {
  const st = Store.get();
  const role = st.auth?.role === "superadmin" ? "superadmin" : "owner";
  const senderName = role === "superadmin"
    ? "Support"
    : ([st.settings?.partnerA, st.settings?.partnerB].filter(Boolean).join(" & ") || st.auth?.email || "Client");
  const row = { ticket_id: ticketId, sender_role: role, sender_name: senderName, body: (body || "").trim(), attachment_url: attachmentUrl || null };
  // Owner on their Neon site posts directly (RLS pins them to their own ticket);
  // the apex superadmin replies to a Neon ticket through the bridge.
  if (onNeon()) { await neonAuthedInsert("support_ticket_messages", row); return; }
  if (onNeonTicket(ticket)) {
    await neonAdminRpc("post_ticket_message", { ticket_id: ticketId, body: row.body, sender_name: senderName, attachment_url: row.attachment_url });
    return;
  }
  const { error } = await supabase.from("support_ticket_messages").insert(row);
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
// Neon's Data API (PostgREST) has NO realtime channel, so anything touching Neon
// tickets falls back to polling. Supabase-only views keep the instant push.
const TICKET_POLL_MS = 15000;
function pollEvery(onChange, ms = TICKET_POLL_MS) {
  const id = setInterval(onChange, ms);
  return () => clearInterval(id);
}

export function subscribeTicketMessagesRealtime(ticketId, onChange) {
  // All tickets live on Neon (Data API has no realtime channel) → poll.
  return pollEvery(onChange, 8000);
}

// Superadmin bell: recent CLIENT replies (superadmin's own replies aren't
// notifications). RLS returns all rows only for the superadmin.
export async function listRecentClientReplies(limit = 20) {
  // Apex superadmin bell → recent owner replies across all Neon tickets (bridge).
  const rows = (await neonAdminRpc("list_recent_client_replies", { limit })).rows || [];
  return rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
}

// Owner bell + Support tab badge: recent SUPERADMIN replies on the caller's OWN
// tickets. RLS scopes support_ticket_messages to the owner's own tickets, so
// this returns only replies addressed to this client. Mirror of
// listRecentClientReplies (the superadmin side). Drives the "the superadmin
// replied" notification independently of the ticket's status — a reply that
// doesn't flip status to waiting_reply still notifies.
export async function listRecentSupportReplies(limit = 20) {
  if (onNeon()) {
    return await neonAuthedSelect("support_ticket_messages",
      `select=*&sender_role=eq.superadmin&order=created_at.desc&limit=${limit}`) || [];
  }
  const { data, error } = await supabase.from("support_ticket_messages")
    .select("*").eq("sender_role", "superadmin").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

// ALL ticket messages (superadmin bell) — Neon has no realtime channel → poll.
export function subscribeAllTicketMessagesRealtime(onChange) {
  return pollEvery(onChange);
}

// Console bell — Neon tickets have no realtime channel → poll.
export function subscribeTicketsRealtime(onChange) {
  return pollEvery(onChange);
}

// Superadmin: list + resolve intake requests (Neon bridge, all statuses).
export async function listSiteRequests() {
  const rows = (await neonAdminRpc("list_all_requests")).rows || [];
  return rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export async function setSiteRequestStatus(id, status) {
  await neonAdminRpc("set_request_status", { id, status });
}

// Superadmin: fix up a request before approving (typo'd names/subdomain/email).
export async function updateSiteRequest(id, patch) {
  await neonAdminRpc("update_request", { id, patch });
}

// Superadmin: permanently remove a request row (typed-confirmation in the UI).
// Deleting a request never touches a client site created from it.
export async function deleteSiteRequest(id) {
  await neonAdminRpc("delete_request", { id });
}

// Console bell for new registrations — Neon has no realtime channel → poll.
export function subscribeSiteRequestsRealtime(onChange) {
  return pollEvery(onChange);
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
    // Feature Permissions v2 is the standard model as of 2026-07-18 — every new
    // site launches on it (features map left null → FEATURE_DEFAULTS via
    // featureLevel; the superadmin sets None/View/Edit per module during setup).
    accessV2: true,
    // New registered sites open with falling petals (Classic Ivory is the wizard's
    // default theme). Owner can change decor/theme anytime in admin.
    decorOn: true,
    decorStyle: "petals",
    onboarded: true, // they already provided setup via the wizard
  };
  // Create the client, link the (self-registered Firebase) owner, and mark the
  // request approved via the Neon bridge — approve_site_request (SECURITY
  // DEFINER) does the same content enrichment register_site uses, in one
  // idempotent transaction. The owner already set their own password at signup,
  // so there's no createOwner / setup-email step here.
  const appr = await neonAdminRpc("approve_request", { id: reqRow.id });
  return { id: null, subdomain: appr.subdomain || reqRow.subdomain, loginError: "", emailError: "" };
}
