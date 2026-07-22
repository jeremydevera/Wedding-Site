// EXPERIMENTAL Neon backend (owner decision 2026-07-19) — the sandbox client can
// serve its data from Neon (Data API + Neon Auth) instead of Supabase, gated by
// the superadmin "USE NEON DATABASE" platform toggle (Supabase app_config key
// `use_neon_db`). Guest paths only for now: anonymous role via a short-lived
// anon JWT from Neon Auth (the Data API rejects tokenless requests). Admin/auth
// paths stay on Supabase until the Neon Auth login lands.
// Plan + port notes: docs/superpowers/plans/2026-07-19-neon-sandbox-migration.md

// ---- Shards -----------------------------------------------------------------
// Owner decision (2026-07-19): prepare for multiple Neon databases ("shards")
// BEFORE they're ever needed. Each shard = one Neon project with its own Neon
// Auth + Data API. The registry below is only the built-in fallback (shard s1,
// the original project) — the LIVE registry is read from Supabase app_config
// key `neon_shards` at boot, shaped:
//   { "default": "s1",
//     "bySubdomain": { "some-client": "s2" },
//     "shards": { "s2": { "authUrl": "…/auth", "dataApiUrl": "…/rest/v1" } } }
// so future shards (s2…s5) go live with a config write — NO redeploy. A client
// resolves to bySubdomain[subdomain] → default → "s1".
const BUILTIN_SHARDS = {
  s1: {
    authUrl: "https://ep-long-credit-aztdmow3.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth",
    dataApiUrl: "https://ep-long-credit-aztdmow3.apirest.c-3.ap-southeast-1.aws.neon.tech/neondb/rest/v1",
  },
};
let registry = null;      // app_config `neon_shards` value (merged over builtin)
let activeShard = "s1";   // one client per page load, so one active shard
export const NEON_SHARDS_KEY = "neon_shards";
export function setNeonRegistry(cfg) { registry = cfg || null; }
export function resolveShardId(subdomain) {
  return registry?.bySubdomain?.[subdomain] || registry?.default || "s1";
}
export function setActiveShard(id) { activeShard = id || "s1"; anonTok = null; } // token is per-shard
function shard() {
  const s = (registry?.shards || {})[activeShard] || BUILTIN_SHARDS[activeShard] || BUILTIN_SHARDS.s1;
  return s;
}

// App_config key for the platform toggle (read from SUPABASE — it stays the
// control plane so the flag can never chicken-and-egg itself).
export const NEON_FLAG_KEY = "use_neon_db";

// ---- Firebase identity mode (post-cutover) ----------------------------------
// app_config `use_firebase_auth` {enabled}: when ON, the Neon Data API trusts
// FIREBASE's JWKS instead of Neon Auth — every token below (guest + signed-in)
// comes from Firebase, and neonAuth.* delegates to Firebase (Google + email/pw).
// Set at boot from the control plane via setFbAuthMode(). Flag-gated so the
// flip is a config write + Data API JWKS change, and rollback is the reverse.
import { firebaseAnonToken, firebaseUserToken, firebaseSignUpEmail, firebaseSignInEmail, firebaseSignOut, currentFirebaseUser, signInWithGoogle } from "@/lib/firebase.js";
export const FB_AUTH_FLAG_KEY = "use_firebase_auth";
let fbMode = false;
export function setFbAuthMode(on) { fbMode = on === true; }
export function fbAuthMode() { return fbMode; }
// Friendly messages for Firebase error codes (auth/xyz-abc).
function fbErr(e) {
  const c = String(e?.code || e?.message || "");
  if (/email-already-in-use/.test(c)) return new Error("That email already has an account — sign in instead.");
  if (/invalid-credential|wrong-password|user-not-found/.test(c)) return new Error("Wrong email or password.");
  if (/too-many-requests/.test(c)) return new Error("Too many attempts — wait a minute and try again.");
  if (/network-request-failed/.test(c)) return new Error("Network problem — check your connection and retry.");
  return e instanceof Error ? e : new Error(c || "auth error");
}

