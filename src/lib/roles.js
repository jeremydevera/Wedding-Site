// Settings, Media + Clients are owner-hidden (clients also filtered below).
const SUPERADMIN_ONLY = new Set(["settings", "media"]);
// Superadmin manages clients/users — not a single event's day-to-day operations,
// so these per-event tabs are hidden from the superadmin view.
const SUPERADMIN_HIDDEN = new Set(["rsvps", "media", "guestbook", "schedule"]);

export function visibleAdminTabs(role, allTabs) {
  if (role === "superadmin") {
    const kept = allTabs.filter((t) => !SUPERADMIN_HIDDEN.has(t.key));
    const hasClients = kept.some((t) => t.key === "clients");
    return hasClients ? kept : [...kept, { key: "clients", label: "Clients", icon: "grid" }];
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

// Per-client module flags. modules = { guestbook:false, quiz:true, ... }; absent key = on.
export function moduleEnabled(modules, key) {
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
