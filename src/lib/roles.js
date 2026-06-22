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
