# Roadmap Slice 6 — R3 Learning Insights Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the aggregate profile view from flat counts to trends (per-concept accuracy, sparklines, weakest-concepts ranking, weekly mastery chart) and add usage transparency (14-day spend, today vs cap tiers, top-3 expensive sessions).

**Architecture:** Extend the existing `GET /api/profile/aggregate` response with two new arrays computed in `profile_service`; add a new read-only `GET /api/usage/summary` endpoint (thin route + `usage_service`) that becomes the first reader of `llm_call_log`. Frontend adds three hand-rolled CSS-chart components to `AggregateProfileView.vue`. No migration — alembic head stays 0016.

**Tech Stack:** FastAPI + SQLAlchemy 2 (backend), Pydantic contracts generated from `docs/api/openapi.yaml`, Vue 3 `<script setup>` + vitest (frontend). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-10-roadmap-slice6-design.md`

## Global Constraints

- No emojis in code or comments.
- Contracts are codegen: edit `docs/api/openapi.yaml` first, then run `python backend/scripts/gen_contracts.py` from the repo root. NEVER hand-edit `backend/contracts/models.py`. CI enforces zero drift.
- Backend tests run from `backend/`: `pytest tests/test_foo.py -v`. Frontend tests run from `frontend/`: `npm run test:unit -- --run <file>`.
- Diagnostic learning events are excluded with the NULL-safe filter: `or_(LearningEvent.purpose.is_(None), LearningEvent.purpose != "diagnostic")` — a plain `!=` silently drops NULL-purpose rows.
- Cap tiers have a single source: `settings.llm_soft_cap_usd` (2.00) and `settings.llm_hard_cap_usd` (3.00) in `backend/config.py`; the $2.70 urgent tier is DERIVED as `hard * 0.9` in `cost_meter.check_cap_from_spend`. Never write 2.7/2.70 (or any tier literal) into production code — reuse `check_cap_from_spend`.
- The aggregate and usage endpoints must make zero LLM calls (regression-tested with monkeypatched litellm).
- Money is `Decimal` quantized to 4 dp server-side, serialized as JSON numbers.
- Frontend: no hardcoded cap thresholds — marker positions come from response values.
- Commit after every task with a conventional-commit message.

---

### Task 1: API contract — new schemas + usage path

**Files:**
- Modify: `docs/api/openapi.yaml`
- Regenerate: `backend/contracts/models.py` (via script — do not hand-edit)

**Interfaces:**
- Produces (consumed by Tasks 2-5): Pydantic classes `ConceptAccuracy`, `WeeklyMasteryPoint`, `DailySpend`, `SessionSpend`, `UsageSummaryResponse`, and two new required fields on `AggregateProfileResponse`: `concept_accuracy: list[ConceptAccuracy]`, `weekly_mastery: list[WeeklyMasteryPoint]`. All importable as `from contracts import ConceptAccuracy, ...`.

- [ ] **Step 1: Add the usage path to `docs/api/openapi.yaml`**

Insert directly after the `/api/review/queue` path block (it ends at the `ReviewQueuePage` $ref around line 139, before `/api/sessions/{session_id}`):

```yaml
  /api/usage/summary:
    get:
      tags: [usage]
      summary: Daily spend history, today's spend vs cap tiers, and the most expensive sessions.
      operationId: getUsageSummary
      responses:
        "200":
          description: Usage summary for the authenticated user.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UsageSummaryResponse"
```

- [ ] **Step 2: Add new component schemas**

Insert after the `AggregateProfileResponse` schema (before `ErrorResponse`, around line 1073):

```yaml
    ConceptAccuracy:
      type: object
      additionalProperties: false
      required:
        - concept
        - correct_count
        - total_count
        - accuracy
        - last_results
        - first_seen_session_id
      description: |
        Per-concept check-question accuracy across all of a user's sessions.
        Diagnostic events are excluded. last_results is oldest-to-newest, at
        most 5 entries. first_seen_session_id is the session of the concept's
        earliest learning event.
      properties:
        concept: { type: string }
        correct_count: { type: integer, minimum: 0 }
        total_count: { type: integer, minimum: 1 }
        accuracy: { type: number, minimum: 0, maximum: 1 }
        last_results:
          type: array
          maxItems: 5
          items: { type: boolean }
        first_seen_session_id: { type: string }

    WeeklyMasteryPoint:
      type: object
      additionalProperties: false
      required: [week_start, count]
      description: |
        Number of concepts whose first correct non-diagnostic answer falls in
        the ISO week starting at week_start (a Monday, UTC).
      properties:
        week_start: { type: string, format: date }
        count: { type: integer, minimum: 0 }

    DailySpend:
      type: object
      additionalProperties: false
      required: [date_utc, cost_usd]
      properties:
        date_utc: { type: string, format: date }
        cost_usd: { type: number, minimum: 0 }

    SessionSpend:
      type: object
      additionalProperties: false
      required: [session_id, topic, cost_usd]
      properties:
        session_id: { type: string }
        topic: { type: string }
        cost_usd: { type: number, minimum: 0 }

    UsageSummaryResponse:
      type: object
      additionalProperties: false
      required:
        - daily
        - today_spend_usd
        - soft_cap_usd
        - urgent_cap_usd
        - hard_cap_usd
        - top_sessions
      description: |
        Spend transparency for the current user. daily covers the last 14 UTC
        days, oldest first, zero-filled for missing ledger rows. Cap values
        mirror the runtime cost meter; the urgent tier is derived (0.9 x
        hard), never a duplicated literal.
      properties:
        daily:
          type: array
          items: { $ref: "#/components/schemas/DailySpend" }
        today_spend_usd: { type: number, minimum: 0 }
        soft_cap_usd: { type: number }
        urgent_cap_usd: { type: number }
        hard_cap_usd: { type: number }
        top_sessions:
          type: array
          maxItems: 3
          items: { $ref: "#/components/schemas/SessionSpend" }
```

- [ ] **Step 3: Extend `AggregateProfileResponse`**

In the existing `AggregateProfileResponse` schema, append two entries to the `required` list:

```yaml
        - concept_accuracy
        - weekly_mastery
```

and two properties after `recent_topics`:

```yaml
        concept_accuracy:
          type: array
          items: { $ref: "#/components/schemas/ConceptAccuracy" }
        weekly_mastery:
          type: array
          items: { $ref: "#/components/schemas/WeeklyMasteryPoint" }
```

- [ ] **Step 4: Regenerate contracts**

Run from repo root: `python backend/scripts/gen_contracts.py`
Expected: `backend/contracts/models.py` regenerated without errors.

- [ ] **Step 5: Verify the new classes import**

Run from `backend/`:
`python -c "from contracts import ConceptAccuracy, WeeklyMasteryPoint, DailySpend, SessionSpend, UsageSummaryResponse, AggregateProfileResponse; print(sorted(AggregateProfileResponse.model_fields))"`
Expected: prints field list including `concept_accuracy` and `weekly_mastery`.

Note: the existing backend test suite will now FAIL on aggregate tests (new required fields with no values). That is expected RED for Task 2 — do NOT run the full suite as part of this task's gate; Task 2 turns it green.

- [ ] **Step 6: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts/models.py
git commit -m "feat(contracts): ConceptAccuracy, WeeklyMasteryPoint, UsageSummaryResponse schemas + /api/usage/summary path"
```

