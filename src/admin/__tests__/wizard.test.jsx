// src/admin/__tests__/wizard.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
// Modal renders through a portal to document.body, so query the document, not
// the render container.
const $ = (sel) => document.querySelector(sel);
const clickBtn = (text) => fireEvent.click([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text));
import React from "react";

// saveClientData serializes the current Store state; capture what onboarded is
// at each save so we can prove the flip happens only AFTER a successful save.
vi.mock("@/lib/api.js", () => ({ saveClientData: vi.fn() }));
import { saveClientData } from "@/lib/api.js";
import { Store } from "@/lib/store.jsx";
import { SetupWizard } from "@/admin/wizard.jsx";

const onboardedAtSave = () => Store.get().settings.onboarded;

beforeEach(() => {
  Store.updateSettings({ onboarded: false, partnerA: "", partnerB: "", venueName: "" });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("SetupWizard — onboarded flips only after save succeeds", () => {
  it("keeps onboarded:false and preserves typed values when the save throws", async () => {
    saveClientData.mockRejectedValue(new Error("network"));
    render(<SetupWizard />);

    fireEvent.change($("#w-pa"), { target: { value: "Ada" } });

    // Advance to the final step, then Finish.
    clickBtn("Next");
    clickBtn("Next");
    clickBtn("Finish setup");

    await waitFor(() => expect(saveClientData).toHaveBeenCalled());

    // Save failed → onboarded must remain false so the parent gate keeps the
    // wizard mounted (the bug flipped it true and unmounted). Store content rolls
    // back, but because the wizard is still mounted its local state is intact, so
    // the typed value survives — nothing the owner typed is lost.
    expect(Store.get().settings.onboarded).toBe(false);
    // Navigate back to step 0 and confirm the typed name is still there.
    clickBtn("Back");
    clickBtn("Back");
    expect($("#w-pa").value).toBe("Ada");
  });

  it("does NOT send onboarded:true on the content save, only after it succeeds", async () => {
    const seen = [];
    saveClientData.mockImplementation(async () => { seen.push(onboardedAtSave()); });
    render(<SetupWizard />);

    fireEvent.change($("#w-pa"), { target: { value: "Grace" } });
    clickBtn("Next");
    clickBtn("Next");
    clickBtn("Finish setup");

    await waitFor(() => expect(saveClientData).toHaveBeenCalledTimes(2));

    // First save (content) must NOT carry onboarded; second save persists it.
    expect(seen[0]).toBe(false);
    expect(seen[1]).toBe(true);
    expect(Store.get().settings.onboarded).toBe(true);
    expect(Store.get().settings.partnerA).toBe("Grace");
  });
});
