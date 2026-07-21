// ============================================================================
// Platform configuration — deployment-wide settings.
//
// PLATFORM_DOMAIN
//   The root domain your client sites are served under. Each client gets
//   `<their-subdomain>.<PLATFORM_DOMAIN>`  e.g.  janandirish.celebrately.us
//   Used for the URLs shown in the superadmin (clients list + "Add client" hint).
//
//   To change the platform domain:
//     1. Preferred — set VITE_PLATFORM_DOMAIN in your Cloudflare Pages env vars
//        (Production + Preview), then redeploy. No code change needed.
//        Or just edit the fallback string below and push.
//     2. In Cloudflare for the NEW domain: add it as a zone, then add a wildcard
//        DNS record + a Worker route so `*.<domain>` serves the app
//        (same setup we did for celebrately.us).
//
//   NOTE: subdomain resolution (src/lib/tenant.js) is domain-agnostic — it reads
//   whatever hostname the browser is on — so it needs NO change when the domain
//   changes. This constant is purely for display.
// ============================================================================
export const PLATFORM_DOMAIN = import.meta.env.VITE_PLATFORM_DOMAIN || "celebrately.us";

// BRAND_NAME — shown in the superadmin lockup. Change here (or VITE_BRAND_NAME) to rebrand.
export const BRAND_NAME = import.meta.env.VITE_BRAND_NAME || "Celebrately";

// Build the public URL for a client site. Single place to change protocol/shape.
export const clientUrl = (subdomain) => `https://${subdomain}.${PLATFORM_DOMAIN}`;

// Subdomains that can't be handed to a client — they collide with the apex,
// the demo fallback, or common infra hostnames.
// CANONICAL list (the union) — ALL three enforcement points mirror THIS:
//   1. this frontend check (isValidSubdomain)
//   2. Supabase edge fn site-request RESERVED set (manual mirror)
//   3. Neon reserved_subdomains TABLE (seeded via /api/neon-admin harden_minors)
// When adding a name here, update 2 and re-run 3 — do not let them drift again.
export const RESERVED_SUBDOMAINS = [
  "www", "app", "admin", "api", "demo", "mail", "media", "static", "assets", "cdn",
  "help", "support", "blog", "docs", "status", "celebrately", "staging", "test",
  "sandbox", "register", "apply",
];

// A subdomain must be a valid DNS label AND not reserved:
//   lowercase letters/digits/hyphens, 1-63 chars, no leading/trailing hyphen.
// Use before creating a client so we never provision a broken/colliding site.
export function isValidSubdomain(s) {
  const v = (s || "").trim().toLowerCase();
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(v) && !RESERVED_SUBDOMAINS.includes(v);
}
