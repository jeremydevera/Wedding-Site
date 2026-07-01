// src/admin/__tests__/r2LibraryAdmin.test.jsx
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/api.js", () => ({
  listMedia: vi.fn(),
  deleteFromR2: vi.fn(),
}));
vi.mock("@/ui/components.jsx", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, confirmDialog: vi.fn().mockResolvedValue(true), toast: vi.fn() };
});

import { listMedia, deleteFromR2 } from "@/lib/api.js";
import { confirmDialog, toast } from "@/ui/components.jsx";
import { R2LibraryAdmin } from "@/admin/superadmin.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
// clearAllMocks wipes call history but not implementations, so reset the confirm
// default each test (one test overrides it to false and must not leak).
beforeEach(() => { confirmDialog.mockResolvedValue(true); });

const IMAGES = [
  { key: "c1/owner/image/hero/aaaaaaaa-photo.jpg", name: "photo.jpg", size: 50000, uploaded: "2026-06-01T00:00:00Z" },
  { key: "c2/owner/image/story/bbbbbbbb-venue.jpg", name: "venue.jpg", size: 80000, uploaded: "2026-05-01T00:00:00Z" },
];

describe("R2LibraryAdmin", () => {
  it("fetches images on mount (with usage annotation) and renders thumbnails", async () => {
    listMedia.mockResolvedValue(IMAGES);
    render(<R2LibraryAdmin />);
    expect(listMedia).toHaveBeenCalledWith(null, "image", { usage: true });
    expect(await screen.findByTitle("photo.jpg")).toBeTruthy();
    expect(screen.getByTitle("venue.jpg")).toBeTruthy();
  });

  it("filters items by client text (case-insensitive prefix match on the key)", async () => {
    listMedia.mockResolvedValue(IMAGES);
    render(<R2LibraryAdmin />);
    await screen.findByTitle("photo.jpg");
    fireEvent.change(screen.getByPlaceholderText(/filter by client/i), { target: { value: "c1" } });
    expect(screen.queryByTitle("photo.jpg")).toBeTruthy();
    expect(screen.queryByTitle("venue.jpg")).toBeNull();
  });

  it("switches to the Audio tab and re-fetches with type=audio", async () => {
    listMedia.mockResolvedValue([]);
    render(<R2LibraryAdmin />);
    await screen.findByText(/no files/i);
    fireEvent.click(screen.getByRole("tab", { name: /audio/i }));
    expect(listMedia).toHaveBeenCalledWith(null, "audio", { usage: true });
  });

  it("shows an error state when the fetch fails", async () => {
    listMedia.mockRejectedValue(new Error("network error"));
    render(<R2LibraryAdmin />);
    expect(await screen.findByText(/network error/i)).toBeTruthy();
  });

  it("confirms and deletes an item, removing it from the list", async () => {
    listMedia.mockResolvedValue(IMAGES);
    deleteFromR2.mockResolvedValue(undefined);
    render(<R2LibraryAdmin />);
    await screen.findByTitle("photo.jpg");
    const btns = screen.getAllByRole("button", { name: /delete/i });
    fireEvent.click(btns[0]);
    await waitFor(() => expect(deleteFromR2).toHaveBeenCalledWith(IMAGES[0].key));
    expect(screen.queryByTitle("photo.jpg")).toBeNull();
    expect(screen.getByTitle("venue.jpg")).toBeTruthy();
    expect(toast).toHaveBeenCalledWith("File deleted");
  });

  it("does not delete when the confirm dialog is cancelled", async () => {
    confirmDialog.mockResolvedValue(false);
    listMedia.mockResolvedValue(IMAGES);
    render(<R2LibraryAdmin />);
    await screen.findByTitle("photo.jpg");
    fireEvent.click(screen.getAllByRole("button", { name: /delete/i })[0]);
    await waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    expect(deleteFromR2).not.toHaveBeenCalled();
    expect(screen.getByTitle("photo.jpg")).toBeTruthy();
  });

  it("hard-blocks a pre-marked in-use file: shows a block popup, never calls delete", async () => {
    const inUse = [{ ...IMAGES[0], inUse: true, usedBy: "demo" }];
    listMedia.mockResolvedValue(inUse);
    render(<R2LibraryAdmin />);
    expect(await screen.findByText("In use")).toBeTruthy();   // pre-marked badge
    fireEvent.click(screen.getAllByRole("button", { name: /delete/i })[0]);
    await waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    // block popup is OK-only and never triggers a server delete
    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ okOnly: true }));
    expect(deleteFromR2).not.toHaveBeenCalled();
    expect(screen.getByText("In use")).toBeTruthy();
  });

  it("handles a 409 in_use race: keeps the file and shows the block popup", async () => {
    listMedia.mockResolvedValue(IMAGES);
    deleteFromR2.mockRejectedValue(Object.assign(new Error("in_use"), { code: "in_use", usedBy: "demo" }));
    render(<R2LibraryAdmin />);
    await screen.findByTitle("photo.jpg");
    fireEvent.click(screen.getAllByRole("button", { name: /delete/i })[0]);
    await waitFor(() => expect(deleteFromR2).toHaveBeenCalledWith(IMAGES[0].key));
    // second confirmDialog call is the OK-only block popup
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ okOnly: true })));
    expect(toast).not.toHaveBeenCalledWith("File deleted");
    // file stays and is now marked in-use (the 409 race updates the badge)
    expect(screen.getByTitle(/photo\.jpg/i)).toBeTruthy();
    expect(screen.getByText("In use")).toBeTruthy();
  });
});
