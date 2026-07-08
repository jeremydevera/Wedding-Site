import { describe, it, expect } from "vitest";
import { ticketToRow } from "@/lib/mappers.js";

describe("ticketToRow", () => {
  const form = { subject: "Map won't save", category: "Bug", urgency: "High", message: "The pin resets." };
  const ctx = { email: "couple@x.com", partnerA: "Romeo", partnerB: "Juliet", subdomain: "romeo-juliet", tab: "home" };

  it("snapshots submitter + builds the row", () => {
    const r = ticketToRow(form, "c1", ctx);
    expect(r.client_id).toBe("c1");
    expect(r.submitter_email).toBe("couple@x.com");
    expect(r.submitter_name).toBe("Romeo & Juliet");
    expect(r.subject).toBe("Map won't save");
    expect(r.category).toBe("Bug");
    expect(r.urgency).toBe("High");
    expect(r.message).toBe("The pin resets.");
    expect(r.context_url).toBe("romeo-juliet / home");
    expect(r.status).toBe("open");
  });

  it("defaults category=Question, urgency=Normal when missing", () => {
    const r = ticketToRow({ subject: "Hi", message: "Help" }, "c1", { email: "a@x.com" });
    expect(r.category).toBe("Question");
    expect(r.urgency).toBe("Normal");
    expect(r.status).toBe("open");
  });

  it("single-name event: no dangling ampersand in submitter_name", () => {
    const r = ticketToRow({ subject: "s", message: "m" }, "c1", { partnerA: "Leo's 7th Birthday", partnerB: "" });
    expect(r.submitter_name).toBe("Leo's 7th Birthday");
  });
});
