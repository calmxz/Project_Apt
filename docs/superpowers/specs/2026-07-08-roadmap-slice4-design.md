# Roadmap Slice 4 Design — P3 Time-to-First-Token + D1 Missed-Concept Context

Date: 2026-07-08
Status: APPROVED (design review in-session)
Source: `docs/planning/2026-07-06-10x-roadmap.md` sections 4 (P3) and 5 (D1).
Sequencing: fourth slice of the 10x roadmap, after slice 3 (R1, PR #108).
Branch: `feat/roadmap-slice4`.

## Scope

Backend-only slice. Two tracks:

- **P3** — reduce time-to-first-token on the chat prepare path and measure it.
- **D1** — stop the agent re-teaching blind: carry missed-question detail
  through the quiz-cooldown window and inject per-gap accuracy into the
  dynamic prompt context.


Out of scope: R2 spaced repetition (slice 5 candidate), any frontend change,
any API contract change (`docs/api/openapi.yaml` untouched — no codegen run
needed).

## Decisions made during design review

| Decision | Choice | Rationale |
|---|---|---|
| Slice composition | P3 + D1, no D2 bolt-on | Follow roadmap sequencing; keep slice M-sized |
| D1 AC3 reliability eval | Script written in-slice; paid run owed post-merge | Matches slice 1-3 convention of batched post-merge paid gates |
| End-session summary (P3 AC3) | Keep synchronous, record rationale | Summary text is returned in `SessionEndResponse` and shown by the UI immediately; moving it off-path is a contract + FE change. Resume-create (`routes/sessions.py:123`) shares the same call. p50 measured via the new timing log instead. |
| Prepare-path query budget (P3 AC1) | <=6 statements via full consolidation (<=7 with D1 aggregate), not roadmap's <=3 | Stack is sync SQLAlchemy on one request-scoped connection; <=3 requires a mega-UNION/CTE that fights the ORM and hurts maintainability. Roadmap is PROPOSAL status; deviation recorded here. Reaching 6 requires touching guard queries (decision revised during planning after measuring the real baseline; see P3.1). |

## Current state (audited 2026-07-08)

- `_prepare_turn` (`backend/routes/chat.py:84-174`) issues ~10 sequential
  statements before the stream opens: cost-cap SELECT (1), rate-limit
  INSERT-on-conflict + UPDATE + SELECT (3), ensure_user SELECT (1), session
  SELECT (1), history SELECT (1), user-message INSERT (1), post-commit
  expire/refresh SELECT on the session row (1), ingestion-status SELECT (1).
  The `get_pending_check`/`get_quiz_cooldown`/`load_profile` `db.get` calls
  after the refresh are free via the SQLAlchemy identity map — the roadmap's
  "~9 round trips" audit overcounted; row-accepting variants are still made
  explicit so correctness does not hinge on identity-map subtleties.
- `litellm.token_counter` runs per loop iteration (`tutor.py:130-137`),
  accumulating `prompt_tokens_total`. Its only consumer is
  `cost_meter.estimate_cancelled_cost` in the `CancelledError` branch
  (`tutor.py:374-375`). The roadmap's premise that it exists for soft-cap
  warning math is wrong — the soft-cap path uses `check_cap(...).soft_breached`
  after the final answer (`tutor.py:213-224`).
- `build_quiz_cooldown` (`check_question_service.py:286-305`) already stores
  `missed` (list of question stems) in `sessions.quiz_cooldown_json`, but
  `prompts.build_dynamic_context` (`prompts.py:149-159`) renders only
  `{gap, last_score, status}` and drops `missed`.
- No per-gap accuracy aggregation exists anywhere; `learning_events` has the
  R0.2 columns (`selected_index`, `correct_index`, `options_json`, `purpose`)
  and an index on `(session_id,)`.
- A statement-count test harness exists: `count_queries` context manager via
  SQLAlchemy `before_cursor_execute` (`tests/test_sessions_perf.py:13-33`).
- `backend/config.py` has no debug/timing flag; logging is plain module-level
  `logging.getLogger(__name__)`.

## P3.1 — Prepare-path query consolidation

Changes to `_prepare_turn` and the services it calls:

Target composition — exactly 6 statements on the happy path (existing user,
no confirmed gaps):

1. **Combined guard read (1 stmt):** one SELECT of two scalar subqueries —
   today's-spend aggregate (cost cap) and user-existence check — replacing
   the cost-cap SELECT and the ensure_user SELECT. `cost_meter` gains a pure
   `check_cap_from_spend(used)` (existing `check_cap(db, user_id)` delegates
   to it; other callers unchanged). If the user row is missing (first turn
   ever), `ensure_user` runs as today — the rare create path may exceed the
   budget and is excluded from the perf test.
2. **Rate limit 3 -> 2 stmts:** the post-increment SELECT is folded into the
   UPDATE via `RETURNING count` (SQLAlchemy 2.x supports RETURNING on both
   Postgres and modern SQLite). The atomic INSERT-on-conflict + guarded
   UPDATE concurrency pattern is preserved unchanged; when the UPDATE
   matches no row (cap already reached), a fallback SELECT reads the count —
   that path raises 429 and is outside the happy-path budget. Existing
   concurrency-semantics tests must stay green.
3. **Session + ingestion in one SELECT (1 stmt):** the session load carries
   correlated scalar subqueries counting the session's documents (total /
   pending / ready); a new pure `documents_service.status_from_counts`
   mirrors `aggregate_status` priority (pending > ready > failed > None) so
   the logic stays single-source. `session_ingestion_status(db, session_id)`
   remains for other callers.
