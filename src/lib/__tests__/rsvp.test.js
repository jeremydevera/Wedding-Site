import { describe, it, expect } from "vitest";
import { isRsvpClosed, joinPlusOnes, isValidOptionalEmail, rsvpStats, maxPartySize } from "@/lib/rsvp.js";

describe("maxPartySize", () => {
  it("defaults to 8 when no allocation is known", () => {
    expect(maxPartySize(null)).toBe(8);
    expect(maxPartySize(undefined)).toBe(8);
    expect(maxPartySize(0)).toBe(8);
  });
  it("caps at the allocation, never above 8", () => {
    expect(maxPartySize(1)).toBe(1);
    expect(maxPartySize(2)).toBe(2);
    expect(maxPartySize(8)).toBe(8);
    expect(maxPartySize(12)).toBe(8);
  });
  it("coerces strings and floors fractions", () => {
    expect(maxPartySize("3")).toBe(3);
    expect(maxPartySize(2.7)).toBe(2);
  });
});

describe("isRsvpClosed", () => {
  it("is open when no deadline is set", () => {
    expect(isRsvpClosed("", 1_000)).toBe(false);
    expect(isRsvpClosed(null, 1_000)).toBe(false);
    expect(isRsvpClosed(undefined, 1_000)).toBe(false);
  });
  it("is open before the deadline, closed after", () => {
    const deadline = "2026-08-15T23:59";
    const before = Date.parse("2026-08-01T12:00");
    const after = Date.parse("2026-09-01T12:00");
    expect(isRsvpClosed(deadline, before)).toBe(false);
    expect(isRsvpClosed(deadline, after)).toBe(true);
  });
  it("stays open on an unparseable deadline string", () => {
    expect(isRsvpClosed("not a date", Date.parse("2099-01-01"))).toBe(false);
  });
});

describe("joinPlusOnes", () => {
  it("trims, drops blanks, and comma-joins", () => {
    expect(joinPlusOnes([" Bob ", "", "  ", "Cara"])).toBe("Bob, Cara");
  });
  it("returns an empty string for empty/undefined input", () => {
    expect(joinPlusOnes([])).toBe("");
    expect(joinPlusOnes(undefined)).toBe("");
  });
});

describe("isValidOptionalEmail", () => {
  it("allows an empty value (optional field)", () => {
    expect(isValidOptionalEmail("")).toBe(true);
    expect(isValidOptionalEmail("   ")).toBe(true);
    expect(isValidOptionalEmail(undefined)).toBe(true);
  });
  it("accepts a well-formed address and rejects a malformed one", () => {
    expect(isValidOptionalEmail("a@b.co")).toBe(true);
    expect(isValidOptionalEmail("nope")).toBe(false);
    expect(isValidOptionalEmail("a@b")).toBe(false);
  });
});

describe("rsvpStats", () => {
  const rows = [
    { status: "attending", count: 2, diet: "Vegetarian" },
    { status: "attending", count: 1, diet: "None" },
    { status: "attending", count: 3, diet: "Vegetarian" },
    { status: "maybe", count: 1, diet: "Vegan" },
    { status: "not_attending", count: 0, diet: "None" },
  ];
  it("counts parties, heads, maybe, declined", () => {
    const s = rsvpStats(rows);
    expect(s.total).toBe(5);
    expect(s.attendingParties).toBe(3);
    expect(s.attendingHeads).toBe(6); // 2 + 1 + 3
    expect(s.maybe).toBe(1);
    expect(s.declined).toBe(1);
  });
  it("tallies diets for attending guests, excluding None", () => {
    const s = rsvpStats(rows);
    expect(s.diets).toEqual({ Vegetarian: 2 });
  });
  it("handles empty input", () => {
    expect(rsvpStats([])).toMatchObject({ total: 0, attendingHeads: 0, diets: {} });
    expect(rsvpStats(undefined).total).toBe(0);
  });
});
