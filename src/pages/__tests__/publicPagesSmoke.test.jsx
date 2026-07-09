import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { Store } from "@/lib/store.jsx";
import { StoryPage, DetailsPage, SchedulePage, VenuePage } from "@/pages/PublicPages.jsx";
import { RSVPPage } from "@/features/rsvp.jsx";
import { GuestbookPage, QuizPage } from "@/features/social.jsx";

// Smoke-render every public content page. This exists because a heading edit
// once referenced an undefined variable inside StoryPage/SchedulePage — the
// logic suite stayed green while both pages crashed blank in prod. Mounting
// each page once turns any render-time ReferenceError into a test failure.

const PAGES = [
  ["StoryPage", StoryPage],
  ["DetailsPage", DetailsPage],
  ["SchedulePage", SchedulePage],
  ["VenuePage", VenuePage],
  ["RSVPPage", RSVPPage],
  ["GuestbookPage", GuestbookPage],
  ["QuizPage", QuizPage],
];

describe("public pages smoke render", () => {
  beforeEach(() => {
    cleanup();
    Store.set({ clientId: "c1", loading: false });
  });

  for (const [name, Page] of PAGES) {
    it(`${name} renders without crashing (default store)`, () => {
      expect(() => render(<Page />)).not.toThrow();
    });
  }

  // Bug 0014: a video milestone with a pan/zoom crop (scale/translate) must be
  // clipped — unwrapped, the transform escaped the frame and bled full-page.
  it("StoryPage clips a video milestone's pan/zoom crop inside overflow:hidden", () => {
    Store.set({ clientId: "c1", loading: false, story: [{ year: "2025", title: "The proposal", desc: "d", img: "abc/owner/video/x.mp4", imgCrop: { z: 1.3, dx: -0.17, dy: 0.02 } }] });
    const { container } = render(<StoryPage />);
    const vid = container.querySelector("video");
    expect(vid).toBeTruthy();
    expect(vid.style.transform).toContain("scale(1.3)");
    expect(vid.parentElement.style.overflow).toBe("hidden");
    Store.set({ story: [] });
  });

  it("StoryPage honors a renamed tab label in its eyebrow", () => {
    Store.updateSettings({ moduleLabels: { story: "Milestones" } });
    const { container } = render(<StoryPage />);
    expect(container.textContent).toContain("Milestones");
    Store.updateSettings({ moduleLabels: {} });
  });
});
