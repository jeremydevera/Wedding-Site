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

  it("locks the count picker until the name is verified (strict on)", () => {
    Store.updateSettings({ strictRsvp: true, rsvpDeadlineDate: "" });
    const { container } = render(<RSVPPage />);
    const el = container.querySelector("#r-count");
    expect(el).toBeTruthy();
    expect(el.disabled).toBe(true);
    expect(container.querySelectorAll("#r-count option").length).toBe(0);
  });

  it("open mode: bringing-with-you is a numeric textbox, not a dropdown", () => {
    Store.updateSettings({ strictRsvp: false, rsvpDeadlineDate: "" });
    const { container } = render(<RSVPPage />);
    const el = container.querySelector("#r-count");
    expect(el).toBeTruthy();
    expect(el.tagName).toBe("INPUT");
    expect(el.getAttribute("type")).toBe("number");
  });
});
