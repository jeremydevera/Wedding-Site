// ============================================================================
// guests.js — pure helpers for the owner's invited-guest list. normName mirrors
// the SQL public.norm_name (migrations 0007/0008); reconcileGuests matches guests
// to RSVPs by fuzzy name and produces per-guest status + a headcount summary.
// ============================================================================
import { headsOf } from "./rsvp.js";

export function normName(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Middle names match if equal, if one side is an initial of the other, or if
// either side is missing (wildcard — the RSVP gate blocks truly ambiguous
// cases by asking the guest to add their middle name, so reconcile can be lax).
function middleMatches(a, b) {
  const x = normName(a), y = normName(b);
  if (x === y) return true;
  if (!x || !y) return true;
  if (x[0] === y[0] && (x.length === 1 || y.length === 1)) return true;
  return false;
}

export function namePartsMatch(a, b) {
  return normName(a.first) === normName(b.first)
    && normName(a.last) === normName(b.last)
    && middleMatches(a.middle, b.middle);
}

// Like namePartsMatch but WITHOUT the empty-middle wildcard — used to prefer an
// exact/initial middle match before falling back to wildcard candidates.
function namePartsMatchExact(a, b) {
  const x = normName(a.middle), y = normName(b.middle);
  const middleExact = x === y || (x && y && x[0] === y[0] && (x.length === 1 || y.length === 1));
  return normName(a.first) === normName(b.first)
    && normName(a.last) === normName(b.last)
    && middleExact;
}

export function reconcileGuests(guests, rsvps) {
  const gs = guests || [];
  const rs = (rsvps || []).map((r, i) => ({ r, i }));
  const used = new Set();

  const rows = gs.map((g) => {
    const gp = { first: g.firstName, last: g.lastName, middle: g.middleName };
    const rp = (r) => ({ first: r.firstName, last: r.lastName, middle: r.middleName });
    // Two tiers, mirroring the SQL gate: exact/initial middle first, then the
    // empty-middle wildcard — so a stale middle-less reply can't shadow the
    // right one.
    const hit = rs.find(({ r, i }) => !used.has(i) && namePartsMatchExact(gp, rp(r)))
      || rs.find(({ r, i }) => !used.has(i) && namePartsMatch(gp, rp(r)));
    if (hit) used.add(hit.i);
    const rsvp = hit ? hit.r : null;
    // A reply always wins; otherwise the owner-set guest status applies
    // (owner-added guests default to "attending" — no reply required).
    const status = rsvp ? rsvp.status : (g.status || "none");
    return { guest: g, rsvp, status };
  });

  const unmatchedRsvps = rs.filter(({ i }) => !used.has(i)).map(({ r }) => r);
  const replied = rows.filter((x) => x.rsvp).length;
  // One rule everywhere: heads = named companions + the guest. Blanks and unused
  // allotment never count. A reply → named companions + 1; an attending guest
  // with no reply (no names given) → just themselves (1). Allocation is only a
  // cap, never a head count.
  const confirmedHeads = rows.reduce(
    (s, x) => s + (x.status === "attending" ? (x.rsvp ? headsOf(x.rsvp) : 1) : 0), 0);

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
