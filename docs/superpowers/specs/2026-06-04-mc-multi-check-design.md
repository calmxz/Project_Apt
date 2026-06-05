# Multi-Question Check Batches — Design

Date: 2026-06-04
Status: Approved (brainstorming) — pending spec review
Branch: `feat/mc-multi-check`
Supersedes the single-question behavior in
[`2026-06-04-interactive-mc-check-questions-design.md`](2026-06-04-interactive-mc-check-questions-design.md)
for the batching and post-batch follow-up concerns only. All anti-cheat,
deterministic-grading, and profile rules from that doc remain in force.

## 1. Problem

Today a check-question is strictly one-at-a-time: the `register` tool rejects a
second question while one is open (`check_question_service.py:126`), and
`pending_check` is a single JSON blob on the session row. After the learner
answers, the card sits in a terminal verdict state and nothing advances until
the learner types a new message.

We want:

- A tutor turn may pose **1..N** check-questions as one batch.
- The card shows the current question with a `current/total` label (e.g. `1/3`)
  when `total > 1`.
- After answering, the learner advances with **Next** (more questions) or
  **Done** (last question). A single-question batch shows only **Done**.
- When the batch fully resolves, a **hidden** tutor follow-up turn fires that
  **reacts to the results** (praise, re-teach the missed gap), with no visible
  user message.

## 2. Decisions (locked in brainstorming)

| Decision | Choice |
|---|---|
| Source of multiple questions | Tutor asks a **batch** in one tool call |
| Question count cap | **1–5** per batch |
| Tool surface | **Migrate** `ask_check_question` -> `ask_check_questions` (single is `len==1`) |
| Verdict display | Show verdict + explanation, **advance on click** (Next / Done) |
| Skip | **Per-question**: skip current, advance. No "skip all" |
| Final message | **Auto-fire**, **reacts to results** |
| Follow-up visibility | **Hidden trigger** — only the tutor reply appears |
| Follow-up mechanism | **Injected server-built summary** (not tutor self-query) |
| Follow-up endpoint | **Dedicated** `POST /sessions/{id}/check/complete` (SSE) |
| Follow-up rate limit | **Not** counted against daily message limit; still cost-cap gated/recorded |

## 3. Flow

```
Tutor turn -> ask_check_questions(gap, items[1..5])   (turn-terminating)
  Card: Q[current], eyebrow "current/total" when total>1, options clickable
  Answer Q[i]:
    POST /check/answer {index:i} -> server grades item i deterministically,
      records LearningEvent (demotion may fire per-answer), advances current_index
    Card shows verdict + explanation
      has_next -> [Next  (i+2)/N]    last -> [Done]
  Skip Q[i]: POST /check/skip {index:i} -> mark skipped (no event), advance
  Batch resolved (all answered or skipped):
    card closes
    POST /check/complete (SSE) -> server builds results summary, injects into a
      non-persisted synthetic turn, clears pending_check, streams tutor reaction
    Only the assistant reply is persisted/shown.
```

If the learner types a normal message **mid-batch** instead of answering, the
card persists (server still holds `pending_check`), the normal turn proceeds
with the partial batch in the prompt, and the auto follow-up does **not** fire.
The follow-up fires only on full resolution via `/check/complete`.

## 4. Contract changes (openapi.yaml -> `gen_contracts.py`; never hand-edit `contracts/models.py`)

### 4.1 Tool args — replace `AskCheckQuestionArgs` with `AskCheckQuestionsArgs`

```yaml
AskCheckQuestionsArgs:
  type: object
  additionalProperties: false
  required: [session_id, gap, items]
  description: |
    Register an ordered batch of 1..5 multiple-choice check-questions and end
    the turn. The first question's text is also streamed as assistant text.
    Per-item correct_index must be < len(options); enforced in
    check_question_service, not here.
  properties:
    session_id: { type: string, maxLength: 64 }
    gap:        { type: string, maxLength: 200 }
    items:
      type: array
      minItems: 1
      maxItems: 5
      items:
        type: object
        additionalProperties: false
        required: [question, options, correct_index, explanation]
        properties:
          question:      { type: string, maxLength: 1000 }
          options:
            type: array
            minItems: 2
            maxItems: 4
            items: { type: string, maxLength: 200 }
          correct_index: { type: integer, minimum: 0 }
          explanation:   { type: string, maxLength: 500 }
```

