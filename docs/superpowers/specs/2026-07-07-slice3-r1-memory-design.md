# Slice 3 — R1 Cross-Session Memory + Slice-2 Carry-Overs (Design)

Date: 2026-07-07
Status: Approved (brainstorm complete)
Branch: `feat/roadmap-slice3` (off dev `9bdab95`, PR target: dev)
Source roadmap: `docs/planning/2026-07-06-10x-roadmap.md` (R1, P2 AC3, slice-2 follow-up)

## 1. Scope

Four workstreams:

1. **R1.1** — Surface `seed_mode=resume` as "Continue topic" UI (backend already shipped).
2. **R1.2** — Gap selector for review-gaps (replaces hard-coded `confirmed_gaps[0]`).
3. **P2 AC3** — Rolling summary of turns dropped from the last-20 history window (deferred from slice 2).
4. **Prune-by-round** — fix `prune_superseded_excerpts` sibling-retrieval defect (slice-2 final-review follow-up).

Out of scope: R2 spaced repetition, P3 TTFT work, any change to the end-of-session
summary flow, prompt-cache decision from the slice-2 dogfood gate.

## 2. R1.1 — Continue-topic UI

Backend, contract, and JS client for `seedMode: 'resume'` + `priorSessionId`
already exist (`backend/routes/sessions.py:104-119`, `frontend/src/stores/session.js:90-97`).
This workstream is frontend-only plus tests.

Design:

- Ended session cards (Home recent list and Sessions library) gain a
  "Continue topic" action. It calls
  `store.createSession({ topic: prior.topic, seedMode: 'resume', priorSessionId: prior.id })`
  and routes into the new session.
- Profile carry-forward (knowledge_level, mastered_concepts, confirmed_gaps,
  last_session_summary) is existing backend behavior — asserted via profile GET
  in tests, no new backend logic.
- Diagnostic skip is emergent: `diagnostic_required = knowledge_level is None`
  (`routes/chat.py`), and a resumed profile carries a non-null level. Covered by
  an assertion, not new code.
- The prior session is auto-ended by the backend during resume creation. The
  store marks the prior session ended locally after a successful resume create
  (backend guarantees the state), so the UI reflects "ended" without a manual
  refresh or extra fetch.
- `NewSessionView` copy no longer presents "reopen" as the only continuation
  path; it mentions Continue topic.

Acceptance criteria (roadmap R1.1 AC1-AC5):

- AC1: Ended card on Home and Sessions library offers Continue topic; new
  session opens with prior profile carried (assert via profile GET).
- AC2: First tutor turn in the resumed session skips the 3Q diagnostic (assert
  the diagnostic branch is not taken).
- AC3: Prior session shows as ended without manual refresh.
- AC4: `NewSessionView` copy updated.
- AC5: Vitest for card action + store call; one Playwright spec reviving the
  skipped WS-G2 "resume carries profile" e2e.

## 3. R1.2 — Gap selector ("Force quiz")

Today `_build_prompt_state` hard-codes `confirmed_gaps[0]`
(`backend/routes/chat.py:51-52`). Chosen approach: per-turn optional field on
ChatRequest (stateless, mirrors existing `review_gaps` bool threading).

Contract (edit `docs/api/openapi.yaml`, then run codegen — never hand-edit
`backend/contracts/`):

- ChatRequest gains `review_gap: string` (optional, nullable). Meaningful only
  when `review_gaps` is true.

Backend:

