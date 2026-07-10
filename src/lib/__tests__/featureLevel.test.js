import { describe, it, expect } from "vitest";
import { featureLevel as fl, featureVisible, FEATURE_DEFAULTS, FEATURE_ROWS } from "@/lib/roles.js";

describe("featureLevel — accessV2 model", () => {
  const s = (features, extra = {}) => ({ accessV2: true, features, ...extra });

  it("reads explicit levels from the features map", () => {
    expect(fl(s({ story: "view" }), "story")).toBe("view");
    expect(fl(s({ music: "edit" }), "music")).toBe("edit");
    expect(fl(s({ quiz: "none" }), "quiz")).toBe("none");
  });

  it("falls back to the new-client defaults for absent keys", () => {
    expect(fl(s({}), "story")).toBe("none");
    expect(fl(s({}), "music")).toBe("none");
    expect(fl(s({}), "details")).toBe("edit");
    expect(fl(s({}), "home")).toBe("edit");
    expect(fl(s(null), "guestbook")).toBe("edit"); // no map at all
  });

  it("clamps home to at least view (landing page always renders)", () => {
    expect(fl(s({ home: "none" }), "home")).toBe("view");
  });

  it("rsvp is always edit; kill-switched modules are always none", () => {
    expect(fl(s({}), "rsvp")).toBe("edit");
    expect(fl({ accessV2: false }, "rsvp")).toBe("edit");
    expect(fl(s({ gallery: "edit" }), "gallery")).toBe("none");
  });

  it("ignores junk values in the map (falls back to default)", () => {
    expect(fl(s({ details: "banana" }), "details")).toBe("edit");
  });

  it("FEATURE_ROWS covers exactly the FEATURE_DEFAULTS keys", () => {
    expect(FEATURE_ROWS.map((r) => r.k).sort()).toEqual(Object.keys(FEATURE_DEFAULTS).sort());
  });
});

describe("featureLevel — legacy derivation (no flag) matches today", () => {
  it("module off -> none", () => {
    expect(fl({ modules: { story: false } }, "story")).toBe("none");
  });
  it("module on + grant on -> edit; grant off -> view", () => {
    expect(fl({ modules: { venue: true }, ownerEdit: { venue: true } }, "venue")).toBe("edit");
    expect(fl({ modules: { venue: true }, ownerEdit: {} }, "venue")).toBe("view");
  });
  it("grantless modules (guestbook/quiz) on -> edit (owners get those tabs today)", () => {
    expect(fl({ modules: { guestbook: true } }, "guestbook")).toBe("edit");
    expect(fl({ modules: {} }, "quiz")).toBe("edit"); // absent module key = on
  });
  it("non-module home folders follow their ownerEdit grant", () => {
    expect(fl({ ownerEdit: { music: true } }, "music")).toBe("edit");
    expect(fl({ ownerEdit: {} }, "music")).toBe("view");
    expect(fl({ ownerEdit: { entourage: true } }, "entourage")).toBe("edit");
  });
  it("featureVisible is level !== none", () => {
    expect(featureVisible({ modules: { story: false } }, "story")).toBe(false);
    expect(featureVisible({ modules: {} }, "details")).toBe(true);
  });
  it("handles null/undefined settings without throwing", () => {
    // absent modules = on; details has a grant key and no grant map -> view
    expect(fl(null, "details")).toBe("view");
  });
});