A single shared `gap` for the batch (questions probe one focus area). If a
future need arises for per-item gaps, add an optional per-item `gap`; out of
scope now (YAGNI).

### 4.2 `PendingCheck` — public projection becomes batch-shaped

```yaml
PendingCheck:
  type: object
  additionalProperties: false
  required: [gap, current_index, total, items]
  description: |
    An open check-question BATCH awaiting learner answers. PUBLIC projection.
    Per item: question + options are always present. correct_index, explanation,
    selected_index, correct are present ONLY for already-answered (or skipped)
    items — never leaked for pending ones.
  properties:
    gap:           { type: string }
    current_index: { type: integer }   # index of the next unanswered item
    total:         { type: integer }
    items:
      type: array
      items:
        type: object
        additionalProperties: false
        required: [question, options, status]
        properties:
          question: { type: string }
          options:  { type: array, items: { type: string } }
          status:   { type: string, enum: [pending, answered, skipped] }
          # revealed only when status != pending:
          selected_index: { type: [integer, "null"], default: null }
          correct_index:  { type: [integer, "null"], default: null }
          correct:        { type: [boolean, "null"], default: null }
          explanation:    { type: [string, "null"],  default: null }
```

### 4.3 Answer request/response — carry the index, report progress

```yaml
CheckAnswerRequest:
  type: object
  additionalProperties: false
  required: [index, selected_index]
  properties:
    index:          { type: integer, minimum: 0 }  # must equal current_index
    selected_index: { type: integer, minimum: 0 }

CheckAnswerResponse:
  type: object
  additionalProperties: false
  required: [correct, explanation, correct_index, current_index, total, has_next, done]
  properties:
    correct:       { type: boolean }
    explanation:   { type: string }
    correct_index: { type: integer }
    current_index: { type: integer }   # advanced
    total:         { type: integer }
    has_next:      { type: boolean }
    done:          { type: boolean }    # true when no items remain
```

### 4.4 Skip request/response — per-question

```yaml
CheckSkipRequest:
  type: object
  additionalProperties: false
  required: [index]
  properties:
    index: { type: integer, minimum: 0 }  # must equal current_index

CheckSkipResponse:
  type: object
  additionalProperties: false
  required: [current_index, total, has_next, done]
  properties:
    current_index: { type: integer }
    total:         { type: integer }
    has_next:      { type: boolean }
    done:          { type: boolean }
```

`ChatResponse.pending_check` and `SessionDetail.pending_check` keep their
`oneOf[PendingCheck, null]` refs — shape changes flow through automatically.

## 5. Backend — `check_question_service`

Stored `pending_check_json` shape (server-only fields included):

```json
{
  "gap": "Big-O",
  "current_index": 1,
  "asked_at_turn": "<iso8601>",
  "items": [
    {"question": "...", "options": ["..."], "correct_index": 1,
     "explanation": "...", "status": "answered",
     "selected_index": 3, "correct": false},
    {"question": "...", "options": ["..."], "correct_index": 0,
     "explanation": "...", "status": "pending",
     "selected_index": null, "correct": null}
  ]
}
```

Functions:

- `register(db, ctx, args: AskCheckQuestionsArgs)` — reject if a batch is already
  open; validate `1 <= len(items) <= 5` and each `0 <= correct_index <
  len(options)`; store all items `status="pending"`, `current_index=0`,
  `asked_at_turn=ctx.turn_started_at`. Return `data` for the stream event:
  `{gap, items:[{question,options}], total}`.
- `public_view(pc)` — project to the §4.2 shape; reveal answer fields only for
  items whose `status != "pending"`.
