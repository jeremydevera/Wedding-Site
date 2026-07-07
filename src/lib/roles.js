// Owner-hidden tabs — only the superadmin (who builds the site) manages these.
// Owners only get the guest-response tabs (Dashboard, RSVPs, Guestbook, Quiz).
// Site-content tabs — Settings (home/theme), Schedule, Details, Venue & Map — plus
// Media + Clients are superadmin-only. (Superadmin-on-a-client uses a different
// code path in AdminApp and still sees all of these.)
// Entourage + Music are no longer tabs — they're folder sub-tabs inside Home,
// gated to superadmin there (see HomeAdmin).
// Home is superadmin-only too (the superadmin builds the home page); owners
// don't get it. Superadmin-on-a-client uses a different path and still sees it.
const SUPERADMIN_ONLY = new Set(["settings", "media", "schedule", "details", "venue", "home"]);

export function visibleAdminTabs(role, allTabs, ownerEdit) {
  if (role === "superadmin") {
    // Superadmin: a platform overview + client management + R2 media library.
    return [
      { key: "overview", label: "Overview", icon: "grid" },
      { key: "clients", label: "Clients", icon: "user" },
      { key: "r2media", label: "Media", icon: "camera" },
    ];
  }
  if (role === "owner") {
    // Per-client grants (settings.ownerEdit, flipped by the superadmin in
    // Settings → Access) open individual content tabs to the owner. Any Home
    // sub-folder grant (couple&event/invitation via "home", plus the standalone
    // maps/timeline/attire/music/entourage folders) exposes the Home tab — the
    // grant then decides which folders show inside it (HomeAdmin gates each).
    const g = ownerEdit || {};
    const homeGranted = HOME_EDIT_KEYS.some((k) => g[k] === true);
    const granted = new Set([
      ...(homeGranted ? ["home"] : []),
      ...(g.schedule === true ? ["schedule"] : []),
      ...(g.venue === true ? ["venue"] : []),
      ...(g.details === true ? ["details"] : []),
    ]);
    return allTabs.filter((t) => (!SUPERADMIN_ONLY.has(t.key) || granted.has(t.key)) && t.key !== "clients");
  }
  return [];
}

// Grant keys for the folders that live inside the Home tab — any one exposes
// the Home tab to the owner (see visibleAdminTabs + HomeAdmin). Keep in sync
// with the "Owner editing" toggles in Settings → Access.
export const HOME_EDIT_KEYS = ["home", "maps", "timeline", "attire", "music", "entourage"];

export function canEnterAdmin(profile, currentClientId) {
  if (!profile) return false;
  if (profile.role === "superadmin") return true;
  if (profile.role === "owner") return !!currentClientId && profile.clientId === currentClientId;
  return false;
}

// Platform-wide kill switch: modules disabled for EVERYONE, regardless of
// per-client flags or event-type sections. "Off for now" features live here —
// empty the set to bring one back. Hides the nav link + blocks the route.
export const DISABLED_MODULES = new Set(["gallery", "upload", "video-message"]);

// Client-facing labels for module keys — how each section reads to a guest
// (matches the public nav / RSVP CTA wording). Used by the admin module toggles
// so the operator sees what the guest sees, not the raw key.
export const MODULE_LABELS = {
  story: "Our Story",
  details: "Details",
  schedule: "Schedule",
  venue: "Venue",
  gallery: "Gallery",
  guestbook: "Guestbook",
  quiz: "Quiz",
  rsvp: "RSVP",
};
export function moduleLabel(key) {
  return MODULE_LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : key);
}

// Per-client module flags. modules = { guestbook:false, quiz:true, ... }; absent key = on.
export function moduleEnabled(modules, key) {
  if (DISABLED_MODULES.has(key)) return false;   // global "off for now"
  if (!modules || !(key in modules)) return true;
  return !!modules[key];
}

// Admin tabs that correspond to a toggleable module (others — dashboard/qr — always show).
const TAB_MODULE = { rsvps: "rsvp", guestbook: "guestbook", quiz: "quiz", schedule: "schedule", details: "details" };

// Filter already-role-gated tabs by the client's module flags (owners only; superadmin keeps all).
export function tabsForClient(tabs, role, modules) {
  if (role === "superadmin") return tabs;
  return tabs.filter((t) => !TAB_MODULE[t.key] || moduleEnabled(modules, TAB_MODULE[t.key]));
}
