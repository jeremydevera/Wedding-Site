// Settings, Media + Clients are owner-hidden (clients also filtered below).
const SUPERADMIN_ONLY = new Set(["settings", "media"]);

export function visibleAdminTabs(role, allTabs) {
  if (role === "superadmin") {
    // Superadmin: a platform overview + client management (no per-event tabs).
    return [
      { key: "overview", label: "Overview", icon: "grid" },
      { key: "clients", label: "Clients", icon: "user" },
    ];
  }
  if (role === "owner") {
    return allTabs.filter((t) => !SUPERADMIN_ONLY.has(t.key) && t.key !== "clients");
  }
  return [];
}

export function canEnterAdmin(profile, currentClientId) {
  if (!profile) return false;
  if (profile.role === "superadmin") return true;
  if (profile.role === "owner") return !!currentClientId && profile.clientId === currentClientId;
  return false;
}

// Platform-wide kill switch: modules disabled for EVERYONE, regardless of
// per-client flags or event-type sections. "Off for now" features live here —
// empty the set to bring one back. Hides the nav link + blocks the route.
export const DISABLED_MODULES = new Set(["gallery"]);

// Per-client module flags. modules = { guestbook:false, quiz:true, ... }; absent key = on.
export function moduleEnabled(modules, key) {
  if (DISABLED_MODULES.has(key)) return false;   // global "off for now"
  if (!modules || !(key in modules)) return true;
  return !!modules[key];
}

// Admin tabs that correspond to a toggleable module (others — dashboard/qr — always show).
const TAB_MODULE = { rsvps: "rsvp", guestbook: "guestbook", quiz: "quiz", schedule: "schedule" };

// Filter already-role-gated tabs by the client's module flags (owners only; superadmin keeps all).
export function tabsForClient(tabs, role, modules) {
  if (role === "superadmin") return tabs;
  return tabs.filter((t) => !TAB_MODULE[t.key] || moduleEnabled(modules, TAB_MODULE[t.key]));
}
