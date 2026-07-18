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
  const SUPA_ORG_ID = env.SUPABASE_ORG_ID || "hmjytmqurgudfkpczvtg";

  // Plan limits — CF exposes no "your plan's quota" API, so these are
  // dashboard-adjustable Pages vars with the current plans as defaults
  // (Workers Paid 10M req/mo, Pages 500 builds/mo, R2 free 10 GB). Change a var
  // after a plan upgrade; applies on the next deploy. The Supabase DB limit is
  // the exception: when a SUPABASE_MGMT_TOKEN (PAT) secret is set it's read LIVE
  // from the org's plan (fetchSupaPlan); CF_LIMIT_SUPA_DB_MB / 500 is only the
  // fallback for when no PAT is configured.
  const envNum = (v, dflt) => (Number.isFinite(+v) && +v > 0 ? +v : dflt);
  const LIMIT_REQ_MONTH = envNum(env.CF_LIMIT_REQ_MONTH, 10_000_000);
  const LIMIT_BUILDS_MONTH = envNum(env.CF_LIMIT_BUILDS_MONTH, 500);
  const LIMIT_R2_GB = envNum(env.CF_LIMIT_R2_GB, 10);
  const LIMIT_SUPA_DB_MB = envNum(env.CF_LIMIT_SUPA_DB_MB, 500);
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

  // Supabase plan -> included DB-size ceiling. The plan lives behind the
  // Management API (api.supabase.com), which needs a Personal Access Token —
  // the anon key / caller JWT can't reach it. No PAT set -> null -> the caller
  // falls back to CF_LIMIT_SUPA_DB_MB / 500, so this stays inert until wired.
  // enterprise / custom-disk plans aren't in the map -> null -> env/500 too.
  const SUPA_PLAN_MB = { free: 500, pro: 8192, team: 8192 };
  const fetchSupaPlan = async () => {
    const pat = env.SUPABASE_MGMT_TOKEN;
    if (!pat) return null;
    try {
      const r = await fetch(`https://api.supabase.com/v1/organizations/${SUPA_ORG_ID}`, {
        headers: { authorization: `Bearer ${pat}` },
      });
      if (!r.ok) return null;
      const o = await r.json();
      const plan = typeof o?.plan === "string" ? o.plan : null;
      return plan ? { plan, limitMb: SUPA_PLAN_MB[plan] || null } : null;
    } catch { return null; }
  };

  let data, buildsMonth, dbBytes, domainCount, supaPlan;
  try {
    const [resp, builds, db, doms, plan] = await Promise.all([
      fetch("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers: { authorization: `Bearer ${CF_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ query: buildQuery({ acct, zone, sinceDT, sinceDate, ydayDate, todayDate }) }),
      }),
      fetchBuildsMonth(),
      fetchDbSize(),
      fetchDomainCount(),
      fetchSupaPlan(),
    ]);
    buildsMonth = builds; dbBytes = db; domainCount = doms; supaPlan = plan;
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
  // Live plan limit wins when a PAT let us read it; else the env var / 500.
  const dbLimitMb = supaPlan?.limitMb || LIMIT_SUPA_DB_MB;
  payload.supa = { dbBytes, dbLimitBytes: dbLimitMb * 1024 * 1024, plan: supaPlan?.plan || null };

  const res = json(payload);
  res.headers.set("cache-control", "max-age=300");
  try { await cache.put(cacheKey, res.clone()); } catch { /* cache best-effort */ }
  return res;
}
