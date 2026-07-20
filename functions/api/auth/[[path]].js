// First-party proxy for Neon Auth (Better Auth). Safari/WebKit blocks the
// third-party session cookie the neonauth domain sets (ITP), which broke
// /register sign-in on Safari — verified via Playwright WebKit. Routing auth
// through OUR domain makes the session cookie first-party on every browser.
//
//   browser → celebrately.us/api/auth/<path>  →  <shard neonauth>/neondb/auth/<path>
//
// The client sends its shard's auth base in `x-neon-auth-base` (validated
// against a strict Neon-host pattern — this must never become an open proxy).
// Set-Cookie headers are rewritten to drop Domain (defaults to our host) and
// relax SameSite=None→Lax (first-party now). The `set-auth-jwt` header (the
// Data API token) is passed through so the client can keep calling the Data
// API directly.

const DEFAULT_AUTH_BASE = "https://ep-long-credit-aztdmow3.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth";
const AUTH_BASE_RE = /^https:\/\/[a-z0-9-]+\.neonauth\.c-\d+\.[a-z0-9-]+\.aws\.neon\.tech\/neondb\/auth$/;

export async function onRequest({ request, params }) {
  const base = request.headers.get("x-neon-auth-base") || DEFAULT_AUTH_BASE;
  if (!AUTH_BASE_RE.test(base)) return new Response(JSON.stringify({ error: "bad auth base" }), { status: 400, headers: { "content-type": "application/json" } });

  const path = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const url = new URL(request.url);
  const target = `${base}/${path}${url.search}`;

  const headers = new Headers();
  for (const h of ["content-type", "cookie", "authorization", "accept"]) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Better Auth CSRF-checks the Origin — forward the caller's real origin
  // (celebrately.us / www / sandbox are all in Neon Auth's trusted origins).
  const origin = request.headers.get("origin") || url.origin;
  headers.set("origin", origin);

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: (request.method === "GET" || request.method === "HEAD") ? undefined : await request.arrayBuffer(),
    redirect: "manual",
  });

  const out = new Headers();
  out.set("x-authproxy", "v2-domain-share"); // deploy marker (verify Set-Cookie Domain rollout)
  for (const h of ["content-type", "set-auth-jwt"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  // Expose set-auth-jwt to the browser fetch() caller (same-origin, but be explicit).
  if (upstream.headers.get("set-auth-jwt")) out.set("access-control-expose-headers", "set-auth-jwt");
  // Rewrite cookies to first-party: SameSite=None→Lax, drop Partitioned
  // (meaningless first-party). Keep HttpOnly/Secure/Max-Age/Path.
  // Domain: set Domain=.celebrately.us so the SAME session works across the
  // apex (where she registers) and her own subdomain (where her admin lives) —
  // she signs up once and arrives at <sub>/admin already signed in.
  // ⚠️ url.hostname is USELESS here: Pages Functions see the *.pages.dev host
  // even for custom-domain requests (CLAUDE.md), so detect from the browser's
  // Origin/Referer instead. When neither is present we still append — a
  // Domain that doesn't match the browser's real host makes the browser REJECT
  // the cookie (harmless: only direct *.pages.dev visits, which we don't use).
  // Localhost dev (wrangler) keeps a host-only cookie.
  const src = request.headers.get("origin") || request.headers.get("referer") || "";
  const shareRoot = /localhost|127\.0\.0\.1/.test(src) ? null : "celebrately.us";
  const setCookies = typeof upstream.headers.getSetCookie === "function"
    ? upstream.headers.getSetCookie()
    : (upstream.headers.get("set-cookie") ? [upstream.headers.get("set-cookie")] : []);
  for (const c of setCookies) {
    const rewritten = c
      .replace(/;\s*Domain=[^;]*/gi, "")
      .replace(/;\s*SameSite=None/gi, "; SameSite=Lax")
      .replace(/;\s*Partitioned/gi, "")
      + (shareRoot ? `; Domain=.${shareRoot}` : "");
    out.append("set-cookie", rewritten);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
