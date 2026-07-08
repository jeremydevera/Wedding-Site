import { describe, it, expect } from "vitest";
import { blankApplyState, requestPayload, stateFromRequest, parseWeddingDate, composeWeddingDate } from "@/admin/apply.jsx";

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

describe("event type — wedding vs birthday", () => {
  it("defaults to wedding and stamps eventType into payload + content", () => {
    const p = requestPayload(blankApplyState());
    expect(p.eventType).toBe("wedding");
    expect(p.content.eventType).toBe("wedding");
  });

  it("birthday: eventTitle becomes partnerA, partnerB is empty", () => {
    const f = { ...blankApplyState(), eventType: "birthday", eventTitle: "Leo's 7th Birthday", email: "mom@x.com", subdomain: "leo-7" };
    const p = requestPayload(f);
    expect(p.eventType).toBe("birthday");
    expect(p.partnerA).toBe("Leo's 7th Birthday");
    expect(p.partnerB).toBe("");
    expect(p.content.eventType).toBe("birthday");
  });

  it("round-trips a birthday request (title restored into eventTitle)", () => {
    const row = { partner_a: "Leo's 7th Birthday", partner_b: "", email: "mom@x.com", subdomain: "leo-7", template_key: "blush", content: { eventType: "birthday" } };
    const f = stateFromRequest(row);
    expect(f.eventType).toBe("birthday");
    expect(f.eventTitle).toBe("Leo's 7th Birthday");
    const p = requestPayload(f);
    expect(p.partnerA).toBe("Leo's 7th Birthday");
    expect(p.partnerB).toBe("");
    expect(p.eventType).toBe("birthday");
  });

  it("old rows without eventType stay weddings", () => {
    const f = stateFromRequest(ROW);
    expect(f.eventType).toBe("wedding");
    expect(requestPayload(f).eventType).toBe("wedding");
  });
});

describe("easy wedding-date dropdowns (compose/parse)", () => {
  it("composes month/day/year + 12h time into the pipeline's ISO shape", () => {
    expect(composeWeddingDate(2027, 5, 1, "3:00 PM")).toBe("2027-05-01T15:00");
    expect(composeWeddingDate(2027, 12, 31, "12:00 AM")).toBe("2027-12-31T00:00");
    expect(composeWeddingDate(2027, 6, 15, "12:30 PM")).toBe("2027-06-15T12:30");
    expect(composeWeddingDate(2027, 6, 15, "")).toBe("2027-06-15T00:00"); // no time -> midnight
  });
  it("clamps impossible days instead of producing an invalid date", () => {
    expect(composeWeddingDate(2027, 2, 31, "")).toBe("2027-02-28T00:00");
    expect(composeWeddingDate(2028, 2, 31, "")).toBe("2028-02-29T00:00"); // leap year
  });
  it("returns empty until the date is complete", () => {
    expect(composeWeddingDate("", 5, 1, "")).toBe("");
    expect(composeWeddingDate(2027, "", 1, "")).toBe("");
    expect(composeWeddingDate(2027, 5, "", "")).toBe("");
  });
  it("parses back to the same dropdown selections (round-trip)", () => {
    expect(parseWeddingDate("2027-05-01T15:00")).toEqual({ y: 2027, mo: 5, d: 1, time: "3:00 PM" });
    expect(parseWeddingDate("2027-05-01T00:00")).toEqual({ y: 2027, mo: 5, d: 1, time: "" }); // midnight = "no time picked"
    expect(parseWeddingDate("")).toEqual({ y: "", mo: "", d: "", time: "" });
  });
});
