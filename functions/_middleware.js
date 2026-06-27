// Canonical-domain redirect (runs on every request via Pages Functions).
//
// The app builds shareable links (QR codes, "view website", etc.) from
// window.location.origin, so anything generated while viewing the bare project
// URL points at wedding-site-8nh.pages.dev. This bounces that exact production
// host to the pretty custom domain, so guests never see the pages.dev address.
//
// Path + query are preserved. Only the exact production host matches — preview
// and branch deploys (hash.wedding-site-8nh.pages.dev) and the real custom
// domains (*.celebrately.us) fall through to the normal asset/SPA pipeline.
const PROJECT_HOST = "wedding-site-8nh.pages.dev";
const CANONICAL_HOST = "demo.celebrately.us";

export const onRequest = async (context) => {
  const url = new URL(context.request.url);
  if (url.hostname === PROJECT_HOST) {
    url.hostname = CANONICAL_HOST;
    url.protocol = "https:";
    url.port = "";
    return Response.redirect(url.toString(), 302);
  }
  return context.next();
};
