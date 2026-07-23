// Firebase Auth — identity provider for Google (and later Facebook) login.
//
// WHY Firebase for identity: Neon Auth's OAuth session is a cookie on Neon's
// domain → Safari/iOS ITP drops it (same wall we hit for passwords). Firebase
// Auth is TOKEN-based (ID token in IndexedDB, not a third-party cookie), so
// Google login works on every browser incl. iPhone. Firebase = who-you-are;
// Neon = your data. The Neon Data API is (separately, at cutover) pointed at
// Firebase's JWKS so RLS trusts these tokens.
//
// Lazy-loaded: the ~heavy Firebase SDK is dynamically imported only when a user
// actually clicks a social button, so it never bloats the main bundle.
//
// Config values are PUBLIC by Firebase design (security is enforced by Auth
// provider settings + authorized domains + token verification), safe to embed.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC4zUcZH06Te0CQLwn9r3VdAeb3Rcf4K0k",
  authDomain: "wedding-dc35d.firebaseapp.com",
  projectId: "wedding-dc35d",
  appId: "1:873543273512:web:acf150b274b366b6d4391d",
  messagingSenderId: "873543273512",
};

let _authP = null;
// Returns { auth, mod } where mod is the firebase/auth namespace. One instance.
async function getAuth() {
  if (_authP) return _authP;
  _authP = (async () => {
    const [{ initializeApp }, authMod] = await Promise.all([
      import("firebase/app"),
      import("firebase/auth"),
    ]);
    const app = initializeApp(FIREBASE_CONFIG);
    // Persist the session locally (IndexedDB) — survives reloads, first-party,
    // Safari-safe (NOT a cross-site cookie).
    const auth = authMod.getAuth(app);
    try { await authMod.setPersistence(auth, authMod.browserLocalPersistence); } catch (e) { /* default persistence */ }
    return { auth, mod: authMod };
  })();
  return _authP;
}

// ---- Cross-subdomain session (the /api/fb-session cookie bridge) ------------
// Firebase persists per-ORIGIN, so an apex sign-in (wizard / main login) would
// be invisible on the owner's own subdomain and she'd sign in twice. After any
// REAL sign-in we push the refresh token into a first-party HttpOnly cookie on
// .celebrately.us (Pages Function /api/fb-session); origins with no local SDK
// session restore from it by minting fresh ID tokens via securetoken.

