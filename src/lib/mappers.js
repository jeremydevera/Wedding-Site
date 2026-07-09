import { BASE_SETTINGS } from "@/lib/store.jsx";

// Build the venue-cards array from a client's content. Prefer the new
// `venueCards` array; fall back to the legacy flat keys (venueParking/Arrival/
// Weather) saved before cards were dynamic; else the seed defaults.
function venueCardsFrom(content) {
  if (Array.isArray(content.venueCards)) return content.venueCards;
  const legacy = [
    ["Parking", content.venueParking],
    ["Arrival", content.venueArrival],
    ["Weather", content.venueWeather],
  ].filter(([, d]) => d != null).map(([t, d]) => ({ t, d }));
  return legacy.length ? legacy : [];
}

// Build the venues array (each = a map + its own tiles). Prefer the new `venues`
// array; otherwise synthesize ONE venue from the legacy single map (venueName/
// venueAddress/mapQuery in settings) + the flat venueCards, so existing clients
// keep working unchanged. Normalizes ids on every venue and card.
function venuesFrom(content, settings) {
  const withIds = (cards, vi) => (Array.isArray(cards) ? cards : []).map((c, j) => ({
    id: c.id || `vc-${vi}-${j}`, t: c.t || "", d: c.d || "",
  }));
  if (Array.isArray(content.venues) && content.venues.length) {
    return content.venues.map((v, i) => ({
      id: v.id || "venue-" + i,
      name: v.name || "", address: v.address || "",
      mapQuery: v.mapQuery || "", mapLat: v.mapLat, mapLng: v.mapLng,
      cards: withIds(v.cards, i),
    }));
  }
  // Blank client (no venues, no legacy venue, no cards) → no venue at all,
  // rather than a synthesized empty card.
  const legacyCards = venueCardsFrom(content);
  if (!settings.venueName && !settings.venueAddress && !settings.mapQuery && !legacyCards.length) return [];
  return [{
    id: "venue-main",
    name: settings.venueName || "", address: settings.venueAddress || "",
    mapQuery: settings.mapQuery || "", mapLat: settings.mapLat, mapLng: settings.mapLng,
    cards: withIds(legacyCards, 0),
  }];
}

// clients row -> the in-memory store state shape
export function clientToState(client) {
  const content = client.content || {};
  const theme = client.theme || {};
  const { schedule, story, faq, quiz, venueCards, venues, detailCards, entourage, attire, playlist, venueParking, venueArrival, venueWeather, ...contentRest } = content;
  const settings = {
    ...BASE_SETTINGS,
    ...contentRest,
    ...theme,
    theme: client.template_key,
    eventType: client.event_type,
  };
  // BASE_SETTINGS carries the DEMO's seed venue ("Somewhere in Lipa, Batangas").
  // A real client that simply hasn't set a venue must NOT inherit it (it leaked
  // into footers/venue lines). Blank the seed for non-demo clients whose own
  // content doesn't define these keys.
  if (client.subdomain !== "demo") {
    for (const k of ["venueName", "venueAddress", "mapQuery"]) {
      if (!(k in content)) settings[k] = "";
    }
  }
  return {
    clientId: client.id,
    settings,
    schedule: schedule || [],
    story: story || [],
    faq: faq || [],
    quiz: quiz || [],
    venueCards: venueCardsFrom(content),
    venues: venuesFrom(content, settings),
    detailCards: Array.isArray(detailCards) ? detailCards : [],
    entourage: Array.isArray(entourage) ? entourage : [],
    attire: Array.isArray(attire) ? attire : [],
    playlist: Array.isArray(playlist) ? playlist : [],
  };
}

// Settings keys that must NEVER be persisted into clients.content — the public
// boot path reads content with the anon key under the "read active clients"
// select policy, so anything left here is world-readable. adminPassword is a
// credential-shaped field (gates nothing today; real admin auth is Supabase
// email/password) and must not be published to visitors.
const CONTENT_SECRET_KEYS = ["adminPassword"];

