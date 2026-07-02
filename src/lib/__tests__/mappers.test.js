import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, SEED_SCHEDULE } from "@/lib/store.jsx";
import { clientToState, stateToClientRow, rsvpToRow, guestbookToRow, quizToRow, rowToGuestbook, rowToRsvp, rowToQuizSub, guestToRow, rowToGuest } from "@/lib/mappers.js";

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

describe("stateToClientRow (reverse of clientToState)", () => {
  it("round-trips template_key / event_type / content + clears theme col", () => {
    const row = { id: "c1", subdomain: "demo", event_type: "wedding", template_key: "glass",
      theme: {}, content: { partnerA: "Al", partnerB: "Bo", schedule: [{ time: "1", title: "x", desc: "", loc: "" }] } };
    const back = stateToClientRow(clientToState(row));
    expect(back.template_key).toBe("glass");
    expect(back.event_type).toBe("wedding");
    expect(back.content.partnerA).toBe("Al");
    expect(back.content.schedule).toHaveLength(1);
    expect(back.theme).toEqual({}); // tokens live in content; column kept empty
  });
});

describe("rsvpToRow", () => {
  it("maps camelCase form -> snake_case columns + client_id, including email", () => {
    expect(rsvpToRow({ fullName: "Jane", email: "jane@ex.com", phone: "5", status: "attending", count: 2,
      plusOne: "Bob", diet: "Vegan", dietNotes: "", song: "s", notes: "n" }, "c1")).toMatchObject({
      client_id: "c1", full_name: "Jane", email: "jane@ex.com", phone: "5", status: "attending", count: 2,
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
  it("maps snake_case columns -> camelCase form, including email", () => {
    const r = rowToRsvp({ id: "r1", full_name: "Jane", email: "jane@ex.com", phone: "5", status: "attending", count: 2,
      plus_one: "Bob", diet: "Vegan", diet_notes: "no nuts", song: "s", notes: "n",
      created_at: "2026-01-01T00:00:00Z" });
    expect(r).toMatchObject({ id: "r1", fullName: "Jane", email: "jane@ex.com", phone: "5", status: "attending",
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

describe("guestToRow", () => {
  it("maps camelCase guest -> snake_case columns + client_id", () => {
    expect(guestToRow({ firstName: "Jeremy", lastName: "Reyes", middleName: "P",
      allocation: 2, email: "j@ex.com", notes: "college" }, "c1")).toEqual({
      client_id: "c1", first_name: "Jeremy", last_name: "Reyes", middle_name: "P",
      allocation: 2, email: "j@ex.com", notes: "college",
      status: "attending", // owner-added guests count as attending by default
    });
  });
});

describe("rowToGuest", () => {
  it("maps snake_case row -> camelCase guest with numeric createdAt", () => {
    const g = rowToGuest({ id: "g1", first_name: "Jeremy", last_name: "Reyes", middle_name: "P",
      allocation: 2, email: "j@ex.com", notes: "college", created_at: "2026-01-01T00:00:00Z" });
    expect(g).toMatchObject({ id: "g1", firstName: "Jeremy", lastName: "Reyes", middleName: "P",
      allocation: 2, email: "j@ex.com", notes: "college" });
    expect(typeof g.createdAt).toBe("number");
  });
});

describe("rowToRsvp name parts", () => {
  it("exposes first/middle/last so guests can be matched", () => {
    const r = rowToRsvp({ id: "r1", full_name: "Jeremy P Reyes", first_name: "Jeremy",
      middle_name: "P", last_name: "Reyes", status: "attending", count: 2 });
    expect(r).toMatchObject({ firstName: "Jeremy", middleName: "P", lastName: "Reyes" });
  });
});
