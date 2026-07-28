import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { InfoPop } from "@/admin/health-info.jsx";

// Regression: the Health popovers (domain/Firebase explainers AND the Neon
// per-shard breakdown) were CLIPPED — `.panel { overflow:hidden }` cut them off,
// and the rightmost tile pushed them past the viewport edge. They must portal to
// <body>, position fixed, and clamp/flip to stay fully visible.
function anchorAt({ left, top, width = 210, height = 200 }) {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {},
  });
  document.body.appendChild(el);
  return el;
}

describe("InfoPop positioning", () => {
  beforeEach(() => {
    window.innerWidth = 1200;
    window.innerHeight = 800;
  });
  afterEach(cleanup);

  it("portals to <body> and is position:fixed (escapes overflow:hidden ancestors)", () => {
    const a = anchorAt({ left: 400, top: 300 });
    const { container } = render(<InfoPop anchor={a}>hello</InfoPop>);
    const tip = document.body.querySelector('[role="tooltip"]');
    expect(tip).toBeTruthy();
    expect(container.contains(tip)).toBe(false);   // NOT inside the React subtree
    expect(tip.parentElement).toBe(document.body); // portalled
    expect(tip.style.position).toBe("fixed");
  });

  it("clamps to the right edge for the LAST tile in a row (Neon database case)", () => {
    const a = anchorAt({ left: 1040, top: 300 }); // rightmost tile
    render(<InfoPop anchor={a}>x</InfoPop>);
    const tip = document.body.querySelector('[role="tooltip"]');
    const left = parseFloat(tip.style.left);
    const width = parseFloat(tip.style.width);
    expect(left + width).toBeLessThanOrEqual(1200); // never past the viewport
    expect(left).toBeGreaterThanOrEqual(10);
  });

  it("clamps to the left edge for a first-column tile", () => {
    const a = anchorAt({ left: 8, top: 300 });
    render(<InfoPop anchor={a}>x</InfoPop>);
    const tip = document.body.querySelector('[role="tooltip"]');
    expect(parseFloat(tip.style.left)).toBeGreaterThanOrEqual(10);
  });

  it("flips BELOW the tile when there isn't room above", () => {
    const a = anchorAt({ left: 400, top: 40 }); // near the top of the viewport
    render(<InfoPop anchor={a}>x</InfoPop>);
    const tip = document.body.querySelector('[role="tooltip"]');
    expect(tip.style.top).not.toBe("");   // anchored from the top => sits below
    expect(tip.style.bottom).toBe("");
  });

  it("sits ABOVE the tile when there is room", () => {
    const a = anchorAt({ left: 400, top: 500 });
    render(<InfoPop anchor={a}>x</InfoPop>);
    const tip = document.body.querySelector('[role="tooltip"]');
    expect(tip.style.bottom).not.toBe(""); // anchored from the bottom => sits above
  });

  it("honours a narrow width (the dark per-shard breakdown)", () => {
    const a = anchorAt({ left: 400, top: 400 });
    render(<InfoPop anchor={a} tone="dark" width={230}>x</InfoPop>);
    const tip = document.body.querySelector('[role="tooltip"]');
    expect(parseFloat(tip.style.width)).toBe(230);
    expect(tip.style.background).toContain("15, 23, 42"); // dark card
  });

  it("never overflows a narrow (mobile) viewport", () => {
    window.innerWidth = 380;
    const a = anchorAt({ left: 300, top: 400, width: 120 });
    render(<InfoPop anchor={a}>x</InfoPop>);
    const tip = document.body.querySelector('[role="tooltip"]');
    const left = parseFloat(tip.style.left), width = parseFloat(tip.style.width);
    expect(width).toBeLessThanOrEqual(360);
    expect(left + width).toBeLessThanOrEqual(380);
  });
});
