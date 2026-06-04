# Interactive Check-Questions + Profile-Update Reliability — Design

Date: 2026-06-01
Status: Draft (awaiting user review)
Branch: `feat/interactive-check-questions` (off `dev`)

## Phase positioning

This is a **correctness fix to already-shipped Phase 2/3 behavior**, not new phase
work. Per CLAUDE.md ("one phase at a time, no jumping ahead"), this is explicitly
scoped as a bugfix/hardening branch and does NOT begin Phase 8. It touches the tutor
agent's check-question loop and the `update_topic_profile` tool, both shipped earlier.

## Problem

Two coupled defects, both rooted in **invisible state and invisible failure**.

### Defect A — the tutor self-grades check-questions

The agent loop (`agent/tutor.py` `run` / `run_streaming`) runs up to `MAX_ITERS=8`
iterations **inside a single user turn**. The END-OF-FOCUS-AREA protocol
(`agent/prompts.py:55-58`) instructs the agent to generate check-questions **and**
call `record_learning_event` for each answer. Because the architecture has no
"yield to the human" primitive, the agent can — and intermittently does — emit a
check-question *and* fabricate the learner's answer by calling
`record_learning_event(correct=...)` in the same turn, before the learner ever sees
the question. Observed live on 2026-06-01: on one turn the agent correctly asked and
waited; the bug is the *other* branch, where it grades without a real answer. This
intermittency is the core problem: correctness currently "relies on model obedience."

There is no server-side state distinguishing "a question is open and awaiting an
answer" from ordinary assistant prose. The question renders as plain assistant text;
the composer stays fully unlocked.

### Defect B — `update_topic_profile` fails silently

