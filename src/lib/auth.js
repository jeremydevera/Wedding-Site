import { Store } from "@/lib/store.jsx";
import { neonAuth, authedRpc, neonAuthedSelect, neonSelect, resolveShardId, setActiveShard, fbAuthMode, setFbAuthMode } from "@/lib/neon.js";
import { resolveSubdomain, subdomainFromHost } from "@/lib/tenant.js";
import { startGoogleRedirect, consumeGoogleRedirect } from "@/lib/firebase.js";

// The REAL host's client label, ignoring any ?client= console override. A
// Firebase popup can only run on an allow-listed domain (celebrately.us / apex),
// never an arbitrary client subdomain — so this decides whether Google must hop
// to the apex. On the apex with ?client= (superadmin "Open admin"), the host is
// celebrately.us → no hop, the popup runs right there.
const hostIsClientSubdomain = () => !!subdomainFromHost(window.location.hostname, "");

const gateFlag = () => { try { sessionStorage.setItem("evermore_admin_session", "1"); } catch (e) {} };

// my_registration_state with one retry — the first authed RPC right after a
// Neon-Auth sign-in can flake to {state:'anon'} while the JWT session warms up
// (observed live; Register.jsx does the same). Without the retry a legit owner's
// first admin sign-in gets treated as "no access". Returns null on hard failure.
async function regState() {
  let st = await authedRpc("my_registration_state").catch(() => null);
  if (st && st.state === "anon") {
    await new Promise((r) => setTimeout(r, 600));
    st = await authedRpc("my_registration_state").catch(() => null);
  }
  return st;
}

// Where does this owner belong? Resolves the admin URL of the client an owner
// profile points at, read from Neon. Null if the client row can't be read.
export async function ownerHomeUrl(clientId) {
  if (!clientId) return null;
  try {
    const rows = await neonSelect("clients", `select=subdomain&id=eq.${encodeURIComponent(clientId)}&limit=1`);
    return rows?.[0]?.subdomain ? `https://${rows[0].subdomain}.celebrately.us/admin` : null;
  } catch (e) { return null; }
}

// Profile-role read with warm-up backoff. The FIRST authed read right after a
// Firebase sign-in can run as 'anon' (permission denied) while the JWT session
// warms up — a single try misroutes the SUPERADMIN ("doesn't have access" /
// bounced to the login form). Retry ONLY on error (a clean empty result is a
// real non-superadmin) for up to ~3s. Shared by every login/boot path.
async function readProfileRole(uid) {
  if (!uid) return null;
  const read = () => neonAuthedSelect("profiles", `select=role&id=eq.${encodeURIComponent(uid)}`)
    .then((rows) => ({ ok: true, rows })).catch(() => ({ ok: false, rows: null }));
  let pr = await read();
  for (const wait of [600, 900, 1400]) {
    if (pr.ok) break;
    await new Promise((r) => setTimeout(r, wait));
    pr = await read();
  }
  return pr.rows;
}

// Apex/console runs on shard s1 with Firebase as the only auth.
async function loadApexNeonCtx() {
  // Firebase is the platform's ONLY auth now, and the apex/console run on shard
  // s1 (builtin). No Supabase read — the control plane lives in Neon.
  setFbAuthMode(true);
  setActiveShard(resolveShardId(""));
}

