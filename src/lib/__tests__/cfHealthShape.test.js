import { describe, it, expect } from "vitest";
import { shapeHealth } from "../../../functions/api/_cf-health-shape.js";

// Fixture mirrors the REAL Cloudflare GraphQL response shape (aliased fields),
// captured live from the account during design. Values trimmed for clarity.
const RESULT = {
  viewer: {
    accounts: [
      {
        workers: [
          { dimensions: { scriptName: "celebrately-router", date: "2026-07-05" }, sum: { requests: 40258, errors: 0 } },
          { dimensions: { scriptName: "celebrately-router", date: "2026-07-06" }, sum: { requests: 24071, errors: 0 } },
          { dimensions: { scriptName: "celebrately-router", date: "2026-07-07" }, sum: { requests: 138020, errors: 2 } },
          { dimensions: { scriptName: "some-other-worker", date: "2026-07-07" }, sum: { requests: 500, errors: 0 } },
        ],
        pages: [
          { dimensions: { date: "2026-07-06" }, sum: { requests: 119, errors: 0 } },
          { dimensions: { date: "2026-07-07" }, sum: { requests: 22212, errors: 1 } },
        ],
        r2storage: [
          { dimensions: { bucketName: "celebrately-medias" }, max: { objectCount: 26, payloadSize: 45263797, metadataSize: 743 } },
          { dimensions: { bucketName: "redrecon-media" }, max: { objectCount: 0, payloadSize: 0, metadataSize: 0 } },
        ],
        r2ops: [
          { dimensions: { actionType: "ListObjects" }, sum: { requests: 12 } },
          { dimensions: { actionType: "GetObject" }, sum: { requests: 88 } },
        ],
      },
    ],
    zones: [
      {
        http: [
          { dimensions: { date: "2026-07-06" }, sum: { requests: 24533, cachedRequests: 30, responseStatusMap: [{ edgeResponseStatus: 200, requests: 23582 }] } },
          {
            dimensions: { date: "2026-07-07" },
            sum: {
              requests: 158524,
              cachedRequests: 494,
              responseStatusMap: [
                { edgeResponseStatus: 200, requests: 109700 },
                { edgeResponseStatus: 304, requests: 27969 },
                { edgeResponseStatus: 429, requests: 4098 },
                { edgeResponseStatus: 502, requests: 11 },
              ],
            },
          },
        ],
      },
    ],
  },
};

const OPTS = { today: "2026-07-07", monthStart: "2026-07-01", limitMonth: 10_000_000, routerScript: "celebrately-router", primaryBucket: "celebrately-medias", updatedAt: "2026-07-07T12:00:00Z" };

describe("shapeHealth", () => {
  const h = shapeHealth(RESULT, OPTS);

  it("marks the payload configured and stamps updatedAt", () => {
    expect(h.configured).toBe(true);
    expect(h.updatedAt).toBe("2026-07-07T12:00:00Z");
    expect(h.limitMonth).toBe(10_000_000);
  });

  it("sums router (celebrately-router only) today and month-to-date", () => {
    expect(h.router.today).toBe(138020);
    expect(h.router.month).toBe(202349); // 40258 + 24071 + 138020, excludes some-other-worker
  });

  it("sums Pages Functions today and month", () => {
    expect(h.functions.today).toBe(22212);
    expect(h.functions.month).toBe(22331); // 119 + 22212
  });

  it("reports the primary R2 bucket storage + total ops today", () => {
    expect(h.r2.objects).toBe(26);
    expect(h.r2.storageBytes).toBe(45263797);
    expect(h.r2.opsToday).toBe(100); // 12 + 88
  });

  it("computes zone requests, cache-hit %, and 5xx for today", () => {
    expect(h.zone.reqToday).toBe(158524);
    expect(h.zone.cacheHitPct).toBe(0.3); // 494 / 158524 * 100, 1 dp
    expect(h.zone.err5xx).toBe(11); // only the 502
  });

  it("returns top status codes for today, busiest first", () => {
    expect(h.zone.status[0]).toEqual({ code: 200, count: 109700 });
    expect(h.zone.status.find((s) => s.code === 429)).toEqual({ code: 429, count: 4098 });
  });

  it("builds a 7-day series ending today, zero-filled for missing days", () => {
    expect(h.series).toHaveLength(7);
    expect(h.series[6]).toEqual({ date: "2026-07-07", router: 138020, functions: 22212 });
    expect(h.series[0]).toEqual({ date: "2026-07-01", router: 0, functions: 0 });
  });

  it("computes month usage as a percentage of the limit", () => {
    expect(h.pctMonth).toBeCloseTo(2.02, 1); // 202349 / 10_000_000 * 100
  });

  it("degrades to zeros (never throws) on an empty/partial response", () => {
    const empty = shapeHealth({ viewer: { accounts: [{}], zones: [{}] } }, OPTS);
    expect(empty.configured).toBe(true);
    expect(empty.router.today).toBe(0);
    expect(empty.zone.reqToday).toBe(0);
    expect(empty.r2.objects).toBe(0);
    expect(empty.series).toHaveLength(7);
  });
});
