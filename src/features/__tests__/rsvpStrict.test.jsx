import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { Store } from "@/lib/store.jsx";
import { RSVPPage } from "@/features/rsvp.jsx";

// Strict RSVP gates at SUBMIT (name probe via RPC), never at render — the form
// must always show. Regression for "strict RSVP on → RSVP page shows nothing".
describe("RSVPPage under Strict RSVP", () => {
  beforeEach(() => cleanup());

  it("renders the full form when strictRsvp is ON", () => {
    Store.updateSettings({ strictRsvp: true, rsvpDeadlineDate: "" });
    const { container } = render(<RSVPPage />);
    expect(container.querySelector("#r-first")).toBeTruthy();
    expect(container.querySelector("#r-count")).toBeTruthy();
    expect(container.textContent).toContain("Send RSVP");
  });

  it("renders the full form when strictRsvp is OFF", () => {
    Store.updateSettings({ strictRsvp: false, rsvpDeadlineDate: "" });
    const { container } = render(<RSVPPage />);
    expect(container.querySelector("#r-first")).toBeTruthy();
    expect(container.textContent).toContain("Send RSVP");
  });

  it("offers all 8 count options while no allocation is known", () => {
    Store.updateSettings({ strictRsvp: true, rsvpDeadlineDate: "" });
    const { container } = render(<RSVPPage />);
    expect(container.querySelectorAll("#r-count option").length).toBe(8);
  });
});
