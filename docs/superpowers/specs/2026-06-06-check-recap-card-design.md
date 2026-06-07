# Check-Question Recap Card in Chat History — Design

**Date:** 2026-06-06
**Status:** Approved (brainstorm), pending spec review
**Author:** session (calmxz)

## Problem

When the tutor opens a check-question batch via `ask_check_questions`, the
assistant turn is persisted with empty `content` (the model emits only the tool
call) plus a `tool_calls_json` recording the ask. The interactive question card
is driven by the live `check_question` stream event and the session's
`pending_check` row, which is **cleared on `/check/complete`**. Result: once a
batch resolves, the chat transcript shows a **blank gray bubble** (an empty
`.content` pill) with a "Questions asked" chip. The question text, the options,
the learner's chosen answer, and the correct answer are **nowhere in the
persisted transcript** — they only ever existed in the ephemeral card.

Goal: render a read-only **recap card** in chat history for every resolved
batch — each question with its options, the learner's pick highlighted, the
correct option marked, and the explanation.

## Source of Truth Note

Check-question batch state (`pending_check`, `public_view`,
`build_results_summary`) lives in `backend/services/check_question_service.py`.
`LearningEvent` (`backend/db/models.py`) stores `{gap_tested, question, correct}`
per graded item — but **not** `selected_index`. So the learner's exact chosen
option is not durably stored anywhere today; it lives only in `pending_check`
during the batch. This drives the persistence design below.

## Architecture

### New state: `chat_messages.check_batch_json`

A nullable `Text` column on `ChatMessage`. Holds the resolved batch in the exact
shape `check_question_service.public_view()` already produces:

```json
{
  "gap": "glycolysis",
  "current_index": 1,
  "total": 1,
  "items": [
    {
      "question": "Which enzyme catalyzes the rate-limiting step?",
      "options": ["Phosphofructokinase-1", "Pyruvate kinase", "Hexokinase"],
      "status": "answered",
      "selected_index": 0,
      "correct_index": 0,
      "correct": true,
      "explanation": "PFK-1 catalyzes the committed step."
    }
  ]
}
```

Migration `0007_check_batch` chains off `0006_quiz_cooldown`.

### Linking the resolved batch to the asking message (the crux)

The `pending_check` record gains a `message_id` field. Flow:

1. `tutor.py` dispatches `ask_check_questions` (via `tools.dispatch` →
   `check_question_service.register`), which creates the `pending_check`.
2. After the streaming turn ends, `tutor.py` calls
   `_persist_assistant_message(...)` and obtains `msg_id`.
3. A new helper `check_question_service.attach_message_id(db, session_id, msg_id)`
   stamps `msg_id` onto the open `pending_check`. (No-op if no pending check.)
