// Pure transformer: Cloudflare GraphQL Analytics response -> the compact payload
// the superadmin Health tab renders. NO network, NO env, NO Cloudflare bindings —
// so it is fully unit-testable with a captured fixture (see
// src/lib/__tests__/cfHealthShape.test.js). Imported by functions/api/cf-health.js.
//
// Input `result` is the GraphQL `data` object (Cloudflare's REST wrapper puts it
// under `.result`), using these aliases from the query in cf-health.js:
//   viewer.accounts[0].{ workers, pages, r2storage, r2ops }
//   viewer.zones[0].{ http }
// Every dataset is optional; a missing/partial one degrades to 0/[] and never throws.

const num = (x) => (Number.isFinite(+x) ? +x : 0);
const round1 = (x) => Math.round(x * 10) / 10;

// Sum a metric across rows that pass `pred`. rows may be undefined.
function sumBy(rows, get, pred) {
  let t = 0;
  for (const r of rows || []) if (!pred || pred(r)) t += num(get(r));
  return t;
}

const onDate = (d) => (r) => r?.dimensions?.date === d;
const fromDate = (d) => (r) => (r?.dimensions?.date || "") >= d; // YYYY-MM-DD lexicographic

// Last `days` date strings (YYYY-MM-DD, UTC) ending at `today` inclusive.
function dateSeries(today, days) {
  const out = [];
  const t = new Date(`${today}T00:00:00Z`);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(t);
    d.setUTCDate(t.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function shapeHealth(result, opts = {}) {
  const {
    today,
    monthStart,
    limitMonth = 10_000_000,
    routerScript = "celebrately-router",
    primaryBucket = "celebrately-medias",
    updatedAt,
    days = 7,
  } = opts;

  const acct = result?.viewer?.accounts?.[0] || {};
  const zone = result?.viewer?.zones?.[0] || {};
  const workers = acct.workers || [];
  const pages = acct.pages || [];
  const r2storage = acct.r2storage || [];
  const r2ops = acct.r2ops || [];
  const http = zone.http || [];

  const reqOf = (r) => r?.sum?.requests;
  const isRouter = (r) => r?.dimensions?.scriptName === routerScript;
  const routerRows = workers.filter(isRouter);

  const router = {
    today: sumBy(routerRows, reqOf, onDate(today)),
    month: sumBy(routerRows, reqOf, fromDate(monthStart)),
  };
  const functions = {
    today: sumBy(pages, reqOf, onDate(today)),
    month: sumBy(pages, reqOf, fromDate(monthStart)),
  };

  // R2: current storage of the primary bucket + total ops today (all action types).
  const bucket = r2storage.find((r) => r?.dimensions?.bucketName === primaryBucket) || {};
  const r2 = {
    objects: num(bucket?.max?.objectCount),
    storageBytes: num(bucket?.max?.payloadSize),
    opsToday: sumBy(r2ops, reqOf),
  };

  // Zone: today's row (fall back to the most recent day if today isn't in yet).
  let zoneRow = http.find(onDate(today));
  if (!zoneRow && http.length) {
    zoneRow = [...http].sort((a, b) => (b?.dimensions?.date || "").localeCompare(a?.dimensions?.date || ""))[0];
  }
  const reqToday = num(zoneRow?.sum?.requests);
  const cachedToday = num(zoneRow?.sum?.cachedRequests);
  const statusMap = zoneRow?.sum?.responseStatusMap || [];
  const status = statusMap
    .map((s) => ({ code: num(s.edgeResponseStatus), count: num(s.requests) }))
    .sort((a, b) => b.count - a.count);
  const zoneOut = {
    reqToday,
    cacheHitPct: reqToday > 0 ? round1((cachedToday / reqToday) * 100) : 0,
    err5xx: sumBy(statusMap, (s) => s.requests, (s) => num(s.edgeResponseStatus) >= 500),
    status,
  };

  const series = dateSeries(today, days).map((d) => ({
    date: d,
    router: sumBy(routerRows, reqOf, onDate(d)),
    functions: sumBy(pages, reqOf, onDate(d)),
  }));

  return {
    configured: true,
    updatedAt,
    limitMonth,
    pctMonth: limitMonth > 0 ? round1((router.month / limitMonth) * 100) : 0,
    router,
    functions,
    r2,
    zone: zoneOut,
    series,
  };
}
