// ============================================================================
// guests.js — pure helpers for the owner's invited-guest list. normName mirrors
// the SQL public.norm_name (migrations 0007/0008); reconcileGuests matches guests
// to RSVPs by fuzzy name and produces per-guest status + a headcount summary.
// ============================================================================

export function normName(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function middleMatches(a, b) {
  const x = normName(a), y = normName(b);
  if (x === y) return true;
  if (x && y && x[0] === y[0] && (x.length === 1 || y.length === 1)) return true;
  return false;
}

export function namePartsMatch(a, b) {
  return normName(a.first) === normName(b.first)
    && normName(a.last) === normName(b.last)
    && middleMatches(a.middle, b.middle);
}

export function reconcileGuests(guests, rsvps) {
  const gs = guests || [];
  const rs = (rsvps || []).map((r, i) => ({ r, i }));
  const used = new Set();

  const rows = gs.map((g) => {
    const hit = rs.find(({ r, i }) => !used.has(i) && namePartsMatch(
      { first: g.firstName, last: g.lastName, middle: g.middleName },
      { first: r.firstName, last: r.lastName, middle: r.middleName },
    ));
    if (hit) used.add(hit.i);
    const rsvp = hit ? hit.r : null;
    const status = rsvp ? rsvp.status : "none";
    return { guest: g, rsvp, status };
  });

  const unmatchedRsvps = rs.filter(({ i }) => !used.has(i)).map(({ r }) => r);
  const replied = rows.filter((x) => x.rsvp).length;
  const confirmedHeads = rows.reduce(
    (s, x) => s + (x.status === "attending" ? (Number(x.rsvp.count) || 0) : 0), 0);

  const summary = {
    invited: gs.length,
    seatsAllocated: gs.reduce((s, g) => s + (Number(g.allocation) || 0), 0),
    replied,
    outstanding: gs.length - replied,
    confirmedHeads,
    maybe: rows.filter((x) => x.status === "maybe").length,
    declined: rows.filter((x) => x.status === "not_attending").length,
  };

  return { rows, summary, unmatchedRsvps };
}

// Build a guest-list draft from an existing RSVP ("Add to list" on unmatched
// RSVPs). Prefers stored name parts; falls back to splitting fullName (first
// token / middle tokens / last token). Their replied party size becomes the
// allocation (min 1).
export function guestFromRsvp(rsvp) {
  const r = rsvp || {};
  let first = (r.firstName || "").trim();
  let middle = (r.middleName || "").trim();
  let last = (r.lastName || "").trim();
  if (!first && !last) {
    const parts = (r.fullName || "").trim().split(/\s+/).filter(Boolean);
    first = parts[0] || "";
    last = parts.length > 1 ? parts[parts.length - 1] : "";
    middle = parts.slice(1, -1).join(" ");
  }
  return {
    firstName: first, middleName: middle, lastName: last,
    allocation: Math.max(1, Number(r.count) || 1),
    email: r.email || "", notes: "",
  };
}

// RSVPs that match an invited guest — with Strict RSVP on, only these count
// toward dashboard tiles/charts; unmatched replies sit in "For Approval".
export function matchedRsvps(guests, rsvps) {
  return reconcileGuests(guests, rsvps).rows.filter((x) => x.rsvp).map((x) => x.rsvp);
}