- `_build_prompt_state(..., review_gap: str | None)`: when `review_gaps` and
  `profile.confirmed_gaps` are set, target `review_gap` if it is an exact member
  of `confirmed_gaps`; otherwise fall back silently to `confirmed_gaps[0]`
  (today's behavior). No 422 on invalid values — graceful degradation.
- Prompt injection (`agent/prompts.py` REVIEW_GAPS line) already renders the
  target; only the selection changes. Assert via prompt-assembly unit test, not
  live LLM.

Frontend:

- New `GapPickerDialog.vue`: PrimeVue Dialog listing one button per confirmed
  gap. Keyboard accessible (focus trap, arrow/tab navigation, Enter selects,
  Esc cancels). Every option carries a testid.
- Reused at both entry points: SessionView `resumeReviewGaps` and the
  ProfileView review action.
- `confirmed_gaps.length > 1` → open picker; `length === 1` → send directly,
  no picker (AC3).
- Seed message names the chosen gap — exact format `Review my gap: <G>`
  (single-gap direct send uses the same format); store threads
  `reviewGap` through `sendMessageStreaming` → `chatStreamService.streamChat`
  body as `review_gap`.

Acceptance criteria (roadmap R1.2 AC1-AC4):

- AC1: Both entry points show the picker when more than one confirmed gap;
  selecting gap G sends the review seed targeting G.
- AC2: Seed message and prompt injection name the chosen gap (prompt-assembly
  unit test).
- AC3: Single-gap case skips the picker.
- AC4: Keyboard accessible; testids on options; vitest coverage.

## 4. P2 AC3 — Rolling summary

Chosen approach: debounced cheap-model LLM summary, stored on the session row,
updated post-turn in the background (zero TTFT impact).

Data model (alembic migration `0016`, additive nullable, single head
maintained):

- `sessions.rolling_summary` TEXT NULL
- `sessions.rolling_summary_count` INTEGER NULL (count of messages already
  covered by the stored summary)

Service (`backend/services/summary_service.py`):

- `update_rolling_summary(db, session_id)`: loads messages that have fallen
  out of the last-20 window (i.e. all but the newest 20), summarizes them via
  the same cheap LiteLLM path as the end-of-session summary, caps output at
  ~1200 chars, writes `rolling_summary` + `rolling_summary_count`, and logs the
  call in `llm_call_log` (tokens + cost, per P1 instrumentation).
- Any LLM/DB failure: log and skip; `rolling_summary_count` unchanged so the
  next trigger retries. A failed summary must never break a chat turn.

Trigger (chat stream completion path in `routes/chat.py`):

- After a turn completes, a background task refreshes the summary when due.
  `rolling_summary_count` stores how many dropped messages the stored summary
  covers; due when `(total_messages - 20) - (rolling_summary_count or 0) >= 10`
  (debounce: one LLM call per ~10 newly dropped messages, not per turn).

Prompt injection:

- `_build_prompt_state` adds `rolling_summary`; `agent/prompts.py` renders it
  only inside the dynamic context block (e.g. "EARLIER IN THIS SESSION: ...").
  The slice-2 prefix-stability guard test enforces that the immutable prompt
  prefix is untouched (prompt-cache safety).

## 5. Prune-by-round fix (slice-2 follow-up)

Defect: `context_budget.prune_superseded_excerpts` prunes by list position, so
sibling retrievals attached to ONE assistant message stub the first sibling
even though no newer retrieval supersedes it.

Fix: prune by dispatch round — all tool results belonging to the same
assistant tool-call round are treated as one generation; only rounds strictly
older than the newest retrieval round are stubbed. Stub wording keeps document
name + chunk id. Unit tests cover the sibling case (two retrievals in one
round survive together) and the existing superseded case. Re-baseline the
token-budget tripwire only if measured numbers move.

## 6. Error handling summary

- Invalid/absent `review_gap` → silent fallback to `confirmed_gaps[0]`.
- Resume validation (400 on missing/forbidden `prior_session_id`) already
  server-side; frontend surfaces existing error toast path.
- Rolling summary failures are swallowed (logged), retried on next trigger.
- Background task must use its own DB session (request session is closed by
  the time it runs).

## 7. Testing

Backend (pytest):

- `_build_prompt_state` units: gap targeting, invalid-gap fallback, single-gap,
  rolling-summary injection present/absent.
- Rolling summary: debounce boundary (exactly 10 / 9 dropped), under-21
  messages no-op, LLM failure skip + retry, cost logged, output cap.
- Migration: single alembic head `0016`; columns nullable.
- Prune-by-round: sibling survival, superseded stubbing, stub wording.
- Prefix-stability guard still green.

Frontend (vitest):

- Card Continue-topic action → `createSession` args + routing.
- GapPickerDialog: renders N options with testids, keyboard nav, single-gap
  bypass, selection threads `reviewGap`.
- Store/service: `review_gap` in request body.

E2E (Playwright): one spec — resume carries profile (revives skipped WS-G2).

CI gates: full backend + frontend suites, lint, contracts zero-drift.

## 8. Verification gates (human, post-merge)

- Live alembic upgrade head (0016) against Supabase.
- Paid live smoke: continue-topic flow end-to-end (profile carried, no
  re-diagnostic), gap picker seeds the chosen gap, rolling summary appears in
  a >20-message session's prompt state.
