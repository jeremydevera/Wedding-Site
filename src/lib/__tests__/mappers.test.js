import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, SEED_SCHEDULE } from "@/lib/store.jsx";
import { clientToState, rsvpToRow, guestbookToRow, quizToRow, rowToGuestbook, rowToRsvp, rowToQuizSub } from "@/lib/mappers.js";

describe("clientToState", () => {
  it("maps template_key->settings.theme and event_type->eventType, falls back to defaults", () => {
    const st = clientToState({
      id: "c1", subdomain: "demo", event_type: "wedding", template_key: "envelope",
      theme: { themeAccent: "#abc" }, content: { partnerA: "Al", partnerB: "Bo" },
    });
    expect(st.clientId).toBe("c1");
    expect(st.settings.theme).toBe("envelope");
    expect(st.settings.eventType).toBe("wedding");
    expect(st.settings.themeAccent).toBe("#abc");
    expect(st.settings.partnerA).toBe("Al");
    // unspecified field falls back to default
    expect(st.settings.tagline).toBe(DEFAULT_SETTINGS.tagline);
    // arrays fall back to seed when content lacks them
    expect(st.schedule).toEqual(SEED_SCHEDULE);
  });
  it("uses content arrays when present", () => {
    const st = clientToState({ id: "c1", subdomain: "d", event_type: "wedding", template_key: "classic",
      theme: {}, content: { schedule: [{ time: "1", title: "x", desc: "", loc: "" }] } });
    expect(st.schedule).toHaveLength(1);
  });
});

describe("rsvpToRow", () => {
  it("maps camelCase form -> snake_case columns + client_id", () => {
    expect(rsvpToRow({ fullName: "Jane", phone: "5", status: "attending", count: 2,
      plusOne: "Bob", diet: "Vegan", dietNotes: "", song: "s", notes: "n" }, "c1")).toEqual({
      client_id: "c1", full_name: "Jane", phone: "5", status: "attending", count: 2,
      plus_one: "Bob", diet: "Vegan", diet_notes: "", song: "s", notes: "n",
    });
  });
});

describe("guestbookToRow", () => {
  it("includes client_id + status", () => {
    expect(guestbookToRow({ name: "A", relationship: "Aunt", message: "hi" }, "c1", "approved"))
      .toEqual({ client_id: "c1", name: "A", relationship: "Aunt", message: "hi", status: "approved" });
  });
});

describe("quizToRow", () => {
  it("maps score/total/answers", () => {
    expect(quizToRow({ name: "A", score: 3, total: 5, answers: { q1: 1 } }, "c1"))
      .toEqual({ client_id: "c1", name: "A", score: 3, total: 5, answers: { q1: 1 } });
  });
});

describe("rowToGuestbook", () => {
  it("maps DB row to app guestbook entry with status 'visible'", () => {
    const e = rowToGuestbook({ id: "g1", name: "A", relationship: "Aunt", message: "hi",
      status: "approved", created_at: "2026-01-01T00:00:00Z" });
    expect(e.id).toBe("g1");
    expect(e.status).toBe("visible");
    expect(typeof e.createdAt).toBe("number");
  });
  it("maps DB status -> app status (approved->visible, pending->pending, hidden->hidden)", () => {
    expect(rowToGuestbook({ id: "g", status: "approved" }).status).toBe("visible");
    expect(rowToGuestbook({ id: "g", status: "pending" }).status).toBe("pending");
    expect(rowToGuestbook({ id: "g", status: "hidden" }).status).toBe("hidden");
    // public site filters on status === "visible", so only approved rows render live
  });
});

describe("rowToRsvp", () => {
  it("maps snake_case columns -> camelCase form", () => {
    const r = rowToRsvp({ id: "r1", full_name: "Jane", phone: "5", status: "attending", count: 2,
      plus_one: "Bob", diet: "Vegan", diet_notes: "no nuts", song: "s", notes: "n",
      created_at: "2026-01-01T00:00:00Z" });
    expect(r).toMatchObject({ id: "r1", fullName: "Jane", phone: "5", status: "attending",
      count: 2, plusOne: "Bob", diet: "Vegan", dietNotes: "no nuts", song: "s", notes: "n" });
    expect(typeof r.createdAt).toBe("number");
  });
});

describe("rowToQuizSub", () => {
  it("maps score/total/answers + createdAt", () => {
    const q = rowToQuizSub({ id: "q1", name: "A", score: 3, total: 5, answers: { q1: 1 },
      created_at: "2026-01-01T00:00:00Z" });
    expect(q).toMatchObject({ id: "q1", name: "A", score: 3, total: 5, answers: { q1: 1 } });
    expect(typeof q.createdAt).toBe("number");
  });
});
