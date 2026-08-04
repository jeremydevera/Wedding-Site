// src/admin/__tests__/applyRequiredNames.test.jsx
// Registration must REQUIRE both partner names (owner request 2026-08-04):
// visibly marked, and the wizard must refuse to advance while either is empty.
// Birthday is the documented exception — it reuses partner_a as the event title
// and has no partner B at all, so it must NOT be dragged into the same rule.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/api.js", () => ({ saveClientData: vi.fn() }));
import { ApplyWizard } from "@/admin/apply.jsx";

const $ = (sel) => document.querySelector(sel);
// the wizard has two layouts: a "Next" Button and a ".apply-mfp__next" ("Next Step")
const nextBtn = () => document.querySelector(".apply-mfp__next")
  || [...document.querySelectorAll("button")].find((b) => /^next\b/i.test(b.textContent.trim()));
const reqStar = (id) => {
  const inp = document.getElementById(id);
  const field = inp && inp.closest(".field");
  return !!(field && field.querySelector(".field__req"));
};
// step 0 also gates on phone + a free subdomain; fill the phone so the only
// thing standing between us and step 1 is the name under test.
const fillPhone = () => { const el = $("#a-phone"); if (el) fireEvent.change(el, { target: { value: "09171234567" } }); };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("registration — partner names are required", () => {
  it("marks BOTH partner fields as required", () => {
    render(<ApplyWizard presetEmail="her@example.com" />);
    expect($("#a-pa")).toBeTruthy();
    expect($("#a-pb")).toBeTruthy();
    expect(reqStar("a-pa")).toBe(true);
    expect(reqStar("a-pb")).toBe(true);
  });

  it("refuses to advance when partner B is missing, and names which one", () => {
    render(<ApplyWizard presetEmail="her@example.com" />);
    fireEvent.change($("#a-pa"), { target: { value: "Romeo" } });
    fillPhone();
    fireEvent.click(nextBtn());
    // still on step 0, with a message that says WHICH name is missing
    expect(document.body.textContent).toMatch(/Partner B's first name/i);
    expect($("#a-pa")).toBeTruthy();
  });

  it("refuses to advance when partner A is missing", () => {
    render(<ApplyWizard presetEmail="her@example.com" />);
    fireEvent.change($("#a-pb"), { target: { value: "Juliet" } });
    fillPhone();
    fireEvent.click(nextBtn());
    expect(document.body.textContent).toMatch(/Partner A's first name/i);
  });

  it("asks for both when neither is filled", () => {
    render(<ApplyWizard presetEmail="her@example.com" />);
    fillPhone();
    fireEvent.click(nextBtn());
    expect(document.body.textContent).toMatch(/both partners' first names/i);
  });

  it("birthday asks for an event title instead — no partner B field at all", () => {
    render(<ApplyWizard presetEmail="her@example.com" />);
    const type = $("#a-type") || document.querySelector("select");
    fireEvent.change(type, { target: { value: "birthday" } });
    expect($("#a-title")).toBeTruthy();
    expect(reqStar("a-title")).toBe(true);
    expect($("#a-pb")).toBeNull(); // by design: birthdays have no second partner
  });
});
