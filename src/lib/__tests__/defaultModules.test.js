import { describe, it, expect } from "vitest";
import { DEFAULT_CLIENT_MODULES } from "@/lib/roles.js";

// A fresh request/client must default to the four core sections ONLY —
// "absent modules" may never read as "everything on" (Our Story showed
// enabled on unreviewed requests).
describe("DEFAULT_CLIENT_MODULES", () => {
  it("enables exactly details/schedule/venue/rsvp", () => {
    expect(DEFAULT_CLIENT_MODULES).toEqual({
      details: true, schedule: true, venue: true, rsvp: true,
      story: false, guestbook: false, quiz: false, gallery: false,
    });
  });
});
