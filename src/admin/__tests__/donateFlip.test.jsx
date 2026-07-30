import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { Store } from "@/lib/store.jsx";
import { DonateToDevTab } from "@/admin/manage.jsx";

// Donate to Dev (owner view): the GCash tile shows the BRAND LOGO first and flips
// to its QR on click (owner request). Tiles with no logo are untouched — they
// still show their QR straight away, so nothing is hidden behind a cover that
// can't be turned over. getAppConfig has no backend here, returns null, and the
// tab falls back to its four default tiles (gcash / maya / bdo / maribank).
const ownerView = () => {
  Store.set({ clientId: "c1", loading: false });
  Store.setAuth({ session: { user: { email: "o@x" } }, role: "owner", clientId: "c1", email: "o@x" });
};
const flipOf = (c) => c.querySelector(".donate-flip");

describe("Donate to Dev — GCash logo flips to the QR", () => {
  beforeEach(() => ownerView());
  afterEach(cleanup);

  it("covers ONLY the GCash tile with a flip card; the others show their QR directly", async () => {
    const { container } = render(<DonateToDevTab />);
    await waitFor(() => expect(container.querySelectorAll(".donate-card").length).toBe(4));
    expect(container.querySelectorAll(".donate-flip").length).toBe(1);
    const card = [...container.querySelectorAll(".donate-card")].find((f) => f.querySelector(".donate-flip"));
    expect(card.textContent).toContain("GCash");
    // every other tile keeps a plain, always-visible QR image
    const plain = [...container.querySelectorAll(".donate-card")].filter((f) => !f.querySelector(".donate-flip"));
    expect(plain.length).toBe(3);
    plain.forEach((f) => expect(f.querySelector("img.donate-card__img, .donate-card__ph")).toBeTruthy());
  });

  it("shows the logo face up, with the QR already in the DOM behind it", async () => {
    const { container } = render(<DonateToDevTab />);
    await waitFor(() => expect(flipOf(container)).toBeTruthy());
    const flip = flipOf(container);
    expect(flip.querySelector(".donate-flip__face--front img").getAttribute("src"))
      .toBe("/assets/donate/gcash-logo.png");
    // the QR is rendered from the start — flipping reveals it, it doesn't load it
    expect(flip.querySelector(".donate-flip__face--back img, .donate-flip__face--back .donate-card__ph")).toBeTruthy();
    expect(flip.classList.contains("is-flipped")).toBe(false);
    expect(flip.getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking flips it, and clicking again flips it back", async () => {
    const { container } = render(<DonateToDevTab />);
    await waitFor(() => expect(flipOf(container)).toBeTruthy());
    const flip = flipOf(container);
    expect(container.textContent).toContain("Tap to show QR");

    fireEvent.click(flip);
    expect(flip.classList.contains("is-flipped")).toBe(true);   // CSS rotates the inner face
    expect(flip.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("Tap to flip back");

    fireEvent.click(flip);
    expect(flip.classList.contains("is-flipped")).toBe(false);
    expect(flip.getAttribute("aria-pressed")).toBe("false");
  });

  it("is a real button, labelled, and hides the face-down QR from screen readers", async () => {
    const { container } = render(<DonateToDevTab />);
    await waitFor(() => expect(flipOf(container)).toBeTruthy());
    const flip = flipOf(container);
    expect(flip.tagName).toBe("BUTTON"); // keyboard-reachable, not a click-only div
    expect(flip.getAttribute("aria-label")).toBe("Show the GCash QR code");
    const back = flip.querySelector(".donate-flip__face--back");
    expect(back.getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(flip);
    expect(flip.getAttribute("aria-label")).toBe("Hide the GCash QR code");
    expect(back.getAttribute("aria-hidden")).toBe("false");
  });
});
