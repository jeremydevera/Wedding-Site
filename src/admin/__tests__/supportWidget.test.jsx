import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { SupportWidget } from "@/admin/SupportWidget.jsx";

// Render-crash safety net (like the public-pages smoke tests): the sticky
// support launcher must mount, open its form, and validate — without throwing.
describe("SupportWidget", () => {
  beforeEach(() => { cleanup(); try { sessionStorage.clear(); } catch (_) {} });

  it("renders the launcher without crashing", () => {
    const { container } = render(<SupportWidget tab="home" />);
    expect(container.textContent).toContain("Need help?");
  });

  it("opens the ticket form when the launcher is clicked", () => {
    const { getByText } = render(<SupportWidget tab="home" />);
    fireEvent.click(getByText("Need help?"));
    // Modal portals to document.body
    expect(document.body.textContent).toContain("How can we help?");
    expect(document.body.textContent).toContain("Send ticket");
  });
});
