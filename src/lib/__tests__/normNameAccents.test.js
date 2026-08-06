// src/lib/__tests__/normNameAccents.test.js
// normName MUST stay byte-identical to SQL public.norm_name: the RSVP gate
// matches server-side, reconcileGuests matches here, and if the two disagree a
// reply is accepted on the site but shows as "unmatched" in the admin.
//
// The expected values below were produced by running SQL public.norm_name on the
// live database after folding accents, so this test pins the contract rather
// than just re-stating the JS implementation.
import { describe, it, expect } from "vitest";
import { normName, namePartsMatch } from "../guests.js";

// input -> SQL public.norm_name(input)
const SQL_NORM = [
  ["Peña", "pena"],
  ["Pena", "pena"],
  ["Muñoz", "munoz"],
  ["Renée", "renee"],
  ["Renee", "renee"],
  ["Niño", "nino"],
  ["De Vera", "devera"],
  ["Joseph L Celis", "josephlcelis"],
  ["Jeremy Adrian", "jeremyadrian"],
  ["  Smith-Jones ", "smithjones"],
  ["", ""],
];

describe("normName mirrors SQL norm_name", () => {
  it.each(SQL_NORM)("normalises %j to %j", (input, expected) => {
    expect(normName(input)).toBe(expected);
  });

  it("folds accents instead of deleting them (the bug that locked guests out)", () => {
    // Old behaviour dropped the accented letter: "Peña" -> "pea", which could
    // never match a guest who typed "Pena".
    expect(normName("Peña")).toBe(normName("Pena"));
    expect(normName("Muñoz")).toBe(normName("Munoz"));
    expect(normName("Renée")).toBe(normName("Renee"));
    expect(normName("Peña")).not.toBe("pea");
  });

  it("still matches an accented guest row against a plain typed name", () => {
    expect(namePartsMatch(
      { first: "José", middle: "", last: "Peña" },
      { first: "Jose", middle: "", last: "Pena" },
    )).toBe(true);
  });

  it("keeps different names apart", () => {
    expect(normName("Pena")).not.toBe(normName("Penas"));
    expect(namePartsMatch(
      { first: "Jose", middle: "", last: "Pena" },
      { first: "Jose", middle: "", last: "Penas" },
    )).toBe(false);
  });
});
