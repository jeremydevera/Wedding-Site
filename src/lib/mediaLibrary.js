// src/lib/mediaLibrary.js
// Pure helpers for the media library picker — no React, no network.
// The key format (set by functions/api/upload.js) is:
//   <clientId>/<scope>/<type>/<purpose>/<shortid>-<name>
// where <shortid> is 8 hex chars (crypto.randomUUID) or a Date.now() fallback.

export const MEDIA_TYPES = ["image", "audio"];

// Mirror upload.js's clientId sanitization + the fixed owner scope, so the
// prefix matches exactly what upload wrote.
export function libraryPrefix(clientId, type) {
  const cid = String(clientId || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) || "shared";
  const t = MEDIA_TYPES.includes(type) ? type : "image";
  return `${cid}/owner/${t}/`;
}

// Human filename: last path segment with the "<shortid>-" prefix removed.
export function fileNameFromKey(key) {
  if (!key || typeof key !== "string") return "";
  const seg = key.split("/").pop() || "";
  return seg.replace(/^([0-9a-zA-Z]{8}|[0-9]{9,})-/, "");
}
