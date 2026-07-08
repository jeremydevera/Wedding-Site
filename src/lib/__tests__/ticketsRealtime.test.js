import { describe, it, expect, vi } from "vitest";

// Regression (Bug 0009 / DEFECT-2026-07-09-B): two live subscribers (bell +
// Clients console) with the SAME channel topic crash supabase-js ("cannot add
// postgres_changes callbacks after subscribe()") and white-screen the console.
// Each subscribeTicketsRealtime call must open a channel with a UNIQUE topic.
const topics = [];
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    channel: (name) => { topics.push(name); return { on() { return this; }, subscribe() { return this; } }; },
    removeChannel: () => {},
  },
}));

import { subscribeTicketsRealtime } from "@/lib/api.js";

describe("subscribeTicketsRealtime", () => {
  it("uses a unique channel topic per subscription (bell + console can coexist)", () => {
    const off1 = subscribeTicketsRealtime(() => {});
    const off2 = subscribeTicketsRealtime(() => {});
    expect(topics.length).toBe(2);
    expect(topics[0]).not.toBe(topics[1]);
    off1(); off2();
  });
});
