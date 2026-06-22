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
  venueName: "Somewhere in Lipa, Batangas",
  venueAddress: "Lipa, Batangas, Philippines",
  ceremonyTime: "3:00 PM",
  receptionTime: "5:30 PM",
  dressCode: "Garden formal \u2014 think soft suits and flowing dresses.",
  rsvpDeadline: "August 15, 2026",
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
  arrangeEnabled: false,
  mapQuery: "Lipa, Batangas, Philippines",
  decorOn: false,
  decorStyle: "petals",
  butterflyStyle: "fullcolor",
  butterflyColor: "#5aa9e6",
  butterflyFlight: "flutter",
  butterflyCount: 12,
  scheduleStyle: "line",
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
    guestbook: SEED_GUESTBOOK,
    rsvps: SEED_RSVPS,
    media: SEED_MEDIA, // {id, type:'photo'|'video', category, dataUrl, src, name, message, status, size, ratio, createdAt}
    quizSubs: [], // {id, name, score, total, answers, createdAt}
    clientId: null,
    loading: true,
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
      ...patch,
      settings: { ..._state.settings, ...(patch.settings || {}) },
      loading: false,
    };
    emit(); // do NOT persist hydrated server data to localStorage
  },
  updateSettings(patch) {
    _state = { ..._state, settings: { ..._state.settings, ...patch } };
    persist();
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
  addGuestbook(entry) {
    _state = { ..._state, guestbook: [{ ...entry, id: uid(), status: entry.status || "visible", createdAt: Date.now() }, ..._state.guestbook] };
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

