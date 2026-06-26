import { describe, it, expect, beforeEach } from "vitest";
import { quizDoneKey, hasPlayedQuiz, markQuizPlayed, clearQuizPlayed } from "@/lib/quiz-attempt.js";

describe("quizDoneKey", () => {
  it("keys on the subdomain", () => {
    expect(quizDoneKey("janandirish")).toBe("quizDone:janandirish");
  });
  it("falls back to demo when blank", () => {
    expect(quizDoneKey("")).toBe("quizDone:demo");
    expect(quizDoneKey(null)).toBe("quizDone:demo");
  });
});

// jsdom hostname is "localhost" -> resolveSubdomain() returns "demo".
describe("play guard round-trip", () => {
  beforeEach(() => { localStorage.clear(); });

  it("starts not-played", () => {
    expect(hasPlayedQuiz()).toBe(false);
  });
  it("mark -> has -> clear -> not", () => {
    markQuizPlayed();
    expect(hasPlayedQuiz()).toBe(true);
    expect(localStorage.getItem("quizDone:demo")).toBe("1");
    clearQuizPlayed();
    expect(hasPlayedQuiz()).toBe(false);
  });
});
