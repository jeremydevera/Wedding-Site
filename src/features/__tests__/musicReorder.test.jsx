import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import React from "react";
import { VinylPlayer, setTracks, playIndex } from "@/features/music.jsx";

// jsdom's HTMLMediaElement.play() returns undefined (no real playback); the
// engine calls .catch() on it, so give it a resolved promise. pause() is a noop.
beforeEach(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  // jsdom has no layout engine; the playlist auto-scroll effect calls scrollTo.
  window.HTMLElement.prototype.scrollTo = window.HTMLElement.prototype.scrollTo || (() => {});
});

// Regression for issue #54: after a playlist reorder, the "Now Playing" index is
// re-synced by matching the loaded track. Keying on url alone picks the FIRST url
// match, so when two tracks share a url the wrong row lights up. Identity must be
// keyed on the stable `id`.

const track = (id, title, url) => ({ id, url, title, artist: "" });

describe("music engine — Now Playing re-sync after reorder", () => {
  // The engine is a module singleton — clear it so each test starts at index 0.
  beforeEach(() => { cleanup(); act(() => setTracks([])); });

  it("follows the loaded track by id when two tracks share a url", () => {
    // Two distinct rows, SAME url — only the id disambiguates them.
    const a = track("a", "First Take", "shared.mp3");
    const b = track("b", "Second Take", "shared.mp3");
    const c = track("c", "Other", "other.mp3");

    act(() => setTracks([a, b, c]));
    // Load the SECOND row (index 1). url-based matching would resolve to index 0.
    act(() => playIndex(1));

    const { container, rerender } = render(<VinylPlayer tracks={[a, b, c]} />);
    // Reorder: move the loaded track (b) to the end. The engine re-syncs its
    // index; the component receives the same reordered list (as MusicMount does).
    act(() => setTracks([c, a, b]));
    rerender(<VinylPlayer tracks={[c, a, b]} />);

    const active = container.querySelector(".vinyl-list__item.is-active");
    expect(active).toBeTruthy();
    // The active row must be the one carrying id "b", now at position 3.
    expect(active.querySelector(".vinyl-list__title").textContent).toBe("Second Take");
    expect(container.querySelector(".vinyl-title").textContent).toBe("Second Take");
  });

  it("falls back to url matching when tracks have no id", () => {
    const a = { url: "one.mp3", title: "One", artist: "" };
    const b = { url: "two.mp3", title: "Two", artist: "" };

    act(() => setTracks([a, b]));
    act(() => playIndex(1)); // load "two.mp3"

    const { container, rerender } = render(<VinylPlayer tracks={[a, b]} />);
    act(() => setTracks([b, a])); // reorder; "two.mp3" now at index 0
    rerender(<VinylPlayer tracks={[b, a]} />);

    expect(container.querySelector(".vinyl-title").textContent).toBe("Two");
  });
});
