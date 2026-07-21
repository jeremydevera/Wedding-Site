import { describe, it, expect } from "vitest";
import { subdomainFromHost } from "@/lib/tenant.js";

describe("subdomainFromHost", () => {
  it("uses ?client override first", () => {
    expect(subdomainFromHost("anything.com", "?client=acme")).toBe("acme");
  });
  it("localhost -> demo", () => {
    expect(subdomainFromHost("localhost", "")).toBe("demo");
  });
  it("project.pages.dev (3 parts) -> demo", () => {
    expect(subdomainFromHost("wedding-site.pages.dev", "")).toBe("demo");
  });
  it("client.project.pages.dev (4 parts) -> client", () => {
    expect(subdomainFromHost("johnandjane.wedding-site.pages.dev", "")).toBe("johnandjane");
  });
  it("custom domain client.celebrately.us -> client", () => {
    expect(subdomainFromHost("janandirish.celebrately.us", "")).toBe("janandirish");
  });
  it("bare platform apex (celebrately.us, 2 parts) -> null (platform hub)", () => {
    expect(subdomainFromHost("celebrately.us", "")).toBe(null);
  });
  it("www.celebrately.us -> null (platform hub, not a bogus 'www' client)", () => {
    expect(subdomainFromHost("www.celebrately.us", "")).toBe(null);
  });
  it("other reserved labels (app/admin/api) -> null (platform hub)", () => {
    expect(subdomainFromHost("app.celebrately.us", "")).toBe(null);
    expect(subdomainFromHost("admin.celebrately.us", "")).toBe(null);
    expect(subdomainFromHost("api.celebrately.us", "")).toBe(null);
  });
  it("a normal (non-reserved) label still resolves to that client", () => {
    expect(subdomainFromHost("janandirish.celebrately.us", "")).toBe("janandirish");
  });
  it("demo.celebrately.us -> 'demo' (reserved-from-registration, but the live showcase client MUST resolve)", () => {
    expect(subdomainFromHost("demo.celebrately.us", "")).toBe("demo");
  });
  // REGRESSION: deriving the hub set from RESERVED_SUBDOMAINS once turned
  // sandbox.celebrately.us into a sign-in page. Reserved-from-REGISTRATION and
  // "platform hub" are different sets — sandbox is the live Neon dev client and
  // MUST resolve as a client site (same for other reserved-but-real labels).
  it("sandbox.celebrately.us -> 'sandbox' (reserved from registration, but a real client site)", () => {
    expect(subdomainFromHost("sandbox.celebrately.us", "")).toBe("sandbox");
    expect(subdomainFromHost("staging.celebrately.us", "")).toBe("staging");
    expect(subdomainFromHost("register.celebrately.us", "")).toBe("register");
  });
});
