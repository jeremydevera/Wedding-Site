// Shared Firebase session cookie for *.celebrately.us.
//
// Firebase Auth persists per-ORIGIN (IndexedDB), so a sign-in at the apex
// (register wizard / main login) is invisible on the owner's own subdomain —
// she'd have to sign in twice. Neon Auth solved this with a Domain=.celebrately.us
// cookie; this function restores exactly that UX for Firebase: after a REAL
// (non-anonymous) sign-in the client POSTs the Firebase refresh token here and
// it's stored in a first-party HttpOnly cookie scoped to .celebrately.us. Any
// subdomain can then GET it back and mint fresh ID tokens via securetoken
// (see restoreFirebaseSession in src/lib/firebase.js). DELETE on sign-out.
//
// Security: HttpOnly (no XSS read of the cookie itself), Secure, SameSite=Lax,
// 30-day cap (Firebase refresh tokens don't expire but re-login monthly is a
// fine trade). GET responses are same-origin only (CORS default) and we verify
// the Origin/Referer is one of our hosts before echoing the token.

const COOKIE = "fb_rt";
const MAX_AGE = 60 * 60 * 24 * 30;

function ourOrigin(request) {
  const src = request.headers.get("Origin") || request.headers.get("Referer") || "";
  try {
    const h = new URL(src).hostname;
    return h === "celebrately.us" || h.endsWith(".celebrately.us") || h.endsWith(".pages.dev");
  } catch { return false; }
}

function cookieDomain(request) {
  // pages.dev previews get a host-only cookie; production shares across subdomains
  const h = new URL(request.url).hostname;
  return h.endsWith(".celebrately.us") || h === "celebrately.us" ? "; Domain=.celebrately.us" : "";
}

function readCookie(request) {
  const jar = request.headers.get("Cookie") || "";
  const m = jar.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

const json = (obj, extra = {}) =>
  new Response(JSON.stringify(obj), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });

export async function onRequest({ request }) {
  if (!ourOrigin(request)) return json({ error: "forbidden" }, { status: 403 });
  const dom = cookieDomain(request);

  if (request.method === "POST") {
    let body = null;
    try { body = await request.json(); } catch { /* fall through */ }
    const rt = body && typeof body.refreshToken === "string" ? body.refreshToken : "";
    // Firebase refresh tokens are opaque base64ish strings; sanity-cap the size.
    if (!rt || rt.length < 20 || rt.length > 4096 || /[;\s]/.test(rt)) return json({ error: "bad token" }, { status: 400 });
    return json({ ok: true }, {
      "Set-Cookie": `${COOKIE}=${encodeURIComponent(rt)}${dom}; Path=/; Max-Age=${MAX_AGE}; Secure; HttpOnly; SameSite=Lax`,
    });
  }
  if (request.method === "GET") {
    const rt = readCookie(request);
    return json(rt ? { refreshToken: rt } : {});
  }
  if (request.method === "DELETE") {
    return json({ ok: true }, {
      "Set-Cookie": `${COOKIE}=${dom}; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`,
    });
  }
  return json({ error: "method" }, { status: 405 });
}