`UpdateTopicProfileArgs` (`backend/contracts/models.py:74`) makes `evidence_type`
(`Literal["declared","inferred","tested"]`) a **required** field on every call. But
`profile_service.apply_patch` only *uses* `evidence_type` to gate
`add_mastered_concept` (`profile_service.py:117`). For a focus-only or
knowledge-level-only patch, `evidence_type` is required by the schema yet inert in the
logic. When the agent sets/changes `focus_target_gap` (exactly what "quiz me / set
focus" triggers) it tends to omit the conceptually-irrelevant `evidence_type`, so
`UpdateTopicProfileArgs.model_validate` raises `ValidationError`, which is caught at
`agent/tools.py:84` and returned as a generic `ToolResult(ok=False)` → the
"Profile update failed" chip. The agent then retries with a dummy `evidence_type` and
succeeds. This produces the observed fail/ok/fail/ok pattern.

The failure is undiagnosable because the error string is discarded at three layers:

1. **Backend dispatch** swallows the `ValidationError` into `ToolResult.error` with no
   log (`agent/tools.py:84-85`).
2. **GET `/sessions/{id}`** omits `tool_calls` entirely (`routes/sessions.py:147-154`),
   so resumed sessions show no tool chips at all.
3. **Frontend** stream handler reads `tool_call.summary` on the error path, but the
   `tool_call_done` error event carries `error`, not `summary`
   (`stores/session.js:250`) — the string is dropped.

**Confidence note:** Defect B's root cause is high-confidence from code inspection
(required-but-inert `evidence_type`). The literal wire error string was not captured
during live testing (SSE body not recorded). Implementation step B3 confirms the exact
message via the new logging from B2 before declaring B1 the fix.

## Goals / non-goals

Goals:
- Make tutor-grading-without-a-real-answer **impossible by construction**, not by prompt.
- Give the learner an explicit, interactive answer experience for check-questions.
- Make `update_topic_profile` stop failing on focus/level-only patches.
- Make tool-call failures observable end to end.

Non-goals (YAGNI):
- No general quiz engine. One open question at a time, one card.
- No scoring/streaks/analytics beyond the existing `LearningEvent` log.
- No multi-question batch UI. Sequences are one-question-per-turn.
- No rework of retrieval, cost, or auth.

## Locked design decisions

| Decision | Choice |
|---|---|
| Fix depth | Structural pause-state + UI affordance |
| Answer UX | Inline answer mode with on-card correct/incorrect feedback |
| Composer while pending | Hard lock — only Answer or Skip |
| Abandon mechanism | Explicit Skip button (deterministic server clear) |
| Questions per focus-area | Short sequence, up to 2-3, one per turn (prompt-governed) |
| Feedback content | Verdict (right/wrong) + one-line explanation |
| Profile-fail | Fold into this spec (workstream B) |

---

## Workstream A — Interactive check-questions

### A1. Enforcement (two layers)

The value of the fix is that self-grading becomes structurally impossible. Two layers:

**Layer B — the guarantee (server guard).** A `pending_check` record is stored on the
`Session` row: `{ gap, question, asked_at_turn }` where `asked_at_turn` is the
`turn_started_at` timestamp of the turn that asked it. `record_learning_event` is
rejected (`ok=False`) unless:
- a `pending_check` exists for this session, AND
- its `gap` matches `args.gap_tested`, AND
- `pending_check.asked_at_turn < ctx.turn_started_at` (asked in a **prior** turn).

This single guard kills both failure modes: "ask and grade in the same turn" (fails the
prior-turn check) and "grade a question that was never asked" (no `pending_check`). On a
successful grade, the server clears `pending_check`.

**Layer A — clean control flow (turn-terminating tool).** A new tool
`ask_check_question(session_id, gap, question)` registers the `pending_check` and
**terminates the agent turn**. When `tutor.run` / `run_streaming` dispatch
`ask_check_question`, after recording the tool result they **break the iteration loop**
and return the assistant turn (the question text the agent already streamed). This
models "ask, yield to the human" directly instead of trusting the agent to stop on its
own. Wired into **both** `run()` and `run_streaming()`.

Layer B is the correctness guarantee; Layer A is the clean boundary. Layer B holds even
if Layer A's loop-break is bypassed.

### A2. Prompt protocol rewrite (`agent/prompts.py`)

- END-OF-FOCUS-AREA changes from "generate 2-3 questions + log each in one turn" to:
  ask **one** question via `ask_check_question`, end the turn, grade the answer next
  turn via `record_learning_event`, then optionally ask the next — up to 2-3 across
  turns. Sequence length is prompt-governed; there is **no counter column** (fabrication
  risk is per-question, fully covered by the Layer B guard).
- New dynamic-context line `PENDING_CHECK: {gap, question}` (or `none`) so the grading
  turn knows what is open and what it is grading.
- Rules clarified: the agent must call `record_learning_event` for the open
  `PENDING_CHECK` when the next user message is an answer; it must NOT call
  `ask_check_question` and `record_learning_event` for the same gap in one turn.

### A3. Abandon / Skip

While a question is open the composer is **hard-locked** to two actions: submit an
answer, or **Skip**. Skip is deterministic and server-driven — no agent judgment:

- New endpoint `POST /api/sessions/{session_id}/check/skip` clears `pending_check` and
  returns `{ ok: true }`.
- No `user_redirected`-by-inference path is needed for abandon; the agent never has to
  decide whether the learner abandoned, because the locked composer can only emit an
  answer or a Skip.

### A4. Grading turn flow

1. Learner submits an answer (a normal user `ChatMessage`) while `PENDING_CHECK` is set.
2. Agent sees `PENDING_CHECK`, grades, calls `record_learning_event(gap, question, correct)`.
3. Server guard validates (prior-turn `pending_check` exists, gap matches), logs the
   `LearningEvent`, runs existing demotion on `correct=false`
   (`learning_event_service.record`), and **clears `pending_check`**.
4. Server emits a `check_result` stream event `{ gap, correct }`; the agent streams a
   one-line explanation as normal assistant text.
5. Card renders the verdict marker + explanation; composer unlocks.
6. Agent may then fire another `ask_check_question` (re-locking the composer) up to the
   2-3 sequence cap.

### A5. `focus_clear_reason="tested_correct"` interaction

The existing guard (`profile_service.py:130-144`) requires a correct `LearningEvent`
created `>= ctx.turn_started_at` when focus is cleared with reason `tested_correct`.
Under the new flow, grading happens in the **grading turn**, so the `LearningEvent` and
the focus-clear co-occur in that same turn — the guard remains satisfiable. This
interaction is explicitly covered by a test (see Testing).

### A6. Frontend (`CheckQuestion.vue` + composer lock)

- The question still **streams as normal assistant text** (so it is never lost); the
  `ask_check_question` tool arg carries `gap`+`question` for validation/state only.
- A new `pendingCheck` state in `stores/session.js`, set from the `check_question`
  stream event and the `pending_check` field on the chat response; cleared on
  `check_result`, on Skip, and on session change.
- `CheckQuestion.vue` renders a distinct quiz card (question + verdict slot). On
  `check_result` it shows the right/wrong marker; the explanation is the following
  assistant text bubble.
- `Composer.vue` enters answer-mode when `pendingCheck` is set: free chat disabled,
  label switches to "Answer the question", and a **Skip** control is shown. Submitting
  sends the answer through the normal streaming path; Skip calls the skip endpoint and
  clears state.

---

## Workstream B — Profile-update reliability

### B1. Conditional `evidence_type` (contract change — codegen)

Make `evidence_type` optional and only meaningful when `add_mastered_concept` is
present. Edit `docs/api/openapi.yaml` first, then run
`python backend/scripts/gen_contracts.py` (CI enforces zero drift; never hand-edit
`backend/contracts/`).

- `evidence_type: Literal["declared","inferred","tested"] | None = None`.
- `profile_service.apply_patch`: when `add_mastered_concept` is set, require a valid
  `evidence_type` (reject with a clear error if missing); otherwise ignore it. The
  existing "declared/tested promote, inferred ignored" rule is unchanged.

### B2. Diagnosability (three layers)

- **Backend dispatch** (`agent/tools.py`): log the caught exception with the tool name
  and a redacted args summary before returning `ToolResult(ok=False, error=...)`. Keep
  the error string in `ToolResult.error`.
- **GET session** (`routes/sessions.py` `_load_messages` + the `Message` contract):
  include `tool_calls` so resumed sessions render their tool chips and failures. This
  is a contract change (codegen) — add `tool_calls` to the `Message` model in
  `openapi.yaml`. (Note: aligns with the previously-deferred tool_calls/citations
  backfill.)
- **Frontend** (`stores/session.js`): on the `tool_call_done` error path, store
  `tool_call.error` (not `summary`); surface it on the tool-call chip
  (`ToolCallChip.vue`) at least on hover/title.

### B3. Confirm root cause

Using B2's new logging, capture the literal error string from a "set focus / quiz me"
turn and confirm B1 eliminates it. If the captured error reveals a different/additional
cause (e.g. the focus-clear guard or an `extra="forbid"` key), fix it in the same
workstream and note it in the plan.

---

## Data flow (happy path, interactive check-question)

```
turn N   (learner: "quiz me")
  agent -> ask_check_question(gap, question)   [tool]
         server: set pending_check = {gap, question, asked_at_turn = turn_started_at(N)}
         tutor loop BREAKS -> returns question text
         stream: check_question {gap, question}, done
  UI: CheckQuestion card; composer hard-locked (Answer | Skip)

turn N+1 (learner submits answer)
  agent -> record_learning_event(gap, question, correct)   [tool]
         server guard: pending_check exists, gap matches,
                       asked_at_turn(N) < turn_started_at(N+1)  -> OK
         log LearningEvent; demote on incorrect; clear pending_check
         stream: check_result {gap, correct}, then explanation text, done
  UI: card shows verdict + explanation; composer unlocks
       agent may ask_check_question again (<= 2-3 total)
```

Skip path: `POST /sessions/{id}/check/skip` -> clear pending_check -> UI unlocks. No grade.

## Contracts / schema changes (openapi.yaml first, then gen_contracts.py)

- New `AskCheckQuestionArgs { session_id, gap, question }`.
- `evidence_type` optional on `UpdateTopicProfileArgs` (B1).
- `tool_calls` added to the `Message` model (B2).
- `pending_check` field on `ChatResponse` (`{ gap, question } | null`).
- New stream events: `check_question { gap, question }`, `check_result { gap, correct }`.
- Alembic migration: add `pending_check` column (JSON/nullable) to the `sessions` table
  (baseline `0001_phase7_baseline.py`).

## Error handling

- `record_learning_event` without a valid prior-turn `pending_check` -> `ok=False` with
  an explicit error; the agent surfaces it briefly and does not retry destructively.
- `ask_check_question` while a `pending_check` already exists -> reject (`ok=False`); one
  open question at a time.
- Skip on a session with no `pending_check` -> idempotent `{ ok: true }`.
- All tool failures are now logged (B2) and visible on the chip.

## Testing

Backend (pytest):
- `record_learning_event` rejected when asked and graded in the same turn.
- `record_learning_event` rejected when no `pending_check` / gap mismatch.
- `record_learning_event` accepted when `pending_check` was set in a prior turn; clears it.
- `ask_check_question` sets `pending_check` and terminates the loop (both `run` and
  `run_streaming`).
- Skip endpoint clears `pending_check`; idempotent when none.
- `focus_clear_reason="tested_correct"` still satisfiable in the grading turn (A5).
- `update_topic_profile` focus-only / level-only patch succeeds **without**
  `evidence_type` (B1); `add_mastered_concept` still requires it.
- Dispatch logs on failure (B2); GET session returns `tool_calls` (B2).

Frontend (vitest):
- `pendingCheck` state set/cleared on `check_question` / `check_result` / Skip / session
  change.
- Composer locks to Answer|Skip while pending; unlocks after result.
- `CheckQuestion.vue` renders question, then verdict marker on result.
- Tool-call error string surfaced on the chip (B2).

E2E (Playwright, if in scope for the branch): quiz -> question card + locked composer ->
answer -> verdict + unlock; and quiz -> Skip -> unlock.

## Touch list

`docs/api/openapi.yaml` -> `backend/contracts/` (codegen) -> `backend/db/models.py` +
new Alembic migration -> `backend/agent/prompts.py` -> `backend/agent/tools.py` -> tool
service (extend `learning_event_service` or small `check_question_service`) +
`profile_service.py` (B1) -> `backend/agent/tutor.py` (both paths) ->
`backend/routes/chat.py` + `backend/routes/sessions.py` (skip endpoint, GET tool_calls)
-> frontend: `services/chatApi.js` / `services/chatStreamService.js`,
`stores/session.js`, new `components/chat/CheckQuestion.vue`,
`components/chat/Composer.vue`, `components/chat/MessageList.vue`,
`components/chat/ToolCallChip.vue`.
