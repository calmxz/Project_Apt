# Roadmap Slice 5 Design — R2 Spaced Repetition (Review Queue + Home Card)

Date: 2026-07-09
Branch: `feat/roadmap-slice5` (off dev `aa07695`)
Source scope: `docs/planning/2026-07-06-10x-roadmap.md` section R2 (R2.1 + R2.2)

## Goal

Convert stored `learning_events` into a reason to return daily: a deterministic
SM-2-lite review scheduler, a cross-session `GET /api/review/queue` endpoint,
and a "Due for review" card on Home that starts a targeted review by composing
the existing `seed_mode=resume` + `review_gaps` machinery. No new chat
machinery, no LLM in the queue path, no schema migration.

Conflict flag (surfaced, not resolved here): design doc section 11 lists spaced
repetition as v2; the 2026-07-06 roadmap schedules it now and the 2026-07-02
gap-backlog does not exclude it. Roadmap + user direction proceed with it.

## Decisions made during brainstorm

1. **Queue scope: all tested concepts.** Any (user, concept) with at least one
   `learning_event` is schedulable — mastered concepts get retention review at
   doubling intervals; unresolved gaps surface too. (Alternative "gaps only"
   rejected: mastered concepts would never get retention review, gutting the
   feature; AC3 demote-re-enter would be near-moot.)
2. **Scheduler state: pure-computed, Python fold.** No `review_schedule`
   table, no write hook, no migration. The scheduler is a pure function over
   event rows with an injected clock (roadmap AC1). Recompute per request is
   fine at current scale. (Materialized table rejected as premature double
   bookkeeping; SQL window-function streaks rejected for sqlite-vs-postgres
   dialect risk.)
3. **Seeding mastered concepts: extend `review_gaps` validation.** The chat
   flag currently only targets `confirmed_gaps`; it will accept a target in
   `confirmed_gaps UNION mastered_concepts`, still server-validated against the
   profile so no client free-text reaches the system prompt. (New parallel
   `review_concept` flag rejected: duplicates the whole pipeline.)
4. **Home card UX: count + top-3 list.** Card shows "Due for review: N" plus
   up to 3 most-overdue concepts, each clickable to start that concept's
   review; inline "View all" expand when N > 3. No new route.

## R2.1 — Review queue service (backend)

### Scheduler: `backend/services/review_queue_service.py`

Pure function, no DB session, no LLM, clock injected:

```
compute_schedule(events: Sequence[EventRow], now: datetime) -> list[ScheduleEntry]
```

- `EventRow` is a lightweight shape (concept string, correct, created_at,
  session_id) — the route layer maps ORM rows to it, keeping the scheduler
  import-free of SQLAlchemy.
- **Concept identity:** events group by key = `gap_tested.strip().casefold()`.
  `gap_tested` is free-text and exact-string today; normalization is
  grouping-only. The displayed `concept` string is the one from the most
  recent event in the group.
- **SM-2-lite per group** (events ordered by `created_at` ascending):
  - `streak` = number of trailing consecutive `correct=True` events.
  - Interval: `streak == 0` (last answer incorrect) -> `BASE_INTERVAL` (1 day);
    `streak >= 1` -> `BASE_INTERVAL * 2^(streak-1)`, capped at
    `MAX_INTERVAL_DAYS` (60). Constants live in the service module.
  - `due_at = last_event.created_at + interval`. Due when `now >= due_at`.
  - Roadmap AC3 (mastered-then-demoted re-enters at reset interval) falls out:
    the demotion event is an incorrect answer, which zeroes the streak and
    makes the concept due one day later.
- `ScheduleEntry` fields: `concept` (display string), `source_session_id`
  (session of the most recent event for the group), `last_tested_at`,
  `streak`, `due_at`.
- Output sorted most-overdue first (`due_at` ascending).

### Endpoint: `GET /api/review/queue`

New router `backend/routes/review.py`, registered in `main.py`.

- Auth: current user (same dependency as sessions routes).
- Query: all of the user's `learning_events` joined
  `LearningEvent.session_id -> Session.id` filtered `Session.user_id`,
  ordered by `created_at` (mirrors the user-level aggregation pattern in
  `profile_service.aggregate_for_user`).
- Fold with `compute_schedule(events, now=utcnow)`; keep only entries with
  `due_at <= now`; paginate in Python.
- Params `limit: int = Query(20, ge=1, le=100)`, `offset: int = Query(0, ge=0)`
  — same convention as `GET /api/sessions/library`.
- Response `ReviewQueuePage { items: list[ReviewQueueItem], total, limit,
  offset }`; `ReviewQueueItem { concept, source_session_id, last_tested_at,
  streak, due_at }`.
