import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Chainable query stub so the debounced loadAdminData() re-fetch resolves.
const query = {
  select: vi.fn(() => query),
  eq: vi.fn(() => query),
  order: vi.fn(() => Promise.resolve({ data: [], error: null })),
};
const channel = {
  on: vi.fn(() => channel),
  subscribe: vi.fn(() => channel),
};
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(),
    from: vi.fn(() => query),
  },
}));
vi.mock("@/lib/store.jsx", async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, Store: { ...mod.Store, get: () => ({ clientId: "c1", settings: {} }), setSubmissions: vi.fn() } };
});

import { subscribeAdminRealtime } from "@/lib/api.js";
import { supabase } from "@/lib/supabase.js";

describe("subscribeAdminRealtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("opens one channel with INSERT listeners on the three activity tables, scoped to the client", () => {
    const off = subscribeAdminRealtime();
    expect(supabase.channel).toHaveBeenCalledWith("admin-feed-c1");
    expect(channel.on).toHaveBeenCalledTimes(3);
    const tables = channel.on.mock.calls.map(([, opts]) => opts.table).sort();
    expect(tables).toEqual(["guestbook", "quiz_answers", "rsvps"]);
    for (const [kind, opts] of channel.on.mock.calls) {
      expect(kind).toBe("postgres_changes");
      expect(opts.event).toBe("INSERT");
      expect(opts.filter).toBe("client_id=eq.c1");
    }
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
    expect(typeof off).toBe("function");
  });

  it("debounces a burst of events into one re-fetch", async () => {
    subscribeAdminRealtime();
    const handler = channel.on.mock.calls[0][2];
    handler(); handler(); handler(); // burst
    expect(supabase.from).not.toHaveBeenCalled(); // nothing until the debounce fires
    await vi.advanceTimersByTimeAsync(450);
    // one loadAdminData() pass = one query per admin table (rsvps/guestbook/quiz/guests)
    expect(supabase.from).toHaveBeenCalledTimes(4);
  });

  it("cleanup removes the channel and cancels a pending re-fetch", async () => {
    const off = subscribeAdminRealtime();
    const handler = channel.on.mock.calls[0][2];
    handler();
    off();
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
    await vi.advanceTimersByTimeAsync(1000);
    expect(supabase.from).not.toHaveBeenCalled(); // pending debounce was cancelled
  });
});
