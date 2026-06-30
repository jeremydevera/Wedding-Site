import { describe, it, expect } from "vitest";
import { mediaUrl, MEDIA_BASE } from "@/lib/media.js";

describe("mediaUrl", () => {
  it("prepends the media base to a bare R2 key", () => {
    expect(mediaUrl("87e2/owner/image/hero/k3x9-a.jpg")).toBe(MEDIA_BASE + "/87e2/owner/image/hero/k3x9-a.jpg");
  });
  it("passes through absolute http(s) urls unchanged", () => {
    expect(mediaUrl("https://x.supabase.co/storage/v1/object/public/audio/a.mp3"))
      .toBe("https://x.supabase.co/storage/v1/object/public/audio/a.mp3");
  });
  it("passes through data: URLs unchanged (legacy base64)", () => {
    expect(mediaUrl("data:image/jpeg;base64,AAAA")).toBe("data:image/jpeg;base64,AAAA");
  });
  it("passes through same-origin paths unchanged (legacy /r2/, /assets/)", () => {
    expect(mediaUrl("/r2/87e2/image/x.jpg")).toBe("/r2/87e2/image/x.jpg");
    expect(mediaUrl("/assets/invite/frame-video.gif")).toBe("/assets/invite/frame-video.gif");
  });
  it("returns empty string for empty/missing values", () => {
    expect(mediaUrl("")).toBe("");
    expect(mediaUrl(null)).toBe("");
    expect(mediaUrl(undefined)).toBe("");
  });
});
