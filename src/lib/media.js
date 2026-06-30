// Resolve a stored media reference to a loadable URL.
//
// New uploads store a BARE R2 key (e.g. "87e2…/owner/image/hero/k3x9a-venue.jpg")
// so the host can change without rewriting data. On the web we serve through the
// same-origin "/r2/<key>" Pages Function (CDN-cached, immutable) — a dedicated
// media.celebrately.us subdomain can't be used because the zone's *.celebrately.us
// wildcard (multi-tenant couple subdomains) shadows any R2 custom subdomain.
// Native apps prepend their own absolute base to the bare key (e.g.
// "https://<host>/r2/" + key).
//
// Legacy values — absolute http/data/blob, or a same-origin path ("/r2/…",
// "/assets/…") — are returned unchanged.
export const MEDIA_PROXY = "/r2/";

export function mediaUrl(stored) {
  if (!stored || typeof stored !== "string") return stored || "";
  if (/^(https?:|data:|blob:)/i.test(stored)) return stored; // absolute / inline
  if (stored.startsWith("/")) return stored;                  // same-origin path (legacy /r2/, /assets/)
  return MEDIA_PROXY + stored.replace(/^\/+/, "");            // bare R2 key -> same-origin proxy
}
