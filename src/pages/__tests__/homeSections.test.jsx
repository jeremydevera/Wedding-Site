import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { Store } from "@/lib/store.jsx";
import { Home } from "@/pages/PublicPages.jsx";

beforeEach(() => {
  cleanup();
  // jsdom lacks IntersectionObserver, which Home's reveal/rsvp effects use.
  global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
});

function setup(extra) {
  Store.set({
    loading: false,
    playlist: [{ id: "t1", url: "song.mp3", title: "Song", artist: "A" }],
    settings: { ...Store.get().settings, theme: "classic", mapQuery: "Lipa, Batangas", ...extra },
  });
}

describe("Home section visibility toggles", () => {
  it("shows music, entourage, attire, and map by default", () => {
    setup({});
    const { container } = render(<Home />);
    expect(container.querySelector("#home-map")).toBeTruthy();
    expect(container.querySelector(".vinyl-card")).toBeTruthy();
    expect(container.querySelector("#home-entourage")).toBeTruthy();
    expect(container.querySelector("#home-attire")).toBeTruthy();
    // seed attire groups carry a description -> it renders
    expect(container.querySelector("#home-attire .attire-card__desc")).toBeTruthy();
  });

  it("hides each section when its flag is false", () => {
    setup({ showMusic: false, showEntourage: false, showMap: false, showAttire: false });
    const { container } = render(<Home />);
    expect(container.querySelector("#home-map")).toBeNull();
    expect(container.querySelector(".vinyl-card")).toBeNull();
    expect(container.querySelector("#home-entourage")).toBeNull();
    expect(container.querySelector("#home-attire")).toBeNull();
  });

  // Regression (bug: home maps filter was a no-op — mapEmbedUrl is always
  // truthy). A picked venue with a name but no address/mapQuery/coords has no
  // resolvable target, so the whole #home-map section must be hidden rather than
  // render a blank Google Maps embed.
  it("hides #home-map when the only venue has no geocodable target", () => {
    Store.set({
      loading: false,
      venues: [{ id: "v1", name: "Reception", mapQuery: "", address: "", mapLat: undefined, mapLng: undefined, cards: [] }],
      // showMap:true / clear the legacy flat map so nothing but the venue's
      // (empty) target can drive the section; showMap explicit so a prior test's
      // showMap:false can't mask the assertion.
      settings: { ...Store.get().settings, theme: "classic", showMap: true, mapQuery: "", venueAddress: "", homeVenueIds: ["v1"] },
    });
    const { container } = render(<Home />);
    expect(container.querySelector("#home-map")).toBeNull();
  });

  // Regression (bug: story/schedule/faq mapped without an Array.isArray guard).
  // A non-array truthy schedule from a bad import/manual DB edit must not crash
  // the public home (schedule.slice/.length used to throw and white-screen it).
  it("does not crash when schedule is a non-array truthy value", () => {
    Store.set({
      loading: false,
      schedule: {},
      settings: { ...Store.get().settings, theme: "classic", mapQuery: "Lipa, Batangas" },
    });
    expect(() => render(<Home />)).not.toThrow();
  });
});
