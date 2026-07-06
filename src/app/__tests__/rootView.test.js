import { describe, it, expect } from "vitest";
import { rootView, footerFine } from "@/app/App.jsx";

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

describe("footerFine", () => {
  // The bug: the footer showed the date even when the "Show wedding date &
  // countdown" master toggle was off. It must obey weddingDateOn like the hero.
  it("hides the date when the master toggle is off (no dangling separator)", () => {
    expect(footerFine({ weddingDateOn: false, weddingDateLabel: "June 4", venueName: "The Grand" }))
      .toEqual({ date: "", venue: "The Grand", sep: false });
  });
  it("shows the date and separator when toggle on (default) and both values present", () => {
    expect(footerFine({ weddingDateLabel: "June 4", venueName: "The Grand" }))
      .toEqual({ date: "June 4", venue: "The Grand", sep: true });
  });
  it("no separator when the date is empty", () => {
    expect(footerFine({ weddingDateOn: true, weddingDateLabel: "", venueName: "The Grand" }))
      .toEqual({ date: "", venue: "The Grand", sep: false });
  });
  it("no separator when the venue is empty", () => {
    expect(footerFine({ weddingDateLabel: "June 4", venueName: "" }))
      .toEqual({ date: "June 4", venue: "", sep: false });
  });
});
