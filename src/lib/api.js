import { supabase } from "@/lib/supabase.js";
import { Store } from "@/lib/store.jsx";
import { resolveSubdomain } from "@/lib/tenant.js";
import { clientToState, stateToClientRow, rowToGuestbook, rowToRsvp, rowToQuizSub, rsvpToRow, guestbookToRow, quizToRow } from "@/lib/mappers.js";
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

// Upload any media file (audio or image) to Cloudflare R2 via the auth-gated
// /api/upload Pages Function. Requires a valid Supabase session (admins only);
// returns { url, key } where url is a same-origin "/r2/<key>" link to store.
export async function uploadToR2(file, kind, clientId) {
  const { data } = await supabase.auth.getSession();
  const token = data && data.session && data.session.access_token;
  if (!token) throw new Error("Not signed in");
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind || "misc");
  if (clientId) form.append("clientId", clientId);
  const res = await fetch("/api/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) {
    let msg = `upload failed (${res.status})`;
    try { const e = await res.json(); if (e && e.error) msg = e.error; } catch (_) {}
    throw new Error(msg);
  }
  return await res.json();
}

// Upload an audio file to R2. Returns { url, path } (path kept for the old
// call-site shape). Audio now lives in R2, not the Supabase `audio` bucket.
export async function uploadAudio(file, clientId) {
  const { url, key } = await uploadToR2(file, "audio", clientId);
  return { url, path: key };
}

// Have the Function pull a remote file into R2 server-side (no browser CORS).
// Used by the migration to move existing Supabase-hosted audio.
async function uploadUrlToR2(sourceUrl, kind, clientId) {
  const { data } = await supabase.auth.getSession();
  const token = data && data.session && data.session.access_token;
  if (!token) throw new Error("Not signed in");
  const form = new FormData();
  form.append("sourceUrl", sourceUrl);
  form.append("kind", kind || "misc");
  if (clientId) form.append("clientId", clientId);
  const res = await fetch("/api/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) { let m = `upload failed (${res.status})`; try { const e = await res.json(); if (e.error) m = e.error; } catch (_) {} throw new Error(m); }
  return await res.json();
}

// One-time migration: move the active client's existing media into R2 and
// rewrite the stored references. Idempotent — anything already on /r2/ is
// skipped, so it can be re-run safely. base64 images upload from the browser
// (data: URLs have no CORS); remote audio is pulled server-side.
const isData = (u) => typeof u === "string" && u.startsWith("data:");
const isLegacyUrl = (u) => typeof u === "string" && u && !u.startsWith("/r2/");
export function hasLegacyMedia(state) {
  const s = state || Store.get();
  if (["heroImage", "frameImage", "envBgImage"].some((k) => isData(s.settings && s.settings[k]))) return true;
  if ((s.attire || []).some((g) => isData(g.image))) return true;
  if ((s.story || []).some((r) => isData(r.img))) return true;
  if ((s.playlist || []).some((t) => isLegacyUrl(t.url) && !isData(t.url))) return true;
  return false;
}

export async function migrateClientMediaToR2(onProgress) {
  const st = Store.get();
  const clientId = st.clientId;
  let migrated = 0, failed = 0;
  const tick = () => { migrated++; if (onProgress) onProgress(migrated); };

  // base64 image -> upload from the browser
  const imgToR2 = async (dataUrl, hint) => {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], `${hint || "image"}.jpg`, { type: blob.type || "image/jpeg" });
    return (await uploadToR2(file, "image", clientId)).url;
  };

  // settings images
  const settings = { ...st.settings };
  for (const k of ["heroImage", "frameImage", "envBgImage"]) {
    if (isData(settings[k])) { try { settings[k] = await imgToR2(settings[k], k); tick(); } catch (e) { failed++; } }
  }
  // attire images
  const attire = (st.attire || []).map((g) => ({ ...g }));
  for (const g of attire) { if (isData(g.image)) { try { g.image = await imgToR2(g.image, g.name || "attire"); tick(); } catch (e) { failed++; } } }
  // story images
  const story = (st.story || []).map((r) => ({ ...r }));
  for (const r of story) { if (isData(r.img)) { try { r.img = await imgToR2(r.img, r.title || "story"); tick(); } catch (e) { failed++; } } }
  // audio (remote Supabase URL) -> server-side pull
  const playlist = (st.playlist || []).map((t) => ({ ...t }));
  for (const t of playlist) {
    if (isLegacyUrl(t.url) && !isData(t.url)) { try { t.url = (await uploadUrlToR2(t.url, "audio", clientId)).url; tick(); } catch (e) { failed++; } }
  }

  Store.set({ attire, story, playlist });
  Store.updateSettings(settings);
  await saveClientData();
  return { migrated, failed };
}
