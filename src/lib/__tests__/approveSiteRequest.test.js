// src/lib/__tests__/approveSiteRequest.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

// Approval now runs entirely through the Neon bridge: approve_site_request
// (SECURITY DEFINER) creates the client + links the self-registered owner + marks
// the request approved, in one transaction. No Supabase, no createOwner.
vi.mock("@/lib/auth.js", () => ({
  loadSession: async () => {},
  createOwner: async () => {},
  sendSetupEmail: async () => {},
  adminBridgeToken: async () => "fb-token",
}));
// api.js still imports the supabase client (dead legacy branches) — stub it.
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: () => ({}), auth: {} } }));

import { approveSiteRequest } from "@/lib/api.js";

const REQ = { id: "req1", subdomain: "amy-and-ben", partner_a: "Amy", partner_b: "Ben", email: "a@b.com", template_key: "classic", content: {} };

let bridge;
beforeEach(() => {
  bridge = [];
  globalThis.fetch = vi.fn(async (url, opts) => {
    bridge.push(JSON.parse(opts?.body || "{}"));
    return { ok: true, json: async () => ({ ok: true, subdomain: "amy-and-ben" }) };
  });
});

describe("approveSiteRequest (Neon bridge)", () => {
  it("approves the request via the bridge approve_request action", async () => {
    const out = await approveSiteRequest(REQ);
    expect(bridge[0].action).toBe("approve_request");
    expect(bridge[0].id).toBe("req1");
    expect(out).toMatchObject({ subdomain: "amy-and-ben", loginError: "", emailError: "" });
  });

  it("surfaces a bridge error (e.g. subdomain taken), never marking approved locally", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: "subdomain already taken" }) }));
    await expect(approveSiteRequest(REQ)).rejects.toThrow(/subdomain already taken/);
  });
});
