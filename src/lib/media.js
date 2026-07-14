// Resolve a stored media reference to a loadable URL.
//
// New uploads store a BARE R2 key (e.g. "87e2…/owner/image/hero/k3x9a-venue.jpg")
// so the host can change without rewriting data. On the web we serve bare keys
// DIRECT from R2 via media.celebrately.us (R2 custom domain on the bucket). The
// zone's *.celebrately.us wildcard used to shadow that subdomain via the router
// Worker, so a dedicated media host "couldn't be used" — that's fixed by a
// more-specific Workers route "media.celebrately.us/*" → Worker=None, which
// bypasses the router. Result: photos/audio/video are served off the router
// entirely (0 Worker invocations) instead of through the counted "/r2/" Function.
//
// Legacy values — absolute http/data/blob, or a same-origin path ("/r2/…",
// "/assets/…") — are returned unchanged. The "/r2/" Pages Function stays as a
// same-origin fallback for those legacy paths.
export const MEDIA_BASE = "https://media.celebrately.us/";

export function mediaUrl(stored) {
  if (!stored || typeof stored !== "string") return stored || "";
  if (/^(https?:|data:|blob:)/i.test(stored)) return stored; // absolute / inline
  if (stored.startsWith("/")) return stored;                  // same-origin path (legacy /r2/, /assets/)
  return MEDIA_BASE + stored.replace(/^\/+/, "");             // bare R2 key -> direct R2 host
}

// CSS style for a stored non-destructive video crop — pan/zoom params saved by
// the crop modal ({ z, dx, dy } as fractions of the clipping box) applied to a
// cover-fitted <video> inside an overflow:hidden box. Returns undefined when
// there's nothing to apply, so spreading into style={} is always safe.
export function cropTransform(crop) {
  if (!crop || typeof crop !== "object") return undefined;
  const z = +crop.z || 1, dx = +crop.dx || 0, dy = +crop.dy || 0;
  if (z === 1 && !dx && !dy) return undefined;
  return { transform: `translate(${(dx * 100).toFixed(3)}%, ${(dy * 100).toFixed(3)}%) scale(${z})`, transformOrigin: "50% 50%" };
}

// Faithful renderer for crop-modal params. The modal pans the MEDIA (at its
// cover size) inside a fixed box, but translate-on-a-cover-fitted element
// crops the media's overflow away first — so a legit pan of a wide video in a
// portrait box (slack the modal allows even at z=1) renders as an empty strip
// instead of a pan. This maps {z,dx,dy} + the media/box aspects to an
// absolutely positioned element at the media's true cover size, clamped so
// the box is always covered (stale params saved against a differently-shaped
// box can't expose an edge). For a <video>/<img> inside an overflow:hidden
// position:absolute box.
export function cropBoxStyle(crop, mediaAspect, boxAspect) {
  if (!mediaAspect || !boxAspect) return undefined;
  const z = Math.max(1, +(crop && crop.z) || 1);
  const r = mediaAspect / boxAspect;
  const w = Math.max(1, r) * z, h = Math.max(1, 1 / r) * z;
  let left = (+(crop && crop.dx) || 0) + (1 - w) / 2;
  let top = (+(crop && crop.dy) || 0) + (1 - h) / 2;
  left = Math.min(0, Math.max(1 - w, left));
  top = Math.min(0, Math.max(1 - h, top));
  return {
    position: "absolute",
    left: (left * 100).toFixed(3) + "%",
    top: (top * 100).toFixed(3) + "%",
    width: (w * 100).toFixed(3) + "%",
    height: (h * 100).toFixed(3) + "%",
    maxWidth: "none",
    objectFit: "fill", // element already has the media's own aspect
  };
}