---

### Task 2: Backend — per-concept accuracy in the aggregate

**Files:**
- Modify: `backend/services/profile_service.py` (function `aggregate_for_user`, lines ~239-331)
- Test: `backend/tests/test_profile_aggregate.py` (append)

**Interfaces:**
- Consumes: `ConceptAccuracy` from Task 1; `aware_utc` from `services.session_enrichment`.
- Produces: private helper `_learning_insights(db, session_ids: list[str], now: datetime) -> tuple[list[ConceptAccuracy], list[WeeklyMasteryPoint]]` in `profile_service.py` (weekly part returns 12 zero-count buckets until Task 3 implements it); `aggregate_for_user(db, user_id, now: datetime | None = None)` gains an optional `now` kwarg (test injection, mirrors `compute_schedule(events, now=now)` precedent).

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_profile_aggregate.py`. The file's existing tests use the `client` + `db_session` fixtures from conftest; reuse the same seeding style as `test_review_queue_route.py`. Read the file first: if it already defines `T0`, equivalent seed helpers, or these imports, REUSE the existing names instead of redefining them (adjust the test code below accordingly):

```python
from datetime import datetime, timedelta, timezone

from db.models import LearningEvent, Session as SessionModel, User

T0 = datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc)


def _seed_session_for_insights(db, session_id="s1", user_id="test-user", topic="biology"):
    if not db.get(User, user_id):
        db.add(User(id=user_id))
    db.add(SessionModel(id=session_id, user_id=user_id, topic=topic))
    db.commit()


def _seed_event_for_insights(db, session_id, gap, correct, created_at, purpose=None):
    db.add(
        LearningEvent(
            session_id=session_id,
            gap_tested=gap,
            question="q",
            correct=correct,
            created_at=created_at,
            purpose=purpose,
        )
    )
    db.commit()


def test_concept_accuracy_math_and_first_session(client, db_session):
    _seed_session_for_insights(db_session, session_id="s1")
    _seed_session_for_insights(db_session, session_id="s2")
    _seed_event_for_insights(db_session, "s1", "mitosis", False, T0)
    _seed_event_for_insights(db_session, "s2", "mitosis", True, T0 + timedelta(hours=1))
    _seed_event_for_insights(db_session, "s2", "mitosis", True, T0 + timedelta(hours=2))
    body = client.get("/api/profile/aggregate").json()
    assert len(body["concept_accuracy"]) == 1
    entry = body["concept_accuracy"][0]
    assert entry["concept"] == "mitosis"
    assert entry["correct_count"] == 2
    assert entry["total_count"] == 3
    assert abs(entry["accuracy"] - 2 / 3) < 0.001
    assert entry["first_seen_session_id"] == "s1"  # earliest event, not most events


def test_concept_accuracy_excludes_diagnostic_keeps_null_purpose(client, db_session):
    _seed_session_for_insights(db_session)
    _seed_event_for_insights(db_session, "s1", "mitosis", True, T0, purpose="diagnostic")
    _seed_event_for_insights(db_session, "s1", "osmosis", True, T0, purpose=None)
    _seed_event_for_insights(db_session, "s1", "diffusion", True, T0, purpose="check")
    body = client.get("/api/profile/aggregate").json()
    concepts = {e["concept"] for e in body["concept_accuracy"]}
    assert concepts == {"osmosis", "diffusion"}


def test_last_results_capped_at_five_oldest_to_newest(client, db_session):
    _seed_session_for_insights(db_session)
    # 7 events: F F F T T T F -> last 5 = F T T T F
    pattern = [False, False, False, True, True, True, False]
    for i, ok in enumerate(pattern):
        _seed_event_for_insights(
            db_session, "s1", "mitosis", ok, T0 + timedelta(minutes=i)
        )
    body = client.get("/api/profile/aggregate").json()
    entry = body["concept_accuracy"][0]
    assert entry["last_results"] == [False, True, True, True, False]
    assert entry["total_count"] == 7


def test_concept_accuracy_empty_when_no_events(client, db_session):
    _seed_session_for_insights(db_session)
    body = client.get("/api/profile/aggregate").json()
    assert body["concept_accuracy"] == []
    assert len(body["weekly_mastery"]) == 12
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_profile_aggregate.py -v`
Expected: the four new tests FAIL. Pre-existing aggregate tests also fail with Pydantic `ValidationError` for missing `concept_accuracy`/`weekly_mastery` (Task 1 made them required) — this step fixes those too.

- [ ] **Step 3: Implement**

In `backend/services/profile_service.py`:

Add imports (top of file, merge with existing import lines — `or_` and `timedelta`/`date` may be new):

```python
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, or_, select

from contracts import ConceptAccuracy, WeeklyMasteryPoint
from services.session_enrichment import aware_utc
```

(Keep every existing import; only add what is missing. `ConceptAccuracy`/`WeeklyMasteryPoint` join the existing `from contracts import ...` line.)

Add module-level helpers above `aggregate_for_user`:

```python
def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _learning_insights(
    db: Session, session_ids: list[str], now: datetime
) -> tuple[list[ConceptAccuracy], list[WeeklyMasteryPoint]]:
    """Per-concept accuracy + weekly mastery buckets from learning_events.
    Diagnostic probes excluded (NULL purpose kept). Pure SQL + Python."""
    this_monday = _monday(now.date())
    weeks = [this_monday - timedelta(weeks=i) for i in range(11, -1, -1)]
    week_counts: dict[date, int] = {w: 0 for w in weeks}

    if not session_ids:
        return [], [
            WeeklyMasteryPoint(week_start=w, count=0) for w in weeks
        ]

    rows = db.execute(
        select(LearningEvent)
        .where(LearningEvent.session_id.in_(session_ids))
        .where(
            or_(
                LearningEvent.purpose.is_(None),
                LearningEvent.purpose != "diagnostic",
            )
        )
        .order_by(LearningEvent.created_at.asc(), LearningEvent.id.asc())
    ).scalars().all()

    per: dict[str, dict] = {}
    first_correct: dict[str, datetime] = {}
    for ev in rows:
        entry = per.setdefault(
            ev.gap_tested,
            {"correct": 0, "total": 0, "results": [], "first_session": ev.session_id},
        )
        entry["total"] += 1
        entry["results"].append(ev.correct)
        if ev.correct:
            entry["correct"] += 1
            first_correct.setdefault(ev.gap_tested, aware_utc(ev.created_at))

    for ts in first_correct.values():
        w = _monday(ts.date())
        if w in week_counts:
            week_counts[w] += 1

    concept_accuracy = sorted(
        (
            ConceptAccuracy(
                concept=name,
                correct_count=v["correct"],
                total_count=v["total"],
                accuracy=round(v["correct"] / v["total"], 4),
                last_results=v["results"][-5:],
                first_seen_session_id=v["first_session"],
            )
            for name, v in per.items()
        ),
        key=lambda x: (x.accuracy, x.concept),
    )
    weekly = [WeeklyMasteryPoint(week_start=w, count=week_counts[w]) for w in weeks]
    return concept_accuracy, weekly
