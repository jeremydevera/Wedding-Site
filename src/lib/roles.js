// Settings, Media + Clients are superadmin-only (clients also filtered below).
const SUPERADMIN_ONLY = new Set(["settings", "media"]);

export function visibleAdminTabs(role, allTabs) {
  if (role === "superadmin") {
    const hasClients = allTabs.some((t) => t.key === "clients");
    return hasClients ? allTabs : [...allTabs, { key: "clients", label: "Clients", icon: "grid" }];
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
