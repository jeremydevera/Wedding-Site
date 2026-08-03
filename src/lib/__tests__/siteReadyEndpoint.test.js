// src/lib/__tests__/siteReadyEndpoint.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// /api/site-ready emails the caller their own site link. It is reachable by ANY
// signed-in user, so the security property under test is: the recipient comes
// from the caller's clients row, and a caller-supplied address is ignored.
const { neonState } = vi.hoisted(() => ({ neonState: { join: [], claim: [{ id: "c1" }] } }));
vi.mock("@neondatabase/serverless", () => ({
  neon: () => ((strings) => {
    const sql = Array.isArray(strings) ? strings.join(" ") : String(strings);
    if (/from profiles p join clients c/.test(sql)) return Promise.resolve(neonState.join);
    if (/update clients/.test(sql)) return Promise.resolve(neonState.claim);
    return Promise.resolve([]);
  }),
}));

import { onRequestPost } from "../../../functions/api/site-ready.js";

const ENV = { NEON_DATABASE_URL: "postgres://x", RESEND_API_KEY: "re_test" };
const OWNER = { id: "c1", subdomain: "jeremy-irish", email: "owner@real.com", partner_a: "Jeremy", partner_b: "Irish" };

function post(headers = {}, body = undefined) {
  return new Request("https://x/api/site-ready", { method: "POST", headers, ...(body ? { body: JSON.stringify(body) } : {}) });
}
// One fetch mock serving both the Firebase lookup and the Resend send.
function mockFetch({ uid = "u1", resendOk = true } = {}) {
  const sends = [];
  globalThis.fetch = vi.fn(async (url, opts) => {
    if (String(url).includes("identitytoolkit")) {
      return { ok: !!uid, json: async () => (uid ? { users: [{ localId: uid }] } : {}) };
    }
    sends.push(JSON.parse(opts.body));
    return { ok: resendOk, status: resendOk ? 200 : 422, json: async () => ({ id: "e1", message: "bad" }) };
  });
  return sends;
}

describe("POST /api/site-ready", () => {
  // Restore the real fetch: vitest reuses a worker across files, so a mock left
  // installed here answers the NEXT file's requests with the wrong shape (it
  // showed up as console noise + teardown rejections in accessV2.test.jsx).
  const realFetch = globalThis.fetch;
  beforeEach(() => { neonState.join = [OWNER]; neonState.claim = [{ id: "c1" }]; });
  afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

  it("401s with no token, and with a token Firebase rejects", async () => {
    mockFetch();
    expect((await onRequestPost({ request: post(), env: ENV })).status).toBe(401);
    mockFetch({ uid: null });
    expect((await onRequestPost({ request: post({ authorization: "Bearer nope" }), env: ENV })).status).toBe(401);
  });

  it("emails the address on the caller's own client row", async () => {
    const sends = mockFetch();
    const res = await onRequestPost({ request: post({ authorization: "Bearer good" }), env: ENV });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, sent: true, to: "owner@real.com" });
    expect(sends[0].to).toEqual(["owner@real.com"]);
    expect(sends[0].html).toContain("https://jeremy-irish.celebrately.us");
  });

  // The relay risk: a signed-in user posting someone else's address.
  it("IGNORES an address in the request body", async () => {
    const sends = mockFetch();
    await onRequestPost({ request: post({ authorization: "Bearer good", "content-type": "application/json" }, { to: "victim@elsewhere.com", email: "victim@elsewhere.com" }), env: ENV });
    expect(sends[0].to).toEqual(["owner@real.com"]);
    expect(JSON.stringify(sends[0])).not.toContain("victim@elsewhere.com");
  });

  it("404s when the account has no site yet", async () => {
    neonState.join = [];
    mockFetch();
    const res = await onRequestPost({ request: post({ authorization: "Bearer good" }), env: ENV });
    expect(res.status).toBe(404);
  });

  it("still reports ok when the send fails — the site is live either way", async () => {
    mockFetch({ resendOk: false });
    const res = await onRequestPost({ request: post({ authorization: "Bearer good" }), env: ENV });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.error).toBeTruthy();
  });

  it("a repeat request sends nothing (idempotent per client)", async () => {
    neonState.claim = []; // marker already set
    const sends = mockFetch();
    const res = await onRequestPost({ request: post({ authorization: "Bearer good" }), env: ENV });
    expect(await res.json()).toMatchObject({ ok: true, skipped: "already sent" });
    expect(sends.length).toBe(0);
  });
});
