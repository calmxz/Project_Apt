# Phase 3 MLP Checkpoint - focus_target_gap clearing reliability

Per CLAUDE.md line 105-107: gate threshold is **>=85%** across the four
Design Doc S6.3 patterns. Below 85% triggers prompt iteration; if still
failing after 2-3 iterations, swap default model to
`anthropic/claude-sonnet-4-6`.

## Eval harness

Built at `backend/scripts/eval_focus_clearing.py`. For each pattern x
replicates, it pre-seeds a session with `focus_target_gap="recursion"`,
sends a single user turn through the real tutor loop, and inspects the
returned `ToolCallRecord` list for `update_topic_profile` calls that null
out `focus_target_gap` with a `focus_clear_reason`.

Patterns:

| Pattern | User turn | Expected |
|---|---|---|
| linear_demonstrated | learner explains recursion with base case | clear |
| topic_shift | learner asks to switch to iteration | clear |
| tangent_clarify | learner asks for sub-clarification on base case | NOT clear |
| vague_signal | "ok got it" with no demonstration | NOT clear |

Run: `python backend/scripts/eval_focus_clearing.py --replicates 5`

Decision policy:

- `>=85%` -> PASS, gate cleared.
- `>=50%` -> ITERATE_PROMPT (revise `backend/agent/prompts.py`, re-run).
- `<50%` -> SWAP_MODEL (set `settings.model = anthropic/claude-sonnet-4-6`).

Each run appends a block to this file.

## Run 2026-05-15T07:57:46+00:00 (smoke, no API key)

Harness verified end-to-end: temp sqlite spin-up worked, contracts loaded,
report writer worked. Real reliability number could not be measured
because `GEMINI_API_KEY` is not set in this environment - all 4 trials
errored with `litellm.APIConnectionError: Missing Gemini API key`.

- model: `gemini/gemini-2.5-pro`
- replicates per pattern: 1
- overall pass rate: n/a (no successful trials)
- decision: **DEFERRED** - re-run with a populated `GEMINI_API_KEY`
  before merging Phase 3.

To run for real:

```
# from repo root, with .env containing a real GEMINI_API_KEY
python backend/scripts/eval_focus_clearing.py --replicates 5
```
