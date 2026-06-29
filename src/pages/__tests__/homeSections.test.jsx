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
  });

  it("hides each section when its flag is false", () => {
    setup({ showMusic: false, showEntourage: false, showMap: false, showAttire: false });
    const { container } = render(<Home />);
    expect(container.querySelector("#home-map")).toBeNull();
    expect(container.querySelector(".vinyl-card")).toBeNull();
    expect(container.querySelector("#home-entourage")).toBeNull();
    expect(container.querySelector("#home-attire")).toBeNull();
  });
});
