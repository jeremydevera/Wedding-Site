import { describe, it, expect, vi, afterEach } from "vitest";

// All tickets + site requests now live on Neon (the Data API has no realtime
// channel), so every subscriber POLLS and returns an unsubscribe fn. These guard
// that each call returns an independent cleanup function (coexist + stop clean)
// and that it actually polls the callback.
import {
  subscribeTicketsRealtime,
  subscribeSiteRequestsRealtime,
  subscribeTicketMessagesRealtime,
  subscribeAllTicketMessagesRealtime,
} from "@/lib/api.js";

describe("realtime subscriptions (poll-based, post-Supabase)", () => {
  afterEach(() => vi.useRealTimers());

  it("each subscriber returns an independent unsubscribe function", () => {
    const offs = [
      subscribeTicketsRealtime(() => {}),
      subscribeSiteRequestsRealtime(() => {}),
      subscribeTicketMessagesRealtime("t1", () => {}),
      subscribeAllTicketMessagesRealtime(() => {}),
    ];
    for (const off of offs) expect(typeof off).toBe("function");
    offs.forEach((o) => o()); // cleanup never throws
  });

  it("polls the callback on an interval and stops after unsubscribe", () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    const off = subscribeTicketsRealtime(cb);
    vi.advanceTimersByTime(20000);
    expect(cb).toHaveBeenCalled();
    const calls = cb.mock.calls.length;
    off();
    vi.advanceTimersByTime(40000);
    expect(cb.mock.calls.length).toBe(calls); // no more polls after cleanup
  });
});
