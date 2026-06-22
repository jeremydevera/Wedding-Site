// Resolve which client a request is for, from the hostname.
// Pure + testable: pass hostname + search string explicitly.
export function subdomainFromHost(hostname, search = "") {
  const override = new URLSearchParams(search).get("client");
  if (override) return override;
  if (hostname === "localhost" || hostname.endsWith(".local") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return "demo";
  }
  const parts = hostname.split(".");
  if (hostname.endsWith("pages.dev")) {
    // project.pages.dev = 3 parts (no client); client.project.pages.dev = 4
    return parts.length >= 4 ? parts[0] : "demo";
  }
  // custom domain: client.celebrate.app -> first label; bare apex -> demo
  return parts.length > 2 ? parts[0] : "demo";
}

export function resolveSubdomain() {
  return subdomainFromHost(window.location.hostname, window.location.search);
}
