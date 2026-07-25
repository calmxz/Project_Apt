# Diagnostic Consent — Design

Date: 2026-07-25
Status: Approved (brainstorm session 2026-07-25)

## Problem

Since PR #99, a fresh session (topic profile `knowledge_level IS NULL`) injects
`DIAGNOSTIC: REQUIRED` into the system prompt every turn, and the prompt block
mandates: call `ask_check_questions` with 3 MC items **before any teaching**,
regardless of what the learner typed. A learner opening with "where should I
start with this topic?" gets an unexplained quiz instead of an answer.

Desired behavior: the diagnostic becomes consent-based. The tutor addresses the
learner's message, then offers a choice — take the quick check, or self-report
a level. The quiz only fires when the learner asks for it or accepts the offer.

## Decision summary

Hybrid of two mechanisms, decided with the user:

1. **Prompt rewrite (backend, prompt-only)** — tutor never force-fires; offers
   quiz or self-report; explicit "quiz me" fires immediately.
2. **Consent card (frontend, deterministic UI)** — SessionView renders a card
   with the same choices, driven by `knowledge_level === null` from the
   existing profile GET. Gives a deterministic consent path that does not
   depend on LLM compliance.

Locked choices:

- **On decline of the quiz offer:** tutor asks for a self-reported level and
  writes it via the existing `update_topic_profile` tool with
  `evidence_type="declared"`. Level gets set either way, so the
  `diagnostic_required` flag dies naturally — no new state, no nagging.
- **Offer timing:** address the learner's intent briefly at a neutral level and
  make the offer in the same turn. No teaching depth until level is known.
- **Redundancy stance:** card and conversational offer may both appear.
  Accepted — harmless; no suppression signal.

## What does NOT change (load-bearing invariants)

- `routes/chat.py:78` — `diagnostic_required = profile.knowledge_level is None`.
  Stays. The flag remaining true across turns is what keeps the offer alive
  with zero new state.
- `check_question_service.py` purpose derivation — flag true → any
  `ask_check_questions` batch gets `purpose="diagnostic"`. Correct: any quiz
  taken before the level is known IS the diagnostic.
- `diagnostic_service.grade_if_diagnostic` and `level_for_score` — untouched.
- F-25 (all-skip = zero evidence, level stays None) — now re-offers instead of
  re-forcing next turn. Follows automatically.
- F-39 (user PATCH mid-batch wins over diagnostic grade) — untouched; it is
  what makes the card's PATCH path safe against an in-flight quiz.
- Review-gaps precedence (`chat.py:105` forces flag off) — untouched.
- No OpenAPI/contract change. No migration. No new routes.

## Part 1 — Prompt rewrite (`backend/agent/prompts.py`)

Replace the `KNOWLEDGE DIAGNOSTIC` block (currently ~lines 110-115). New
semantics when `DIAGNOSTIC: REQUIRED`:

- Do NOT call `ask_check_questions` unprompted.
- In the first response of the session: briefly address the learner's message
  at a neutral level, then in the same turn offer the choice — a quick
  3-question check, or self-reporting a level
  (beginner / intermediate / advanced).
- If the learner explicitly asks to be quizzed (any turn, any phrasing):
  call `ask_check_questions` immediately with exactly 3 multiple-choice items
  on the TOPIC at increasing difficulty (easy, medium, hard) — the existing
  shape, so grading is unchanged.
- If the learner self-reports a level: call `update_topic_profile` with
  `knowledge_level` and `evidence_type="declared"`.
- If the learner declines or ignores both options: teach beginner-friendly.
  Do not repeat the offer every turn; re-offer only when it arises naturally.
- `DIAGNOSTIC: OFF` → normal check-question protocol (unchanged wording).
- REVIEW-GAPS MODE block keeps its existing "do not run the diagnostic" line.

The `DIAGNOSTIC: REQUIRED/OFF` label itself is unchanged — only the
instruction block's meaning changes.

## Part 2 — Consent card (frontend)

New component `DiagnosticConsentCard.vue`, rendered by SessionView at the top
of the chat area above the composer. Flat styling per current design language
(PR #158).

**Data source:** SessionView fetches `GET /profile/{session_id}` when the
active session loads (endpoint exists; response carries `knowledge_level` and
the ETag needed for PATCH). No contract change. `diagnostic_required` is
derived client-side as `knowledge_level === null`.

**Render condition:** derived flag is true AND there is no open pending check
AND the session is not in review-gaps seed mode.

**Actions:**

- **"Quiz me (3 quick questions)"** — sends the canned chat message
  "Quiz me to gauge my level" through the existing send path. The prompt's
  explicit-request rule fires the diagnostic deterministically. Card hides
  while the resulting check batch is open (render condition) and stays gone
  once grading sets the level.
- **Beginner / Intermediate / Advanced** — existing WS-E
  `PATCH /profile/{session_id}` with `If-Match` ETag sets `knowledge_level`
  (server records declared-style provenance as today). On success, card hides.
- **Dismiss (×)** — local component state only, not persisted. Card reappears
  on next session visit while the level is unset. The tutor's conversational
  offer remains the fallback.

**Error path:** PATCH 412 (ETag conflict) → refetch profile; if
`knowledge_level` is now set (e.g. a concurrent quiz graded), hide the card;
otherwise retry surface per existing profile-edit UX.

## Testing

- `backend/tests/test_prompts.py` — update diagnostic-block assertions: offer
  semantics present; "Do not teach or explain first" force-fire language gone;
  explicit-request rule present.
- Existing diagnostic tests (`test_diagnostic_grading.py`,
  `test_check_question_service.py`, route tests) must stay green unmodified —
  server behavior is unchanged by design.
- Frontend vitest — card render conditions (flag true/false, pending check
  open, review-gaps seed), the three action branches, dismiss behavior, and
  the 412 refetch path.
- **Reliability checkpoint (paid, deferred allowed):** live eval that the
  tutor (a) does not force-fire on a first-turn content question and (b) fires
  immediately on an explicit quiz request. Threshold >=85% per CLAUDE.md; 2-3
  prompt iterations then model-swap fallback. May be batched into the
  owed-smokes ledger.

## Out of scope

- Suppressing the inline offer when the card is visible (redundancy accepted).
- Persisting card dismissal server-side.
- Any change to diagnostic grading, batch shape, or profile schema.
