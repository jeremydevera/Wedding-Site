import { DEFAULT_SETTINGS, SEED_SCHEDULE, SEED_STORY, SEED_FAQ, SEED_QUIZ, SEED_VENUE_CARDS, SEED_DETAIL_CARDS, SEED_ENTOURAGE, SEED_ATTIRE } from "@/lib/store.jsx";

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
  return legacy.length ? legacy : SEED_VENUE_CARDS;
}

// clients row -> the in-memory store state shape
export function clientToState(client) {
  const content = client.content || {};
  const theme = client.theme || {};
  const { schedule, story, faq, quiz, venueCards, detailCards, entourage, attire, playlist, venueParking, venueArrival, venueWeather, ...contentRest } = content;
  return {
    clientId: client.id,
    settings: {
      ...DEFAULT_SETTINGS,
      ...contentRest,
      ...theme,
      theme: client.template_key,
      eventType: client.event_type,
    },
    schedule: schedule || SEED_SCHEDULE,
    story: story || SEED_STORY,
    faq: faq || SEED_FAQ,
    quiz: quiz || SEED_QUIZ,
    venueCards: venueCardsFrom(content),
    detailCards: Array.isArray(detailCards) ? detailCards : SEED_DETAIL_CARDS,
    entourage: Array.isArray(entourage) ? entourage : SEED_ENTOURAGE,
    attire: Array.isArray(attire) ? attire : SEED_ATTIRE,
    playlist: Array.isArray(playlist) ? playlist : [],
  };
}

// Reverse of clientToState: in-memory store state -> a clients-row update.
// Theme tokens + all settings live in `content`; `theme` column is kept empty so
// it can't shadow content on reload (clientToState spreads `theme` after content).
export function stateToClientRow(state) {
  const { theme, eventType, ...rest } = state.settings || {};
  return {
    template_key: theme,
    event_type: eventType,
    theme: {},
    content: { ...rest, schedule: state.schedule, story: state.story, faq: state.faq, quiz: state.quiz, venueCards: state.venueCards, detailCards: state.detailCards, entourage: state.entourage, attire: state.attire, playlist: state.playlist },
  };
}

export function rsvpToRow(r, clientId) {
  return {
    client_id: clientId,
    full_name: r.fullName, email: r.email, first_name: r.firstName, middle_name: r.middleName, last_name: r.lastName,
    phone: r.phone, status: r.status, count: r.count,
    plus_one: r.plusOne, diet: r.diet, diet_notes: r.dietNotes, song: r.song, notes: r.notes,
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
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
  };
}

export function guestToRow(g, clientId) {
  return {
    client_id: clientId,
    first_name: g.firstName, last_name: g.lastName, middle_name: g.middleName,
    allocation: g.allocation, email: g.email, notes: g.notes,
  };
}

export function rowToGuest(row) {
  return {
    id: row.id, firstName: row.first_name, lastName: row.last_name, middleName: row.middle_name,
    allocation: row.allocation, email: row.email, notes: row.notes,
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
  };
}

export function rowToQuizSub(row) {
  return {
    id: row.id, name: row.name, score: row.score, total: row.total, answers: row.answers,
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
  };
}
