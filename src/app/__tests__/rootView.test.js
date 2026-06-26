import { describe, it, expect } from "vitest";
import { rootView } from "@/app/App.jsx";

describe("rootView", () => {
  it("loading wins over everything", () => {
    expect(rootView({ loading: true, notFound: true, subdomain: "x", route: "home" })).toBe("loading");
  });

  // The bug: a deleted/nonexistent subdomain must NOT fall through to the public
  // site (seed content). notFound takes precedence.
  it("notFound subdomain -> notfound (not public)", () => {
    expect(rootView({ loading: false, notFound: true, subdomain: "deleted-couple", route: "home" })).toBe("notfound");
  });
  it("notFound also blocks the admin route", () => {
    expect(rootView({ loading: false, notFound: true, subdomain: "deleted-couple", route: "admin" })).toBe("notfound");
  });

  it("apex (subdomain null) -> admin hub", () => {
    expect(rootView({ loading: false, notFound: false, subdomain: null, route: "home" })).toBe("admin");
  });
  it("admin route on a real client -> admin", () => {
    expect(rootView({ loading: false, notFound: false, subdomain: "janandirish", route: "admin" })).toBe("admin");
  });
  it("real client, public route -> public", () => {
    expect(rootView({ loading: false, notFound: false, subdomain: "janandirish", route: "home" })).toBe("public");
  });
});
