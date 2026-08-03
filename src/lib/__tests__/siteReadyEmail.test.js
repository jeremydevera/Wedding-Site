import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { siteReadyHtml, siteUrl, sendSiteReadyEmail } from "../../../functions/api/_site-ready-email.js";

// "Your site is live" email. Before this existed a client's site went live and
// nobody told them the address — approveSiteRequest had dropped the old setup
// email when owners started setting their own password at signup.
const ENV = { RESEND_API_KEY: "re_test", RESEND_FROM: "Celebrately <noreply@send.celebrately.us>" };
const CLIENT = { id: "c1", subdomain: "jeremy-irish", email: "o@x.com", partner_a: "Jeremy", partner_b: "Irish" };

// Minimal tagged-template stub: records each statement and replays queued results.
function sqlStub(results) {
  const calls = [];
  const q = [...results];
  const sql = (strings, ...vals) => { calls.push({ text: strings.join("?"), vals }); return Promise.resolve(q.length ? q.shift() : []); };
  sql.calls = calls;
  return sql;
}

describe("siteReadyHtml", () => {
  it("puts the live site URL and the dashboard link in the body", () => {
    const html = siteReadyHtml({ subdomain: "jeremy-irish", names: "Jeremy & Irish" });
    expect(html).toContain("https://jeremy-irish.celebrately.us");
    expect(html).toContain("https://jeremy-irish.celebrately.us/admin");
    expect(html).toContain("Jeremy &amp; Irish");
    expect(siteUrl("abc")).toBe("https://abc.celebrately.us");
  });

  it("escapes the names — they're user-supplied", () => {
    const html = siteReadyHtml({ subdomain: "s", names: '<script>alert(1)</script>' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("reads fine with no names on file", () => {
    const html = siteReadyHtml({ subdomain: "s", names: "" });
    expect(html).toContain("your site is ready to share");
  });
});

describe("sendSiteReadyEmail", () => {
  // See the note in siteReadyEndpoint.test.js — a leaked fetch mock breaks the
  // next test file that shares this worker.
  const realFetch = globalThis.fetch;
  beforeEach(() => { globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: "e1" }) })); });
  afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

  it("sends to the address ON THE CLIENT ROW and marks it sent", async () => {
    const sql = sqlStub([[{ id: "c1" }]]); // the claim succeeds
    const out = await sendSiteReadyEmail(ENV, sql, CLIENT);
    expect(out).toEqual({ sent: true, to: "o@x.com" });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.to).toEqual(["o@x.com"]);
    expect(body.subject).toBe("Your Celebrately website is live");
    expect(body.html).toContain("jeremy-irish.celebrately.us");
    // claim written before sending
    expect(sql.calls[0].text).toMatch(/update clients/);
    expect(sql.calls[0].text).toMatch(/is null/);
  });

  // Idempotency: the browser path and the superadmin path can both fire for the
  // same client, and a refresh can repeat either one.
  it("skips when the marker is already set — never a second email", async () => {
    const sql = sqlStub([[]]); // claim matched no row
    const out = await sendSiteReadyEmail(ENV, sql, CLIENT);
    expect(out).toEqual({ skipped: "already sent" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("releases the marker when the send fails, so a retry can still send", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 422, json: async () => ({ message: "invalid to" }) }));
    const sql = sqlStub([[{ id: "c1" }]]);
    const out = await sendSiteReadyEmail(ENV, sql, CLIENT);
    expect(out.error).toContain("invalid to");
    expect(sql.calls[1].text).toMatch(/content - /); // marker removed
  });

  it("does nothing without an email on file, or without an API key", async () => {
    expect(await sendSiteReadyEmail(ENV, sqlStub([]), { ...CLIENT, email: "" })).toEqual({ skipped: "no email on file" });
    expect(await sendSiteReadyEmail(ENV, sqlStub([]), { ...CLIENT, email: "not-an-email" })).toEqual({ skipped: "no email on file" });
    expect(await sendSiteReadyEmail({}, sqlStub([]), CLIENT)).toEqual({ skipped: "RESEND_API_KEY not configured" });
    expect(await sendSiteReadyEmail(ENV, sqlStub([]), { id: "c1" })).toEqual({ skipped: "no client" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
