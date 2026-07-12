// ============================================================================
// eventTypes.js — Event-type registry.
//
// The platform serves many kinds of events from one engine. Each event type
// supplies its own terminology, the sections it shows, and which themes apply.
// Adding a new event type (birthday, corporate, …) is purely additive: add an
// entry here, then content/pages read from it. See docs/STRUCTURE.md.
//
// NOTE: "wedding" is fully wired today. "birthday"/"corporate" are scaffolds —
// ready-to-extend examples so the structure scales without a rewrite. The
// wedding-specific copy still lives in the page components; the `terms` tokens
// below are the target for migrating that copy to be event-type-driven.
// ============================================================================

import { THEMES } from "@/themes";

export const EVENT_TYPES = {
  wedding: {
    label: "Wedding",
    terms: { host: "the couple", action: "We're getting married", rsvp: "Will you be there?" },
    sections: ["story", "details", "schedule", "venue", "gallery", "guestbook", "quiz", "rsvp"],
    defaultTheme: "classic",
    themes: ["classic", "classic2", "classic3", "glass", "noir", "garden", "blush", "dusk", "burgundy", "lavender", "emerald", "terracotta", "champagne", "envelope", "envelope2"],
  },

  birthday: {
    label: "Birthday",
    terms: { host: "the celebrant", action: "Let's celebrate!", rsvp: "Can you make it?" },
    // Full section parity with weddings — birthdays RSVP too (the original
    // scaffold omitted rsvp/quiz/story, which left the nav's RSVP button
    // pointing at a "section unavailable" page on birthday sites).
    sections: ["story", "details", "schedule", "venue", "gallery", "guestbook", "quiz", "rsvp"],
    defaultTheme: "blush",
    // All designs EXCEPT "envelope" (Olive Envelope is wedding-only).
    themes: ["classic", "classic2", "classic3", "glass", "noir", "garden", "blush", "dusk", "burgundy", "lavender", "emerald", "terracotta", "champagne"],
  },

  corporate: {
    label: "Corporate Event",
    terms: { host: "the team", action: "You're invited", rsvp: "Will you attend?" },
    sections: ["details", "schedule", "venue", "rsvp", "gallery"],
    defaultTheme: "noir",
    themes: ["noir", "glass", "emerald", "burgundy"],
  },
};

export const DEFAULT_EVENT_TYPE = "wedding";

export function eventType(key) {
  return EVENT_TYPES[key] || EVENT_TYPES[DEFAULT_EVENT_TYPE];
}

// Theme keys allowed for an event type — drives the theme picker in admin.
export function themesForEvent(key) {
  return eventType(key).themes;
}

// Whether a section should render for the active event type.
export function hasSection(key, section) {
  return eventType(key).sections.includes(section);
}

// Dev-only integrity check: every referenced theme key must exist, and each
// defaultTheme must be in its own list. Stripped from production builds.
if (import.meta.env && import.meta.env.DEV) {
  for (const [key, t] of Object.entries(EVENT_TYPES)) {
    const unknown = t.themes.filter((k) => !THEMES[k]);
    if (unknown.length) console.error(`[eventTypes] ${key}: unknown theme keys → ${unknown.join(", ")}`);
    if (!t.themes.includes(t.defaultTheme)) console.error(`[eventTypes] ${key}: defaultTheme "${t.defaultTheme}" not in its themes list`);
  }
}
