import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import React from "react";

// Ticket image attachments (one per message): the original request and each
// reply render their stored R2 key as a media.celebrately.us image, and the
// composer offers an "Attach image" picker.
vi.mock("@/lib/api.js", async (orig) => ({
  ...(await orig()),
  listTicketMessages: async () => ([
    { id: "m1", ticket_id: "t1", sender_role: "superadmin", sender_name: "Support", body: "See this", attachment_url: "c1/owner/image/support/reply-shot.png", created_at: "2026-07-11T02:00:00Z" },
  ]),
  subscribeTicketMessagesRealtime: () => () => {},
}));

import { TicketThread } from "@/admin/SupportWidget.jsx";

const TICKET = {
  id: "t1", client_id: "c1", submitter_name: "Jeremy & Irish",
  message: "The map pin resets", created_at: "2026-07-11T01:00:00Z",
  attachment_url: "c1/owner/image/support/original-shot.png",
};

describe("ticket image attachments", () => {
  beforeEach(() => cleanup());

  it("renders the original request image, a reply image, and the picker", async () => {
    const { container } = render(<TicketThread ticket={TICKET} />);
    const srcs = () => [...container.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    // original request attachment
    await waitFor(() => expect(srcs().some((s) => s.includes("media.celebrately.us/c1/owner/image/support/original-shot.png"))).toBe(true));
    // reply attachment (from the mocked message list)
    await waitFor(() => expect(srcs().some((s) => s.includes("media.celebrately.us/c1/owner/image/support/reply-shot.png"))).toBe(true));
    // composer image picker
    expect(container.textContent).toContain("Attach image");
  });
});