// Token the apex superadmin console sends to the /api/neon-admin bridge. The
// console signs in with FIREBASE (Google / email+password); the bridge verifies
// the Firebase ID token against a Neon superadmin profile.
export async function adminBridgeToken() {
  try {
    const { firebaseUserToken } = await import("@/lib/firebase.js");
    return (await firebaseUserToken()) || "";
  } catch (e) { return ""; }
}

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
    // Same warm-up flake as regState(): the first authed read after sign-in can
    // run as 'anon' (permission denied) — retry once on ERROR only. A clean
    // empty result is a legit non-superadmin, no retry (keeps owner sign-in fast).
    const prof = await readProfileRole(s.user.id);
    if (prof && prof[0] && prof[0].role === "superadmin") {
      Store.setAuth({ session: s, role: "superadmin", clientId: Store.get().clientId, email: s.user.email });
      gateFlag();
      return { role: "superadmin", client_id: Store.get().clientId };
    }
    const st = await regState();
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
  // Apex/hub (no client loaded): Firebase is the platform's ONLY auth now. A
  // Firebase session that maps to a Neon superadmin profile IS the console
  // session; a site owner is routed to her admin; an unfinished registrant to
  // /register. (Owner request 2026-07-23: a signed-in client on celebrately.us
  // stays on her account.)
  if (!resolveSubdomain() && /^\/(admin\/?)?$/.test(window.location.pathname)) {
    try {
      await loadApexNeonCtx();
      const s = await neonAuth.session();
      if (s && s.user) {
        const prof = await readProfileRole(s.user.id);
        if (prof && prof[0] && prof[0].role === "superadmin") {
          Store.setAuth({ session: s, role: "superadmin", clientId: null, email: s.user.email });
          gateFlag();
          return;
        }
        const st = await regState();
        if (st?.state === "active" && st.subdomain) { window.location.assign(`https://${st.subdomain}.celebrately.us/admin`); return; }
        if (st?.state === "none") { window.location.assign("/register"); return; }
        // pending → fall through to the login form
      }
    } catch (e2) { /* no Firebase session — show the login form */ }
  }
  Store.setAuth({ session: null, role: null, clientId: null, email: null });
}

export async function signIn(email, password) {
  if (Store.get().neonMode) {
    // Client site: authenticate the OWNER (or superadmin) against Firebase.
    await neonAuth.signIn(email, password);       // throws a friendly error on bad creds
    let p = await loadNeonSession();
    // Second chance: on a cold/slow session loadNeonSession can miss the
    // superadmin profile even after its internal backoff — never bounce the
    // platform admin with "no access" over a warm-up hiccup.
    if (!p) { await new Promise((r) => setTimeout(r, 800)); p = await loadNeonSession(); }
    if (p) return p;
    // Signed in fine but this isn't her site — send her HOME.
    const st = await regState();
    if (st?.state === "active" && st.subdomain && st.subdomain !== resolveSubdomain()) {
      window.location.assign(`https://${st.subdomain}.celebrately.us/admin`);
      return { role: "owner", client_id: null, redirecting: true };
    }
    throw new Error("This account doesn't have access to this site's admin.");
  }
  // Apex/console: Firebase (email+password). Superadmin → console; owner → her
  // site; a registrant who didn't finish the wizard → /register.
  await loadApexNeonCtx();
  const ns = await neonAuth.signIn(email, password);
  const uid = ns?.user?.id;
  const prof = await readProfileRole(uid);
  if (prof && prof[0] && prof[0].role === "superadmin") {
    Store.setAuth({ session: ns, role: "superadmin", clientId: null, email: ns.user?.email || email });
    gateFlag();
    return { role: "superadmin", client_id: null };
  }
  const st = await regState();
  if (st?.state === "active" && st.subdomain) {
    window.location.assign(`https://${st.subdomain}.celebrately.us/admin`);
    return { role: "owner", client_id: null, redirecting: true };
  }
  if (st?.state === "pending") throw new Error("Your site is waiting for approval — check back soon.");
  if (st?.state === "none") { window.location.assign("/register"); return { role: "guest", client_id: null, redirecting: true }; }
  throw new Error("That account doesn't have access to the console.");
}