4. **History SELECT (1 stmt)** — unchanged.
5. **User-message INSERT (1 stmt), moved after all reads:** the
   add+commit moves to the end of `_prepare_turn` (still committed before
   returning, preserving the survives-early-stream-end guarantee), which
   eliminates the post-commit expire/refresh SELECT.
6. `check_question_service.get_pending_check`/`get_quiz_cooldown` and
   `profile_service` gain row-accepting variants (`*_from_row(row)`) used by
   `_prepare_turn`; the existing session_id-based functions remain for
   callers outside the prepare path.

**Budget: at most 6 statements on the prepare path; at most 7 when the D1.2
gap-accuracy aggregate runs** (it is conditional on non-empty
`confirmed_gaps`). Asserted with the existing `count_queries` harness. The
test covers both branches (empty and non-empty `confirmed_gaps`).

## P3.2 — Pre-stream token_counter removal

Stop calling `litellm.token_counter` eagerly per iteration. Instead, record
the message-list length at each iteration start (`iter_boundaries:
list[int]` — an O(1) append). On `CancelledError`, reconstruct today's exact
accumulation by summing `token_counter(model, messages=full[:b])` over the
recorded boundaries (each iteration billed the then-current prefix; counter
is local tokenization, no API call) and pass the sum to
`estimate_cancelled_cost` unchanged. The happy path performs zero
tokenization work before or during streaming. Cancelled-billing tests
updated to the new call shape; soft-cap warning tests untouched.

## P3.3 — End-session summary: kept synchronous

