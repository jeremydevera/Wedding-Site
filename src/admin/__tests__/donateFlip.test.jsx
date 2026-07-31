import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
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
    expect(card.querySelector(".donate-flip__face--front img").getAttribute("src")).toContain("gcash-logo");
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

    fireEvent.click(flip);
    expect(flip.classList.contains("is-flipped")).toBe(true);   // CSS rotates the inner face
    expect(flip.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(flip);
    expect(flip.classList.contains("is-flipped")).toBe(false);
    expect(flip.getAttribute("aria-pressed")).toBe("false");
  });

  // Owner: "delete the GCASH word, instead use TAP ME. once tapped flip it then
  // change the WORD 'TAP ME' to gcash number 09150860371 then allow option to
  // copy just like in the section 'OR SEND TO THESE NUMBERS'."
  it("captions the cover with TAP ME — no wallet name", async () => {
    const { container } = render(<DonateToDevTab />);
    await waitFor(() => expect(flipOf(container)).toBeTruthy());
    const cap = container.querySelector(".donate-card:has(.donate-flip) .donate-card__label");
    expect(cap.textContent.trim()).toBe("Tap me"); // CSS uppercases it to TAP ME
    expect(cap.textContent).not.toMatch(/gcash/i);
    expect(cap.querySelector("button")).toBeNull(); // no Copy until it's flipped
  });

  it("swaps TAP ME for the number + a Copy button once flipped", async () => {
    const { container } = render(<DonateToDevTab />);
    await waitFor(() => expect(flipOf(container)).toBeTruthy());
    fireEvent.click(flipOf(container));
    const cap = container.querySelector(".donate-card:has(.donate-flip) .donate-card__label");
    expect(cap.querySelector(".donate-num__value").textContent).toBe("09150860371");
    expect(cap.textContent).not.toContain("Tap me");
    expect(cap.querySelector("button").textContent).toBe("Copy");
  });

  it("Copy copies the number and does NOT flip the card back", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { container } = render(<DonateToDevTab />);
    await waitFor(() => expect(flipOf(container)).toBeTruthy());
    fireEvent.click(flipOf(container));
    const cap = container.querySelector(".donate-card:has(.donate-flip) .donate-card__label");

    await act(async () => { fireEvent.click(cap.querySelector("button")); });
    expect(writeText).toHaveBeenCalledWith("09150860371");
    expect(cap.querySelector("button").textContent).toBe("Copied!"); // same feedback as the numbers list
    // the Copy button sits OUTSIDE the flip button, so the card stays face-up
    expect(flipOf(container).classList.contains("is-flipped")).toBe(true);

    // Let the handler's 1.6s "Copied!" reset land INSIDE act. Left pending it
    // fires after the environment is torn down, which surfaced as an
    // intermittent unhandled "ReferenceError: window is not defined".
    await act(async () => { await new Promise((r) => setTimeout(r, 1700)); });
    expect(cap.querySelector("button").textContent).toBe("Copy");
  });

  it("takes the number from the configured numbers list, matched by label", async () => {
    // Same source as "Or send to these numbers" — the tile can't show a stale copy.
    const { container } = render(<DonateToDevTab />);
    await waitFor(() => expect(flipOf(container)).toBeTruthy());
    fireEvent.click(flipOf(container));
    const tileNum = container.querySelector(".donate-num--tile .donate-num__value").textContent;
    // the tile row is itself a .donate-num, so scope the lookup to the LIST
    const listRow = [...container.querySelectorAll(".donate-numbers__list .donate-num")]
      .find((r) => r.querySelector(".donate-num__wallet").textContent === "GCash");
    expect(listRow.querySelector(".donate-num__value").textContent).toBe(tileNum);
  });

  // Owner: "i want the style of copy text to be like in the 'or send to these
  // number'". Reusing the row's classes is what guarantees that — a second set of
  // bespoke styles is how the two drift apart.
  it("renders the flipped caption with the numbers list's own row classes", async () => {
    const { container } = render(<DonateToDevTab />);
    await waitFor(() => expect(flipOf(container)).toBeTruthy());
    fireEvent.click(flipOf(container));
    const row = container.querySelector(".donate-card__label .donate-num");
    expect(row).toBeTruthy();                                  // same block as a list row
    expect(row.classList.contains("donate-num--tile")).toBe(true); // + a sizing modifier only
    expect(row.querySelector(".donate-num__value")).toBeTruthy();
    // no parallel bespoke classes left behind
    expect(container.querySelector(".donate-card__paynum")).toBeNull();
    expect(container.querySelector(".donate-card__pay")).toBeNull();
  });

  // Owner: "on middle of qr and code put 'OR Send to these number'".
  it("puts the 'Or send to these numbers' heading between the QR tiles and the numbers", async () => {
    const { container } = render(<DonateToDevTab />);
    await waitFor(() => expect(container.querySelector(".donate-numbers__title")).toBeTruthy());
    const grid = container.querySelector(".donate-grid");
    const title = container.querySelector(".donate-numbers__title");
    const list = container.querySelector(".donate-numbers__list");
    expect(title.textContent).toBe("Or send to these numbers");
    // DOM order: tiles → heading → number rows (CSS centres it and draws the rules)
    expect(grid.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
