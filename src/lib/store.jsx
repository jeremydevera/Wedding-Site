import React from "react";
const { useState, useEffect, useRef, useMemo, useCallback, useReducer } = React;

// ============================================================================
// store.jsx — localStorage-backed app store with pub/sub + seed data
// Everything the "backend" would hold lives here so the prototype truly works:
// settings, RSVPs, guestbook, media, quiz submissions.
// ============================================================================

export const STORE_KEY = "evermore_store_v3";

// ---- Seed / default data ---------------------------------------------------
export const DEFAULT_SETTINGS = {
  theme: "classic",
  eventType: "wedding",
  partnerA: "Jeremy",
  partnerB: "Irish",
  // ISO date string for the wedding moment
  weddingDate: "2026-09-19T15:00",
  weddingDateLabel: "Saturday, September 19, 2026",
  tagline: "We're getting married",
  welcome:
    "Two families, one celebration. We would be honored to have you with us as we say \u201cI do.\u201d Find everything you need below \u2014 and don't forget to share your photos.",
  // Home-page invitation section (editable via the admin "Home" tab).
  inviteTitle: "You're invited to celebrate love",
  inviteBody:
    "We can't wait to celebrate the start of our forever, surrounded by the people we love most. Thank you for being part of our story \u2014 here's a little about how we got here, and what our wedding day will hold.",
  venueName: "Somewhere in Lipa, Batangas",
  venueAddress: "Lipa, Batangas, Philippines",
  ceremonyTime: "3:00 PM",
  receptionTime: "5:30 PM",
  dressCode: "Garden formal \u2014 think soft suits and flowing dresses.",
  rsvpDeadline: "August 15, 2026",
  // ISO datetime (like weddingDate). When set and in the past, the public RSVP
  // form closes. Blank = always open (backward-compatible for existing clients).
  rsvpDeadlineDate: "",
  hashtag: "#JeremyAndIrish2026",
  adminPassword: "wedding",
  uploadsEnabled: true,
  galleryEnabled: true,
  autoApproveMedia: true,
  autoApproveGuestbook: true,
  heroImage: "",
  frameImage: "",
  envBgImage: "",
  envTintOn: true,
  envTint: 55,
  envTintColor: "olive",
  envTitleSize: 5, // envelope cover title size, 1–10 scale; maps to a cqw fraction that scales with the envelope
  arrangeEnabled: false,
  mapQuery: "Lipa, Batangas, Philippines",
  // Home-page section visibility (toggled in the admin Home tab). Default on;
  // read as `!== false` everywhere so existing clients without the flag show.
  showMusic: true,
  showEntourage: true,
  showMap: true,
  showAttire: true,
  musicAutoplay: true,
  decorOn: false,
  decorStyle: "petals",
  scheduleStyle: "line",
  homeTimelineLayout: "vertical",   // home "glimpse of the schedule" timeline: vertical | horizontal
  themeAccent: "",
  displayFont: "Cormorant Garamond",
  bodyFont: "Jost",
};

export const SEED_SCHEDULE = [
  { time: "2:15 PM", title: "Guest Arrival", desc: "Welcome drinks on the south lawn.", loc: "Garden Terrace" },
  { time: "3:00 PM", title: "Ceremony", desc: "Please be seated by 2:50. The ceremony begins promptly.", loc: "The Old Orchard" },
  { time: "3:45 PM", title: "Cocktail Hour", desc: "Canap\u00e9s, signature cocktails, and live strings.", loc: "Stone Courtyard" },
  { time: "5:30 PM", title: "Dinner & Toasts", desc: "A seated three-course dinner with speeches.", loc: "The Grand Barn" },
  { time: "8:00 PM", title: "First Dance", desc: "Followed by the floor opening to all.", loc: "The Grand Barn" },
  { time: "11:30 PM", title: "Send-Off", desc: "A sparkler farewell under the stars.", loc: "Front Drive" },
];