```

Change the signature of `aggregate_for_user`:

```python
def aggregate_for_user(
    db: Session, user_id: str, now: datetime | None = None
) -> AggregateProfileResponse:
```

Inside it, after `session_ids = [s.id for s in sessions]` is computed, add:

```python
    concept_accuracy, weekly_mastery = _learning_insights(
        db, session_ids, now or datetime.now(timezone.utc)
    )
```

and add both to the return:

```python
        concept_accuracy=concept_accuracy,
        weekly_mastery=weekly_mastery,
```

Note: `LearningEvent.created_at` ordering ties are broken by `id` — insertion order, same as the review queue. `first_seen_session_id` here is the earliest EVENT's session (documented in the schema description); the profile-based `AggregateConceptCount.first_seen_session_id` semantics are untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run from `backend/`: `pytest tests/test_profile_aggregate.py -v`
Expected: ALL tests in the file PASS (new four + previously-failing pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add backend/services/profile_service.py backend/tests/test_profile_aggregate.py
git commit -m "feat(backend): per-concept accuracy + sparkline data in aggregate profile"
```

---

### Task 3: Backend — weekly mastery buckets

**Files:**
- Modify: `backend/services/profile_service.py` (`_learning_insights` — logic already scaffolded in Task 2; this task locks behavior with tests and fixes anything the tests expose)
- Test: `backend/tests/test_profile_aggregate.py` (append)

**Interfaces:**
- Consumes: `_learning_insights` and the `now` kwarg from Task 2.
- Produces: verified `weekly_mastery` semantics for Task 7's frontend: exactly 12 buckets, Monday-start ISO dates, oldest first, zero-filled, one count per concept at its FIRST correct event.

- [ ] **Step 1: Write failing (or locking) tests**

Append to `backend/tests/test_profile_aggregate.py`. `T0 = 2026-07-01 12:00 UTC` is a Wednesday; its Monday is `2026-06-29`. Route tests cannot inject `now`, so call the service directly:

```python
def test_weekly_mastery_buckets_first_correct_only(db_session):
    from services.profile_service import aggregate_for_user

    _seed_session_for_insights(db_session)
    # mitosis: wrong then correct in week of 2026-06-29, correct again 2 weeks later
    _seed_event_for_insights(db_session, "s1", "mitosis", False, T0)
    _seed_event_for_insights(db_session, "s1", "mitosis", True, T0 + timedelta(hours=1))
    _seed_event_for_insights(db_session, "s1", "mitosis", True, T0 + timedelta(weeks=2))
    # osmosis: first correct 1 week after T0
    _seed_event_for_insights(db_session, "s1", "osmosis", True, T0 + timedelta(weeks=1))
    # diffusion: never correct -> never counted
    _seed_event_for_insights(db_session, "s1", "diffusion", False, T0)

    now = T0 + timedelta(weeks=2)  # 2026-07-15
    resp = aggregate_for_user(db_session, "test-user", now=now)

    assert len(resp.weekly_mastery) == 12
    # oldest first, consecutive Mondays, newest bucket = Monday of `now`
    assert resp.weekly_mastery[-1].week_start.isoformat() == "2026-07-13"
    assert resp.weekly_mastery[0].week_start.isoformat() == "2026-04-27"
    by_week = {p.week_start.isoformat(): p.count for p in resp.weekly_mastery}
    assert by_week["2026-06-29"] == 1  # mitosis first correct
    assert by_week["2026-07-06"] == 1  # osmosis
    assert by_week["2026-07-13"] == 0  # mitosis retest does NOT recount
    assert sum(p.count for p in resp.weekly_mastery) == 2


def test_weekly_mastery_outside_window_dropped(db_session):
    from services.profile_service import aggregate_for_user

    _seed_session_for_insights(db_session)
    # first correct 20 weeks before `now` -> outside the 12-week window
    _seed_event_for_insights(db_session, "s1", "ancient", True, T0)
    now = T0 + timedelta(weeks=20)
    resp = aggregate_for_user(db_session, "test-user", now=now)
    assert sum(p.count for p in resp.weekly_mastery) == 0
    assert len(resp.weekly_mastery) == 12


def test_weekly_mastery_diagnostic_correct_not_counted(db_session):
    from services.profile_service import aggregate_for_user

    _seed_session_for_insights(db_session)
    _seed_event_for_insights(db_session, "s1", "mitosis", True, T0, purpose="diagnostic")
    resp = aggregate_for_user(db_session, "test-user", now=T0)
    assert sum(p.count for p in resp.weekly_mastery) == 0
```

- [ ] **Step 2: Run tests**

Run from `backend/`: `pytest tests/test_profile_aggregate.py -v`
Expected: PASS if Task 2's scaffold is fully correct; any FAIL pinpoints a bucketing bug — fix `_learning_insights` minimally until green. Either way the tests now lock the contract.

- [ ] **Step 3: Run the full aggregate + review files**

Run: `pytest tests/test_profile_aggregate.py tests/test_review_queue_route.py tests/test_review_queue_service.py -v`
Expected: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_profile_aggregate.py backend/services/profile_service.py
git commit -m "feat(backend): weekly mastery buckets locked by service-level tests"
```

---

### Task 4: Backend — usage_service

**Files:**
- Create: `backend/services/usage_service.py`
- Test: `backend/tests/test_usage_service.py` (create)

**Interfaces:**
- Consumes: `UsageSummaryResponse`, `DailySpend`, `SessionSpend` from Task 1; `check_cap_from_spend` from `services.cost_meter`; models `DailyCostLedger`, `LlmCallLog`, `Session as SessionModel`, `User`.
- Produces: `usage_summary(db: Session, user_id: str, now: datetime | None = None) -> UsageSummaryResponse` — Task 5's route calls exactly this.

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_usage_service.py`:

```python
from datetime import datetime, timezone
from decimal import Decimal

from db.models import DailyCostLedger, LlmCallLog, Session as SessionModel, User
from services.usage_service import usage_summary

NOW = datetime(2026, 7, 10, 8, 0, 0, tzinfo=timezone.utc)  # today = 2026-07-10


def _seed_user(db, user_id="test-user"):
    if not db.get(User, user_id):
        db.add(User(id=user_id))
        db.commit()


def _seed_ledger(db, user_id, date_utc, cost):
    db.add(DailyCostLedger(user_id=user_id, date_utc=date_utc, cost_usd=Decimal(cost)))
    db.commit()


def _seed_call(db, user_id, session_id, cost):
    db.add(
        LlmCallLog(
            user_id=user_id,
            session_id=session_id,
            purpose="chat",
            model="m",
            cost_usd=Decimal(cost),
        )
    )
    db.commit()


def _seed_session(db, session_id, user_id="test-user", topic="biology"):
    db.add(SessionModel(id=session_id, user_id=user_id, topic=topic))
    db.commit()


def test_daily_window_zero_filled_oldest_first(db_session):
    _seed_user(db_session)
    _seed_ledger(db_session, "test-user", "2026-07-10", "1.5000")
    _seed_ledger(db_session, "test-user", "2026-07-01", "0.2000")
    _seed_ledger(db_session, "test-user", "2026-06-01", "9.0000")  # outside window
    resp = usage_summary(db_session, "test-user", now=NOW)
    assert len(resp.daily) == 14
    assert resp.daily[0].date_utc.isoformat() == "2026-06-27"
    assert resp.daily[-1].date_utc.isoformat() == "2026-07-10"
    by_date = {d.date_utc.isoformat(): d.cost_usd for d in resp.daily}
    assert by_date["2026-07-10"] == 1.5
    assert by_date["2026-07-01"] == 0.2
    assert by_date["2026-07-05"] == 0.0
    assert "2026-06-01" not in by_date


def test_today_spend_and_caps_from_single_source(db_session):
    from config import settings
    from services.cost_meter import check_cap_from_spend

    _seed_user(db_session)
    _seed_ledger(db_session, "test-user", "2026-07-10", "2.5000")
    resp = usage_summary(db_session, "test-user", now=NOW)
    assert resp.today_spend_usd == 2.5
    assert resp.soft_cap_usd == float(settings.llm_soft_cap_usd)
    assert resp.hard_cap_usd == float(settings.llm_hard_cap_usd)
    # urgent must equal the cost_meter derivation, not an independent literal
    expected_urgent = float(check_cap_from_spend(Decimal("0")).urgent_cap)
    assert resp.urgent_cap_usd == expected_urgent


def test_no_data_returns_zeroes(db_session):
    _seed_user(db_session)
    resp = usage_summary(db_session, "test-user", now=NOW)
    assert resp.today_spend_usd == 0.0
    assert all(d.cost_usd == 0.0 for d in resp.daily)
    assert resp.top_sessions == []


def test_top_sessions_ordering_and_cap_at_three(db_session):
    _seed_user(db_session)
    for sid, costs in [
        ("s1", ["0.1000"]),
        ("s2", ["0.5000", "0.5000"]),  # total 1.0 -> top
        ("s3", ["0.3000"]),
        ("s4", ["0.2000"]),
    ]:
        _seed_session(db_session, sid)
        for c in costs:
            _seed_call(db_session, "test-user", sid, c)
    resp = usage_summary(db_session, "test-user", now=NOW)
    assert [t.session_id for t in resp.top_sessions] == ["s2", "s3", "s4"]
    assert resp.top_sessions[0].cost_usd == 1.0
    assert resp.top_sessions[0].topic == "biology"


def test_top_sessions_user_isolation_and_null_session_skipped(db_session):
    _seed_user(db_session)
    _seed_user(db_session, "other-user")
    _seed_session(db_session, "mine", user_id="test-user")
    _seed_session(db_session, "theirs", user_id="other-user")
    _seed_call(db_session, "test-user", "mine", "0.1000")
    _seed_call(db_session, "other-user", "theirs", "5.0000")
    _seed_call(db_session, "test-user", None, "3.0000")  # unattributed: excluded
    resp = usage_summary(db_session, "test-user", now=NOW)
    assert [t.session_id for t in resp.top_sessions] == ["mine"]


def test_usage_service_has_no_tier_literals():
    """Guard: tier thresholds live in config/cost_meter only."""
    import inspect

    import services.usage_service as mod

    src = inspect.getsource(mod)
    for literal in ("2.7", "2.70", "2.0", "2.00", "3.0", "3.00", "0.9"):
        assert literal not in src, f"tier literal {literal} duplicated in usage_service"
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_usage_service.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'services.usage_service'`.

- [ ] **Step 3: Implement**

Create `backend/services/usage_service.py`:

```python
"""Read-side spend transparency (roadmap R3.2). First reader of llm_call_log.

Pure SQL + Python, zero LLM calls. Cap tiers come exclusively from
cost_meter.check_cap_from_spend (config-backed; urgent derived there) so the
thresholds have a single source of truth.
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from contracts import DailySpend, SessionSpend, UsageSummaryResponse
from db.models import DailyCostLedger, LlmCallLog, Session as SessionModel
from services.cost_meter import check_cap_from_spend

WINDOW_DAYS = 14
TOP_SESSIONS = 3


def usage_summary(
    db: Session, user_id: str, now: datetime | None = None
) -> UsageSummaryResponse:
    today = (now or datetime.now(timezone.utc)).date()
    window = [today - timedelta(days=i) for i in range(WINDOW_DAYS - 1, -1, -1)]
    keys = [d.isoformat() for d in window]

    rows = db.execute(
        select(DailyCostLedger.date_utc, DailyCostLedger.cost_usd)
        .where(DailyCostLedger.user_id == user_id)
        .where(DailyCostLedger.date_utc.in_(keys))
    ).all()
    by_date = {date_utc: float(cost) for date_utc, cost in rows}
    daily = [
        DailySpend(date_utc=d, cost_usd=by_date.get(d.isoformat(), 0.0))
        for d in window
    ]

    caps = check_cap_from_spend(Decimal(str(by_date.get(today.isoformat(), 0.0))))

    top_rows = db.execute(
        select(
            LlmCallLog.session_id,
            SessionModel.topic,
            func.sum(LlmCallLog.cost_usd).label("total"),
        )
        .join(SessionModel, LlmCallLog.session_id == SessionModel.id)
        .where(LlmCallLog.user_id == user_id)
        .group_by(LlmCallLog.session_id, SessionModel.topic)
        .order_by(func.sum(LlmCallLog.cost_usd).desc(), LlmCallLog.session_id.asc())
        .limit(TOP_SESSIONS)
    ).all()
    top_sessions = [
        SessionSpend(session_id=sid, topic=topic or "", cost_usd=float(total))
        for sid, topic, total in top_rows
    ]

    return UsageSummaryResponse(
        daily=daily,
        today_spend_usd=float(caps.used),
        soft_cap_usd=float(caps.soft_cap),
        urgent_cap_usd=float(caps.urgent_cap),
        hard_cap_usd=float(caps.hard_cap),
        top_sessions=top_sessions,
    )
```

Notes: the inner join drops `session_id IS NULL` rows by construction (unattributable calls). Tie-break on `session_id.asc()` keeps top-3 deterministic. `topic or ""` because `SessionSpend.topic` is required.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_usage_service.py -v`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/usage_service.py backend/tests/test_usage_service.py
git commit -m "feat(backend): usage_service - 14-day spend window, caps, top sessions"
```

---

### Task 5: Backend — usage route + zero-LLM regressions

**Files:**
- Create: `backend/routes/usage.py`
- Modify: `backend/main.py` (register router)
- Test: `backend/tests/test_usage_route.py` (create); `backend/tests/test_profile_aggregate.py` (append one zero-LLM test)

**Interfaces:**
- Consumes: `usage_summary` from Task 4; `current_user_id` from `services.auth`; `get_db` from `db.database`.
- Produces: `GET /api/usage/summary` live in the app — Task 6's frontend calls it.

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_usage_route.py`:

```python
from datetime import datetime, timezone
from decimal import Decimal

from db.models import DailyCostLedger, User


def _seed_today(db, user_id="test-user", cost="1.0000"):
    if not db.get(User, user_id):
        db.add(User(id=user_id))
    today = datetime.now(timezone.utc).date().isoformat()
    db.add(DailyCostLedger(user_id=user_id, date_utc=today, cost_usd=Decimal(cost)))
    db.commit()