4. On **each** `/check/answer` and on `/check/complete`, after mutating the
   batch, write `public_view(pc)` JSON onto `ChatMessage(id == pc["message_id"])`
   via a new helper `check_question_service.write_check_batch(db, pc)`. Per-answer
   writes mean a mid-batch reload also shows in-progress state (answered items
   revealed, pending items still hidden by `public_view`'s anti-cheat rule).

If `message_id` is missing (older flow / race), `write_check_batch` is a no-op —
the read-time backfill (below) covers it.

### Read path

`GET /sessions/{id}` already serializes messages. Add a nullable `check_batch`
field to each message payload:

- If `check_batch_json` is set → parse and return it.
- Else, if the message has an `ask_check_questions` tool call → **best-effort
  reconstruct** (see Backfill).
- Else → `null`.

### Contract change (codegen, not hand-edit)

The `Message` schema in `docs/api/openapi.yaml` is contract-governed
(`additionalProperties: false`) and `backend/contracts/` is generated from it.
The recap payload is identical to the existing `PendingCheck` schema
(`{gap, current_index, total, items[]}` where each item carries
`selected_index/correct_index/correct/explanation`). So:

1. Edit `docs/api/openapi.yaml`: add to `Message.properties`:
   ```yaml
   check_batch:
     oneOf:
       - $ref: "#/components/schemas/PendingCheck"
       - type: "null"
     default: null
   ```
2. Run `python backend/scripts/gen_contracts.py` to regenerate
   `backend/contracts/`. CI enforces zero drift, so this must run before commit.

Additive + nullable: existing clients ignore it. Reusing `PendingCheck` avoids a
new schema and guarantees the recap shape matches `public_view` exactly.

### Backfill (existing batches)

Already-resolved batches predating this feature have no `check_batch_json` and
the chosen option is unrecoverable. Reconstruct at **read time** (no data
migration, no write to old rows) in the session serializer:

- Question / options / correct_index / explanation: from the asking message's
  `tool_calls_json` `ask_check_questions` args.
- `correct` per item: join `LearningEvent` by `(session_id, gap_tested, question)`
  for the matching turn; `correct` from the event. Unmatched → `correct: null`.
- `selected_index`: `null` (unknowable). `status`: `"answered"` if a matching
  `LearningEvent` exists, else `"skipped"`.

The recap card renders `selected_index: null` as "answer not recorded" — it
still shows the question, options, correct answer, and explanation.

## Frontend

### `CheckRecap.vue` (new)

Read-only card rendering a `check_batch` object. Per item:
- Question text (heading).
- Options list; the `correct_index` option marked correct (check); the
  `selected_index` option marked as the learner's pick. If
  `selected_index === correct_index` → single "your answer · correct" marker.
  If they differ → learner's pick marked incorrect, correct option marked.
  If `selected_index == null` → no pick marker, show "answer not recorded".
- Explanation line below the options.
- Batch header: `gap` + score `n_correct / n_graded`.

Mirrors the visual language of `CheckQuestion.vue` but is non-interactive
(no clickable options, no Skip/Done).

### `AssistantBubble.vue`

When `message.check_batch` is present:
- Render `CheckRecap` **instead of** the `ToolCallChip` row and the empty
  `.content` pill (decision: recap replaces chip + empty pill).
- Still render citations / cancelled marker if present.

When absent → unchanged behavior.

The live interactive `CheckQuestion.vue` (driven by `pending_check` while a
batch is open) is **untouched**. Once the batch resolves and history reloads,
the recap card is what persists.

## Data Flow Summary

```
ask_check_questions dispatched
  -> register() creates pending_check
  -> tutor persists asking assistant msg, gets msg_id
  -> attach_message_id(pending_check.message_id = msg_id)
learner answers item
  -> answer() mutates pc
  -> write_check_batch(pc) -> ChatMessage[msg_id].check_batch_json = public_view(pc)
/check/complete
  -> write_check_batch(pc) (final state) before clear_pending_check
session reload (GET /sessions/{id})
  -> message.check_batch from column, else best-effort reconstruct
  -> AssistantBubble renders CheckRecap
```

Note: `complete_check` currently calls `clear_pending_check` then
`set_quiz_cooldown`. `write_check_batch(pc)` must run **before**
`clear_pending_check` (uses the in-memory `pc`, so ordering is for clarity /
the message_id lookup).

## Error Handling

- Missing/blank `check_batch_json` → `None`, fall through to backfill.
- Malformed JSON → treat as `None` (mirrors `get_pending_check`'s try/except).
- `message_id` not found on write → no-op (logged at debug). Read-time backfill
  still produces a partial card.
- Backfill `LearningEvent` match miss → `correct: null`, card still renders.

## Testing

Backend:
- `write_check_batch` persists `public_view` JSON onto the linked message;
  no-op when `message_id` absent.
- `attach_message_id` stamps id onto the open pending_check.
- `/check/answer` and `/check/complete` populate `check_batch_json` on the
  asking message (route tests, reusing `test_check_complete_route.py` fixtures).
- Session-load serializer returns `check_batch` from the column when present.
- Backfill: a message with an `ask_check_questions` tool call and no
  `check_batch_json` reconstructs question/options/correct from tool args and
  `correct` from `LearningEvent`, with `selected_index: null`.

Frontend (vitest):
- `CheckRecap.vue` renders correct/incorrect/your-pick markers for each branch
  (pick == correct, pick != correct, pick null).
- `AssistantBubble.vue` renders `CheckRecap` and suppresses the chip + empty
  pill when `check_batch` is present; unchanged when absent.

## Out of Scope

- No change to the live interactive `CheckQuestion.vue` flow.
- No change to grading, profile updates, quiz_cooldown, or the POST-QUIZ
  PROTOCOL.
- No data migration that writes to existing rows (backfill is read-time only).
- No new contract schema: `check_batch` reuses the existing `PendingCheck`
  schema (see Contract change above).

## CodeQL Config (bundled — migration 0007 trips it)

Migration `0007_check_batch` carries the alembic framework globals
(`revision`, `down_revision`, `branch_labels`, `depends_on`) that the
`security-and-quality` pack flags as `py/unused-global-variable` — false
positives (alembic reads them by introspection). Migrations 0001–0006 were
dismissed manually in the GHAS UI. To stop recurrence on every future migration:

- Add `.github/codeql/codeql-config.yml`:
  ```yaml
  name: "Project_Apt CodeQL config"
  paths-ignore:
    - "backend/db/alembic/versions/**"
  ```
- Wire it into `.github/workflows/codeql.yml` init step:
  ```yaml
  - name: Init CodeQL
    uses: github/codeql-action/init@v3
    with:
      languages: ${{ matrix.language }}
      queries: security-and-quality
      config-file: ./.github/codeql/codeql-config.yml
  ```

`paths-ignore` is path-scoped (query-filters are repo-wide); alembic versions are
generated DDL boilerplate, so excluding them from scanning is acceptable. This
clears the existing 0001–0006 notes on the default branch after merge too.

## Deployment Note

Migration `0007_check_batch` must be applied to the live Supabase DB
(`python -m alembic upgrade head`) before the model selects the new column —
otherwise authed endpoints 503 (same failure mode hit during the quiz-loop
smoke). The running server reads schema from the live DB, not the model.
