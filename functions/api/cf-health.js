// functions/api/cf-health.js
// Cloudflare Pages Function — GET /api/cf-health
// Superadmin-only. Proxies the Cloudflare GraphQL Analytics API server-side (the
// read-only token lives in env.CF_ANALYTICS_TOKEN, never in the browser) and
// returns a compact health payload for the superadmin Health tab. Scoped to
// /api/* via _routes.json. Result is edge-cached 5 min so CF's API is hit at most
// ~once per 5 min no matter how many superadmins refresh.

import { shapeHealth, countBuildsThisMonth } from "./_cf-health-shape.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

// Verify the bearer token belongs to a superadmin (mirrors media.js — kept inline
// so the Function stays self-contained). 401 no/bad token, 403 not superadmin,
// 502 lookup failed.
async function requireSuperadmin(SUPABASE_URL, SUPABASE_ANON_KEY, token) {
  if (!token) return { ok: false, status: 401 };
  let uid;
  try {
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    });
    if (!who.ok) return { ok: false, status: 401 };
    const user = await who.json();
    uid = user && user.id;
  } catch { return { ok: false, status: 502 }; }
  if (!uid) return { ok: false, status: 401 };
  try {
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}&select=role`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    });
    if (!pr.ok) return { ok: false, status: 502 };
    const rows = await pr.json();
    const role = Array.isArray(rows) && rows[0] && rows[0].role;
    if (role !== "superadmin") return { ok: false, status: 403 };
  } catch { return { ok: false, status: 502 }; }
  return { ok: true, uid };
}

// YYYY-MM-DD (UTC) for a Date offset by `deltaDays`.
function ymd(base, deltaDays = 0) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function buildQuery({ acct, zone, sinceDT, sinceDate, ydayDate, todayDate }) {
  return `query {
    viewer {
      accounts(filter:{accountTag:"${acct}"}) {
        workers: workersInvocationsAdaptive(limit:1000, filter:{datetime_geq:"${sinceDT}"}) {
          sum { requests errors } dimensions { scriptName date }
        }
        pages: pagesFunctionsInvocationsAdaptiveGroups(limit:1000, filter:{date_geq:"${sinceDate}"}) {
          sum { requests errors } dimensions { date }
        }
        r2storage: r2StorageAdaptiveGroups(limit:50, filter:{date_geq:"${ydayDate}"}) {
          max { objectCount payloadSize metadataSize } dimensions { bucketName }
        }
        r2ops: r2OperationsAdaptiveGroups(limit:100, filter:{date_geq:"${todayDate}"}) {
          sum { requests } dimensions { actionType }
        }
      }
      zones(filter:{zoneTag:"${zone}"}) {
        http: httpRequests1dGroups(limit:31, filter:{date_geq:"${sinceDate}"}) {
          sum { requests cachedRequests responseStatusMap { edgeResponseStatus requests } } dimensions { date }
        }
      }
    }
  }`;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const SUPABASE_URL = env.SUPABASE_URL || "https://xprynknppsehuzqqdvue.supabase.co";
  const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwcnlua25wcHNlaHV6cXFkdnVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwODg1OTUsImV4cCI6MjA5NzY2NDU5NX0._S3xdNXBm6d4SI8MO0MNoZ3bT8uspEd8lrdVm29Efgo";

  // Gate FIRST — a non-superadmin never reaches Cloudflare or the cache.
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const chk = await requireSuperadmin(SUPABASE_URL, SUPABASE_ANON_KEY, token);
  if (!chk.ok) return json({ error: chk.status === 403 ? "forbidden" : chk.status === 502 ? "auth lookup failed" : "unauthorized" }, chk.status);

  const CF_TOKEN = env.CF_ANALYTICS_TOKEN;
  if (!CF_TOKEN) return json({ configured: false }); // not wired yet — UI shows setup steps

  const acct = env.CF_ACCOUNT_ID || "4acf69efbeed54838dc0d5f004769933";
  const zone = env.CF_ZONE_ID || "3de2f4733d9e76517db51bf1a44314a2";

  // Serve the 5-min edge cache unless ?refresh=1 forces a fresh pull.
  const url = new URL(request.url);
  const force = url.searchParams.get("refresh") === "1";
  const cache = caches.default;
  const cacheKey = new Request("https://cf-health.internal/v1");
  if (!force) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const now = new Date();
  const todayDate = ymd(now);
  const monthStart = `${todayDate.slice(0, 7)}-01`;
  const sinceDate = ymd(now, -30);
  const sinceDT = `${sinceDate}T00:00:00Z`;
  const ydayDate = ymd(now, -1);

  // Pages builds this month — newest-first pages; stop at the first deployment
  // older than the month start (or a 20-page safety cap ≈ the 500/mo allowance).
  // Requires "Cloudflare Pages: Read" on the analytics token; returns null (tile
  // shows a hint) until that permission exists. Soft-fail by design.
  const fetchBuildsMonth = async () => {
    try {
      let count = 0;
      for (let page = 1; page <= 20; page++) {
        const r = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${acct}/pages/projects/wedding-site/deployments?per_page=25&page=${page}`,
          { headers: { authorization: `Bearer ${CF_TOKEN}` } },
        );
        if (!r.ok) return null; // 403 until token gets Pages:Read
        const jr = await r.json();
        const list = jr.result || [];
        if (!list.length) break;
        count += countBuildsThisMonth(list, monthStart);
        if ((list[list.length - 1]?.created_on || "") < monthStart) break; // paged past the month
      }
      return count;
    } catch { return null; }
  };

  // Supabase DB size — superadmin-only RPC (0025), called with the CALLER's JWT
  // so the DB re-verifies the role itself. NULL/failure -> null (tile shows "—").
  const fetchDbSize = async () => {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/db_size_bytes`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: "{}",
      });
      if (!r.ok) return null;
      const v = await r.json();
      return Number.isFinite(+v) ? +v : null;
    } catch { return null; }
  };

  let data, buildsMonth, dbBytes;
  try {
    const [resp, builds, db] = await Promise.all([
      fetch("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers: { authorization: `Bearer ${CF_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ query: buildQuery({ acct, zone, sinceDT, sinceDate, ydayDate, todayDate }) }),
      }),
      fetchBuildsMonth(),
      fetchDbSize(),
    ]);
    buildsMonth = builds; dbBytes = db;
    const jr = await resp.json();
    if (!resp.ok || (jr.errors && jr.errors.length) || !jr.data) {
      return json({ configured: true, error: "upstream" }); // soft — do not cache, do not leak details
    }
    data = jr.data;
  } catch {
    return json({ configured: true, error: "upstream" });
  }

  const payload = shapeHealth(data, {
    today: todayDate,
    monthStart,
    limitMonth: 10_000_000,
    updatedAt: now.toISOString(),
  });
  payload.builds = { month: buildsMonth, limit: 500 };            // null month => token lacks Pages:Read
  payload.supa = { dbBytes, dbLimitBytes: 500 * 1024 * 1024 };    // free-tier 500 MB reference

  const res = json(payload);
  res.headers.set("cache-control", "max-age=300");
  try { await cache.put(cacheKey, res.clone()); } catch { /* cache best-effort */ }
  return res;
}
