// src/admin/__tests__/mediaPicker.test.jsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/api.js", () => ({ listMedia: vi.fn() }));
import { listMedia } from "@/lib/api.js";
import { MediaLibrary } from "@/admin/MediaPicker.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("MediaLibrary", () => {
  it("renders a grid from the fetched items and fires onPick with the key", async () => {
    listMedia.mockResolvedValue([
      { key: "c1/owner/image/hero/aaaaaaaa-venue.jpg", name: "venue.jpg", size: 10, uploaded: "2026-06-01T00:00:00Z" },
    ]);
    const onPick = vi.fn();
    render(<MediaLibrary type="image" clientId="c1" onPick={onPick} />);
    const cell = await screen.findByRole("button", { name: /venue\.jpg/i });
    fireEvent.click(cell);
    expect(onPick).toHaveBeenCalledWith("c1/owner/image/hero/aaaaaaaa-venue.jpg");
  });

  it("shows an empty state when there are no items", async () => {
    listMedia.mockResolvedValue([]);
    render(<MediaLibrary type="image" clientId="c1" onPick={() => {}} />);
    expect(await screen.findByText(/no uploads yet/i)).toBeTruthy();
  });

  it("shows an error state when the fetch fails", async () => {
    listMedia.mockRejectedValue(new Error("boom"));
    render(<MediaLibrary type="audio" clientId="c1" onPick={() => {}} />);
    expect(await screen.findByText(/couldn.t load|boom/i)).toBeTruthy();
  });
});
