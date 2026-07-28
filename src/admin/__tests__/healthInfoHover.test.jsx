import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

// Owner request: the two long explainers (domain cap + Firebase Auth) must NOT
// sit open on the page — each appears only when hovering its OWN tile.
vi.mock("@/lib/auth.js", () => ({ adminBridgeToken: async () => "fb-token" }));

const HEALTH = {
  updatedAt: new Date("2026-07-28T00:00:00Z").toISOString(),
  limitMonth: 100000,
  router: { today: 10, month: 100 },
  builds: { month: 3, limit: 500 },
  domains: { count: 4, limit: 100 },
  r2: { objects: 5, storageBytes: 1000, opsToday: 7 },
  neon: { shardCount: 1, totalBytes: 100, totalLimitBytes: 536870912, limitBytesPerShard: 536870912, shards: [{ id: "s1", bytes: 100 }] },
  zone: { cacheHitPct: 90, reqToday: 50, err5xx: 0, status: [] },
  functions: { today: 2, month: 20 },
  series: [{ date: "2026-07-27", router: 1, functions: 1 }, { date: "2026-07-28", router: 2, functions: 2 }],
};

import { CloudflareHealth } from "@/admin/CloudflareHealth.jsx";

const FIREBASE_SNIPPET = /holds the logins for Neon-backed client sites/;
const DOMAINS_SNIPPET = /counts every hostname attached to the/;

describe("Health tab — long explainers are hover-only", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => HEALTH }));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("renders NEITHER explainer as an always-open block", async () => {
    const { container } = render(<CloudflareHealth />);
    await waitFor(() => expect(container.textContent).toMatch(/Firebase Auth/));
    expect(document.body.textContent).not.toMatch(FIREBASE_SNIPPET);
    expect(document.body.textContent).not.toMatch(DOMAINS_SNIPPET);
  });

  it("shows the Firebase explainer ONLY while hovering its own tile", async () => {
    const { container } = render(<CloudflareHealth />);
    await waitFor(() => expect(container.textContent).toMatch(/Firebase Auth/));
    const tile = [...container.querySelectorAll(".kpi")].find((k) => k.textContent.includes("Firebase Auth"));
    expect(tile).toBeTruthy();

    fireEvent.mouseEnter(tile);
    // portalled to <body> so `.kpi { overflow:hidden }` can't clip it
    expect(document.body.textContent).toMatch(FIREBASE_SNIPPET);
    const pop = document.body.querySelector('[role="tooltip"]');
    expect(pop).toBeTruthy();
    expect(tile.contains(pop)).toBe(false);
    expect(getComputedStyle(pop).position).toBe("fixed");

    fireEvent.mouseLeave(tile);
    expect(document.body.textContent).not.toMatch(FIREBASE_SNIPPET);
  });

  it("hovering a DIFFERENT tile does not reveal the Firebase explainer", async () => {
    const { container } = render(<CloudflareHealth />);
    await waitFor(() => expect(container.textContent).toMatch(/Firebase Auth/));
    const other = [...container.querySelectorAll(".kpi")].find((k) => k.textContent.includes("Cache hit"));
    fireEvent.mouseEnter(other);
    expect(document.body.textContent).not.toMatch(FIREBASE_SNIPPET);
  });

  it("keyboard focus opens it too (not mouse-only)", async () => {
    const { container } = render(<CloudflareHealth />);
    await waitFor(() => expect(container.textContent).toMatch(/Firebase Auth/));
    const tile = [...container.querySelectorAll(".kpi")].find((k) => k.textContent.includes("Firebase Auth"));
    expect(tile.getAttribute("tabindex")).toBe("0"); // reachable
    fireEvent.focus(tile);
    expect(document.body.textContent).toMatch(FIREBASE_SNIPPET);
    fireEvent.blur(tile);
    expect(document.body.textContent).not.toMatch(FIREBASE_SNIPPET);
  });

  it("tap toggles it open and closed (touch has no hover)", async () => {
    const { container } = render(<CloudflareHealth />);
    await waitFor(() => expect(container.textContent).toMatch(/Firebase Auth/));
    const tile = [...container.querySelectorAll(".kpi")].find((k) => k.textContent.includes("Firebase Auth"));
    fireEvent.click(tile);
    expect(document.body.textContent).toMatch(FIREBASE_SNIPPET);
    fireEvent.click(tile);
    expect(document.body.textContent).not.toMatch(FIREBASE_SNIPPET);
  });
});
