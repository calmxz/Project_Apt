# Phase 8 · WS-F — Product Fixes (F1 cost-warn tier, F2 review-gaps resume, F3 rate-limit verify)

Status: design approved 2026-07-04. Branch `phase/8-ws-f-fixes` off `dev`.
Parent: [Phase 8 launch umbrella](2026-07-02-phase-8-launch-design.md).

## 0. Why this reframes the umbrella's WS-F

The umbrella framed WS-F as three parallel fixes assuming F1 and F3 were greenfield.
Reading the live code found otherwise:

- **F1** cost warning is already wired end-to-end. `cost_meter.check_cap` returns
  `CapStatus.soft_breached` at the `$2` soft cap; `chat.py` sets `X-Cost-Warning`;
  the frontend carries it through `costBus` -> store `cost_warning` -> toast.
  The soft cap sits at ~66% of the `$3` hard cap. F1's real ask is a SECOND,
  louder tier close to lockout.
- **F3** `rate_limit.py` is already Postgres-backed (`UsageCounter`, atomic
  `INSERT ... ON CONFLICT DO NOTHING` + guarded `UPDATE`; race fixed in PR #83,
  commit `28e0ed4`). It is already multi-instance safe. No other in-memory
  throttle exists in the backend. F3 is verify-only, not a rewrite.
- **F2** resume-review-gaps is the only net-new feature. Today an ended session
  shows a single "Resume topic" button that clears `ended_at` and nothing else.

So WS-F collapses to: F2 (build), F1 (small extension), F3 (verify + document).

## 1. Scope

| Fix | Change | Size |
|---|---|---|
| F2 | "Review my gaps" resume button that opens the tutor on a confirmed gap | Feature |
| F1 | Second cost-warning tier at 90% of the hard cap | Small |
| F3 | Confirm rate limit is DB-backed + multi-instance safe; add a concurrency test if missing; document | Verify |

Order: **F2 first** (largest, real work), then F1, then F3.

Out of scope: any change to the profile write model (WS-E owns profile edits),
any new proactive-opener LLM path (none exists; we stay turn-driven), waitlist
(cut in the umbrella).

## 2. F2 — Review-gaps resume

### 2.1 Decision: transient flag, not focus mutation

Two mechanisms were on the table:

- **Reuse `focus_target_gap`** — server sets it on reopen; the tutor already
  carries the profile JSON per turn.
- **Transient `review_gaps` flag** — a per-request boolean, mirroring the
  existing `diagnostic_required` derived at `chat.py:97`.

Chosen: **transient flag.** Reasons:

1. The `FOCUS PROTOCOL` in `IMMUTABLE_RULES` frames the tutor as the *setter* of
   `focus_target_gap`; there is no rule "if focus is already set, drill into it."
   Either mechanism needs a new prompt rule, so focus-reuse buys no code saving.