- `answer(db, session_id, index, selected_index)` — assert `index ==
  current_index` (else 409/422); compute `correct = selected_index ==
  item.correct_index`; `record_from_answer(...)` (LearningEvent + any demotion);
  set item `status="answered"`, `selected_index`, `correct`; `current_index +=
  1`. Return verdict + `has_next/done`.
- `skip(db, session_id, index)` — assert `index == current_index`; set
  `status="skipped"`; `current_index += 1`; no LearningEvent. Return
  `has_next/done`.
- `is_done(pc)` — `current_index >= total`.
- `clear_pending_check` — unchanged; called by `/check/complete` after the
  summary is built.

Ordering guard: answering/skipping out of order (`index != current_index`) is
rejected. This keeps the state machine linear and the "1/N" label honest.

## 6. Backend — routes (`routes/sessions.py`)

- `POST /sessions/{id}/check/answer` — body `CheckAnswerRequest`; ownership
  check; delegate to `check_question_service.answer`; return
  `CheckAnswerResponse`.
- `POST /sessions/{id}/check/skip` — body `CheckSkipRequest`; delegate to
  `check_question_service.skip`; return `CheckSkipResponse`.
- `POST /sessions/{id}/check/complete` — **new SSE endpoint** (the hidden
  follow-up):
  1. Ownership check; load `pending_check`; if absent or not `is_done`, return
     409 (nothing to complete).
  2. Cost-cap gate (`cost_meter.check_cap`); if not allowed, emit a
     `daily_cost_cap_reached` SSE error and return (card already closed).
  3. **Do not** call `rate_limit.check_and_increment` (system-initiated turn).
  4. Build the results summary server-side from the stored items, e.g.:
     ```
     [check results] gap=Big-O: 2/3 correct.
       Q2 missed: learner chose "O(100n)", correct "O(n)".
       Q3 skipped.
     ```
  5. Clear `pending_check`.
  6. Build messages = recent history + a **synthetic, non-persisted** user turn
     whose content is the summary; build the system prompt the usual way
     (profile already reflects per-answer demotions). Stream via
     `tutor.run_streaming`, which persists only the assistant reply.

The synthetic summary turn is never written to `ChatMessage`, so the transcript
shows only the tutor's reaction. Cost is recorded inside `run_streaming` as
normal.

## 7. Backend — tutor loop & prompts

- `tutor.py`: rename the turn-terminating tool to `ask_check_questions` in all
  four sites — sibling-filter `:100` (non-stream) and `:391` (stream),
  `_summarize :219`, and the `check_question` StreamEvent emit `:446`. The
  `check_question` event payload becomes batch-shaped:
  `{gap, items:[{question,options}], total}`.
- `prompts.py`: rewrite the CHECK-QUESTION PROTOCOL block — replace
  "one question per turn" with batch guidance (1–5 questions probing one focus
  gap, each with 2–4 options, exactly one correct, 0-based `correct_index`, a
  one-sentence explanation). Keep "you do NOT grade" and "only one batch open at
  a time". Update the `PENDING_CHECK` dynamic-context render (`:107`) to be
  batch/progress aware, e.g. `{"gap": "...", "answered": 2, "total": 3}`.

## 8. Frontend

- `services/sessionsApi.js`: `answerCheck(sessionId, index, selectedIndex)` and
  `skipCheck(sessionId, index)` send the index; add `completeCheck(sessionId)`
  to open the `/check/complete` SSE stream (reuse the existing chat SSE client).
