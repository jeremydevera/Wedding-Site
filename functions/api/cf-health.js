// functions/api/cf-health.js
// Cloudflare Pages Function — GET /api/cf-health
// Superadmin-only. Proxies the Cloudflare GraphQL Analytics API server-side (the
// read-only token lives in env.CF_ANALYTICS_TOKEN, never in the browser) and
// returns a compact health payload for the superadmin Health tab. Scoped to
// /api/* via _routes.json. Result is edge-cached 5 min so CF's API is hit at most
// ~once per 5 min no matter how many superadmins refresh.

import { shapeHealth, countBuildsThisMonth } from "./_cf-health-shape.js";
import { neon } from "@neondatabase/serverless";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

const FIREBASE_API_KEY = "AIzaSyC4zUcZH06Te0CQLwn9r3VdAeb3Rcf4K0k";
async function firebaseUid(apiKey, token) {
  try {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: token }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return (d && d.users && d.users[0] && d.users[0].localId) || null;
  } catch { return null; }
}

// Verify the bearer token belongs to a superadmin (Firebase ID token → Neon
// profiles). 401 no/bad token, 403 not superadmin, 502 lookup failed.
async function requireSuperadmin(env, token) {
  if (!token) return { ok: false, status: 401 };
  if (!env || !env.NEON_DATABASE_URL) return { ok: false, status: 500 };
  const uid = await firebaseUid(env.FIREBASE_API_KEY || FIREBASE_API_KEY, token);
  if (!uid) return { ok: false, status: 401 };
  try {
    const sql = neon(env.NEON_DATABASE_URL);
    const rows = await sql`select role from profiles where id = ${uid} and role = 'superadmin' limit 1`;
    if (!rows || !rows[0]) return { ok: false, status: 403 };
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

  // Gate FIRST — a non-superadmin never reaches Cloudflare or the cache.
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const chk = await requireSuperadmin(env, token);
  if (!chk.ok) return json({ error: chk.status === 403 ? "forbidden" : chk.status === 502 ? "auth lookup failed" : "unauthorized" }, chk.status);

  const CF_TOKEN = env.CF_ANALYTICS_TOKEN;
  if (!CF_TOKEN) return json({ configured: false }); // not wired yet — UI shows setup steps

  const acct = env.CF_ACCOUNT_ID || "4acf69efbeed54838dc0d5f004769933";
  const zone = env.CF_ZONE_ID || "3de2f4733d9e76517db51bf1a44314a2";

  // Plan limits — CF exposes no "your plan's quota" API, so these are
  // dashboard-adjustable Pages vars with the current plans as defaults
  // (Workers Paid 10M req/mo, Pages 500 builds/mo, R2 free 10 GB). Change a var
  // after a plan upgrade; applies on the next deploy.
  const envNum = (v, dflt) => (Number.isFinite(+v) && +v > 0 ? +v : dflt);
  const LIMIT_REQ_MONTH = envNum(env.CF_LIMIT_REQ_MONTH, 10_000_000);
  const LIMIT_BUILDS_MONTH = envNum(env.CF_LIMIT_BUILDS_MONTH, 500);
  const LIMIT_R2_GB = envNum(env.CF_LIMIT_R2_GB, 10);
  // Pages free plan: 100 custom domains per project (Pro 250, Business 500).
  const LIMIT_DOMAINS = envNum(env.CF_LIMIT_DOMAINS, 100);

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

  // Custom domains attached to the Pages project — counts against the plan cap
  // (100 free / 250 Pro / 500 Business). Same "Cloudflare Pages: Read" permission
  // as builds; soft-fails to null (tile shows the token hint) until it exists.
  const fetchDomainCount = async () => {
    const tryUrl = async (qs) => {
      const r = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${acct}/pages/projects/wedding-site/domains${qs}`,
        { headers: { authorization: `Bearer ${CF_TOKEN}` } },
      );
      if (!r.ok) return null;
      const jr = await r.json();
      const total = jr.result_info && Number.isFinite(+jr.result_info.total_count) ? +jr.result_info.total_count : null;
      return total != null ? total : (Array.isArray(jr.result) ? jr.result.length : null);
    };
    // per_page first (covers projects with >25 domains); some API versions
    // reject unknown params, so fall back to the bare endpoint.
    try { return (await tryUrl("?per_page=100")) ?? (await tryUrl("")); } catch { return null; }
  };

  // Neon storage — all data lives on Neon (5 shards). Read the shard registry
  // from Neon app_config, then ask each shard's Data API for pg_database_size via
  // the public db_size_bytes() RPC (anon token).
  // Free tier = 512 MB storage per project; total capacity = 512 MB × shards.
  const NEON_LIMIT_MB = +(env.CF_LIMIT_NEON_DB_MB || 512);
  const fetchNeonUsage = async () => {
    try {
      if (!env.NEON_DATABASE_URL) return null;
      const sql = neon(env.NEON_DATABASE_URL);
      const rows = await sql`select value from app_config where key = 'neon_shards' limit 1`;
      const shards = rows?.[0]?.value?.shards || {};
      const ids = Object.keys(shards);
      if (!ids.length) return null;
      const per = await Promise.all(ids.map(async (id) => {
        const s = shards[id];
        try {
          const tj = await (await fetch(`${s.authUrl}/token/anonymous`)).json();
          const tok = tj.token || tj.jwt;
          if (!tok) return { id, bytes: null };
          const rr = await fetch(`${s.dataApiUrl}/rpc/db_size_bytes`, {
            method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: "{}",
          });
          if (!rr.ok) return { id, bytes: null };
          const v = await rr.json();
          return { id, bytes: Number.isFinite(+v) ? +v : null };
        } catch { return { id, bytes: null }; }
      }));
      const known = per.filter((s) => s.bytes != null);
      return { shards: per, count: ids.length, totalBytes: known.length ? known.reduce((a, s) => a + s.bytes, 0) : null, limitBytesPerShard: NEON_LIMIT_MB * 1024 * 1024 };
    } catch { return null; }
  };

  let data, buildsMonth, domainCount, neonUsage;
  try {
    const [resp, builds, doms, neonU] = await Promise.all([
      fetch("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers: { authorization: `Bearer ${CF_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ query: buildQuery({ acct, zone, sinceDT, sinceDate, ydayDate, todayDate }) }),
      }),
      fetchBuildsMonth(),
      fetchDomainCount(),
      fetchNeonUsage(),
    ]);
    buildsMonth = builds; domainCount = doms; neonUsage = neonU;
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
    limitMonth: LIMIT_REQ_MONTH,
    updatedAt: now.toISOString(),
  });
  payload.builds = { month: buildsMonth, limit: LIMIT_BUILDS_MONTH }; // null month => token lacks Pages:Read
  payload.domains = { count: domainCount, limit: LIMIT_DOMAINS }; // null count => token lacks Pages:Read
  payload.r2.limitBytes = LIMIT_R2_GB * 1024 ** 3;
  // Neon (sharded). null => registry unreadable or all shards down.
  payload.neon = neonUsage
    ? { totalBytes: neonUsage.totalBytes, shardCount: neonUsage.count, limitBytesPerShard: neonUsage.limitBytesPerShard, totalLimitBytes: neonUsage.limitBytesPerShard * neonUsage.count, shards: neonUsage.shards }
    : null;

  const res = json(payload);
  res.headers.set("cache-control", "max-age=300");
  try { await cache.put(cacheKey, res.clone()); } catch { /* cache best-effort */ }
  return res;
}
