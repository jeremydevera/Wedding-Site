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
