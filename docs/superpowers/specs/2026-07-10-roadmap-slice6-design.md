# Roadmap Slice 6 — R3 Learning Insights Dashboard (Design)

Date: 2026-07-10
Branch: `feat/roadmap-slice6`
Source: `docs/planning/2026-07-06-10x-roadmap.md` §R3 (R3.1 + R3.2)
Status: Approved design, pre-plan

## 1. Goal

Upgrade the aggregate profile view from flat counts to trends, and add usage
transparency. Two halves:

- **R3.1** — per-concept accuracy, last-5 sparkline, weakest-concepts ranking,
  mastery-over-time weekly chart, deep links to source sessions, designed
  empty states.
- **R3.2** — daily spend history (14 days), today's spend vs cap tiers, top-3
  most expensive sessions.

Both ship in this slice. No migration: all required tables
(`learning_events`, `daily_cost_ledger`, `llm_call_log`) already exist.
Alembic head stays 0016.

## 2. Decisions taken (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Scope | R3.1 + R3.2 together | R3.2 is small: `llm_call_log` landed in an earlier slice with `session_id` + `cost_usd`, so top-sessions is buildable, not degraded (roadmap R3.2 AC2 contingency does not apply). |
| Mastery-over-time derivation | First-correct approximation | Week of the first correct non-diagnostic learning event per concept counts as its promotion week. Pure read-side, works on historical data, no schema change. No promotion event rows exist; adding them was rejected (migration + tool change, empty history). |
| Charts | Hand-rolled CSS/SVG | Extends the existing `dist-bar` precedent in `AggregateProfileView.vue`. All visuals are trivial shapes; no chart library dependency. |
| R3.2 placement | Dashboard section on `AggregateProfileView` | One page tells the whole R3 story; roadmap allowed "Settings (or dashboard)". |
| API shape | Extend aggregate response + new `/api/usage/summary` | Roadmap R3.1 AC1 says "aggregate endpoint adds". Cost is a separate domain; keeps the profile contract clean. |
| Weakest ranking | Client-side | Derived trivially from `concept_accuracy` (filter total >= 2, sort ascending accuracy); avoids duplicated server data. |

## 3. Backend

### 3.1 Aggregate extension (R3.1)

`services/profile_service.aggregate_for_user` gains a per-concept
learning-event aggregation step. Diagnostic rows are excluded with the
NULL-safe filter already used by the review queue:
`or_(LearningEvent.purpose.is_(None), LearningEvent.purpose != "diagnostic")`.

`AggregateProfileResponse` (edit `docs/api/openapi.yaml` first, then run
`python backend/scripts/gen_contracts.py`) gains:

- `concept_accuracy: list[ConceptAccuracy]` — one entry per concept
  (`gap_tested` value) with at least one non-diagnostic event:
  - `concept: str`
  - `correct_count: int`
  - `total_count: int`
  - `accuracy: float` (0-1, correct/total)
  - `last_results: list[bool]` — at most 5, ordered oldest to newest
  - `first_seen_session_id: str` — session of the concept's earliest event
- `weekly_mastery: list[WeeklyMasteryPoint]` — last 12 weeks, zero-filled:
  - `week_start: date` (ISO Monday)
  - `count: int` — concepts whose first correct non-diagnostic event falls in
    that week

Endpoint stays pure SQL + Python — zero LLM calls (regression-tested).

### 3.2 Usage endpoint (R3.2)

New `GET /api/usage/summary` — thin route in `backend/routes/usage.py`
delegating to `backend/services/usage_service.py`, following the
`routes/review.py` pattern (`Depends(current_user_id)`, `Depends(get_db)`,
typed response, `extra="forbid"` contract).

`UsageSummaryResponse`:

- `daily: list[DailySpend]` — last 14 UTC days from `daily_cost_ledger`,
  zero-filled for missing days: `{date_utc: date, cost_usd: float}`
- `today_spend_usd: float`
- `soft_cap_usd: float`, `urgent_cap_usd: float`, `hard_cap_usd: float` —
  sourced from `config.py` values and the existing `cost_meter` urgent
  derivation (0.9 x hard). Single source asserted by test; no new literal
  thresholds anywhere.