export const SEED_STORY = [
  { year: "2018", title: "How we met", desc: "A rainy bookshop in Brooklyn and one shared umbrella.", img: "/assets/samples/story1.png" },
  { year: "2020", title: "First trip", desc: "Three days lost in Lisbon, and never happier.", img: "/assets/samples/story2.png" },
  { year: "2023", title: "Moving in", desc: "A tiny apartment, a loud cat, endless plants.", img: "/assets/samples/story3.png" },
  { year: "2025", title: "The proposal", desc: "Sunrise on the Maine coast, with the ring in a coffee cup.", img: "/assets/samples/story4.png" },
];

export const SEED_FAQ = [
  { q: "What time should I arrive?", a: "Please arrive by 2:30 PM so we can begin the ceremony on time at 3:00." },
  { q: "Can I bring a plus-one?", a: "Your invitation will note the number of seats reserved in your name. Please RSVP accordingly." },
  { q: "Are children welcome?", a: "We love your little ones, but this will be an adults-only celebration with a few exceptions noted on your invite." },
  { q: "Is parking available?", a: "Yes \u2014 complimentary valet and self-parking are available at the rear entrance." },
  { q: "Can I take photos?", a: "We're having an unplugged ceremony, but please photograph everything afterward and upload it here!" },
];

// Venue info cards — the cards shown under the map on the Venue page.
// Editable in admin (title + description), add/remove/reorder. Persisted to clients.content.
// Details page info tiles — editable in admin (icon + title + body), add/remove/reorder.
export const SEED_DETAIL_CARDS = [
  { icon: "rings", title: "The Ceremony", body: "Join us as we say “I do.” Please be seated 10 minutes before we begin — the ceremony will be unplugged, so be fully present with us." },
  { icon: "heart", title: "The Reception", body: "Cocktails, dinner, and dancing follow immediately at the same venue. Expect to celebrate late into the night." },
  { icon: "user", title: "Dress Code", body: "Formal — black-tie optional. Dress to celebrate!" },
  { icon: "pin", title: "Getting There", body: "Complimentary valet and self-parking at the rear entrance. Rideshare drop-off is at the front gate." },
];

// Entourage — named groups (Groomsmen, Bridesmaids, …), each a list of people
// with an optional role. Shown on the home page after the schedule glimpse.
export const SEED_ENTOURAGE = [
  { id: "ent-sponsors", title: "Principal Sponsors", people: [
    { id: "ent-p1", name: "Mr. & Mrs. Antonio Reyes", role: "" },
    { id: "ent-p2", name: "Dr. & Mrs. Ramon Santos", role: "" },
    { id: "ent-p3", name: "Mr. & Mrs. Eduardo Bautista", role: "" },
  ] },
  { id: "ent-groomsmen", title: "Groomsmen", people: [
    { id: "ent-p4", name: "Mark Reyes", role: "Best Man" },
    { id: "ent-p5", name: "Carlo Santos", role: "" },
    { id: "ent-p6", name: "Paolo Cruz", role: "" },
    { id: "ent-p7", name: "Daniel Ramos", role: "" },
  ] },
  { id: "ent-bridesmaids", title: "Bridesmaids", people: [
    { id: "ent-p8", name: "Camille Bautista", role: "Maid of Honor" },
    { id: "ent-p9", name: "Nicole Flores", role: "" },
    { id: "ent-p10", name: "Andrea Torres", role: "" },
    { id: "ent-p11", name: "Jasmine Cruz", role: "" },
  ] },
];

// Attire guide — groups (Men, Women, Children, …), each with an example image
// and a color palette (array of hex). Shown on the home page after the schedule.
export const SEED_ATTIRE = [
  { id: "att-men", name: "Men", desc: "Black or dark suit, earthy tones.", image: "", palette: ["#1f2410", "#3a4422", "#0e0e0e"] },
  { id: "att-women", name: "Women", desc: "Olive green and soft sage shades.", image: "", palette: ["#6b7a3a", "#4a5320", "#b7a98a"] },
  { id: "att-children", name: "Children", desc: "Beige and neutral tones.", image: "", palette: ["#e6dcc3", "#cbb487", "#b59a6a"] },
];