def test_usage_summary_shape(client, db_session):
    _seed_today(db_session)
    r = client.get("/api/usage/summary")
    assert r.status_code == 200
    body = r.json()
    assert len(body["daily"]) == 14
    assert body["today_spend_usd"] == 1.0
    assert body["soft_cap_usd"] == 2.0
    assert body["urgent_cap_usd"] == 2.7
    assert body["hard_cap_usd"] == 3.0
    assert body["top_sessions"] == []


def test_usage_summary_rejects_invalid_token(client, db_session):
    r = client.get(
        "/api/usage/summary", headers={"Authorization": "Bearer bogus"}
    )
    assert r.status_code == 401


def test_usage_summary_makes_no_llm_call(client, db_session, monkeypatch):
    import litellm

    def _boom(*args, **kwargs):
        raise AssertionError("usage path must not call the LLM")

    monkeypatch.setattr(litellm, "acompletion", _boom, raising=False)
    monkeypatch.setattr(litellm, "completion", _boom, raising=False)
    _seed_today(db_session)
    assert client.get("/api/usage/summary").status_code == 200


def test_usage_summary_user_isolation(client, db_session):
    _seed_today(db_session, user_id="other-user", cost="9.0000")
    r = client.get("/api/usage/summary")
    assert r.json()["today_spend_usd"] == 0.0
```

(The tier literals 2.0/2.7/3.0 in TESTS are fine — the single-source guard applies to production code only; test fixtures asserting the live values are exactly how drift gets caught.)

Append to `backend/tests/test_profile_aggregate.py`:

```python
def test_aggregate_makes_no_llm_call(client, db_session, monkeypatch):
    import litellm

    def _boom(*args, **kwargs):
        raise AssertionError("aggregate path must not call the LLM")

    monkeypatch.setattr(litellm, "acompletion", _boom, raising=False)
    monkeypatch.setattr(litellm, "completion", _boom, raising=False)
    _seed_session_for_insights(db_session)
    _seed_event_for_insights(db_session, "s1", "mitosis", True, T0)
    assert client.get("/api/profile/aggregate").status_code == 200
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_usage_route.py -v`
Expected: FAIL — 404 on `/api/usage/summary` (route not registered).

- [ ] **Step 3: Implement**

Create `backend/routes/usage.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from contracts import UsageSummaryResponse
from db.database import get_db
from services.auth import current_user_id
from services.usage_service import usage_summary

router = APIRouter(prefix="/api")