- `top_sessions: list[SessionSpend]` — top 3 by summed `llm_call_log.cost_usd`
  for the current user (join through sessions for ownership + topic):
  `{session_id: str, topic: str, cost_usd: float}`

This is the first reader of `llm_call_log` (its docstring anticipated R3).
Money values quantized to 4 decimal places, consistent with `cost_meter`.

## 4. Frontend

All on `frontend/src/views/AggregateProfileView.vue`; three new components,
hand-rolled CSS/SVG, each `role="img"` + descriptive `aria-label` where the
visual is non-textual.

### Insights section (below existing stat cards)

- `WeakestConcepts.vue` — ranked list: concepts with `total_count >= 2`,
  ascending accuracy, top 5. Row = concept name, accuracy percent with CSS
  width bar, 5-dot sparkline (correct/incorrect dots, oldest to newest), row
  links to `session-profile` route via `first_seen_session_id` (R3.1 AC3).
- `MasteryTrend.vue` — 12-week bar chart from `weekly_mastery`, flex columns
  like the existing `.dist-bar`.

### Usage section

- `UsagePanel.vue` — three parts:
  - 14-day spend bar chart from `daily`.
  - Today-vs-tiers progress bar: fill = `today_spend_usd / hard_cap_usd`,
    markers at soft/urgent/hard positions from response values (never
    hardcoded thresholds).
  - Top-3 expensive sessions list (topic + cost), each linking to the session.

### Data flow

- `frontend/src/services/profileApi.js` gains `getUsageSummary()` via
  `apiGet('/usage/summary')`.
- View fetches aggregate + usage in parallel inside existing
  `onMounted(load)`.
- Independent failure domains: if the usage fetch fails, the usage section
  shows an inline notice and the insights section still renders; and vice
  versa (aggregate failure keeps existing view-level error, usage alone does
  not render a broken page).

### Empty/low-data states (R3.1 AC4)

- No concept with >= 2 attempts: WeakestConcepts shows guidance copy
  ("answer more check questions to see trends"), not an empty chart.
- All-zero `weekly_mastery`: MasteryTrend hidden, replaced by a hint.
- Empty spend history: "no usage yet" state in UsagePanel.

## 5. Error handling

- Usage endpoint: 401 via existing auth dependency; standard error envelope.
- Frontend maps errors through `lib/errors.js` `friendlyError`.
- `cost_usd` serialized as JSON numbers (float), 4-dp quantized server-side.

## 6. Testing

TDD per task; sqlite CI parity maintained.

Backend service tests:
- Accuracy math (correct/total), diagnostic and NULL-purpose handling
  (NULL included, `"diagnostic"` excluded).
- `last_results` ordering (oldest to newest) and cap at 5.
- Weekly bucketing: Monday start, zero-fill, 12-week window, first-correct
  dedup per concept.
- 14-day ledger window + zero-fill; today's value.
- Top-3 ordering, tie behavior deterministic, user isolation (other users'
  sessions never leak).
- Cap values in response come from config/cost_meter (assert single source —
  no duplicated numeric literals in usage_service).

Backend route tests:
- 401 unauthenticated for `/api/usage/summary`.
- Response contract shape for both endpoints.
- Zero-LLM regression for both endpoints (monkeypatched litellm, same
  pattern as the review queue test).

Frontend vitest:
- WeakestConcepts: min-2-attempts filter, ascending sort, top-5 cap,
  sparkline dot rendering, deep-link targets.
- MasteryTrend: bars from data, all-zero hint state.
- UsagePanel: bars, marker positions derived from response values,
  top-sessions links, empty state.
- View: parallel fetch, independent failure degradation.

Gates: full backend + frontend suites, lint, contract-drift check
(`gen_contracts.py` produces no diff).

## 7. Out of scope

- Promotion event rows / schema changes (rejected alternative).
- Chart library.
- Settings-page usage display.
- R4 provenance weighting; R5 exams.
- Any LLM behavior change — this slice is read-only over existing data.