// "Forgot your password?" from the login screen. Supabase-side accounts
// (superadmin + existing Supabase owners) get a reset link. Enumeration-safe:
// Supabase always resolves without revealing whether the email exists, and we
// never surface an error to the caller — the UI shows the same neutral message
// regardless. Neon self-serve owners set their password via the emailed link
// from approval, so this covers the accounts that have a password to reset.
// Returns a status the login UI acts on: { sent } | { notFound } | { error }.
// Firebase-backed site (Neon clients): Firebase can report a missing account
// (when enumeration protection is OFF) → { notFound }. Supabase's reset API is
// enumeration-safe and never reveals existence, so Supabase sites always resolve
// to { sent }.
export async function requestPasswordReset(email) {
  const addr = (email || "").trim();
  if (!addr) return { error: "Enter your email." };
  // Firebase is the only auth now (apex console + every client owner). Firebase
  // sends the reset link and can report a missing account → { notFound }.
  try {
    const { firebaseSendPasswordReset } = await import("@/lib/firebase.js");
    return await firebaseSendPasswordReset(addr);
  } catch (e) { return { error: "Couldn't send the reset link. Please try again." }; }
}

// Google login (Firebase). On a Neon client's admin: sign in + require owner/SA
// of THIS site. On the apex hub: route like the password fallback — owner with a
// live site → her admin; unfinished → /register; SA → refuse (console uses the
// admin password). Supabase client sites: not supported, actionable error.
const isUnauthorizedDomain = (e) => /unauthorized[-_]domain/i.test((e && (e.code || e.message)) || "");
function hopToApex() {
  // Fallback only: a client subdomain NOT on Firebase's authorized-domains list
  // can't open the popup. Hop to the apex (always authorized) which auto-
  // continues Google and routes back. Authorized subdomains never reach here.
  window.location.assign("https://celebrately.us/admin?gfrom=" + encodeURIComponent(resolveSubdomain() || ""));
  return { role: null, client_id: null, redirecting: true };
}

export async function signInGoogle() {
  if (Store.get().neonMode) {
    // A Neon client's admin (subdomain OR the superadmin's apex ?client=) or a
    // Neon owner login. Open the Google popup RIGHT HERE — one click, no hop —
    // now that client subdomains are on the authorized-domains list. Only if
    // Firebase rejects the domain (a brand-new subdomain not yet authorized) do
    // we fall back to the apex hop. loadNeonSession then grants superadmin (SA
    // profile) or owner-of-this-site.
    try {
      await neonAuth.signInGoogle();
    } catch (e) {
      if (isUnauthorizedDomain(e) && hostIsClientSubdomain()) return hopToApex();
      throw e;
    }
    let p = await loadNeonSession();
    // Same warm-up second chance as the password path — don't tell the
    // superadmin their Google account "doesn't have access" over a slow start.
    if (!p) { await new Promise((r) => setTimeout(r, 800)); p = await loadNeonSession(); }
    if (!p) {
      const st = await regState();
      if (st?.state === "active" && st.subdomain && st.subdomain !== resolveSubdomain()) {
        window.location.assign(`https://${st.subdomain}.celebrately.us/admin`);
        return { role: "owner", client_id: null, redirecting: true };
      }
      await neonAuth.signOut().catch(() => {});
      throw new Error("That Google account doesn't have access to this site's admin.");
    }
    return p;
  }
  // Non-neon (Supabase-era) client site: Google isn't wired there — hop to the
  // apex login. Host-based, so the SA "Open admin" (apex ?client=) never hops.
  if (hostIsClientSubdomain()) return hopToApex();
  await loadApexNeonCtx();
  if (!fbAuthMode()) throw new Error("Google login isn't available yet — sign in with your email & password.");
  const gfrom = new URLSearchParams(window.location.search).get("gfrom");
  const ns = await neonAuth.signInGoogle();
  return routeAfterGoogle(ns?.user?.id, gfrom);
}

