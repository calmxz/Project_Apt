# Quiz-Loop Fix: Post-Quiz Protocol + Readiness Signal

Date: 2026-06-05
Status: Approved design, ready for implementation plan
Scope: backend only (prompt rules + one ephemeral session field + threading)

## Problem

After a batched multiple-choice check completes, the server builds a results
summary and injects it as a non-persisted synthetic user turn
(`[check results] gap=X: 2/3 correct. Q2 missed...`), then streams the tutor's
reaction (`complete_check` in `backend/routes/sessions.py`). Nothing in the
system prompt tells the tutor what to do with those results, so it re-quizzes.
The learner gets quiz after quiz with no teaching in between.

Two specific gaps:

- No rule for the all-correct case. The user could not tell whether the loop
  ends when every answer is correct.
- No cross-turn memory of a recent quiz. The synthetic `[check results]` turn
  scrolls out of the recent-history window, so even a well-behaved tutor loses
  the context that it just quizzed this gap.

## Root cause

The fix is primarily a prompt rule. The tutor must address quiz results
(re-teach or acknowledge) before quizzing again. A small piece of ephemeral
state reinforces this past the point where the `[check results]` turn scrolls
out of history.

## Design

### State: `quiz_cooldown`

A new ephemeral field stored on the session row as JSON, in the same style as
`pending_check`. It is NOT part of `pending_check` — `complete_check` clears
`pending_check` immediately after building the summary, so cooldown must live
separately to survive the re-teaching turns.

Shape:

```json
{ "gap": "derivatives", "last_score": "2/3", "missed": ["chain rule"] }
```

Lifecycle:

- Set: in `complete_check`, only when the just-completed batch had at least one
  miss or skip. An all-correct batch sets nothing (the gap is mastered; there is
  nothing to re-teach).
- Read: by `build_dynamic_context`, rendered as a `QUIZ_READINESS` line.
- Cleared / superseded: overwritten the next time a batch on any gap completes
  with misses. There is no dedicated clear tool and no clear flag. The tutor's
  judgment about when to re-quiz lives in its prose, not in a tool call. A stale
  cooldown (the gap already appears in `mastered_concepts`) is harmless context;
  the prompt tells the tutor to treat readiness as judgment input, not a gate.

### Dynamic context injection

`build_dynamic_context` (`backend/agent/prompts.py`) adds one line after
`PENDING_CHECK`:

- With an active cooldown:
  `QUIZ_READINESS: {"gap": "derivatives", "last_score": "2/3", "status": "cooling_down"}`
- With no cooldown:
  `QUIZ_READINESS: ready`

### Prompt rules (centerpiece)

Add a POST-QUIZ PROTOCOL block to `IMMUTABLE_RULES`. This prose is the real
lever; the state is reinforcement.

- After a batch resolves you receive a `[check results]` summary. Address the
  results first. Do NOT immediately call `ask_check_questions` again.
- If the learner missed or skipped items: re-teach the missed concept(s) in
  plain language, then offer (do not force) another check when they are ready.
- If every answer was correct: acknowledge the mastery, move the conversation
  forward, and do NOT re-quiz the same gap. The quiz loop ends here.
- `QUIZ_READINESS` carries the last quiz outcome for a gap. Treat it as judgment
  input, not a hard rule.
- If the learner asks to be quizzed while `QUIZ_READINESS` shows `cooling_down`
  for that gap, you may note that more practice could help and offer a quick
  recap first. If the learner insists ("just quiz me"), quiz them. The learner
  stays in control.

### Threading (three sites)

The cooldown value must reach the prompt on the turns that matter.

1. `complete_check` (`backend/routes/sessions.py`): after `build_results_summary`
   and before building `prompt_state`, compute and persist the cooldown (set on
   miss/skip, leave unset on all-correct). Add a `quiz_cooldown` key to
   `prompt_state` so the hint appears on the first re-teach turn — the most
   important one.
2. `chat.py` turn preparation (`prompt_state`, around line 99): add a
   `quiz_cooldown` key, read from the session row.
3. `build_dynamic_context`: render the `QUIZ_READINESS` line from
   `state.get("quiz_cooldown")`.

A helper in `check_question_service` owns set/get/clear of `quiz_cooldown`,
mirroring the existing `pending_check` helpers, and derives the cooldown shape
from a resolved batch (`gap`, `last_score`, `missed`).

## Out of scope

- No new agent tool. No change to `update_topic_profile`, `ask_check_questions`,
  `record_learning_event`, or `retrieve_chunks` signatures.
- No hard server-side block on back-to-back quizzes. The gate is a soft nudge;
  the learner can always insist.
- No frontend change. The cooldown is server state surfaced only into the
  system prompt.

## Testing

- `test_prompts.py`: `build_dynamic_context` renders `QUIZ_READINESS:
  cooling_down ...` when a cooldown is present and `QUIZ_READINESS: ready` when
  absent; `IMMUTABLE_RULES` contains the POST-QUIZ PROTOCOL rules (all-correct
  stop, re-teach on miss, insist-overrides-nudge).
- `check_question_service`: cooldown is set when a resolved batch has a miss or
  skip; cooldown is NOT set when the batch is all-correct; the derived shape
  carries `gap`, `last_score`, `missed`.
- Route test (`complete_check`): after a batch with misses, the cooldown
  persists into the follow-up `prompt_state` so the hint reaches the first
  re-teach turn.

## Open compliance note

Because nothing hard-blocks re-quizzing, correctness depends on the tutor
respecting the prompt rules — the same reliability surface as the existing
check-question and focus-clear protocols (Phase 2/3 ~85% checkpoints). If live
testing shows the tutor still re-quizzes through the nudge, the fallback is a
prompt iteration, then escalation per the CLAUDE.md reliability-checkpoint rule,
not a server-side hard block (which would break the insist-overrides path).