let anonTok = null; // { token, exp(ms) }
function jwtExpMs(token) {
  try { return (JSON.parse(atob(token.split(".")[1])).exp || 0) * 1000; } catch { return 0; }
}
// Anonymous JWT for guests — fetched once, cached until ~1 min before expiry
// (Neon anon tokens live ~15 min).
async function anonToken() {
  if (fbMode) return firebaseAnonToken(); // Firebase anonymous session (SDK caches/refreshes)
  if (anonTok && Date.now() < anonTok.exp - 60_000) return anonTok.token;
  const res = await fetch(`${shard().authUrl}/token/anonymous`);
  if (!res.ok) throw new Error(`neon anon token failed (${res.status})`);
  const j = await res.json().catch(() => ({}));
  const token = j.token || j.jwt;
  if (!token) throw new Error("neon anon token missing in response");
  anonTok = { token, exp: jwtExpMs(token) || Date.now() + 10 * 60_000 };
  return token;
}

async function neonRest(path, { method = "GET", body, headers = {}, raw = false } = {}) {
  const token = await anonToken();
  const res = await fetch(`${shard().dataApiUrl}/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).message || msg; } catch { /* keep status */ }
    const err = new Error(msg); err.status = res.status; throw err;
  }
  if (raw) return res;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// PostgREST-style helpers (same query syntax as Supabase's REST layer).
export const neonSelect = (table, query) => neonRest(`${table}?${query}`);
export const neonInsert = (table, row) =>
  // return=minimal: anon can INSERT rsvps/guestbook/quiz but not read them back
  // (RLS) — asking for the row back would 4xx an otherwise-successful insert.
  neonRest(table, { method: "POST", body: row, headers: { prefer: "return=minimal" } });
export const neonRpc = (fn, args) => neonRest(`rpc/${fn}`, { method: "POST", body: args || {} });

// Paged select with an exact total (PostgREST Range/Content-Range protocol) —
// mirrors supabase's .select("*", { count: "exact" }).range(from, to).
export async function neonSelectPaged(table, query, from, to) {
  const res = await neonRest(`${table}?${query}`, {
    raw: true,
    headers: { prefer: "count=exact", "range-unit": "items", range: `${from}-${to}` },
  });
  const rows = await res.json().catch(() => []);
  const total = parseInt((res.headers.get("content-range") || "").split("/")[1], 10);
  return { rows: rows || [], count: Number.isFinite(total) ? total : (rows || []).length };
}

// ---- Neon Auth (Better Auth REST) — registered users ------------------------
// Auth calls go through OUR first-party proxy (/api/auth/* → the shard's
// neonauth host). Direct calls set a THIRD-party cookie that Safari/WebKit
// blocks (verified: sign-in bounced back to the auth card on WebKit) — via the
// proxy the session cookie is first-party on every browser. The short-lived
// Data API JWT still arrives via the `set-auth-jwt` response header (proxied
// through) and is cached until ~1 min before expiry.
let userTok = null; // { token, exp(ms) }
async function authFetch(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`/api/auth${path}`, {
    method,
    credentials: "include",
    headers: {
      "x-neon-auth-base": shard().authUrl, // proxy validates against a strict Neon-host pattern
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const jwt = res.headers.get("set-auth-jwt");
  if (jwt) userTok = { token: jwt, exp: jwtExpMs(jwt) || Date.now() + 10 * 60_000 };
  let data = null;
  try { data = await res.json(); } catch { /* some endpoints return empty */ }
  if (!res.ok) {
    const err = new Error(data?.message || `auth error (${res.status})`);
    err.status = res.status; throw err;
  }
  return data;
}
export const neonAuth = {
  // turnstileToken: Cloudflare Turnstile response — verified SERVER-side by the
  // /api/auth proxy (Neon path). Firebase path: signup goes to Google directly
  // (their own abuse protection + our register_site hourly cap still apply);
  // the widget token is still required by the UI.
  signUp: async (email, password, turnstileToken) => {
    if (fbMode) { try { const r = await firebaseSignUpEmail(email, password); return { token: r.idToken, user: { id: r.uid, email: r.email } }; } catch (e) { throw fbErr(e); } }
    return authFetch("/sign-up/email", { method: "POST", body: { email, password, name: email.split("@")[0] }, headers: turnstileToken ? { "x-turnstile-token": turnstileToken } : {} });
  },
  signIn: async (email, password) => {
    if (fbMode) { try { const r = await firebaseSignInEmail(email, password); return { token: r.idToken, user: { id: r.uid, email: r.email } }; } catch (e) { throw fbErr(e); } }
    return authFetch("/sign-in/email", { method: "POST", body: { email, password } });
  },
  // Google — Firebase mode only (Neon Auth's OAuth is the Safari-broken path).
  signInGoogle: async () => {
    if (!fbMode) throw new Error("Google sign-in isn't available yet.");
    try { const r = await signInWithGoogle(); return { token: r.idToken, user: { id: r.user.uid, email: r.user.email } }; } catch (e) { throw fbErr(e); }
  },
  signOut: () => {
    if (fbMode) return firebaseSignOut();
    userTok = null; return authFetch("/sign-out", { method: "POST", body: {} }).catch(() => null);
  },
  // Email-verification. Neon path: OTP via shared sender. Firebase path:
  // verification is a LINK email sent at signup (non-blocking) — resend only.
  sendVerifyOtp: async (email) => {
    if (fbMode) return null; // Firebase: verification LINK already emailed at signup
    return authFetch("/email-otp/send-verification-otp", { method: "POST", body: { email, type: "email-verification" } });
  },
  verifyEmailOtp: (email, otp) => {
    if (fbMode) return Promise.reject(new Error("Check your inbox for the verification LINK instead."));
    return authFetch("/email-otp/verify-email", { method: "POST", body: { email, otp } });
  },
  // null when signed out; { user } when signed in (also refreshes the JWT)
  session: async () => {
    if (fbMode) { const u = await currentFirebaseUser(); return u ? { user: { id: u.uid, email: u.email, emailVerified: u.emailVerified } } : null; }
    try { const d = await authFetch("/get-session"); return d && d.user ? d : null; } catch { return null; }
  },
};
async function userToken() {
  if (fbMode) { const t = await firebaseUserToken(); if (!t) throw new Error("not signed in"); return t; }
  if (userTok && Date.now() < userTok.exp - 60_000) return userTok.token;
  const s = await neonAuth.session(); // refreshes userTok via header
  if (!s || !userTok) throw new Error("not signed in");
  return userTok.token;
}
// Data API RPC with the signed-in user's JWT (RLS role: authenticated).
export async function authedRpc(fn, args) {
  const token = await userToken();
  const res = await fetch(`${shard().dataApiUrl}/rpc/${fn}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(args || {}),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).message || msg; } catch { /* keep */ }
    const err = new Error(msg); err.status = res.status; throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---- Authenticated Data API (owner JWT) — admin reads/writes -----------------
// The signed-in owner's JWT gives RLS role "authenticated"; the ported Neon
// policies scope every read/write to their own client (auth.user_id() ->
// profiles.client_id), exactly like the Supabase owner-update policies. Used by
// the admin path (loadAdminData + mutations + saveClientData) when neonMode.
async function neonAuthedRest(path, { method = "GET", body, headers = {}, raw = false } = {}) {
  const token = await userToken();
  const res = await fetch(`${shard().dataApiUrl}/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).message || msg; } catch { /* keep status */ }
    const err = new Error(msg); err.status = res.status; throw err;
  }
  if (raw) return res;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
export const neonAuthedSelect = (table, query) => neonAuthedRest(`${table}?${query}`);
export const neonAuthedInsert = (table, row) => neonAuthedRest(table, { method: "POST", body: row, headers: { prefer: "return=representation" } });
export const neonAuthedUpdate = (table, query, patch) => neonAuthedRest(`${table}?${query}`, { method: "PATCH", body: patch, headers: { prefer: "return=minimal" } });
export const neonAuthedDelete = (table, query) => neonAuthedRest(`${table}?${query}`, { method: "DELETE", headers: { prefer: "return=minimal" } });

// deploy marker: neon-registration funnel v1 (2026-07-21)
