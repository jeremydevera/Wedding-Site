import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { Store } from "@/lib/store.jsx";
import { RSVPPage, deadlineUTC } from "@/features/rsvp.jsx";
import { isRsvpClosed } from "@/lib/rsvp.js";

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

// Regression: the naive <datetime-local> deadline must be interpreted as UTC so
// the client close-gate agrees with the server guard's `(dl)::timestamptz` cast
// (0018, DB session tz = UTC). Without this, Date.parse anchors it to the
// guest's browser-local tz and the form closes at a different absolute instant
// per visitor. deadlineUTC() normalizes the string before isRsvpClosed().
describe("deadlineUTC (deadline timezone normalization)", () => {
  it("anchors a naive datetime-local string to UTC", () => {
    expect(deadlineUTC("2026-08-15T23:00")).toBe("2026-08-15T23:00Z");
    expect(deadlineUTC("2026-08-15T23:00:30")).toBe("2026-08-15T23:00:30Z");
  });

  it("leaves already-zoned, empty, and non-string values unchanged", () => {
    expect(deadlineUTC("2026-08-15T23:00Z")).toBe("2026-08-15T23:00Z");
    expect(deadlineUTC("2026-08-15T23:00+02:00")).toBe("2026-08-15T23:00+02:00");
    expect(deadlineUTC("")).toBe("");
    expect(deadlineUTC(null)).toBe(null);
    expect(deadlineUTC(undefined)).toBe(undefined);
  });

  it("closes at the UTC instant, not the browser-local one", () => {
    // Deadline 2026-08-15T23:00 UTC => absolute 1755298800000 ms.
    const utcMs = Date.parse("2026-08-15T23:00Z");
    expect(isRsvpClosed(deadlineUTC("2026-08-15T23:00"), utcMs - 1000)).toBe(false);
    expect(isRsvpClosed(deadlineUTC("2026-08-15T23:00"), utcMs + 1000)).toBe(true);
  });
});