async function publishSession(user) {
  try {
    const rt = user && user.refreshToken;
    if (rt) {
      await fetch("/api/fb-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: rt }) });
      _ck = { t: Date.now(), rt };
    }
  } catch (e) { /* cookie bridge is best-effort; same-origin login still works */ }
}

// Shared-cookie probe with a short cache (userToken() runs on every authed API
// call — don't hammer /api/fb-session). Returns the refresh token, null when
// the cookie is DEFINITIVELY absent (signed out somewhere), or undefined when
// unknowable (local dev / endpoint unreachable — keep the local session then).
let _ck = { t: 0, rt: undefined };
async function cookieToken() {
  if (Date.now() - _ck.t < 20000) return _ck.rt;
  try {
    const r = await fetch("/api/fb-session");
    const d = r.ok ? await r.json() : null;
    _ck = { t: Date.now(), rt: r.ok ? (d.refreshToken || null) : undefined };
  } catch (e) { _ck = { t: Date.now(), rt: undefined }; }
  return _ck.rt;
}

let _restored = null; // { uid, email, idToken, exp, refreshToken }
const jwtPayload = (t) => { try { return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return {}; } };

async function mintFromRefreshToken(rt) {
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_CONFIG.apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(rt)}`,
  });
  if (!res.ok) throw new Error("session expired");
  const d = await res.json();
  const p = jwtPayload(d.id_token);
  return { uid: d.user_id, email: p.email || null, emailVerified: p.email_verified === true, idToken: d.id_token, exp: (p.exp || 0) * 1000, refreshToken: d.refresh_token || rt };
}

// Session restored from the shared cookie (or null). Cached; re-mints the ID
// token when within 2 minutes of expiry. A dead/revoked token clears the cookie.
async function restoredSession() {
  if (_restored && _restored.exp - Date.now() > 120000) return _restored;
  try {
    const rt = _restored ? _restored.refreshToken : await cookieToken();
    if (!rt) return null;
    _restored = await mintFromRefreshToken(rt);
    return _restored;
  } catch (e) {
    _restored = null;
    try { await fetch("/api/fb-session", { method: "DELETE" }); } catch (e2) { /* ignore */ }
    return null;
  }
}

// Pop the Google consent, return { idToken, user }. idToken is the Firebase
// JWT (verified server-side / by Neon's JWKS at cutover). Throws with a clean
// message on cancel / provider-not-enabled.
export async function signInWithGoogle() {
  const { auth, mod } = await getAuth();
  const provider = new mod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const res = await mod.signInWithPopup(auth, provider);
  const idToken = await res.user.getIdToken();
  await publishSession(res.user);
  return { idToken, user: { uid: res.user.uid, email: res.user.email, name: res.user.displayName } };
}

// Current signed-in REAL Firebase user (or null). Anonymous guest sessions are
// NOT a user — admin/session checks must never treat them as signed in.
// Falls back to the shared-cookie session so an apex sign-in is visible on the
// owner's subdomain (and vice versa).
export async function currentFirebaseUser() {
  const { auth } = await getAuth();
  await new Promise((r) => { const un = auth.onAuthStateChanged(() => { un(); r(); }); });
  const u = auth.currentUser;
  if (!u || u.isAnonymous) {
    const s = await restoredSession();
    return s ? { uid: s.uid, email: s.email, name: null, emailVerified: s.emailVerified, idToken: s.idToken } : null;
  }
  // Local session exists — but the shared cookie is the CROSS-ORIGIN source of
  // truth: signing out on any subdomain deletes it, and every other origin
  // must drop its own local copy too (otherwise the apex kept resuming to a
  // site the owner had just signed out of). Unknown (dev/api down) = keep.
  if ((await cookieToken()) === null) {
    try { const { auth: a2, mod } = await getAuth(); await mod.signOut(a2); } catch (e) { /* ignore */ }
    return null;
  }
  return { uid: u.uid, email: u.email, name: u.displayName, emailVerified: u.emailVerified, idToken: await u.getIdToken() };
}

export async function firebaseSignOut() {
  const { auth, mod } = await getAuth();
  try { await mod.signOut(auth); } catch (e) { /* ignore */ }
  _restored = null;
  _ck = { t: Date.now(), rt: null };
  try { await fetch("/api/fb-session", { method: "DELETE" }); } catch (e) { /* sign-out is local-first */ }
}

// ---- Post-cutover primitives (Neon Data API trusts Firebase's JWKS) ---------
// Email/password + anonymous session helpers mirroring what Neon Auth provided.

export async function firebaseSignUpEmail(email, password) {
  const { auth, mod } = await getAuth();
  const res = await mod.createUserWithEmailAndPassword(auth, email, password);
  // Send the verification link (non-blocking — Turnstile already gates bots;
  // Google users arrive pre-verified).
  try { await mod.sendEmailVerification(res.user); } catch (e) { /* ignore */ }
  await publishSession(res.user);
  return { uid: res.user.uid, email: res.user.email, idToken: await res.user.getIdToken() };
}

export async function firebaseSignInEmail(email, password) {
  const { auth, mod } = await getAuth();
  const res = await mod.signInWithEmailAndPassword(auth, email, password);
  await publishSession(res.user);
  return { uid: res.user.uid, email: res.user.email, idToken: await res.user.getIdToken() };
}

// Guest token: Firebase ANONYMOUS session — signature-valid for the Data API's
// JWKS check, maps to the `anonymous` role (no role claim), auth.user_id() is a
// uid that matches no profile. Requires the Anonymous provider enabled.
export async function firebaseAnonToken() {
  const { auth, mod } = await getAuth();
  if (!auth.currentUser) await mod.signInAnonymously(auth);
  return auth.currentUser.getIdToken();
}

// Fresh ID token for the signed-in (non-anonymous) user, or null.
export async function firebaseUserToken() {
  const u = await currentFirebaseUser();
  return u && u.idToken ? u.idToken : null;
}
