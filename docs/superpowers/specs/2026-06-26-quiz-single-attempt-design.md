# Quiz: one attempt per device — design

**Date:** 2026-06-26
**Status:** approved

## Goal

Stop a guest from taking the Couple Quiz more than once. Quiz takers are
anonymous (no login), so enforcement is soft and device-local.

## Decisions

- **Strictness:** soft, per-device via `localStorage`. Accepted limitation:
  cleared cache / incognito / a different device can replay. Right trade-off
  for a fun, no-login wedding quiz.
- **Return behavior:** locked screen, **no score shown**. Friendly
  "You already played! 🎉 Thanks for taking the couple quiz." No Start button.
- **No database / RLS change.** Purely client-side. (Contrast: the venue cards
  needed `clients.content`; this does not.)
- **Owner escape hatch:** `?retake=1` in the URL clears the flag so the owner
  can re-demo without clearing their browser.

## Mechanism

- localStorage key: `quizDone:<subdomain>` (keyed on `resolveSubdomain()` so each
  client's quiz is independent and the key is stable from first render — avoids
  the null/late `clientId` timing problem). Apex/demo → `quizDone:demo`.
- Value: `"1"` once the quiz is finished (after the submit attempt, success or not).

## Components

- **`src/lib/quiz-attempt.js`** (new) — small, testable guard:
  - `quizDoneKey(subdomain)` — pure; returns the storage key.
  - `hasPlayedQuiz()` / `markQuizPlayed()` / `clearQuizPlayed()` — read/write/remove,
    each wrapped in try/catch (Safari private mode throws on `localStorage`).
- **`src/features/social.jsx` `QuizPage`** — new `"locked"` stage:
  - Initial stage computed once: if `?retake=1` → `clearQuizPlayed()` and start at
    `intro`; else `hasPlayedQuiz() ? "locked" : "intro"`.
  - `finish()` calls `markQuizPlayed()` after the `postQuiz` attempt, before
    showing the result.
  - `locked` render: `PageHero` + a centered card with the message, no Start, no score.

## Error handling

- All `localStorage` access is wrapped; on any error the guard **fails open**
  (treats the guest as not-yet-played) so a storage failure never blocks the quiz.

## Testing

- `src/lib/__tests__/quiz-attempt.test.js`:
  - `quizDoneKey` returns `quizDone:<sub>` and `quizDone:demo` when blank.
  - round-trip: `markQuizPlayed()` → `hasPlayedQuiz()` true → `clearQuizPlayed()` → false
    (jsdom provides `localStorage`).

## Out of scope

- Cross-device / per-person enforcement (would need login or email verification).
- Leaderboard de-duplication on the server.