@router.get("/usage/summary", response_model=UsageSummaryResponse)
def get_usage_summary(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    return usage_summary(db, user_id)
```

In `backend/main.py`, add `usage` to the existing `from routes import ...` line and register after the review router (line ~36):

```python
app.include_router(usage.router)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_usage_route.py tests/test_profile_aggregate.py -v`
Expected: ALL PASS.

- [ ] **Step 5: Run the full backend suite**

Run from `backend/`: `pytest`
Expected: ALL PASS (baseline was 570 pass / 5 skip; expect ~+18).

- [ ] **Step 6: Commit**

```bash
git add backend/routes/usage.py backend/main.py backend/tests/test_usage_route.py backend/tests/test_profile_aggregate.py
git commit -m "feat(backend): GET /api/usage/summary route + zero-LLM regressions"
```

---

### Task 6: Frontend — getUsageSummary + WeakestConcepts component

**Files:**
- Modify: `frontend/src/services/profileApi.js`
- Create: `frontend/src/components/profile/WeakestConcepts.vue`
- Test: `frontend/src/__tests__/weakestConcepts.test.js` (create)

**Interfaces:**
- Consumes: `apiGet` from `./apiClient.js`; `concept_accuracy` entries shaped per Task 1 (`{concept, correct_count, total_count, accuracy, last_results, first_seen_session_id}`).
- Produces: `getUsageSummary()` export (Task 9 calls it); `WeakestConcepts.vue` with prop `conceptAccuracy: Array` (Task 9 mounts it).

- [ ] **Step 1: Write failing tests**

Create `frontend/src/__tests__/weakestConcepts.test.js`:

```js
import { mount, RouterLinkStub } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import WeakestConcepts from '../components/profile/WeakestConcepts.vue'

const entry = (concept, accuracy, total = 4, results = [true, false]) => ({
  concept,
  correct_count: Math.round(accuracy * total),
  total_count: total,
  accuracy,
  last_results: results,
  first_seen_session_id: `sess-${concept}`,
})

const factory = (conceptAccuracy) =>
  mount(WeakestConcepts, {
    props: { conceptAccuracy },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })

describe('WeakestConcepts', () => {
  it('filters below two attempts, sorts ascending accuracy, caps at five', () => {
    const items = [
      entry('a', 0.9),
      entry('b', 0.1),
      entry('c', 0.5),
      entry('d', 0.3),
      entry('e', 0.7),
      entry('f', 0.2),
      entry('once', 0.0, 1), // single attempt: excluded
    ]
    const w = factory(items)
    const names = w.findAll('.rank-name').map((n) => n.text())
    expect(names).toEqual(['b', 'f', 'd', 'c', 'e'])
    expect(names).not.toContain('once')
  })

  it('renders sparkline dots oldest-to-newest with correct classes', () => {
    const w = factory([entry('a', 0.5, 4, [true, false, true])])
    const dots = w.findAll('.spark-dot')
    expect(dots).toHaveLength(3)
    expect(dots[0].classes()).toContain('dot-correct')
    expect(dots[1].classes()).toContain('dot-wrong')
    expect(dots[2].classes()).toContain('dot-correct')
  })

  it('links each row to the first-seen session', () => {
    const w = factory([entry('a', 0.5)])
    const link = w.findComponent(RouterLinkStub)
    expect(link.props('to')).toEqual({
      name: 'session-profile',
      params: { id: 'sess-a' },
    })
  })

  it('shows guidance copy when nothing has two attempts', () => {
    const w = factory([entry('once', 0.0, 1)])
    expect(w.find('[data-testid="weakest-empty"]').exists()).toBe(true)
    expect(w.find('.rank-row').exists()).toBe(false)
  })

  it('shows accuracy percent', () => {
    const w = factory([entry('a', 0.25)])
    expect(w.find('.rank-pct').text()).toBe('25%')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `frontend/`: `npm run test:unit -- --run src/__tests__/weakestConcepts.test.js`
Expected: FAIL — cannot resolve `../components/profile/WeakestConcepts.vue`.

- [ ] **Step 3: Implement**

Add to `frontend/src/services/profileApi.js` (after `getAggregateProfile`):

```js
export const getUsageSummary = () => apiGet('/usage/summary')
```

Create `frontend/src/components/profile/WeakestConcepts.vue`:

```vue
<template>
  <div class="weakest" data-testid="weakest-concepts">
    <h2 class="section-title">
      <i class="pi pi-chart-line col-icon" aria-hidden="true" />
      Weakest concepts
    </h2>
    <p v-if="!ranked.length" class="muted" data-testid="weakest-empty">
      Answer more check questions to see trends — concepts appear after two
      attempts.
    </p>
    <ul v-else class="rank-list">
      <li v-for="item in ranked" :key="item.concept" class="rank-row">
        <router-link
          :to="{ name: 'session-profile', params: { id: item.first_seen_session_id } }"
          class="rank-link"
        >
          <span class="rank-name">{{ item.concept }}</span>
          <span
            class="rank-bar"
            role="img"
            :aria-label="`${pct(item)} percent accuracy over ${item.total_count} attempts`"
          >
            <span class="rank-fill" :style="{ width: pct(item) + '%' }" />
          </span>
          <span class="rank-pct">{{ pct(item) }}%</span>
          <span class="spark" aria-hidden="true">
            <span
              v-for="(r, i) in item.last_results"
              :key="i"
              :class="['spark-dot', r ? 'dot-correct' : 'dot-wrong']"
            />
          </span>
        </router-link>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  conceptAccuracy: { type: Array, required: true },
})

const ranked = computed(() =>
  props.conceptAccuracy
    .filter((c) => c.total_count >= 2)
    .sort((a, b) => a.accuracy - b.accuracy || a.concept.localeCompare(b.concept))
    .slice(0, 5),
)

const pct = (c) => Math.round(c.accuracy * 100)
</script>

<style scoped>
.weakest {
  display: flex;
  flex-direction: column;
}

.section-title {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: var(--tracking-tight);
  color: var(--color-heading);
  margin: 0 0 0.875rem 0;
}

.col-icon {
  font-size: 1.05rem;
  color: var(--color-accent-text);
}

.muted { color: var(--color-text-muted); }

.rank-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.rank-row {
  border-radius: var(--radius-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  transition: border-color var(--motion-fast) ease;
}

.rank-row:hover { border-color: var(--color-accent-soft); }

.rank-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  color: inherit;
  text-decoration: none;
}

.rank-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.9375rem;
  color: var(--color-heading);
}

.rank-bar {
  flex: 0 0 6rem;
  height: 0.5rem;
  border-radius: var(--radius-pill);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  overflow: hidden;
}

.rank-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--accent-coral-400);
}

.rank-pct {
  flex: 0 0 2.75rem;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.spark {
  display: inline-flex;
  gap: 0.2rem;
}

.spark-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
}

.dot-correct { background: var(--color-success-text); }
.dot-wrong { background: var(--color-error-text); }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run src/__tests__/weakestConcepts.test.js`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/profileApi.js frontend/src/components/profile/WeakestConcepts.vue frontend/src/__tests__/weakestConcepts.test.js
git commit -m "feat(frontend): WeakestConcepts ranking component + getUsageSummary api"
```

---

### Task 7: Frontend — MasteryTrend component

**Files:**
- Create: `frontend/src/components/profile/MasteryTrend.vue`
- Test: `frontend/src/__tests__/masteryTrend.test.js` (create)

**Interfaces:**
- Consumes: `weekly_mastery` entries per Task 1 (`{week_start, count}`, 12 items, oldest first).
- Produces: `MasteryTrend.vue` with prop `weeklyMastery: Array` (Task 9 mounts it).

- [ ] **Step 1: Write failing tests**

Create `frontend/src/__tests__/masteryTrend.test.js`:

```js
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import MasteryTrend from '../components/profile/MasteryTrend.vue'

const weeks = (counts) =>
  counts.map((count, i) => ({
    week_start: `2026-0${Math.floor(i / 4) + 5}-0${(i % 4) * 7 + 1}`,
    count,
  }))

describe('MasteryTrend', () => {
  it('renders one column per week with height scaled to max', () => {
    const w = mount(MasteryTrend, {
      props: { weeklyMastery: weeks([0, 1, 2, 4, 0, 0, 0, 0, 0, 0, 0, 2]) },
    })
    const bars = w.findAll('.trend-bar')
    expect(bars).toHaveLength(12)
    expect(bars[3].attributes('style')).toContain('height: 100%')
    expect(bars[1].attributes('style')).toContain('height: 25%')
    expect(bars[0].attributes('style')).toContain('height: 0%')
  })

  it('shows hint instead of chart when all weeks are zero', () => {
    const w = mount(MasteryTrend, {
      props: { weeklyMastery: weeks(new Array(12).fill(0)) },
    })
    expect(w.find('[data-testid="trend-empty"]').exists()).toBe(true)
    expect(w.find('.trend-chart').exists()).toBe(false)
  })

  it('exposes an aria-label summarizing totals', () => {
    const w = mount(MasteryTrend, {
      props: { weeklyMastery: weeks([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 2]) },
    })
    expect(w.find('.trend-chart').attributes('aria-label')).toContain(
      '3 concepts mastered over the last 12 weeks',
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run src/__tests__/masteryTrend.test.js`
Expected: FAIL — cannot resolve `../components/profile/MasteryTrend.vue`.

- [ ] **Step 3: Implement**

Create `frontend/src/components/profile/MasteryTrend.vue`:

```vue
<template>
  <div class="trend" data-testid="mastery-trend">
    <h2 class="section-title">Mastery over time</h2>
    <p v-if="allZero" class="muted" data-testid="trend-empty">
      Nothing new mastered in the last 12 weeks yet — trends appear as you
      answer check questions correctly.
    </p>
    <div v-else class="trend-chart" role="img" :aria-label="ariaLabel">
      <div
        v-for="pt in weeklyMastery"
        :key="pt.week_start"
        class="trend-col"
        :title="`Week of ${pt.week_start}: ${pt.count}`"
      >
        <span class="trend-bar-track">
          <span class="trend-bar" :style="{ height: barHeight(pt) }" />
        </span>
        <span class="trend-tick">{{ pt.week_start.slice(5) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  weeklyMastery: { type: Array, required: true },
})

const maxCount = computed(() =>
  Math.max(...props.weeklyMastery.map((p) => p.count), 0),
)

const allZero = computed(() => maxCount.value === 0)

const total = computed(() =>
  props.weeklyMastery.reduce((acc, p) => acc + p.count, 0),
)

const ariaLabel = computed(
  () => `${total.value} concepts mastered over the last 12 weeks`,
)

const barHeight = (pt) =>
  `${maxCount.value ? Math.round((pt.count / maxCount.value) * 100) : 0}%`
</script>

<style scoped>
.trend {
  display: flex;
  flex-direction: column;
}

.section-title {
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: var(--tracking-tight);
  color: var(--color-heading);
  margin: 0 0 0.875rem 0;
}

.muted { color: var(--color-text-muted); }

.trend-chart {
  display: flex;
  align-items: flex-end;
  gap: 0.375rem;
  height: 7rem;
}

.trend-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  height: 100%;
  min-width: 0;
}

.trend-bar-track {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  border-radius: var(--radius-sm);
  background: var(--color-surface-soft);
}

.trend-bar {
  display: block;
  width: 100%;
  border-radius: var(--radius-sm);
  background: var(--accent-coral-400);
  min-height: 0;
}

.trend-tick {
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  color: var(--color-text-faint);
  white-space: nowrap;
}
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run src/__tests__/masteryTrend.test.js`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/profile/MasteryTrend.vue frontend/src/__tests__/masteryTrend.test.js
git commit -m "feat(frontend): MasteryTrend weekly bar chart component"
```

---

### Task 8: Frontend — UsagePanel component

**Files:**
- Create: `frontend/src/components/profile/UsagePanel.vue`
- Test: `frontend/src/__tests__/usagePanel.test.js` (create)

**Interfaces:**
- Consumes: `UsageSummaryResponse` shape per Task 1 (`{daily, today_spend_usd, soft_cap_usd, urgent_cap_usd, hard_cap_usd, top_sessions}`).
- Produces: `UsagePanel.vue` with prop `usage: Object` (Task 9 mounts it).

- [ ] **Step 1: Write failing tests**

Create `frontend/src/__tests__/usagePanel.test.js`:

```js
import { mount, RouterLinkStub } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import UsagePanel from '../components/profile/UsagePanel.vue'

const usage = (overrides = {}) => ({
  daily: [
    { date_utc: '2026-07-09', cost_usd: 0.5 },
    { date_utc: '2026-07-10', cost_usd: 1.0 },
  ],
  today_spend_usd: 1.0,
  soft_cap_usd: 2.0,
  urgent_cap_usd: 2.7,
  hard_cap_usd: 3.0,
  top_sessions: [],
  ...overrides,
})

const factory = (u = usage()) =>
  mount(UsagePanel, {
    props: { usage: u },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })

describe('UsagePanel', () => {
  it('renders one spend bar per day, scaled to the max day', () => {
    const w = factory()
    const bars = w.findAll('.spend-bar')
    expect(bars).toHaveLength(2)
    expect(bars[1].attributes('style')).toContain('height: 100%')
    expect(bars[0].attributes('style')).toContain('height: 50%')
  })

  it('positions tier markers from response values, not literals', () => {
    const w = factory(usage({ hard_cap_usd: 4.0, soft_cap_usd: 1.0, urgent_cap_usd: 3.6 }))
    const markers = w.findAll('.tier-marker')
    expect(markers).toHaveLength(2) // soft + urgent; hard = 100% end
    expect(markers[0].attributes('style')).toContain('left: 25%') // 1.0 / 4.0
    expect(markers[1].attributes('style')).toContain('left: 90%') // 3.6 / 4.0
  })

  it('fills the meter to today/hard ratio', () => {
    const w = factory() // 1.0 / 3.0
    expect(w.find('.meter-fill').attributes('style')).toContain('width: 33%')
  })

  it('lists top sessions with links', () => {
    const w = factory(
      usage({
        top_sessions: [{ session_id: 's9', topic: 'algebra', cost_usd: 0.42 }],
      }),
    )
    const link = w.findComponent(RouterLinkStub)
    expect(link.props('to')).toEqual({
      name: 'session-profile',
      params: { id: 's9' },
    })
    expect(w.text()).toContain('algebra')
    expect(w.text()).toContain('$0.42')
  })

  it('shows empty state when there is no spend at all', () => {
    const w = factory(
      usage({
        daily: [
          { date_utc: '2026-07-09', cost_usd: 0 },
          { date_utc: '2026-07-10', cost_usd: 0 },
        ],
        today_spend_usd: 0,
      }),
    )
    expect(w.find('[data-testid="usage-empty"]').exists()).toBe(true)
    expect(w.find('.spend-chart').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run src/__tests__/usagePanel.test.js`
Expected: FAIL — cannot resolve `../components/profile/UsagePanel.vue`.

- [ ] **Step 3: Implement**

Create `frontend/src/components/profile/UsagePanel.vue`:

```vue
<template>
  <div class="usage" data-testid="usage-panel">
    <h2 class="section-title">
      <i class="pi pi-wallet col-icon" aria-hidden="true" />
      Usage
    </h2>

    <p v-if="noSpend" class="muted" data-testid="usage-empty">
      No usage yet — spend history appears once you start chatting.
    </p>

    <template v-else>
      <div
        class="spend-chart"
        role="img"
        :aria-label="`Daily spend, last ${usage.daily.length} days`"
      >
        <div
          v-for="d in usage.daily"
          :key="d.date_utc"
          class="spend-col"
          :title="`${d.date_utc}: $${d.cost_usd.toFixed(2)}`"
        >
          <span class="spend-track">
            <span class="spend-bar" :style="{ height: barHeight(d) }" />
          </span>
        </div>
      </div>

      <div class="meter-wrap">
        <div
          class="meter"
          role="img"
          :aria-label="`Today: $${usage.today_spend_usd.toFixed(2)} of $${usage.hard_cap_usd.toFixed(2)} daily cap`"
        >
          <span class="meter-fill" :style="{ width: fillPct }" />
          <span
            class="tier-marker"
            :style="{ left: markerPct(usage.soft_cap_usd) }"
            :title="`soft cap $${usage.soft_cap_usd.toFixed(2)}`"
          />
          <span
            class="tier-marker"
            :style="{ left: markerPct(usage.urgent_cap_usd) }"
            :title="`urgent cap $${usage.urgent_cap_usd.toFixed(2)}`"
          />
        </div>
        <span class="meter-caption">
          Today ${{ usage.today_spend_usd.toFixed(2) }} / ${{ usage.hard_cap_usd.toFixed(2) }} cap
        </span>
      </div>
    </template>

    <div v-if="usage.top_sessions.length" class="top-sessions">
      <h3 class="sub-title">Most expensive sessions</h3>
      <ul class="top-list">
        <li v-for="t in usage.top_sessions" :key="t.session_id" class="top-row">
          <router-link
            :to="{ name: 'session-profile', params: { id: t.session_id } }"
            class="top-link"
          >
            <span class="top-topic">{{ t.topic || 'untitled' }}</span>
            <span class="top-cost">${{ t.cost_usd.toFixed(2) }}</span>
          </router-link>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  usage: { type: Object, required: true },
})

const maxDay = computed(() =>
  Math.max(...props.usage.daily.map((d) => d.cost_usd), 0),
)

const noSpend = computed(
  () => maxDay.value === 0 && props.usage.today_spend_usd === 0,
)

const barHeight = (d) =>
  `${maxDay.value ? Math.round((d.cost_usd / maxDay.value) * 100) : 0}%`

const pctOfHard = (v) =>
  `${Math.min(100, Math.round((v / props.usage.hard_cap_usd) * 100))}%`

const fillPct = computed(() => pctOfHard(props.usage.today_spend_usd))
const markerPct = (v) => pctOfHard(v)
</script>

<style scoped>
.usage {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.section-title {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: var(--tracking-tight);
  color: var(--color-heading);
  margin: 0;
}

.col-icon {
  font-size: 1.05rem;
  color: var(--color-accent-text);
}

.muted { color: var(--color-text-muted); }

.spend-chart {
  display: flex;
  align-items: flex-end;
  gap: 0.25rem;
  height: 5rem;
}

.spend-col {
  flex: 1;
  height: 100%;
  min-width: 0;
}

.spend-track {
  display: flex;
  align-items: flex-end;
  height: 100%;
  border-radius: var(--radius-sm);
  background: var(--color-surface-soft);
}

.spend-bar {
  display: block;
  width: 100%;
  border-radius: var(--radius-sm);
  background: var(--accent-coral-400);
}

.meter-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.meter {
  position: relative;
  height: 0.75rem;
  border-radius: var(--radius-pill);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  overflow: hidden;
}

.meter-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--accent-coral-400);
}

.tier-marker {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--color-border-strong);
}

.meter-caption {
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.sub-title {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-text-muted);
  margin: 0 0 0.5rem 0;
}

.top-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.top-row {
  border-radius: var(--radius-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
}

.top-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.625rem 1rem;
  color: inherit;
  text-decoration: none;
}

.top-topic {
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.9375rem;
  color: var(--color-heading);
}

.top-cost {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run src/__tests__/usagePanel.test.js`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/profile/UsagePanel.vue frontend/src/__tests__/usagePanel.test.js
git commit -m "feat(frontend): UsagePanel - daily spend bars, tier meter, top sessions"
```

---

### Task 9: Frontend — view integration with independent failure domains

**Files:**
- Modify: `frontend/src/views/AggregateProfileView.vue`
- Test: `frontend/src/__tests__/aggregateProfileView.test.js` (extend — read it first and follow its existing mocking style)

**Interfaces:**
- Consumes: `WeakestConcepts` (Task 6), `MasteryTrend` (Task 7), `UsagePanel` (Task 8), `getUsageSummary` (Task 6).
- Produces: final user-facing dashboard.

- [ ] **Step 1: Read the existing view test**

Read `frontend/src/__tests__/aggregateProfileView.test.js` fully before changing anything. It already mocks `../services/profileApi.js` — the mock must now also export `getUsageSummary` or every existing test in the file breaks with "No export named getUsageSummary".

- [ ] **Step 2: Write failing tests**

Add to `frontend/src/__tests__/aggregateProfileView.test.js` (adapt names to the file's existing helpers/mocks; the assertions below are the contract). A minimal aggregate payload must now include `concept_accuracy: []` and `weekly_mastery: []`:

```js
// vi.mock block gains:
//   getUsageSummary: vi.fn(),

const usagePayload = {
  daily: [{ date_utc: '2026-07-10', cost_usd: 1.0 }],
  today_spend_usd: 1.0,
  soft_cap_usd: 2.0,
  urgent_cap_usd: 2.7,
  hard_cap_usd: 3.0,
  top_sessions: [],
}

it('renders insights and usage sections when both fetches succeed', async () => {
  getAggregateProfile.mockResolvedValue(aggregatePayload) // file's existing non-empty payload + concept_accuracy/weekly_mastery
  getUsageSummary.mockResolvedValue(usagePayload)
  const w = await mountView() // file's existing mount helper
  expect(w.find('[data-testid="weakest-concepts"]').exists()).toBe(true)
  expect(w.find('[data-testid="mastery-trend"]').exists()).toBe(true)
  expect(w.find('[data-testid="usage-panel"]').exists()).toBe(true)
})

it('usage failure degrades to a notice without breaking insights', async () => {
  getAggregateProfile.mockResolvedValue(aggregatePayload)
  getUsageSummary.mockRejectedValue(new Error('boom'))
  const w = await mountView()
  expect(w.find('[data-testid="weakest-concepts"]').exists()).toBe(true)
  expect(w.find('[data-testid="usage-error"]').exists()).toBe(true)
  expect(w.find('[data-testid="usage-panel"]').exists()).toBe(false)
})

it('aggregate failure keeps the view-level error and skips usage render', async () => {
  getAggregateProfile.mockRejectedValue(new Error('boom'))
  getUsageSummary.mockResolvedValue(usagePayload)
  const w = await mountView()
  expect(w.find('[data-testid="agg-error"]').exists()).toBe(true)
  expect(w.find('[data-testid="usage-panel"]').exists()).toBe(false)
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:unit -- --run src/__tests__/aggregateProfileView.test.js`
Expected: new tests FAIL (sections not rendered).

- [ ] **Step 4: Implement**

In `frontend/src/views/AggregateProfileView.vue`:

Script changes — add imports and state, rewrite `load()`:

```js
import MasteryTrend from '../components/profile/MasteryTrend.vue'
import UsagePanel from '../components/profile/UsagePanel.vue'
import WeakestConcepts from '../components/profile/WeakestConcepts.vue'
import { getAggregateProfile, getUsageSummary } from '../services/profileApi.js'

const usage = ref(null)
const usageError = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  usageError.value = false
  const [agg, use] = await Promise.allSettled([
    getAggregateProfile(),
    getUsageSummary(),
  ])
  if (agg.status === 'fulfilled') {
    data.value = agg.value
  } else {
    error.value = friendlyError(agg.reason)
  }
  if (use.status === 'fulfilled') {
    usage.value = use.value
  } else {
    usageError.value = true
  }
  loading.value = false
}
```

Template changes — inside the non-empty `<template v-else>` branch, insert after the `.dist` block (line ~89) an insights grid:

```html
        <div class="two-col" data-testid="agg-insights">
          <div class="col">
            <WeakestConcepts :concept-accuracy="data.concept_accuracy" />
          </div>
          <div class="col">
            <MasteryTrend :weekly-mastery="data.weekly_mastery" />
          </div>
        </div>
```

and after the `.recent` block (line ~159), the usage section:

```html
        <UsagePanel v-if="usage" :usage="usage" />
        <p v-else-if="usageError" class="muted" data-testid="usage-error">
          Usage data is unavailable right now.
        </p>
```

Both new blocks live inside the existing `v-else` (data loaded, sessions > 0) branch — the zero-session `EmptyState` path is unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:unit -- --run src/__tests__/aggregateProfileView.test.js`
Expected: ALL PASS (pre-existing + 3 new).

- [ ] **Step 6: Run the full frontend suite**

Run from `frontend/`: `npm run test:unit -- --run`
Expected: ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/views/AggregateProfileView.vue frontend/src/__tests__/aggregateProfileView.test.js
git commit -m "feat(frontend): insights + usage sections on aggregate profile view"
```

---

### Task 10: Final gates

**Files:**
- Modify: `.superpowers/sdd/progress.md` (append slice 6 ledger)

- [ ] **Step 1: Full backend suite**

Run from `backend/`: `pytest`
Expected: ALL PASS (~588 pass / 5 skip; +18 vs 570 baseline).

- [ ] **Step 2: Full frontend suite**

Run from `frontend/`: `npm run test:unit -- --run`
Expected: ALL PASS (~+16 vs 570 baseline).

- [ ] **Step 3: Lint**

Run from `frontend/`: `npm run lint`
Expected: clean.

- [ ] **Step 4: Contract drift gate**

Run from repo root: `python backend/scripts/gen_contracts.py`
Then: `git status --porcelain backend/contracts/`
Expected: no output (zero drift).

- [ ] **Step 5: Confirm no migration snuck in**

Run: `git status --porcelain backend/db/alembic/`
Expected: no output (head stays 0016).

- [ ] **Step 6: Update progress ledger + commit**

Append a slice 6 section to `.superpowers/sdd/progress.md` recording: tasks 1-10 complete, test counts, gates green.

```bash
git add .superpowers/sdd/progress.md
git commit -m "docs: slice 6 progress ledger - all gates green"
```

---

## Verification Summary

| Gate | Command | Where |
|---|---|---|
| Backend tests | `pytest` | `backend/` |
| Frontend tests | `npm run test:unit -- --run` | `frontend/` |
| Lint | `npm run lint` | `frontend/` |
| Contract drift | `python backend/scripts/gen_contracts.py` then clean `git status` | repo root |
| No migration | `git status --porcelain backend/db/alembic/` empty | repo root |

Human-gated after merge (not in this plan): paid live smoke of the dashboard against real data; live Postgres check of the two new read queries.
