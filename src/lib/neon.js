// EXPERIMENTAL Neon backend (owner decision 2026-07-19) — the sandbox client can
// serve its data from Neon (Data API + Neon Auth) instead of Supabase, gated by
// the superadmin "USE NEON DATABASE" platform toggle (Supabase app_config key
// `use_neon_db`). Guest paths only for now: anonymous role via a short-lived
// anon JWT from Neon Auth (the Data API rejects tokenless requests). Admin/auth
// paths stay on Supabase until the Neon Auth login lands.
// Plan + port notes: docs/superpowers/plans/2026-07-19-neon-sandbox-migration.md

const NEON_AUTH_URL = "https://ep-long-credit-aztdmow3.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth";
const NEON_DATA_API_URL = "https://ep-long-credit-aztdmow3.apirest.c-3.ap-southeast-1.aws.neon.tech/neondb/rest/v1";

// App_config key for the platform toggle (read from SUPABASE — it stays the
// control plane so the flag can never chicken-and-egg itself).
export const NEON_FLAG_KEY = "use_neon_db";

let anonTok = null; // { token, exp(ms) }
function jwtExpMs(token) {
  try { return (JSON.parse(atob(token.split(".")[1])).exp || 0) * 1000; } catch { return 0; }
}
// Anonymous JWT for guests — fetched once, cached until ~1 min before expiry
// (Neon anon tokens live ~15 min).
async function anonToken() {
  if (anonTok && Date.now() < anonTok.exp - 60_000) return anonTok.token;
  const res = await fetch(`${NEON_AUTH_URL}/token/anonymous`);
  if (!res.ok) throw new Error(`neon anon token failed (${res.status})`);
  const j = await res.json().catch(() => ({}));
  const token = j.token || j.jwt;
  if (!token) throw new Error("neon anon token missing in response");
  anonTok = { token, exp: jwtExpMs(token) || Date.now() + 10 * 60_000 };
  return token;
}

async function neonRest(path, { method = "GET", body, headers = {}, raw = false } = {}) {
  const token = await anonToken();
  const res = await fetch(`${NEON_DATA_API_URL}/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).message || msg; } catch { /* keep status */ }
    const err = new Error(msg); err.status = res.status; throw err;
  }
  if (raw) return res;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// PostgREST-style helpers (same query syntax as Supabase's REST layer).
export const neonSelect = (table, query) => neonRest(`${table}?${query}`);
export const neonInsert = (table, row) =>
  // return=minimal: anon can INSERT rsvps/guestbook/quiz but not read them back
  // (RLS) — asking for the row back would 4xx an otherwise-successful insert.
  neonRest(table, { method: "POST", body: row, headers: { prefer: "return=minimal" } });
export const neonRpc = (fn, args) => neonRest(`rpc/${fn}`, { method: "POST", body: args || {} });

// Paged select with an exact total (PostgREST Range/Content-Range protocol) —
// mirrors supabase's .select("*", { count: "exact" }).range(from, to).
export async function neonSelectPaged(table, query, from, to) {
  const res = await neonRest(`${table}?${query}`, {
    raw: true,
    headers: { prefer: "count=exact", "range-unit": "items", range: `${from}-${to}` },
  });
  const rows = await res.json().catch(() => []);
  const total = parseInt((res.headers.get("content-range") || "").split("/")[1], 10);
  return { rows: rows || [], count: Number.isFinite(total) ? total : (rows || []).length };
}
