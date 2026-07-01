// src/lib/__tests__/mediaLibrary.test.js
import { describe, it, expect } from "vitest";
import { libraryPrefix, fileNameFromKey, MEDIA_TYPES } from "@/lib/mediaLibrary.js";

describe("libraryPrefix", () => {
  it("builds the owner/<type> prefix for a client", () => {
    expect(libraryPrefix("87e2", "image")).toBe("87e2/owner/image/");
    expect(libraryPrefix("87e2", "audio")).toBe("87e2/owner/audio/");
  });
  it("sanitizes clientId like upload.js and defaults empty to 'shared'", () => {
    expect(libraryPrefix("a/b c!", "image")).toBe("abc/owner/image/");
    expect(libraryPrefix("", "image")).toBe("shared/owner/image/");
    expect(libraryPrefix("!!!", "audio")).toBe("shared/owner/audio/");
  });
  it("defaults an unknown type to 'image'", () => {
    expect(libraryPrefix("x", "video")).toBe("x/owner/image/");
    expect(libraryPrefix("x", undefined)).toBe("x/owner/image/");
  });
  it("exposes the allowed types", () => {
    expect(MEDIA_TYPES).toEqual(["image", "audio"]);
  });
});

describe("fileNameFromKey", () => {
  it("strips the last path segment's <shortid>- prefix (8 hex)", () => {
    expect(fileNameFromKey("87e2/owner/image/hero/k3x9a1b2-venue.jpg")).toBe("venue.jpg");
  });
  it("strips a Date.now() numeric shortid fallback", () => {
    expect(fileNameFromKey("87e2/owner/audio/playlist/1719800000000-song.mp3")).toBe("song.mp3");
  });
  it("returns the raw last segment when there is no shortid prefix", () => {
    expect(fileNameFromKey("87e2/owner/image/hero/venue.jpg")).toBe("venue.jpg");
    expect(fileNameFromKey("plain.png")).toBe("plain.png");
  });
  it("is safe on empty / non-string input", () => {
    expect(fileNameFromKey("")).toBe("");
    expect(fileNameFromKey(null)).toBe("");
  });
});
