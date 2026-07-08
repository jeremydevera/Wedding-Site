// Owner-hidden tabs — only the superadmin (who builds the site) manages these.
// Owners only get the guest-response tabs (Dashboard, RSVPs, Guestbook, Quiz).
// Site-content tabs — Settings (home/theme), Schedule, Details, Venue & Map — plus
// Media + Clients are superadmin-only. (Superadmin-on-a-client uses a different
// code path in AdminApp and still sees all of these.)
// Entourage + Music are no longer tabs — they're folder sub-tabs inside Home,
// gated to superadmin there (see HomeAdmin).
// Home is superadmin-only too (the superadmin builds the home page); owners
// don't get it. Superadmin-on-a-client uses a different path and still sees it.
const SUPERADMIN_ONLY = new Set(["settings", "media", "schedule", "details", "venue", "home", "story"]);

export function visibleAdminTabs(role, allTabs, ownerEdit) {
  if (role === "superadmin") {
    // Superadmin: platform overview + client management + R2 media library + CF health.
    return [
      { key: "overview", label: "Overview", icon: "grid" },
      { key: "clients", label: "Clients", icon: "user" },
      { key: "r2media", label: "Media", icon: "camera" },
      { key: "support", label: "Support", icon: "mail" },
      { key: "health", label: "Health", icon: "eye" },
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
      // Standalone tab grants, straight from the one list — add to OWNER_EDIT_TABS
      // and it's exposed here automatically (each key matches an ADMIN_TABS key).
      ...OWNER_EDIT_TABS.filter((t) => g[t.k] === true).map((t) => t.k),
    ]);
    return allTabs.filter((t) => (!SUPERADMIN_ONLY.has(t.key) || granted.has(t.key)) && t.key !== "clients");
  }
  return [];
}

// ── Owner-edit grants — ONE source of truth ────────────────────────────────
// Both grant editors (the client's Settings → Access panel AND the superadmin
// Edit-client / Edit-request modals' AccessFields) render from these lists, and
// visibleAdminTabs decides tab visibility from them. Add a grant HERE and it
// shows in every editor and gates the right tab automatically.
//
// OWNER_EDIT_HOME = folders that live INSIDE the Home tab (any one exposes Home).
// OWNER_EDIT_TABS = standalone top-level tabs; each key MUST match an ADMIN_TABS key.
export const OWNER_EDIT_HOME = [
  { k: "home", label: "Couple & Event + Invitation", desc: "Couple & event details and the invitation section." },
  { k: "maps", label: "Google Maps", desc: "The home-page map and its pin." },
  { k: "timeline", label: "Timeline", desc: "The home-page schedule-glimpse layout." },
  { k: "homeDetails", label: "Details (home section)", desc: "The home-page details cards — visibility + vertical/horizontal layout." },
  { k: "attire", label: "Attire", desc: "The dress-code guide." },
  { k: "music", label: "Music playlist", desc: "The home-page player and its tracks." },
  { k: "entourage", label: "Entourage", desc: "Wedding-party groups and names." },
];
export const OWNER_EDIT_TABS = [
  { k: "schedule", label: "Schedule", desc: "The Schedule tab (wedding-day timeline guests see)." },
  { k: "venue", label: "Venue & Map", desc: "The Venue & Map tab (venue cards, map, directions)." },
  { k: "details", label: "Details", desc: "The Details tab (info cards + FAQ guests see)." },
  { k: "story", label: "Our Story", desc: "The Our Story tab (milestones — title, description, photo)." },
];
// Any Home-folder grant exposes the Home tab (derived, never hand-maintained).
export const HOME_EDIT_KEYS = OWNER_EDIT_HOME.map((g) => g.k);

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

// Guest-facing label for a section, honoring the owner's rename (Settings →
// Features → Rename tabs). Used by BOTH the nav links and each page's heading
// eyebrow so a rename shows everywhere, not just in the menu. `dflt` lets a
// page keep its richer default ("Venue & Map") when no rename exists.
export function sectionLabel(key, labels, dflt) {
  const custom = labels && typeof labels[key] === "string" ? labels[key].trim() : "";
  return custom || dflt || moduleLabel(key);
}

// Per-client module flags. modules = { guestbook:false, quiz:true, ... }; absent key = on.
export function moduleEnabled(modules, key) {
  if (DISABLED_MODULES.has(key)) return false;   // global "off for now"
  if (!modules || !(key in modules)) return true;
  return !!modules[key];
}

// Admin tabs that correspond to a toggleable module (others — dashboard/qr — always show).
const TAB_MODULE = { rsvps: "rsvp", guestbook: "guestbook", quiz: "quiz", schedule: "schedule", details: "details", story: "story" };

// Filter already-role-gated tabs by the client's module flags (owners only; superadmin keeps all).
export function tabsForClient(tabs, role, modules) {
  if (role === "superadmin") return tabs;
  return tabs.filter((t) => !TAB_MODULE[t.key] || moduleEnabled(modules, TAB_MODULE[t.key]));
}
