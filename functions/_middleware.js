// Canonical-domain redirect (Pages Function, runs on every request).
//
// Goal: anyone who lands on the bare project URL (wedding-site-8nh.pages.dev) —
// usually via a link or QR code built from window.location.origin while the
// admin tab was on pages.dev — is bounced to the pretty custom domain, so guests
// never see the pages.dev address. Path + query are preserved.
//
// IMPORTANT — loop safety: an earlier version matched on new URL(request.url),
// which on Cloudflare Pages reports the *.pages.dev host even for custom-domain
// requests, so demo.celebrately.us redirected to itself forever. This version:
//   1) decides using the real client Host header, not request.url, and
//   2) has a hard guard that NEVER redirects anything already on celebrately.us.
// Either alone prevents the loop; together they make it impossible.
const PROJECT_HOST = "wedding-site-8nh.pages.dev";
const CANONICAL_HOST = "demo.celebrately.us";

export const onRequest = async (context) => {
  const host = (context.request.headers.get("host") || "").toLowerCase();

  // Hard loop guard: the real custom domain (and any subdomain of it) is never
  // touched — it must serve normally no matter what.
  if (host.endsWith("celebrately.us")) return context.next();

  // Only the exact bare project host is redirected. Preview/branch deploys
  // (hash.wedding-site-8nh.pages.dev) don't match, so they keep working.
  if (host === PROJECT_HOST) {
    const url = new URL(context.request.url);
    url.protocol = "https:";
    url.port = "";
    url.hostname = CANONICAL_HOST;
    return Response.redirect(url.toString(), 302);
  }

  return context.next();
};