// Reverse of clientToState: in-memory store state -> a clients-row update.
// Theme tokens + all settings live in `content`; `theme` column is kept empty so
// it can't shadow content on reload (clientToState spreads `theme` after content).
export function stateToClientRow(state) {
  const { theme, eventType, ...rest } = state.settings || {};
  for (const k of CONTENT_SECRET_KEYS) delete rest[k];
  return {
    template_key: theme,
    event_type: eventType,
    theme: {},
    content: { ...rest, schedule: state.schedule, story: state.story, faq: state.faq, quiz: state.quiz, venueCards: state.venueCards, venues: state.venues, detailCards: state.detailCards, entourage: state.entourage, attire: state.attire, playlist: state.playlist },
  };
}

// Support ticket form → support_tickets row. Snapshots the submitter (email +
// couple names) and the admin context (subdomain / tab) so the superadmin has
// what they need without a join. Defaults: category Question, urgency Normal,
// status open. Single-name events (birthday) produce no dangling "&".
export function ticketToRow(form, clientId, ctx = {}) {
  const name = [ctx.partnerA, ctx.partnerB].map((x) => (x || "").trim()).filter(Boolean).join(" & ");
  return {
    client_id: clientId,
    submitter_email: ctx.email || null,
    submitter_name: name || null,
    subject: (form.subject || "").trim(),
    category: form.category || "Question",
    urgency: form.urgency || "Normal",
    message: (form.message || "").trim(),
    context_url: [ctx.subdomain, ctx.tab].filter(Boolean).join(" / ") || null,
    status: "open",
  };
}

export function rsvpToRow(r, clientId) {
  return {
    client_id: clientId,
    full_name: r.fullName, email: r.email, first_name: r.firstName, middle_name: r.middleName, last_name: r.lastName,
    phone: r.phone, status: r.status, count: r.count,
    plus_one: r.plusOne, diet: r.diet, diet_notes: r.dietNotes, song: r.song, notes: r.notes,
    companions: Array.isArray(r.companions) ? r.companions : [],
  };
}

export function guestbookToRow(e, clientId, status) {
  return { client_id: clientId, name: e.name, relationship: e.relationship, message: e.message, status };
}

export function quizToRow(s, clientId) {
  return { client_id: clientId, name: s.name, score: s.score, total: s.total, answers: s.answers };
}

// DB guestbook status -> in-memory status. Public site shows only "visible"
// (= approved), so pending/hidden stay off the live site even when the admin
// has loaded every row.
const GB_STATUS = { approved: "visible", hidden: "hidden", pending: "pending" };
export function rowToGuestbook(row) {
  return {
    id: row.id, name: row.name, relationship: row.relationship, message: row.message,
    status: GB_STATUS[row.status] || "visible",
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
  };
}

export function rowToRsvp(row) {
  return {
    id: row.id, fullName: row.full_name, email: row.email,
    firstName: row.first_name, middleName: row.middle_name, lastName: row.last_name,
    phone: row.phone, status: row.status, count: row.count,
    plusOne: row.plus_one, diet: row.diet, dietNotes: row.diet_notes, song: row.song, notes: row.notes,
    companions: Array.isArray(row.companions) ? row.companions : [],
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
  };
}

export function guestToRow(g, clientId) {
  return {
    client_id: clientId,
    first_name: g.firstName, last_name: g.lastName, middle_name: g.middleName,
    allocation: g.allocation, email: g.email, notes: g.notes,
    status: g.status || "attending",
  };
}

export function rowToGuest(row) {
  return {
    id: row.id, firstName: row.first_name, lastName: row.last_name, middleName: row.middle_name,
    allocation: row.allocation, email: row.email, notes: row.notes,
    status: row.status || "attending",
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
  };
}

export function rowToQuizSub(row) {
  return {
    id: row.id, name: row.name, score: row.score, total: row.total, answers: row.answers,
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
  };
}
