import { describe, it, expect } from "vitest";
import { clientUrl, isValidSubdomain, PLATFORM_DOMAIN } from "@/config/site.js";

describe("isValidSubdomain", () => {
  it("accepts normal subdomains", () => {
    expect(isValidSubdomain("janandirish")).toBe(true);
    expect(isValidSubdomain("jan-and-irish")).toBe(true);
    expect(isValidSubdomain("rosa2026")).toBe(true);
  });
  it("rejects reserved names", () => {
    for (const r of ["www", "app", "admin", "api", "demo"]) expect(isValidSubdomain(r)).toBe(false);
  });
  it("rejects invalid DNS labels", () => {
    expect(isValidSubdomain("")).toBe(false);
    expect(isValidSubdomain("Jan Irish")).toBe(false); // space + uppercase
    expect(isValidSubdomain("-lead")).toBe(false);     // leading hyphen
    expect(isValidSubdomain("trail-")).toBe(false);    // trailing hyphen
    expect(isValidSubdomain("under_score")).toBe(false);
    expect(isValidSubdomain("a".repeat(64))).toBe(false); // > 63 chars
  });
});

describe("clientUrl", () => {
  it("builds https url under the platform domain", () => {
    expect(clientUrl("janandirish")).toBe(`https://janandirish.${PLATFORM_DOMAIN}`);
  });
});
