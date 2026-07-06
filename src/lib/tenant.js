// Resolve which client a request is for, from the hostname.
// Pure + testable: pass hostname + search string explicitly.
import { RESERVED_SUBDOMAINS } from "@/config/site.js";

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
  // Infra labels (www, app, admin, api, mail, static, assets, cdn) are also the
  // platform hub, never a client: they can't be registered as a subdomain, so
  // resolving them as a client yields a bogus "site unavailable". Fail closed to
  // the hub (login/console). NOTE: "demo" is reserved-from-registration but IS the
  // live seeded demo client (demo.celebrately.us MUST resolve), so it is excluded
  // from the hub set and passes through as a normal client label.
  const HUB_LABELS = RESERVED_SUBDOMAINS.filter((s) => s !== "demo");
  if (parts.length > 2 && !HUB_LABELS.includes(parts[0])) return parts[0];
  return null;
}

export function resolveSubdomain() {
  return subdomainFromHost(window.location.hostname, window.location.search);
}
