import { DEFAULT_SETTINGS, SEED_SCHEDULE, SEED_STORY, SEED_FAQ, SEED_QUIZ } from "@/lib/store.jsx";

// clients row -> the in-memory store state shape
export function clientToState(client) {
  const content = client.content || {};
  const theme = client.theme || {};
  const { schedule, story, faq, quiz, ...contentRest } = content;
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
  };
}

export function rsvpToRow(r, clientId) {
  return {
    client_id: clientId,
    full_name: r.fullName, phone: r.phone, status: r.status, count: r.count,
    plus_one: r.plusOne, diet: r.diet, diet_notes: r.dietNotes, song: r.song, notes: r.notes,
  };
}

export function guestbookToRow(e, clientId, status) {
  return { client_id: clientId, name: e.name, relationship: e.relationship, message: e.message, status };
}

export function quizToRow(s, clientId) {
  return { client_id: clientId, name: s.name, score: s.score, total: s.total, answers: s.answers };
}

export function rowToGuestbook(row) {
  return {
    id: row.id, name: row.name, relationship: row.relationship, message: row.message,
    status: "visible", createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
  };
}
