import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import React from "react";
import { TweaksPanel } from "@/ui/tweaks-panel.jsx";

// The floating Tweaks panel is dragged by its header. Regression for
// "panel can't be dragged on touch devices": the header drag must use Pointer
// Events (which cover mouse + touch + pen), not mouse-only events.
describe("TweaksPanel header drag", () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  // The panel is closed until the host posts __activate_edit_mode.
  const openPanel = () => {
    const utils = render(<TweaksPanel />);
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        source: window.parent,
        data: { type: "__activate_edit_mode" },
      }));
    });
    return utils;
  };

  it("uses a pointerdown handler on the header (touch-capable)", () => {
    const { container } = openPanel();
    const hd = container.querySelector(".twk-hd");
    expect(hd).toBeTruthy();
    // React attaches onPointerDown -> the DOM carries the prop as a listener.
    // Firing pointermove after a pointerdown on the header must reposition it.
    const panel = container.querySelector(".twk-panel");
    expect(panel).toBeTruthy();

    act(() => {
      hd.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true, clientX: 100, clientY: 100,
      }));
    });
    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true, clientX: 60, clientY: 40,
      }));
    });

    // Dragging left/up (toward the top-left) increases right/bottom offsets.
    // The exact px depends on jsdom layout (0-size), but the handler must have
    // written inline right/bottom styles in response to the pointer events.
    expect(panel.style.right).not.toBe("");
    expect(panel.style.bottom).not.toBe("");

    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
  });

  it("does not respond to mouse-only events (drag is pointer-based)", () => {
    const { container } = openPanel();
    const hd = container.querySelector(".twk-hd");
    const panel = container.querySelector(".twk-panel");
    const before = { right: panel.style.right, bottom: panel.style.bottom };

    // A legacy mousedown must NOT start a drag; a following mousemove is a no-op.
    act(() => {
      hd.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true, clientX: 100, clientY: 100,
      }));
      window.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true, clientX: 40, clientY: 20,
      }));
    });

    expect(panel.style.right).toBe(before.right);
    expect(panel.style.bottom).toBe(before.bottom);
  });
});