- `stores/session.js`:
  - `pendingCheck` shape: `{gap, items, currentIndex, total}` where each item
    carries its own `status/selectedIndex/correctIndex/correct/explanation`.
  - `handleCheckQuestion({gap, items, total})` — set batch, `currentIndex=0`.
  - `answerCheck(index)` — POST, write the item's result, set `currentIndex`
    from the response. Keep the concurrency/re-answer guard (per item).
  - `skipCheck(index)` — POST, advance. If the skip resolves the batch
    (`done === true`), fire `completeCheck()` immediately (same single-fire
    guard as Done) since there is no verdict to dwell on.
  - **View vs server index**: the store tracks a local `viewIndex` (the item
    currently displayed) separate from the server `currentIndex` (next
    unanswered). After answering item `i`, the response advances
    `currentIndex` to `i+1`, but `viewIndex` stays at `i` so the verdict +
    explanation remain visible. Clicking **Next** moves `viewIndex` to
    `currentIndex`. A skip advances both at once (no verdict to dwell on).
  - **Done**: when the answered item is the last (`done === true`), show
    `[Done]` instead of `[Next]`. Clicking `[Done]` calls `completeCheck()`
    exactly once (guard against double-fire), clears the card, and streams the
    reaction into messages like a normal assistant turn. The follow-up fires on
    the Done click, never silently — the learner must see the final verdict
    first.
  - `sendMessageStreaming`/`sendMessage`: typing mid-batch does not fire the
    follow-up and does not clear an unfinished batch.
  - GET-session mapping (`:86`) rebuilds the batch at `current_index` with prior
    answered verdicts visible.
- `components/chat/CheckQuestion.vue`: render the current item only; show
  `{{current+1}}/{{total}}` eyebrow when `total > 1`; per-item verdict +
  explanation after answering; `[Next]` when `has_next` else `[Done]`; per-item
  `[Skip]`.

## 9. Tests

Backend:
- `check_question_service`: batch register (bounds 1..5, per-item option/index
  validation), in-order answer/skip enforcement, advance + `is_done`, anti-cheat
  projection (pending items leak nothing; answered items reveal).
- `/check/answer` + `/check/skip`: index handling, 409 when no batch / out of
  order, ownership.
- `/check/complete`: 409 when not done; cost-cap gate; summary builder content;
  no user `ChatMessage` persisted; assistant reply persisted; rate limit NOT
  incremented.
- tutor loop: `ask_check_questions` turn-terminating + sibling-filter; batch
  `check_question` event payload.
- contract drift (`gen_contracts.py` -> zero diff).

Frontend:
- `1/N` nav, Next advances, single-question -> Done closes, per-item skip
  advances, follow-up fires exactly once on done, double-click guard, resume
  mid-batch renders correct question + prior verdicts.

## 10. Risk register (final)

| # | Risk | Status |
|---|---|---|
| 1 | Focus-clear `tested_correct` guard vs follow-up turn | Closed — guard already removed (`profile_service.py:8`) |
| 2 | `is_gradable` turn-boundary vs route grading | Closed — `record_from_answer` bypasses it (as today) |
| 3 | Answer leak on resume | Closed — `public_view` reveals only non-pending items |
| 4 | Second batch / ask+grade same turn | Closed — `register` rejects; sibling-filter preserved |
| 5 | Follow-up double-fire | Mitigated — client fires `/check/complete` once with a guard; server 409s if not `is_done` |
| 6 | Follow-up visible bubble / quota burn | Closed — dedicated `/check/complete`, non-persisted synthetic turn, no rate-limit increment |
| 7 | Cost cap hit at batch completion | Handled — `/check/complete` emits cap error, skips silently; card already closed |
| 8 | Reaction reflects stale profile (double-count) | Handled — demotions recorded per-answer; summary built after, reflects post-mutation state |
| 9 | Tool rename misses a site | Mitigated — 6 sites enumerated (§7) + tests |
| 10 | Tutor batch-sizing reliability | Watch — prompt iteration may be needed; existing Phase-2 `update_topic_profile` >=85% checkpoint unaffected |
| 11 | Typing mid-batch leaves card lingering (no "skip all") | Accepted — per §3; revisit only if it annoys in smoke |

## 11. Out of scope (YAGNI)

- Per-item `gap` (batch shares one focus gap).
- "Skip all / dismiss batch" button.
- Auto-advance timers (advance is click-driven).
- Re-ordering or editing a batch after registration.

## 12. Smoke (manual, paid — like prior MC work)

After implementation + green CI: live-LLM session, ask the tutor to quiz on a
topic, verify a multi-question batch renders with `1/N`, Next/Done work, a
per-item skip advances, and the hidden follow-up reacts to the results without a
visible user bubble.
