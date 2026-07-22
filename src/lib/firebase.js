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

// Pop the Google consent, return { idToken, user }. idToken is the Firebase
// JWT (verified server-side / by Neon's JWKS at cutover). Throws with a clean
// message on cancel / provider-not-enabled.
export async function signInWithGoogle() {
  const { auth, mod } = await getAuth();
  const provider = new mod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const res = await mod.signInWithPopup(auth, provider);
  const idToken = await res.user.getIdToken();
  return { idToken, user: { uid: res.user.uid, email: res.user.email, name: res.user.displayName } };
}

// Current signed-in REAL Firebase user (or null). Anonymous guest sessions are
// NOT a user — admin/session checks must never treat them as signed in.
export async function currentFirebaseUser() {
  const { auth } = await getAuth();
  await new Promise((r) => { const un = auth.onAuthStateChanged(() => { un(); r(); }); });
  const u = auth.currentUser;
  if (!u || u.isAnonymous) return null;
  return { uid: u.uid, email: u.email, name: u.displayName, emailVerified: u.emailVerified, idToken: await u.getIdToken() };
}

export async function firebaseSignOut() {
  const { auth, mod } = await getAuth();
  try { await mod.signOut(auth); } catch (e) { /* ignore */ }
}

// ---- Post-cutover primitives (Neon Data API trusts Firebase's JWKS) ---------
// Email/password + anonymous session helpers mirroring what Neon Auth provided.

export async function firebaseSignUpEmail(email, password) {
  const { auth, mod } = await getAuth();
  const res = await mod.createUserWithEmailAndPassword(auth, email, password);
  // Send the verification link (non-blocking — Turnstile already gates bots;
  // Google users arrive pre-verified).
  try { await mod.sendEmailVerification(res.user); } catch (e) { /* ignore */ }
  return { uid: res.user.uid, email: res.user.email, idToken: await res.user.getIdToken() };
}

export async function firebaseSignInEmail(email, password) {
  const { auth, mod } = await getAuth();
  const res = await mod.signInWithEmailAndPassword(auth, email, password);
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
