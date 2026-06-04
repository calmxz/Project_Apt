# Interactive Multiple-Choice Check-Questions — Design

Date: 2026-06-04
Status: Approved (brainstorming), pending implementation plan
Supersedes the free-text answer flow in [`2026-06-01-interactive-check-questions-design.md`](2026-06-01-interactive-check-questions-design.md).

## Problem

Today a check-question is open-ended: the tutor asks, the learner types an answer
into the chat composer, and a *second* LLM turn grades it via
`record_learning_event`. This is slow (~10s grading turn), costs an LLM call per
answer, and offers no claude.ai-style click-to-answer interaction.

## Goal

Make check-questions interactive multiple-choice cards: the tutor supplies the
options and the correct one; the learner clicks; the server grades instantly
(no LLM) and silently records the result into the adaptive profile.

## Decisions (locked during brainstorming)

1. **Deterministic grading.** The agent supplies `options` + `correct_index`.
   A click is graded server-side by index comparison — no LLM call.
2. **Silent record.** The card flips to a verdict + one-sentence explanation
   inline. The LearningEvent is written and the profile updated server-side
   (demotion on incorrect mastered concept). No automatic follow-up LLM turn;
   the tutor sees the result on the learner's next message.
3. **Always multiple-choice.** `ask_check_question` always requires options.
   The old free-text typing path and its LLM grading turn are removed.

## Anti-cheat boundary (security)

`correct_index` and `explanation` MUST NOT reach the client before the learner
answers. They are stored server-side only. The public projection of a pending
check exposes `{gap, question, options}` and nothing else. Grading happens on
the server; the client sends only the selected index and receives the verdict.

## Approaches considered

- **A (chosen).** New REST endpoint `POST /sessions/{id}/check/answer`. Server
  grades by index, records the event, returns the verdict. No LLM, no streaming,
  answer never leaves the server.
- **B (rejected).** Client receives `correct_index` and grades itself. Leaks the
  answer; client-trusted grading is trivially cheatable via devtools.
- **C (rejected).** Route the answer back through a chat turn and auto-grade
  before invoking the LLM. Still costs a turn; more moving parts than A.

## Contract changes

Edit `docs/api/openapi.yaml` first, then run codegen
(`python backend/scripts/gen_contracts.py`). CI enforces zero drift.

```
AskCheckQuestionArgs:
    session_id, gap, question            (existing)
    options: list[str]   # 2-4 items
    correct_index: int   # 0-based, < len(options)
    explanation: str     # one sentence, shown after answering

PendingCheck (public, returned to frontend):
    gap, question                        (existing)
    options: list[str]   # NO correct_index, NO explanation
```

New `CheckAnswerRequest`: `{ selected_index: int }`.
New `CheckAnswerResponse`: `{ correct: bool, explanation: str, correct_index: int }`.

Stored `Session.pending_check_json` gains the server-only fields:

```
{ gap, question, options, correct_index, explanation, asked_at_turn }
```

`check_question_service.public_view()` strips the stored dict to
`{gap, question, options}` — this is the anti-cheat boundary and must be unit
tested to never emit `correct_index` or `explanation`.

## Backend changes

### `services/check_question_service.py`
- `set_pending_check(...)` stores `options`, `correct_index`, `explanation`.
- `public_view(...)` adds `options`, never the answer fields.
- `register(...)` (the `ask_check_question` tool handler) persists the new fields.

### `services/learning_event_service.py`
- Add `record_from_answer(db, session_id, gap, question, correct)`:
  writes the `LearningEvent`, demotes the gap from `mastered_concepts` when
  `correct is False`, clears the pending check — all in one transaction,
  mirroring `record()`. **Bypasses the `is_gradable` turn-barrier guard.**
  Rationale: the turn-barrier exists to stop the *LLM* from asking and
  self-grading in one turn. A human click is not the LLM, so the barrier does
  not apply. The existing `record()` and its barrier remain for any LLM path.

### `routes/sessions.py`
- New `POST /sessions/{session_id}/check/answer` taking `CheckAnswerRequest`.
  - Ownership check (404 if not owner / not found), mirroring `skip_check`.
  - 404/409 if no pending check is open.
  - Validate `selected_index` in range `[0, len(options))` (422 otherwise).
  - `correct = selected_index == correct_index`.
  - Call `record_from_answer(...)`.
  - Return `CheckAnswerResponse{correct, explanation, correct_index}`.

### `agent/` (tutor + tools + prompts + stream)
- `ask_check_question` tool: validate and forward `options`, `correct_index`,
  `explanation`.
- **Remove** the `record_learning_event` tool from the agent toolset and the
  `check_result` stream emit — grading is no longer the LLM's job.
- `agent/prompts.py`: instruct the tutor that every check-question must provide
  3-4 plausible options, exactly one correct, set `correct_index`, and write a
  one-sentence `explanation`. Remove self-grading / "wait for typed answer"
  instructions.

### Focus-clear integration

The `focus_clear_reason="tested_correct"` guard verifies that a correct
`LearningEvent` was logged "that turn". Click-grading writes the event outside
an LLM turn, so the guard must accept a correct click-recorded event from a
prior turn for the focused gap. The implementation plan will specify the exact
relaxation (e.g. "a correct LearningEvent for this gap exists since it was last
focused") and its test. This is the one cross-cutting integration point.

## Frontend changes

### `stores/session.js`
- `pendingCheck` shape becomes
  `{ gap, question, options, verdict, selectedIndex, explanation, correctIndex }`.
- `handleCheckQuestion` / `loadSession` / `sendMessage` map `options` through.
- New action `answerCheck(index)`: POST `/check/answer`, then set
  `verdict`, `selectedIndex`, `explanation`, `correctIndex` from the response.
- `checkLocked` (composer lock) unchanged: locked while `verdict === null`.
  Skip still clears.

### `services/sessionsApi.js`
- Add `answerCheck(sessionId, selectedIndex)`.

### `components/chat/CheckQuestion.vue`
- Render `options` as a radio-style list of buttons.
- Click an option (only while unanswered) → `answerCheck(index)`.
- After answering: disable all options, mark the selected one, highlight the
  correct option green and an incorrect pick amber, show `explanation`, show
  the existing Correct / Not quite verdict line.
- Skip button remains until answered.

## Testing

Backend:
- Contract drift test passes after codegen.
- `public_view` never emits `correct_index` / `explanation` (anti-cheat).
- `record_from_answer`: correct path, incorrect path, demotion of a mastered
  gap, clears pending, no-op when no pending check.
- Answer endpoint: 404 (not found / not owner), no-pending, out-of-range index
  (422), correct and incorrect happy paths return the right verdict.

Frontend:
- `CheckQuestion.vue`: renders options; click calls `answerCheck`; post-answer
  shows verdict + explanation + correct/incorrect highlighting; options disabled
  after answering.
- store `answerCheck`: sets verdict/selectedIndex/explanation/correctIndex and
  unlocks the composer.

## Out of scope (YAGNI)

- Per-option explanations (one explanation string suffices).
- Auto follow-up LLM turn after answering.
- Retaining the free-text answer path.