2. WS-E (#103, merged today) declared `focus_target_gap` **agent-owned**. A
   reopen that writes focus adds a third writer to a field the design just made
   single-owner, and would need to bump the profile ETag to avoid racing a
   concurrent profile PATCH.
3. The focus-clear guard rail makes focus sticky: a server-set focus the tutor
   did not establish must be cleared with a valid `focus_clear_reason`, so a
   user who simply changes subject can leave focus stuck.

The transient flag mutates nothing, self-clears after one turn, and touches the
same seam `diagnostic_required` already uses.

### 2.2 Which gap

Pick the **first entry of `confirmed_gaps`**. Deterministic, no ranking model,
matches the list order the user already sees in the profile view. (If the list
is empty the mode never triggers — see empty state.)

### 2.3 Flow

```
[ended session]
  user clicks "Review my gaps"
    -> store.reopenSession(id)        (existing: clears ended_at)
    -> store auto-fires ONE chat turn with review_gaps:true and a fixed
         seed message "Review my gaps"
         seed turn renders as a normal user bubble (honest: the user clicked
         the button; mirrors the codebase's visible "[check results]" system
         turn rather than inventing hidden-render + backend persist-skip)
    -> backend chat: review_gaps flag + confirmed_gaps non-empty
         -> target = confirmed_gaps[0]
         -> prompt_state["review_gaps_target"] = target
         -> dynamic context renders  REVIEW_GAPS: <target>
    -> tutor's streamed reply IS the opener: brief recap of the gap,
       then poses a check via ask_check_questions
```

### 2.4 Backend changes

- `contracts/openapi.yaml` -> `ChatRequest` gains optional `review_gaps: bool`
  (default false). Regenerate `contracts/models.py` via
  `python backend/scripts/gen_contracts.py` (never hand-edit models).
- `routes/chat.py` `_prepare` (the block ending at `prompt_state` ~line 92):
  - read `req.review_gaps`
  - if true and `profile.confirmed_gaps`: set
    `prompt_state["review_gaps_target"] = profile.confirmed_gaps[0]`
  - else leave unset (mode off)
  - The seed turn persists a normal user message row (`chat.py:81`) and renders
    as a user bubble. No backend persist special-casing and no hidden-render
    machinery. Seed text is the fixed string "Review my gaps".
- `agent/prompts.py`:
  - `build_dynamic_context`: render `REVIEW_GAPS: <target or "OFF">`.
  - `IMMUTABLE_RULES`: add a "REVIEW-GAPS MODE" block — when `REVIEW_GAPS` names a
    gap, open the turn by briefly recapping that gap, then pose a check on it via
    `ask_check_questions`; do not diagnose first; obeys the normal one-open-batch
    and cost rules.

### 2.5 Frontend changes

- `components/SessionEndedBanner.vue`: add a second CTA "Review my gaps" beside
  "Resume topic". Emit a distinct event (`resume-gaps`). Show it ONLY when the
  session has >=1 confirmed gap.
- The banner needs to know gap count. Source: the profile the session view
  already loads (WS-E profile GET exposes `confirmed_gaps`). Pass a
  `hasGaps` / `gapCount` prop down; do not fetch inside the banner.
- `views/SessionView.vue`: add `resumeReviewGaps()` — calls `reopenSession`,
  then fires the hidden `review_gaps:true` seed turn through the store.
- `stores/session.js`: `sendMessageStreaming` gains an optional `reviewGaps`
  flag threaded into `streamChat`; the review-gaps resume path calls it with the
  fixed seed text "Review my gaps" and `reviewGaps:true`. Normal user bubble.

### 2.6 Empty state

`confirmed_gaps == []` -> "Review my gaps" button is not rendered. "Resume topic"
is unchanged and always available. Defensive backend: if `review_gaps:true`
arrives with no gaps, the mode is simply off (normal resume), never an error.

## 3. F1 — 90%-of-hard cost tier

- `cost_meter.CapStatus` gains `urgent_breached: bool` and `urgent_cap: Decimal`.
- `check_cap`: `urgent_cap = hard_cap * Decimal("0.9")` (derive; no new env var
  needed, but if config clarity is preferred add `llm_urgent_cap_usd` with a
  `0.9 * hard` default — pick derive unless tests want an explicit knob).
- `routes/chat.py` (~line 145): when `urgent_breached`, set a distinct signal —
  either `X-Cost-Warning: urgent` (extend the existing header's value) or a
  second header. Prefer extending the existing header value so the frontend has
  one seam. Keep soft-only breaches emitting the current warning value.
- Frontend `costBus`/store `cost_warning`: branch on the level; urgent shows a
  louder/stickier toast than soft. Reuse the existing toast component; change
  severity/copy, not the transport.
- Ordering holds: `used >= urgent_cap` implies `soft_breached` already true;
  urgent is the stronger of the two, hard cap (429) still wins above `$3`.

## 4. F3 — rate-limit verify

- Confirm `rate_limit.check_and_increment` is the only throttle and is DB-backed
  (done: it is; `UsageCounter` + atomic upsert).
- Confirm no other in-memory limiter/counter exists (done: grep clean).
- If no test asserts cross-caller concurrency safety, add one: two interleaved
  `check_and_increment` calls for the same (user, day) must not exceed
  `daily_cap` nor create duplicate rows. If PR #83 already left such a test,
  cite it and add nothing.
- No production code change expected. Document this outcome in the plan so the
  umbrella status table records F3 as verified, not skipped.

## 5. Testing

- **F2 backend:** `review_gaps:true` + gaps -> `prompt_state` carries the first
  gap and dynamic context renders `REVIEW_GAPS: <gap>`; empty gaps -> mode off;
  `test_prompts.py` gains a REVIEW-GAPS render case; contract test covers the new
  `ChatRequest` field.
- **F2 frontend:** banner shows the second button only with gaps; click drives
  `reopenSession` then a `review_gaps` seed turn ("Review my gaps") that renders
  as a normal user bubble.
- **F1 backend:** `check_cap` boundaries — below soft, soft-only, urgent
  (`>= 0.9*hard`), hard (429). `test` for the header level string.
- **F1 frontend:** store surfaces urgent vs soft distinctly.
- **F3:** concurrency test as above (or cite existing).
- Full suites green: backend `pytest` under `DATABASE_URL=sqlite:///./data/app.db`
  for CI parity (WS-C lesson: local `.env` Postgres masks env-dependent guards);
  frontend `npm run test:unit -- --run`; `npm run lint`.

## 6. Owed / human gates

- Paid live-LLM smoke of F2: end a session with a confirmed gap, click "Review my
  gaps", confirm the tutor opens on that gap with a check-question card.
- F1 live check: drive spend past `$2.70` and confirm the urgent tier surfaces
  distinctly from the soft warning (may be simulated by lowering caps in a
  scratch env rather than real spend).

## 7. Non-goals / guard rails

- No profile write from the resume path (F2 stays read-only w.r.t. the profile;
  only the tutor mutates the profile, via its normal tools).
- No new opener LLM call outside the turn loop.
- Contracts are codegen: edit `openapi.yaml`, run `gen_contracts.py`, never
  hand-edit `contracts/models.py`.
