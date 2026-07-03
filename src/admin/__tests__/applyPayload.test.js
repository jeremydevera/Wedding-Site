import { describe, it, expect } from "vitest";
import { blankApplyState, requestPayload, stateFromRequest } from "@/admin/apply.jsx";

// The superadmin "edit request" reuses the wizard: a site_requests row loads
// via stateFromRequest and saves via requestPayload — the same serializer the
// public /apply submit uses. These tests lock that round-trip so a new wizard
// field can't silently drop out of editing.

const ROW = {
  partner_a: "Romeo", partner_b: "Juliet", email: "rj@example.com",
  subdomain: "romeo-juliet", template_key: "garden", status: "pending",
  content: {
    weddingDate: "2027-05-01T15:00", weddingDateLabel: "Saturday, May 1, 2027",
    venueName: "Villa Verde", venueAddress: "123 Garden Ln",
    mapQuery: "Villa Verde", mapLat: 14.55, mapLng: 121.02,
    schedule: [{ time: "3:00 PM", title: "Ceremony", loc: "Chapel" }],
    entourage: [{ id: "g1", title: "Groomsmen", people: [{ id: "p1", name: "Mercutio", role: "Best man" }] }],
    strictRsvp: true,
  },
};

describe("stateFromRequest -> requestPayload round-trip", () => {
  it("preserves every wizard field from the stored request", () => {
    const p = requestPayload(stateFromRequest(ROW));
    expect(p.partnerA).toBe("Romeo");
    expect(p.partnerB).toBe("Juliet");
    expect(p.email).toBe("rj@example.com");
    expect(p.subdomain).toBe("romeo-juliet");
    expect(p.templateKey).toBe("garden");
    expect(p.content.weddingDate).toBe("2027-05-01T15:00");
    expect(p.content.venueName).toBe("Villa Verde");
    expect(p.content.venueAddress).toBe("123 Garden Ln");
    expect(p.content.mapQuery).toBe("Villa Verde");
    expect(p.content.mapLat).toBe(14.55);
    expect(p.content.mapLng).toBe(121.02);
    expect(p.content.schedule).toEqual(ROW.content.schedule);
    expect(p.content.entourage).toEqual(ROW.content.entourage);
    expect(p.content.strictRsvp).toBe(true);
  });

  it("loads a sparse/older request over the blank defaults without crashing", () => {
    const f = stateFromRequest({ partner_a: "Ana", partner_b: "Ben", email: "", subdomain: "ana-ben", content: null });
    expect(f.partnerA).toBe("Ana");
    expect(f.theme).toBe(blankApplyState().theme);
    expect(Array.isArray(f.schedule) && f.schedule.length > 0).toBe(true); // defaults kick in
    expect(f.entourage).toEqual([]);
    const p = requestPayload(f);
    expect(p.subdomain).toBe("ana-ben");
    expect(p.content.strictRsvp).toBe(false);
  });

  it("gives entourage rows ids when an older row lacks them (wizard needs keys)", () => {
    const f = stateFromRequest({ partner_a: "A", partner_b: "B", subdomain: "ab", content: { entourage: [{ title: "Sponsors", people: [{ name: "X" }] }] } });
    expect(f.entourage[0].id).toBeTruthy();
    expect(f.entourage[0].people[0].id).toBeTruthy();
  });
});