- Contract-first: add path + schemas to `docs/api/openapi.yaml`, then
  `python backend/scripts/gen_contracts.py`. Never hand-edit
  `backend/contracts/models.py`.
- **No LLM guard (roadmap R2.2 AC4):** the queue path makes zero LLM/agent
  calls. Enforced by a test that monkeypatches the LLM entry point to raise
  and asserts the queue GET still succeeds.

No migration. Alembic head stays `0016_session_rolling_summary`.

## R2.2 — Daily review surface (frontend + seed-flow extension)

### Seed-flow extension (backend)

`backend/routes/chat.py::_build_prompt_state` (currently ~lines 83-86):

- Accept `review_gap` target when it is in
  `confirmed_gaps UNION mastered_concepts` (today: `confirmed_gaps` only).
- Fallback behavior unchanged: invalid/absent target -> `confirmed_gaps[0]`
  if any; `review_gaps` requires a non-empty union to activate.
- `backend/agent/prompts.py` REVIEW_GAPS block: when the target is in
  `mastered_concepts`, add retention framing — verify retention with check
  questions rather than re-teaching from scratch. Gap targets keep the
  existing drill framing.
- Client strings never reach the prompt unvalidated: the rendered target is
  the profile's own stored string, selected by membership test.

### Home card (frontend)

`frontend/src/views/HomeView.vue` gains a second `.mode-card` in the existing
`.modes` grid:

- On mount, fetch the queue via new `frontend/src/services/reviewApi.js`
  (`getReviewQueue({limit, offset})`). Cheap GET; no LLM (AC4).
- N = `total` from the response. Card hidden entirely when N = 0 (AC1).
- Card body: "Due for review: N concepts" + up to 3 most-overdue items
  (concept name, last-tested date, streak). When N > 3, an inline "View all"
  control expands the list in place (fetches more with a larger limit); no
  new route.
- Clicking a concept starts a review (AC2), reusing slice-3/WS-F machinery
  verbatim:
  1. `sessionStore.createSession({ topic: <prior topic>, seedMode: 'resume',
     priorSessionId: item.source_session_id })` — copies the source session's
     profile forward and auto-ends the prior session (existing behavior).
  2. `router.push({ name: 'session', params: { id }, query: { review_gap:
     item.concept } })` — `SessionView.handleReviewGapQuery` already consumes
     the query param, strips it from the URL, and sends the visible seed
     message with `review_gaps: true`.
- State lives in a small extension of the existing session Pinia store or a
  local composable — whichever matches the `continueTopic` pattern already in
  `frontend/src/stores/session.js`; no new global store unless the
  implementation plan finds one necessary.

### Schedule updates (AC3)

Nothing new to write: grading already records `learning_events`
(`check_question_service.answer` -> `learning_event_service.record_from_answer`),
and the scheduler is pure-read, so the next queue GET reflects the new streak
and `due_at`. Asserted by an integration test: seed events -> queue shows
concept due -> grade an answer for it -> queue GET shows moved `due_at` (or
concept no longer due).

## Error handling

- Queue GET: 401 unauthenticated (standard dependency); empty queue is a
  normal 200 with `total: 0` (frontend hides the card).
- Start-review resume: existing `POST /api/sessions` 404 when
  `prior_session_id` is missing/unowned; frontend surfaces the existing toast
  and stays on Home.
- Queue fetch failure on Home: card silently absent (log to console); Home
  must never block on the review card.

## Testing

Backend (pytest):
- Scheduler unit tests against a fixed event fixture with injected clock
  (roadmap AC1): interval doubling, reset on incorrect, 60-day cap,
  casefold/strip grouping across sessions, demote-re-enter (AC3), display
  string = most recent, sort order, empty input.
- Route tests: pagination (`limit/offset/total`), cross-session aggregation,
  user isolation (user A never sees user B's concepts), only-due filtering,
  no-LLM guard (monkeypatched LLM entry raises; queue GET still 200).
- Chat validation tests: mastered target accepted and rendered with retention
  framing; gap target unchanged; junk target falls back to `confirmed_gaps[0]`.
- Integration: grade-then-queue `due_at` movement (R2.2 AC3).

Frontend (vitest):
- Card absent at N = 0; renders count + top-3 at N > 0; "View all" expand at
  N > 3; clicking a concept calls createSession with `seedMode: 'resume'` +
  correct `priorSessionId` and navigates with `review_gap` query; fetch
  failure hides card without breaking Home.

Gates: full BE + FE suites, lint, codegen drift check (contract change), no
migration checks needed.

## Out of scope

- Dedicated `/review` route or full-queue page (follow-up if top-3 + expand
  proves insufficient).
- Persisted scheduler state / ease factors (revisit only if queue computation
  becomes measurably slow).
- R3 insights dashboard, R4/R5 (later slices).
