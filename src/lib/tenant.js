// Resolve which client a request is for, from the hostname.
// Pure + testable: pass hostname + search string explicitly.

// Hosts that are the PLATFORM HUB, never a client site. This is deliberately
// NOT derived from RESERVED_SUBDOMAINS: reservation means "can't be registered
// by a new client", hub means "doesn't resolve as a client site" — different
// sets. sandbox/staging/test ARE reserved from registration yet MUST resolve
// as client sites (sandbox is the live Neon dev client — deriving this list
// from the union once broke it into a sign-in page). Keep this the frozen
// infra-label set; extend only for labels that truly have no site.
const HUB_LABELS = ["www", "app", "admin", "api", "mail", "static", "assets", "cdn"];

export function subdomainFromHost(hostname, search = "") {
  const override = new URLSearchParams(search).get("client");
  if (override) return override;
  if (hostname === "localhost" || hostname.endsWith(".local") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return "demo";
  }
  const parts = hostname.split(".");
  if (hostname === "pages.dev" || hostname.endsWith(".pages.dev")) {
    // project.pages.dev = 3 parts (no client); client.project.pages.dev = 4
    return parts.length >= 4 ? parts[0] : "demo";
  }
  // custom domain: client.celebrately.us -> first label.
  // bare apex (celebrately.us) -> null = the platform hub (login + manage clients),
  // NOT a client site.
  // Infra labels (HUB_LABELS above) are also the platform hub, never a client:
  // resolving them as a client yields a bogus "site unavailable". Fail closed to
  // the hub (login/console).
  if (parts.length > 2 && !HUB_LABELS.includes(parts[0])) return parts[0];
  return null;
}

export function resolveSubdomain() {
  return subdomainFromHost(window.location.hostname, window.location.search);
}