No code change. Rationale (recorded per roadmap AC3's "OR" branch): the
summary text is part of `SessionEndResponse` and rendered by the UI
immediately on end; making it a background task would require a contract
change (summary becomes pending/optional), FE polling or placeholder
handling, and would also affect the resume-create path
(`routes/sessions.py:123`) which reuses `generate_and_persist`. End-session
p50 is measured with the P3.4 timing log and recorded in the PR description.

## P3.4 — Timing instrumentation

- New `Settings` field `debug_timing: bool = False` (`backend/config.py`).
- When enabled, the chat turn logs `prepare_ms` (time spent in
  `_prepare_turn`) and `first_token_ms` (request start to first streamed
  token) via the module logger. End-session logs its handler duration the
  same way.
- No new dependencies, no structured-logging framework. Off by default;
  zero overhead when disabled beyond two `time.perf_counter()` calls.
- Before/after numbers for prepare_ms and first_token_ms go in the PR
  description (measured locally against live Supabase — unpaid, no LLM
  needed for the prepare path with `LLM_STUB=1`).

## D1.1 — Missed-question detail through the cooldown window

1. `build_quiz_cooldown` enriches each `missed` entry from a bare question
   stem to `{question, chosen, correct}` where `chosen` and `correct` are the
   option **texts** from the resolved batch item (all data already in hand at
   the call site, `sessions.py:452`).
2. `prompts.build_dynamic_context` renders the missed list compactly inside
   the existing `QUIZ_READINESS` block, e.g. one line per missed item:
   question stem (truncated), chosen-vs-correct.
3. Tolerant parse: cooldown blobs written before this slice have stem-only
   `missed` entries; the renderer handles both shapes (string or dict entry).
   No migration — `quiz_cooldown_json` is transient per-session state.
4. Tests: `test_quiz_cooldown_service.py` (new shape written),
   `test_prompts.py` (render, both shapes, truncation).

## D1.2 — Per-gap accuracy in dynamic context

1. New `learning_event_service.gap_accuracy(db, session_id)` — single
   `SELECT gap_tested, COUNT(*), SUM(correct) ... GROUP BY gap_tested`
   aggregate returning `{gap: {attempts, correct}}`.
   **Session-scoped**: cross-session accuracy belongs to R2's review queue
   (which will query at user level); recorded here so R2 does not assume
   this function already does it.
2. `_prepare_turn` calls it only when the loaded profile has non-empty
   `confirmed_gaps` (protects the P3.1 budget; the <=7 branch).
3. `build_dynamic_context` renders a `GAP_ACCURACY` block listing only gaps
   present in the current `confirmed_gaps`, capped at the top 8 gaps by
   attempt count and a fixed character budget for the whole block; the
   assembly test asserts the cap holds with oversized input.
4. Old rows without R0.2 columns still aggregate fine (`correct` predates
   R0.2).

## D1 AC3 — Reliability eval (owed gate)

An eval script scenario (existing eval harness pattern from WS-G3) where the
tutor's next explanation after a failed check references the missed concept;
target >=85 percent. Script written and committed in this slice; the paid run
is an owed post-merge human gate, batched with the other outstanding paid
smokes (slices 1-3).

## Error handling

- `gap_accuracy` failure (unexpected DB error) must not kill the turn: the
  prepare path treats it as best-effort — on exception, log and proceed with
  an empty accuracy map. Test with a mocked failure.
- Tolerant cooldown parse (D1.1.3) covers malformed/legacy JSON: fall back to
  rendering without missed detail, never raise from prompt assembly.
- Timing log never raises; disabled flag path has no observable behavior
  change (existing tests are the guard).

## Testing summary

| Area | Test |
|---|---|
| P3.1 budget | statement-count test, both branches (<=6 / <=7), via `count_queries` |
| P3.1 refactor | existing chat/session suites stay green (behavior unchanged) |
| P3.2 | cancelled-billing test updated; soft-cap tests untouched; no tokenization on happy path (assert `token_counter` not called) |
| P3.4 | flag-on smoke test asserts log lines emitted; flag-off default asserts none |
| D1.1 | cooldown shape test; prompt render tests (new shape, legacy shape, truncation) |
| D1.2 | aggregate unit test on fixture events; render cap test; conditional-call test; best-effort failure test |
| Suite | full backend pytest green on sqlite CI-parity; no OpenAPI change so no codegen/drift run |

No frontend changes; no vitest additions; no Alembic migration.

## Acceptance criteria (slice-final)

- AC1: Prepare path issues at most 6 statements (7 with gap accuracy),
  asserted by test; down from ~11-12.
- AC2: No `token_counter` call on the happy streaming path; cancelled-stream
  billing still produces a nonzero estimate (test).
- AC3: Spec records the keep-synchronous decision for end-session summary
  (this document); end-session duration appears in timing log when enabled.
- AC4: `debug_timing` flag logs `prepare_ms` and `first_token_ms`; PR
  description carries before/after numbers.
- AC5: After a failed check batch, `QUIZ_READINESS` in the dynamic context
  contains each missed item's question stem and chosen-vs-correct texts for
  the cooldown window.
- AC6: Dynamic context contains a capped `GAP_ACCURACY` block derived from
  `learning_events` for current confirmed gaps; absent when no gaps.
- AC7: D1 eval script committed; paid run recorded as owed post-merge gate.
- AC8: Full backend suite green.

## Deviations from this spec (recorded post-implementation, Task 11)

- **P3.2 snapshots, not `list[int]` boundaries.** This document's design
  section (P3.2) sketches recording iteration boundaries as `list[int]`
  offsets and re-tokenizing `full[:b]` slices on cancel. The implementation
  instead appends a shallow-copied prefix (`[dict(m) for m in full]`) per
  iteration to `iter_prompt_snapshots`. Reason: P2's
  `prune_superseded_excerpts` mutates a tool message's `content` value on the
  shared dict later in the loop; an index-only boundary would tokenize the
  post-mutation (already-pruned, shorter) prefix on cancel instead of what
  was actually billed at that iteration. A per-iteration snapshot keeps each
  iteration's prefix exact regardless of later in-place pruning. Behavior
  (the cancelled-cost estimate) is unchanged; only the mechanism differs.
  Covered by the existing cancelled-billing regression tests.
- No other divergences found: P3.1 landed at the planned <=6/<=7 statement
  budget (measured exactly 6 and exactly 7 in the two test branches), P3.3
  and P3.4 match this document as written, and D1.1/D1.2/D1 AC3 match this
  document as written (80-char stem cap, top-8/600-char `GAP_ACCURACY` cap,
  eval script committed with the paid run owed post-merge).
