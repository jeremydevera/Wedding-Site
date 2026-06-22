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
  it("custom domain client.celebrate.app -> client", () => {
    expect(subdomainFromHost("johnandjane.celebrate.app", "")).toBe("johnandjane");
  });
});
