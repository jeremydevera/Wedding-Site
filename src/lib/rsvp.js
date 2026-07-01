// ============================================================================
// rsvp.js — pure, framework-free RSVP helpers (deadline gate, plus-one join,
// optional-email validation, admin stats). Kept dependency-free so both the
// public form and the admin panel can import them and they stay unit-testable.
// ============================================================================

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// True once the RSVP window has passed. Open (false) when no deadline is set or
// the stored value can't be parsed, so existing clients without a date keep
// working. `now` is milliseconds (pass Date.now()); defaults to now if omitted.
export function isRsvpClosed(deadlineDate, now) {
  if (!deadlineDate) return false;
  const t = Date.parse(deadlineDate);
  if (Number.isNaN(t)) return false;
  return (now == null ? Date.now() : now) > t;
}

// Trim each guest name, drop blanks, comma-join. Stored in the existing
// `plus_one` text column so admin display + CSV keep working unchanged.
export function joinPlusOnes(names) {
  return (names || []).map((s) => (s || "").trim()).filter(Boolean).join(", ");
}

// Email is optional: an empty value is always valid; a non-empty value must look
// like an address (mirrors the server's EMAIL_RE in functions/api/send-email.js).
export function isValidOptionalEmail(email) {
  const v = (email || "").trim();
  return v === "" || EMAIL_RE.test(v);
}

// Largest party size the count picker should offer. With no known allocation
// (null/undefined/absurd), fall back to the form's global cap of 8; a known
// allocation caps at min(allocation, 8). Strict-RSVP only — callers pass the
// value from the rsvp_guest_allocation probe.
export function maxPartySize(allocation) {
  const n = Math.floor(Number(allocation));
  if (!Number.isFinite(n) || n < 1) return 8;
  return Math.min(8, n);
}

// Caterer-facing tallies from the RSVP list. attendingHeads sums `count` across
// attending parties; diets counts each non-"None" diet among attending parties.
export function rsvpStats(rsvps) {
  const list = rsvps || [];
  const attending = list.filter((r) => r.status === "attending");
  const diets = {};
  for (const r of attending) {
    if (r.diet && r.diet !== "None") diets[r.diet] = (diets[r.diet] || 0) + 1;
  }
  return {
    total: list.length,
    attendingParties: attending.length,
    attendingHeads: attending.reduce((s, r) => s + (Number(r.count) || 0), 0),
    maybe: list.filter((r) => r.status === "maybe").length,
    declined: list.filter((r) => r.status === "not_attending").length,
    diets,
  };
}
