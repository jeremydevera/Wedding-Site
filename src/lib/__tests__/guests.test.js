import { describe, it, expect } from "vitest";
import { normName, namePartsMatch, reconcileGuests, guestFromRsvp, matchedRsvps } from "@/lib/guests.js";

describe("matchedRsvps", () => {
  const guests = [{ id: "g1", firstName: "Jeremy", lastName: "Reyes", middleName: "", allocation: 2 }];
  const rsvps = [
    { id: "r1", fullName: "Jeremy Reyes", firstName: "Jeremy", lastName: "Reyes", middleName: "", status: "attending", count: 2 },
    { id: "r2", fullName: "Gate Crasher", firstName: "Gate", lastName: "Crasher", middleName: "", status: "attending", count: 5 },
  ];
  it("returns only RSVPs that match an invited guest", () => {
    expect(matchedRsvps(guests, rsvps).map((r) => r.id)).toEqual(["r1"]);
  });
  it("handles empty inputs", () => {
    expect(matchedRsvps([], rsvps)).toEqual([]);
    expect(matchedRsvps(undefined, undefined)).toEqual([]);
  });
});

describe("guestFromRsvp", () => {
  it("uses name parts and count when present", () => {
    expect(guestFromRsvp({ firstName: "Jeremy", middleName: "P", lastName: "Reyes", count: 3, email: "j@ex.com", status: "attending" }))
      .toEqual({ firstName: "Jeremy", middleName: "P", lastName: "Reyes", allocation: 3, email: "j@ex.com", notes: "" });
  });
  it("splits fullName when parts are missing (first / middle... / last)", () => {
    expect(guestFromRsvp({ fullName: "Maria Luisa Dela Cruz", count: 1 }))
      .toMatchObject({ firstName: "Maria", middleName: "Luisa Dela", lastName: "Cruz" });
    expect(guestFromRsvp({ fullName: "Ana Cruz" })).toMatchObject({ firstName: "Ana", middleName: "", lastName: "Cruz" });
    expect(guestFromRsvp({ fullName: "Prince" })).toMatchObject({ firstName: "Prince", middleName: "", lastName: "" });
  });
  it("defaults allocation to at least 1 and email/notes to empty", () => {
    expect(guestFromRsvp({ fullName: "Tom Okafor", count: 0 })).toMatchObject({ allocation: 1, email: "", notes: "" });
    expect(guestFromRsvp({ fullName: "Tom Okafor" }).allocation).toBe(1);
  });
});

describe("normName", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(normName("  De Vera! ")).toBe("devera");
    expect(normName(null)).toBe("");
  });
});

describe("namePartsMatch", () => {
  const g = { first: "Jeremy", last: "Reyes", middle: "Perez" };
  it("matches on first+last when middles are equal or absent", () => {
    expect(namePartsMatch(g, { first: "jeremy", last: "reyes", middle: "Perez" })).toBe(true);
    expect(namePartsMatch({ first: "A", last: "B", middle: "" }, { first: "a", last: "b", middle: "" })).toBe(true);
  });
  it("treats a middle initial as matching the full middle", () => {
    expect(namePartsMatch(g, { first: "Jeremy", last: "Reyes", middle: "P" })).toBe(true);
  });
  it("rejects a different last name", () => {
    expect(namePartsMatch(g, { first: "Jeremy", last: "Cruz", middle: "Perez" })).toBe(false);
  });
  it("treats a missing middle on either side as a wildcard", () => {
    expect(namePartsMatch({ first: "Joseph", last: "Celis", middle: "L" }, { first: "Joseph", last: "Celis", middle: "" })).toBe(true);
    expect(namePartsMatch({ first: "Joseph", last: "Celis", middle: "" }, { first: "Joseph", last: "Celis", middle: "R" })).toBe(true);
  });
});

describe("reconcileGuests", () => {
  const guests = [
    { id: "g1", firstName: "Jeremy", lastName: "Reyes", middleName: "", allocation: 2 },
    { id: "g2", firstName: "Maria", lastName: "Cruz", middleName: "", allocation: 4 },
    { id: "g3", firstName: "Tom", lastName: "Okafor", middleName: "", allocation: 1 },
  ];
  const rsvps = [
    { id: "r1", fullName: "Jeremy Reyes", firstName: "Jeremy", lastName: "Reyes", middleName: "", status: "attending", count: 2 },
    { id: "r2", fullName: "Tom Okafor", firstName: "Tom", lastName: "Okafor", middleName: "", status: "not_attending", count: 0 },
    { id: "r3", fullName: "Gate Crasher", firstName: "Gate", lastName: "Crasher", middleName: "", status: "attending", count: 3 },
  ];
  it("assigns status per guest and finds outstanding + unmatched", () => {
    const { rows, summary, unmatchedRsvps } = reconcileGuests(guests, rsvps);
    const byId = Object.fromEntries(rows.map((x) => [x.guest.id, x]));
    expect(byId.g1.status).toBe("attending");
    expect(byId.g2.status).toBe("none");
    expect(byId.g3.status).toBe("not_attending");
    expect(summary.invited).toBe(3);
    expect(summary.seatsAllocated).toBe(7);
    expect(summary.replied).toBe(2);
    expect(summary.outstanding).toBe(1);
    expect(summary.confirmedHeads).toBe(2);
    expect(summary.declined).toBe(1);
    expect(unmatchedRsvps.map((r) => r.id)).toEqual(["r3"]);
  });
  it("handles empty inputs", () => {
    expect(reconcileGuests([], []).summary).toMatchObject({ invited: 0, seatsAllocated: 0, confirmedHeads: 0 });
    expect(reconcileGuests(undefined, undefined).rows).toEqual([]);
  });
});