// Where a just-completed Google sign-in should land (shared by the popup path
// and the redirect auto-continue). The SUPERADMIN is accepted on ANY site: with
// a `gfrom` (came from a client's admin) they're taken to that site's admin —
// the shared Firebase cookie makes loadNeonSession grant superadmin there;
// without one they stay on the console (their Firebase session is now set, so
// every client admin recognizes them). Owners go to their own site; site-less
// accounts go to /register.
async function routeAfterGoogle(uid, gfrom) {
  await loadApexNeonCtx();
  const prof = await readProfileRole(uid);
  if (prof && prof[0] && prof[0].role === "superadmin") {
    if (gfrom) { window.location.assign(`https://${gfrom}.celebrately.us/admin`); return { role: "superadmin", client_id: null, redirecting: true }; }
    // Superadmin signed in with Google on the apex → open the console right here
    // (set the session so superadmin.jsx renders without a reload).
    const s = await neonAuth.session().catch(() => null);
    Store.setAuth({ session: s || { user: { id: uid } }, role: "superadmin", clientId: null, email: s?.user?.email || null });
    gateFlag();
    return { role: "superadmin", client_id: null, note: "You're signed in with Google — open any client's admin to manage it." };
  }
  const st = await regState();
  if (st?.state === "active" && st.subdomain) {
    window.location.assign(`https://${st.subdomain}.celebrately.us/admin`);
    return { role: "owner", client_id: null, redirecting: true };
  }
  if (st?.state === "pending") throw new Error("Your site is waiting for approval — check back soon.");
  window.location.assign("/register");
  return { role: "guest", client_id: null, redirecting: true };
}

// Apex auto-continue: called on mount when `?gfrom=` is present. On the return
// leg from Google it consumes the redirect result and routes; on the first leg
// (no result yet) it returns {consumed:false} so the caller can START the
// redirect. Keeps the whole flow to ONE click on the client subdomain.
export async function completeGoogleRedirect() {
  const gfrom = new URLSearchParams(window.location.search).get("gfrom");
  let res = null;
  try { res = await consumeGoogleRedirect(); } catch (e) { /* none pending */ }
  if (!res) return { consumed: false, gfrom };
  try { await loadApexNeonCtx(); return { consumed: true, ...(await routeAfterGoogle(res.user.uid, gfrom)) }; }
  catch (e) { return { consumed: true, error: e.message || "Google sign-in failed.", gfrom }; }
}

export async function beginGoogleRedirect() { await startGoogleRedirect(); }

export async function signOut() {
  // Firebase is the only auth now (apex console + every client owner).
  setFbAuthMode(true);
  try { await neonAuth.signOut(); } catch (e) { /* ignore */ }
  try { sessionStorage.removeItem("evermore_admin_session"); } catch (e) {}
  Store.setAuth({ session: null, role: null, clientId: null, email: null });
}

// Superadmin owner-lifecycle actions run through the Neon bridge, which performs
// the Firebase Admin operation server-side (with the platform SA key) and updates
// the Neon profiles/clients rows. Verified by the console's Firebase ID token —
// no Supabase edge function.
async function invokeOwnerFn(body) {
  const token = await adminBridgeToken();
  const res = await fetch("/api/neon-admin", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || (res.status === 403 ? "Your session expired — sign in again, then retry." : `Request failed (${res.status})`));
  if (j && j.error) throw new Error(j.error);
  return j;
}

// Superadmin-only: create the owner login, or reset an existing owner's password.
export async function createOwner({ email, password, client_id }) {
  return invokeOwnerFn({ action: "create_owner", email, password, client_id });
}

// Superadmin-only: change an existing owner's login email.
export async function updateOwnerEmail({ old_email, new_email }) {
  return invokeOwnerFn({ action: "update_owner_email", old_email, new_email });
}

// Superadmin-only: delete an owner's Firebase login + Neon profile.
// Pass any of email / user_id / client_id; the bridge resolves the user.
export async function deleteOwner({ email, user_id, client_id }) {
  return invokeOwnerFn({ action: "delete_owner_account", email, user_id, client_id });
}

// Superadmin-only: email the owner a Firebase "set your password" reset link.
export async function sendSetupEmail({ email, subdomain, name }) {
  return invokeOwnerFn({ action: "send_setup_email", email, subdomain, name });
}