export const SEED_VENUE_CARDS = [
  { t: "Parking", d: "Complimentary valet and self-parking available at the rear entrance from 2:00 PM." },
  { t: "Arrival", d: "Please arrive by 2:30 PM. The ceremony begins promptly — plan to be seated early." },
  { t: "Weather", d: "The ceremony is outdoors — bring a light layer for the evening breeze." },
];

export const SEED_QUIZ = [
  { id: "q1", type: "multiple_choice", q: "Where did the couple first meet?", options: ["A coffee shop", "A bookshop", "A wedding", "Online"], answer: 1 },
  { id: "q2", type: "multiple_choice", q: "Which city was their first trip together?", options: ["Paris", "Rome", "Lisbon", "Tokyo"], answer: 2 },
  { id: "q3", type: "true_false", q: "Jeremy proposed at sunset.", options: ["True", "False"], answer: 1 },
  { id: "q4", type: "multiple_choice", q: "What pet do they share?", options: ["A dog", "A cat", "A parrot", "None"], answer: 1 },
  { id: "q5", type: "multiple_choice", q: "Who is more likely to be late?", options: ["Jeremy", "Irish", "Both", "Neither"], answer: 0 },
];

export const SEED_GUESTBOOK = [
  { id: "gb1", name: "Eleanor Vance", relationship: "Aunt", message: "I have watched you both grow into the most wonderful pair. Wishing you a lifetime of joy.", status: "visible", createdAt: Date.now() - 86400000 * 5 },
  { id: "gb2", name: "Marcus & Dev", relationship: "College friends", message: "From dorm-room ramen to wedding bells. Couldn't be prouder. Let's party!", status: "visible", createdAt: Date.now() - 86400000 * 3 },
  { id: "gb3", name: "Priya Anand", relationship: "Coworker", message: "Congratulations to the loveliest couple. May your story keep getting better.", status: "visible", createdAt: Date.now() - 86400000 * 1 },
];

export const SEED_RSVPS = [  { id: "r1", fullName: "Eleanor Vance", email: "eleanor@example.com", phone: "555-0142", status: "attending", count: 2, plusOne: "George Vance", diet: "Vegetarian", dietNotes: "", song: "At Last \u2014 Etta James", notes: "Can't wait!", createdAt: Date.now() - 86400000 * 6 },
  { id: "r2", fullName: "Marcus Bell", email: "marcus@example.com", phone: "555-0199", status: "attending", count: 1, plusOne: "", diet: "None", dietNotes: "", song: "September \u2014 EW&F", notes: "", createdAt: Date.now() - 86400000 * 4 },
  { id: "r3", fullName: "Priya Anand", email: "priya@example.com", phone: "", status: "maybe", count: 1, plusOne: "", diet: "Vegan", dietNotes: "", song: "", notes: "Will confirm by July.", createdAt: Date.now() - 86400000 * 2 },
  { id: "r4", fullName: "Tom Okafor", email: "tom@example.com", phone: "555-0177", status: "not_attending", count: 0, plusOne: "", diet: "None", dietNotes: "", song: "", notes: "So sorry to miss it!", createdAt: Date.now() - 86400000 * 1 },
];

