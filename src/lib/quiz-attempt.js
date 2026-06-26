// Per-device, per-client "already played the quiz" guard.
// Soft restriction via localStorage — a guest can replay by clearing storage,
// using incognito, or a different device. That's the accepted trade-off for an
// anonymous (no-login) wedding quiz.
// See docs/superpowers/specs/2026-06-26-quiz-single-attempt-design.md
import { resolveSubdomain } from "@/lib/tenant.js";

// Pure: the localStorage key for a given client's quiz. Keyed on subdomain so
// each client's quiz is independent and the key is stable from first render.
export function quizDoneKey(subdomain) {
  return `quizDone:${subdomain || "demo"}`;
}

// localStorage can throw (Safari private mode). Always fail safe.
function safe(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}

export function hasPlayedQuiz() {
  return safe(() => localStorage.getItem(quizDoneKey(resolveSubdomain())) === "1", false);
}

export function markQuizPlayed() {
  safe(() => localStorage.setItem(quizDoneKey(resolveSubdomain()), "1"));
}

export function clearQuizPlayed() {
  safe(() => localStorage.removeItem(quizDoneKey(resolveSubdomain())));
}
