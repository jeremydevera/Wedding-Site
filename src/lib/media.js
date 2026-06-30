// Resolve a stored media reference to a loadable URL.
//
// New uploads store a BARE R2 key (e.g. "87e2…/owner/image/hero/k3x9a-venue.jpg")
// so the host can change without rewriting data — web + native apps each prepend
// their own base. Anything already absolute (http/data/blob) or a same-origin path
// (legacy "/r2/<key>", "/assets/…") is returned unchanged.
export const MEDIA_BASE = "https://media.celebrately.us";

export function mediaUrl(stored) {
  if (!stored || typeof stored !== "string") return stored || "";
  if (/^(https?:|data:|blob:)/i.test(stored)) return stored; // absolute / inline
  if (stored.startsWith("/")) return stored;                  // same-origin path (legacy /r2/, /assets/)
  return MEDIA_BASE + "/" + stored.replace(/^\/+/, "");        // bare R2 key
}