export const SEED_MEDIA = [
  { id: "m1", type: "photo", category: "gallery", dataUrl: "/assets/samples/g1.png", name: "Eleanor V.", message: "Golden hour on the lawn.", status: "approved", ratio: "3 / 4", createdAt: Date.now() - 3600000 * 9 },
  { id: "m2", type: "photo", category: "gallery", dataUrl: "/assets/samples/g2.png", name: "Marcus B.", message: "The garden looked unreal.", status: "approved", ratio: "4 / 3", createdAt: Date.now() - 3600000 * 8 },
  { id: "m3", type: "video", category: "gallery", dataUrl: "/assets/samples/g3.png", src: null, name: "Priya A.", message: "Toast time! 🥂", status: "approved", ratio: "4 / 3", createdAt: Date.now() - 3600000 * 7 },
  { id: "m4", type: "photo", category: "gallery", dataUrl: "/assets/samples/g4.png", name: "Sofia R.", message: "Petals everywhere.", status: "approved", ratio: "1 / 1", createdAt: Date.now() - 3600000 * 6 },
  { id: "m5", type: "photo", category: "gallery", dataUrl: "/assets/samples/g5.png", name: "Daniel K.", message: "Cheers to the happy couple.", status: "approved", ratio: "3 / 4", createdAt: Date.now() - 3600000 * 5 },
  { id: "m6", type: "photo", category: "gallery", dataUrl: "/assets/samples/g6.png", name: "Tom O.", message: "Dusk over the courtyard.", status: "approved", ratio: "4 / 3", createdAt: Date.now() - 3600000 * 4 },
  { id: "m7", type: "photo", category: "gallery", dataUrl: "/assets/samples/g7.png", name: "Hana M.", message: "", status: "approved", ratio: "1 / 1", createdAt: Date.now() - 3600000 * 3 },
  { id: "m8", type: "photo", category: "gallery", dataUrl: "/assets/samples/g8.png", name: "Leo F.", message: "First dance!", status: "approved", ratio: "3 / 4", createdAt: Date.now() - 3600000 * 2 },
  { id: "m9", type: "photo", category: "gallery", dataUrl: "/assets/samples/g9.png", name: "Aunt Rosa", message: "Sparkler send-off.", status: "pending", ratio: "4 / 3", createdAt: Date.now() - 3600000 * 1 },
];

export function defaultState() {
  return {
    settings: { ...DEFAULT_SETTINGS },
    schedule: SEED_SCHEDULE,
    story: SEED_STORY,
    faq: SEED_FAQ,
    quiz: SEED_QUIZ,
    venueCards: SEED_VENUE_CARDS,
    detailCards: SEED_DETAIL_CARDS,
    entourage: SEED_ENTOURAGE,
    attire: SEED_ATTIRE, // attire-guide groups: { id, name, image, palette:[hex] }
    playlist: [], // music tracks: { id, url, title, artist } (audio in Supabase Storage)
    guestbook: SEED_GUESTBOOK,
    rsvps: SEED_RSVPS,
    guests: [], // owner-managed invited list (server-owned; loaded from DB in admin)
    media: SEED_MEDIA, // {id, type:'photo'|'video', category, dataUrl, src, name, message, status, size, ratio, createdAt}
    quizSubs: [], // {id, name, score, total, answers, createdAt}
    clientId: null,
    loading: true,
    // true when the requested subdomain has no active client (deleted / never
    // existed / deactivated) — the app shows an "unavailable" page, not seed content.
    notFound: false,
    auth: { ready: false, session: null, role: null, clientId: null, email: null },
  };
}

// ---- Store core ------------------------------------------------------------
export function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    // shallow-merge so new seed fields appear for older saves
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings || {}) },
      // Identity / tenant / session are SERVER-derived every boot — never restore
      // them from localStorage. A persisted clientId would otherwise keep a
      // superadmin "inside" the last client they edited, even on the apex hub.
      clientId: null,
      notFound: false,
      loading: true,
      auth: { ready: false, session: null, role: null, clientId: null, email: null },
    };
  } catch (e) {
    return defaultState();
  }
}

export let _state = loadState();
export const _subs = new Set();

export function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(_state));
  } catch (e) {
    console.warn("persist failed (likely storage full):", e);
  }
}

export function emit() {
  _subs.forEach((fn) => fn(_state));
}

