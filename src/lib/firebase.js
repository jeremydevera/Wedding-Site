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

// Current signed-in Firebase user (or null). Fresh ID token included.
export async function currentFirebaseUser() {
  const { auth } = await getAuth();
  await new Promise((r) => { const un = auth.onAuthStateChanged(() => { un(); r(); }); });
  const u = auth.currentUser;
  if (!u) return null;
  return { uid: u.uid, email: u.email, name: u.displayName, idToken: await u.getIdToken() };
}

export async function firebaseSignOut() {
  const { auth, mod } = await getAuth();
  try { await mod.signOut(auth); } catch (e) { /* ignore */ }
}
