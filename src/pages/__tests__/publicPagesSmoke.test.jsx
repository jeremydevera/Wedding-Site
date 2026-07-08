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

  it("StoryPage honors a renamed tab label in its eyebrow", () => {
    Store.updateSettings({ moduleLabels: { story: "Milestones" } });
    const { container } = render(<StoryPage />);
    expect(container.textContent).toContain("Milestones");
    Store.updateSettings({ moduleLabels: {} });
  });
});