export const Store = {
  get: () => _state,
  subscribe(fn) {
    _subs.add(fn);
    return () => _subs.delete(fn);
  },
  set(patch) {
    _state = { ..._state, ...(typeof patch === "function" ? patch(_state) : patch) };
    persist();
    emit();
  },
  hydrate(patch) {
    _state = {
      ..._state,
      // server-owned, per-tenant: reset on every boot so stale localStorage
      // echoes / demo seeds from another client never bleed in
      rsvps: [], quizSubs: [], guests: [],
      ...patch,
      settings: { ..._state.settings, ...(patch.settings || {}) },
      loading: false,
    };
    emit(); // do NOT persist hydrated server data to localStorage
  },
  setAuth(auth) {
    _state = { ..._state, auth: { ready: true, ...auth } };
    emit(); // session is not persisted to localStorage; Supabase manages it
  },
  // Replace admin submission lists with rows loaded from Supabase (owner/superadmin
  // admin views). Server-owned data — not persisted to localStorage.
  setSubmissions({ rsvps, guestbook, quizSubs, guests }) {
    _state = {
      ..._state,
      ...(rsvps !== undefined ? { rsvps } : {}),
      ...(guestbook !== undefined ? { guestbook } : {}),
      ...(quizSubs !== undefined ? { quizSubs } : {}),
      ...(guests !== undefined ? { guests } : {}),
    };
    emit();
  },
  updateSettings(patch) {
    _state = { ..._state, settings: { ..._state.settings, ...patch } };
    persist();
    emit();
  },
  // Ephemeral, in-memory settings change — theme/decoration PREVIEW for public
  // demo visitors. Deliberately does NOT persist() to localStorage, so it never
  // overrides the saved theme and reverts to the client's settings on refresh.
  // (Admins use updateSettings + saveClientData to actually save.)
  previewSettings(patch) {
    _state = { ..._state, settings: { ..._state.settings, ...patch } };
    emit();
  },
  addRSVP(rsvp) {
    _state = { ..._state, rsvps: [{ ...rsvp, id: uid(), createdAt: Date.now() }, ..._state.rsvps] };
    persist();
    emit();
  },
  deleteRSVP(id) {
    _state = { ..._state, rsvps: _state.rsvps.filter((r) => r.id !== id) };
    persist();
    emit();
  },
  addGuest(guest) {
    _state = { ..._state, guests: [{ ...guest }, ...(_state.guests || [])] };
    persist();
    emit();
  },
  updateGuest(id, patch) {
    _state = { ..._state, guests: (_state.guests || []).map((g) => (g.id === id ? { ...g, ...patch } : g)) };
    persist();
    emit();
  },
  deleteGuest(id) {
    _state = { ..._state, guests: (_state.guests || []).filter((g) => g.id !== id) };
    persist();
    emit();
  },
  addGuestbook(entry) {
    _state = { ..._state, guestbook: [{ ...entry, id: entry.id || uid(), status: entry.status || "visible", createdAt: entry.createdAt || Date.now() }, ..._state.guestbook] };
    persist();
    emit();
  },
  setGuestbookStatus(id, status) {
    _state = { ..._state, guestbook: _state.guestbook.map((g) => (g.id === id ? { ...g, status } : g)) };
    persist();
    emit();
  },
  deleteGuestbook(id) {
    _state = { ..._state, guestbook: _state.guestbook.filter((g) => g.id !== id) };
    persist();
    emit();
  },
  addMedia(items) {
    const withIds = items.map((m) => ({ ...m, id: uid(), createdAt: Date.now() }));
    _state = { ..._state, media: [...withIds, ..._state.media] };
    persist();
    emit();
  },
  setMediaStatus(id, status) {
    _state = { ..._state, media: _state.media.map((m) => (m.id === id ? { ...m, status } : m)) };
    persist();
    emit();
  },
  deleteMedia(id) {
    _state = { ..._state, media: _state.media.filter((m) => m.id !== id) };
    persist();
    emit();
  },
  addQuizSub(sub) {
    _state = { ..._state, quizSubs: [{ ...sub, id: uid(), createdAt: Date.now() }, ..._state.quizSubs] };
    persist();
    emit();
  },
  updateStory(story) {
    _state = { ..._state, story };
    persist();
    emit();
  },  updateStoryItem(index, patch) {
    _state = { ..._state, story: _state.story.map((s, i) => (i === index ? { ...s, ...patch } : s)) };
    persist();
    emit();
  },
  addQuizQuestion(q) {
    _state = { ..._state, quiz: [..._state.quiz, { ...q, id: uid() }] };
    persist();
    emit();
  },
  updateQuizQuestion(id, patch) {
    _state = { ..._state, quiz: _state.quiz.map((q) => (q.id === id ? { ...q, ...patch } : q)) };
    persist();
    emit();
  },
  deleteQuizQuestion(id) {
    _state = { ..._state, quiz: _state.quiz.filter((q) => q.id !== id) };
    persist();
    emit();
  },
  moveQuizQuestion(id, dir) {
    const arr = [..._state.quiz];
    const i = arr.findIndex((q) => q.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    _state = { ..._state, quiz: arr };
    persist();
    emit();
  },
  // Move question `fromId` to the position currently held by `toId` (drag reorder).
  reorderQuizQuestion(fromId, toId) {
    if (fromId === toId) return;
    const arr = [..._state.quiz];
    const from = arr.findIndex((q) => q.id === fromId);
    const to = arr.findIndex((q) => q.id === toId);
    if (from < 0 || to < 0) return;
    const [m] = arr.splice(from, 1);
    arr.splice(to, 0, m);
    _state = { ..._state, quiz: arr };
    persist();
    emit();
  },
  updateSchedule(schedule) {
    _state = { ..._state, schedule };
    persist();
    emit();
  },
  updateScheduleItem(index, patch) {
    _state = { ..._state, schedule: _state.schedule.map((s, i) => (i === index ? { ...s, ...patch } : s)) };
    persist();
    emit();
  },
  moveSchedule(index, dir) {
    const arr = [..._state.schedule];
    const j = index + dir;
    if (index < 0 || j < 0 || j >= arr.length) return;
    [arr[index], arr[j]] = [arr[j], arr[index]];
    _state = { ..._state, schedule: arr };
    persist();
    emit();
  },
  updateVenueCards(venueCards) {
    _state = { ..._state, venueCards };
    persist();
    emit();
  },
  updateVenueCard(index, patch) {
    _state = { ..._state, venueCards: (_state.venueCards || []).map((c, i) => (i === index ? { ...c, ...patch } : c)) };
    persist();
    emit();
  },
  moveVenueCard(index, dir) {
    const arr = [...(_state.venueCards || [])];
    const j = index + dir;
    if (index < 0 || j < 0 || j >= arr.length) return;
    [arr[index], arr[j]] = [arr[j], arr[index]];
    _state = { ..._state, venueCards: arr };
    persist();
    emit();
  },
  updateFaq(faq) {
    _state = { ..._state, faq };
    persist();
    emit();
  },
  updateFaqItem(index, patch) {
    _state = { ..._state, faq: (_state.faq || []).map((f, i) => (i === index ? { ...f, ...patch } : f)) };
    persist();
    emit();
  },
  moveFaq(index, dir) {
    const arr = [...(_state.faq || [])];
    const j = index + dir;
    if (index < 0 || j < 0 || j >= arr.length) return;
    [arr[index], arr[j]] = [arr[j], arr[index]];
    _state = { ..._state, faq: arr };
    persist();
    emit();
  },
  updateDetailCards(detailCards) {
    _state = { ..._state, detailCards };
    persist();
    emit();
  },
  updateDetailCard(index, patch) {
    _state = { ..._state, detailCards: (_state.detailCards || []).map((c, i) => (i === index ? { ...c, ...patch } : c)) };
    persist();
    emit();
  },
  moveDetailCard(index, dir) {
    const arr = [...(_state.detailCards || [])];
    const j = index + dir;
    if (index < 0 || j < 0 || j >= arr.length) return;
    [arr[index], arr[j]] = [arr[j], arr[index]];
    _state = { ..._state, detailCards: arr };
    persist();
    emit();
  },
  // ---- Entourage: groups of people (id-based ops) ----
  addEntourageGroup(title) {
    _state = { ..._state, entourage: [...(_state.entourage || []), { id: uid(), title: title || "New group", people: [] }] };
    persist(); emit();
  },
  updateEntourageGroup(gid, patch) {
    _state = { ..._state, entourage: (_state.entourage || []).map((g) => (g.id === gid ? { ...g, ...patch } : g)) };
    persist(); emit();
  },
  deleteEntourageGroup(gid) {
    _state = { ..._state, entourage: (_state.entourage || []).filter((g) => g.id !== gid) };
    persist(); emit();
  },
  moveEntourageGroup(gid, dir) {
    const arr = [...(_state.entourage || [])];
    const i = arr.findIndex((g) => g.id === gid), j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    _state = { ..._state, entourage: arr };
    persist(); emit();
  },
  addEntouragePerson(gid, person) {
    _state = { ..._state, entourage: (_state.entourage || []).map((g) => (g.id === gid ? { ...g, people: [...(g.people || []), { id: uid(), name: (person && person.name) || "", role: (person && person.role) || "" }] } : g)) };
    persist(); emit();
  },
  updateEntouragePerson(gid, pid, patch) {
    _state = { ..._state, entourage: (_state.entourage || []).map((g) => (g.id === gid ? { ...g, people: (g.people || []).map((p) => (p.id === pid ? { ...p, ...patch } : p)) } : g)) };
    persist(); emit();
  },
  deleteEntouragePerson(gid, pid) {
    _state = { ..._state, entourage: (_state.entourage || []).map((g) => (g.id === gid ? { ...g, people: (g.people || []).filter((p) => p.id !== pid) } : g)) };
    persist(); emit();
  },
  moveEntouragePerson(gid, pid, dir) {
    _state = { ..._state, entourage: (_state.entourage || []).map((g) => {
      if (g.id !== gid) return g;
      const arr = [...(g.people || [])];
      const i = arr.findIndex((p) => p.id === pid), j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return g;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...g, people: arr };
    }) };
    persist(); emit();
  },
  // ---- Attire guide (groups with an example image + a color palette) ----
  addAttireGroup(group) {
    _state = { ..._state, attire: [...(_state.attire || []), { id: uid(), name: (group && group.name) || "New group", desc: (group && group.desc) || "", image: (group && group.image) || "", palette: (group && group.palette) || [] }] };
    persist(); emit();
  },
  updateAttireGroup(id, patch) {
    _state = { ..._state, attire: (_state.attire || []).map((g) => (g.id === id ? { ...g, ...patch } : g)) };
    persist(); emit();
  },
  deleteAttireGroup(id) {
    _state = { ..._state, attire: (_state.attire || []).filter((g) => g.id !== id) };
    persist(); emit();
  },
  moveAttireGroup(id, dir) {
    const arr = [...(_state.attire || [])];
    const i = arr.findIndex((g) => g.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    _state = { ..._state, attire: arr };
    persist(); emit();
  },
  // ---- Music playlist (audio in Supabase Storage; rows hold url+title+artist) ----
  addTrack(track) {
    _state = { ..._state, playlist: [...(_state.playlist || []), { id: uid(), url: track.url, title: track.title || "Untitled", artist: track.artist || "" }] };
    persist(); emit();
  },
  updateTrack(id, patch) {
    _state = { ..._state, playlist: (_state.playlist || []).map((t) => (t.id === id ? { ...t, ...patch } : t)) };
    persist(); emit();
  },
  deleteTrack(id) {
    _state = { ..._state, playlist: (_state.playlist || []).filter((t) => t.id !== id) };
    persist(); emit();
  },
  moveTrack(id, dir) {
    const arr = [...(_state.playlist || [])];
    const i = arr.findIndex((t) => t.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    _state = { ..._state, playlist: arr };
    persist(); emit();
  },
  resetAll() {
    _state = defaultState();
    persist();
    emit();
  },
};

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// React hook: subscribe a component to the whole store
export function useStore() {
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => Store.subscribe(() => force()), []);
  return Store.get();
}

