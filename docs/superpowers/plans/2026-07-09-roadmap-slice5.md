# Roadmap Slice 5 (R2 Spaced Repetition) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SM-2-lite review scheduler over `learning_events`, `GET /api/review/queue`, and a Home "Due for review" card that starts a targeted review via the existing `seed_mode=resume` + `review_gap` machinery.

**Architecture:** Pure-computed scheduler (no migration, no write path): a pure function folds a user's learning events into per-concept streak/due_at; the route fetches events cross-session via the `sessions.user_id` join and paginates in Python. The chat `review_gaps` target validation widens from `confirmed_gaps` to `confirmed_gaps UNION mastered_concepts` so retention reviews of mastered concepts can be seeded. Frontend adds a second mode-card on Home reusing `continueTopic` + the `review_gap` route query.

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic contracts (codegen from openapi.yaml), Vue 3 + Pinia + vitest.

**Spec:** `docs/superpowers/specs/2026-07-09-roadmap-slice5-design.md` (wins on conflicts).

## Global Constraints

- Run pytest from `backend/`, never repo root.
- `backend/contracts/` is codegen output — never hand-edit. Edit `docs/api/openapi.yaml`, then run `python backend/scripts/gen_contracts.py` from repo root. CI enforces zero drift.
- No emojis in code or comments.
- Use the native Grep tool for repo-wide sweeps (`rtk rg` has a false-zero gotcha).
- Branch: `feat/roadmap-slice5` (already created). PRs target `dev`.
- SQLite (CI test DB) strips tzinfo despite `DateTime(timezone=True)`. Any datetime read from the DB must be coerced with `aware_utc` (`services/session_enrichment.py`) before timezone-aware arithmetic.
- No new alembic migration in this slice; head stays `0016_session_rolling_summary`.
- Scheduler constants: `BASE_INTERVAL_DAYS = 1`, `MAX_INTERVAL_DAYS = 60`.
- The queue path must make zero LLM calls (roadmap R2.2 AC4).

---

### Task 1: API contract — ReviewQueueItem / ReviewQueuePage + GET /api/review/queue

**Files:**
- Modify: `docs/api/openapi.yaml` (path after the `/api/sessions/library` block ending at line ~116; schemas after `SessionLibraryPage` ending at line ~826)
- Regenerated: `backend/contracts/models.py` (via codegen — do not hand-edit)
- Test: `backend/tests/test_contracts.py` (append)

**Interfaces:**
- Produces: Pydantic models `ReviewQueueItem` (fields `concept: str`, `source_session_id: str`, `source_topic: str`, `last_tested_at: datetime`, `streak: int`, `due_at: datetime`) and `ReviewQueuePage` (fields `items: list[ReviewQueueItem]`, `total: int`, `limit: int`, `offset: int`), importable as `from contracts import ReviewQueueItem, ReviewQueuePage`. Tasks 3 and 4 rely on these exact names.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_contracts.py`:

```python
def test_review_queue_contracts_exist():
    from contracts import ReviewQueueItem, ReviewQueuePage

    item = ReviewQueueItem(
        concept="photosynthesis",
        source_session_id="s1",
        source_topic="biology",
        last_tested_at="2026-07-01T00:00:00Z",
        streak=2,
        due_at="2026-07-03T00:00:00Z",
    )
    page = ReviewQueuePage(items=[item], total=1, limit=20, offset=0)
    assert page.items[0].concept == "photosynthesis"
    assert page.items[0].streak == 2
    assert page.total == 1
```

- [ ] **Step 2: Run test to verify it fails**

From `backend/`: `pytest tests/test_contracts.py::test_review_queue_contracts_exist -v`
Expected: FAIL with `ImportError: cannot import name 'ReviewQueueItem'`

- [ ] **Step 3: Add the path to `docs/api/openapi.yaml`**

Insert after the `/api/sessions/library` path block (i.e. immediately before the `/api/sessions/{session_id}:` line at ~117):

```yaml
  /api/review/queue:
    get:
      tags: [review]
      summary: Concepts due for spaced-repetition review across all of the user's sessions.
      operationId: getReviewQueue
      parameters:
        - in: query
          name: limit
          required: false
          schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
        - in: query
          name: offset
          required: false
          schema: { type: integer, default: 0, minimum: 0 }
      responses:
        "200":
          description: A page of due review concepts, most overdue first.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ReviewQueuePage"
```

- [ ] **Step 4: Add the schemas to `docs/api/openapi.yaml`**

Insert after the `SessionLibraryPage` schema block (i.e. immediately before the `SessionEndSummaryKind:` line at ~828):

```yaml
    ReviewQueueItem:
      type: object
      additionalProperties: false
      required: [concept, source_session_id, source_topic, last_tested_at, streak, due_at]
      description: One concept due for spaced-repetition review.
      properties:
        concept: { type: string }
        source_session_id: { type: string }
        source_topic: { type: string }
        last_tested_at: { type: string, format: date-time }
        streak: { type: integer }
        due_at: { type: string, format: date-time }

    ReviewQueuePage:
      type: object
      additionalProperties: false
      required: [items, total, limit, offset]
      description: One page of the review queue, most overdue first.
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/ReviewQueueItem" }
        total:  { type: integer }
        limit:  { type: integer }
        offset: { type: integer }
```

- [ ] **Step 5: Run codegen**

From repo root: `python backend/scripts/gen_contracts.py`
Expected: exits 0; `backend/contracts/models.py` gains `ReviewQueueItem` and `ReviewQueuePage`. (A PostToolUse hook may auto-run codegen after openapi.yaml edits — verify it fired; run manually if not.)

- [ ] **Step 6: Run test to verify it passes**

From `backend/`: `pytest tests/test_contracts.py::test_review_queue_contracts_exist -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts/models.py backend/tests/test_contracts.py
git commit -m "feat(contracts): review queue page + item schemas and GET /api/review/queue"
```

---

### Task 2: SM-2-lite scheduler service (pure function)

**Files:**
- Create: `backend/services/review_queue_service.py`
- Test: `backend/tests/test_review_queue_service.py` (create)

**Interfaces:**
- Consumes: nothing from other tasks (stdlib only — deliberately no SQLAlchemy import).
- Produces: `EventRow(concept: str, correct: bool, created_at: datetime, session_id: str, topic: str)` frozen dataclass; `ScheduleEntry(concept: str, source_session_id: str, source_topic: str, last_tested_at: datetime, streak: int, due_at: datetime)` frozen dataclass; `compute_schedule(events: Sequence[EventRow], now: datetime) -> list[ScheduleEntry]` returning ONLY entries with `due_at <= now`, sorted most-overdue first (`due_at` ascending); module constants `BASE_INTERVAL_DAYS = 1`, `MAX_INTERVAL_DAYS = 60`. Task 3 imports `EventRow`, `compute_schedule`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_review_queue_service.py`:

```python
from datetime import datetime, timedelta, timezone

from services.review_queue_service import (
    BASE_INTERVAL_DAYS,
    MAX_INTERVAL_DAYS,
    EventRow,
    compute_schedule,
)

T0 = datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc)


def _ev(concept, correct, at, session_id="s1", topic="biology"):
    return EventRow(
        concept=concept, correct=correct, created_at=at,
        session_id=session_id, topic=topic,
    )


def test_empty_events_yield_empty_schedule():
    assert compute_schedule([], now=T0) == []


def test_incorrect_answer_due_after_base_interval():
    events = [_ev("mitosis", False, T0)]
    not_yet = compute_schedule(events, now=T0 + timedelta(hours=23))
    assert not_yet == []
    due = compute_schedule(events, now=T0 + timedelta(days=BASE_INTERVAL_DAYS))
    assert len(due) == 1
    assert due[0].concept == "mitosis"
    assert due[0].streak == 0
    assert due[0].due_at == T0 + timedelta(days=BASE_INTERVAL_DAYS)


def test_streak_doubles_interval():
    # three consecutive corrects -> streak 3 -> interval 2^(3-1) = 4 days
    events = [
        _ev("mitosis", True, T0),
        _ev("mitosis", True, T0 + timedelta(days=1)),
        _ev("mitosis", True, T0 + timedelta(days=3)),
    ]
    last = T0 + timedelta(days=3)
    assert compute_schedule(events, now=last + timedelta(days=3)) == []
    due = compute_schedule(events, now=last + timedelta(days=4))
    assert len(due) == 1
    assert due[0].streak == 3
    assert due[0].due_at == last + timedelta(days=4)


def test_incorrect_resets_streak():
    # correct, correct, incorrect -> streak 0 -> due after base interval
    events = [
        _ev("osmosis", True, T0),
        _ev("osmosis", True, T0 + timedelta(days=1)),
        _ev("osmosis", False, T0 + timedelta(days=2)),
    ]
    due = compute_schedule(events, now=T0 + timedelta(days=3))
    assert len(due) == 1
    assert due[0].streak == 0
    assert due[0].due_at == T0 + timedelta(days=2) + timedelta(days=BASE_INTERVAL_DAYS)


def test_interval_capped_at_max():
    # 8 consecutive corrects -> raw 2^7 = 128 days -> capped at MAX_INTERVAL_DAYS
    events = [
        _ev("photosynthesis", True, T0 + timedelta(days=i)) for i in range(8)
    ]
    last = T0 + timedelta(days=7)
    assert compute_schedule(events, now=last + timedelta(days=MAX_INTERVAL_DAYS - 1)) == []
    due = compute_schedule(events, now=last + timedelta(days=MAX_INTERVAL_DAYS))
    assert len(due) == 1
    assert due[0].due_at == last + timedelta(days=MAX_INTERVAL_DAYS)


def test_concepts_group_by_casefolded_stripped_key():
    events = [
        _ev("Bayes Theorem", False, T0, session_id="s1"),
        _ev("  bayes theorem ", True, T0 + timedelta(days=1), session_id="s2", topic="stats"),
    ]
    due = compute_schedule(events, now=T0 + timedelta(days=3))
    assert len(due) == 1
    # display string and source come from the most recent event in the group
    assert due[0].concept == "  bayes theorem "
    assert due[0].source_session_id == "s2"
    assert due[0].source_topic == "stats"
    assert due[0].streak == 1


def test_blank_concepts_are_skipped():
    events = [_ev("   ", False, T0)]
    assert compute_schedule(events, now=T0 + timedelta(days=2)) == []


def test_sorted_most_overdue_first():
    events = [
        _ev("newer", False, T0 + timedelta(days=5), session_id="s2"),
        _ev("older", False, T0, session_id="s1"),
    ]
    due = compute_schedule(events, now=T0 + timedelta(days=10))
    assert [e.concept for e in due] == ["older", "newer"]


def test_unsorted_input_is_handled():
    # events arrive out of order; scheduler must sort within the group
    events = [
        _ev("mitosis", True, T0 + timedelta(days=2)),
        _ev("mitosis", False, T0),
    ]
    due = compute_schedule(events, now=T0 + timedelta(days=10))
    assert len(due) == 1
    assert due[0].streak == 1
    assert due[0].last_tested_at == T0 + timedelta(days=2)
```

- [ ] **Step 2: Run tests to verify they fail**

From `backend/`: `pytest tests/test_review_queue_service.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'services.review_queue_service'`

- [ ] **Step 3: Write the implementation**

Create `backend/services/review_queue_service.py`:

```python
"""SM-2-lite review scheduler (roadmap R2.1).

Pure functions over learning-event rows: no DB session, no LLM, clock
injected. The route layer maps ORM rows to EventRow so this module stays
free of SQLAlchemy imports.

Interval rule: streak = trailing consecutive correct answers for a concept.
streak == 0 (last answer incorrect) -> due BASE_INTERVAL_DAYS after the last
event; streak >= 1 -> BASE_INTERVAL_DAYS * 2^(streak-1) days, capped at
MAX_INTERVAL_DAYS. A mastered-then-demoted concept re-enters at the reset
interval automatically because the demotion event is an incorrect answer
(roadmap R2.1 AC3).

Concept identity: gap_tested strings are free-text and exact-match across
sessions, so grouping uses a strip().casefold() key; the displayed concept
string and source session come from the group's most recent event.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

BASE_INTERVAL_DAYS = 1
MAX_INTERVAL_DAYS = 60


@dataclass(frozen=True)
class EventRow:
    concept: str
    correct: bool
    created_at: datetime  # timezone-aware UTC
    session_id: str
    topic: str


@dataclass(frozen=True)
class ScheduleEntry:
    concept: str
    source_session_id: str
    source_topic: str
    last_tested_at: datetime
    streak: int
    due_at: datetime


def _interval_days(streak: int) -> int:
    if streak <= 0:
        return BASE_INTERVAL_DAYS
    return min(BASE_INTERVAL_DAYS * 2 ** (streak - 1), MAX_INTERVAL_DAYS)


def compute_schedule(
    events: Sequence[EventRow], now: datetime
) -> list[ScheduleEntry]:
    """Return concepts due for review at `now`, most overdue first."""
    groups: dict[str, list[EventRow]] = {}
    for ev in events:
        key = ev.concept.strip().casefold()
        if not key:
            continue
        groups.setdefault(key, []).append(ev)

    due: list[ScheduleEntry] = []
    for group in groups.values():
        ordered = sorted(group, key=lambda e: e.created_at)
        streak = 0
        for ev in reversed(ordered):
            if not ev.correct:
                break
            streak += 1
        last = ordered[-1]
        due_at = last.created_at + timedelta(days=_interval_days(streak))
        if due_at <= now:
            due.append(
                ScheduleEntry(
                    concept=last.concept,
                    source_session_id=last.session_id,
                    source_topic=last.topic,
                    last_tested_at=last.created_at,
                    streak=streak,
                    due_at=due_at,
                )
            )
    due.sort(key=lambda e: e.due_at)
    return due
```

- [ ] **Step 4: Run tests to verify they pass**

From `backend/`: `pytest tests/test_review_queue_service.py -v`
Expected: 9 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/review_queue_service.py backend/tests/test_review_queue_service.py
git commit -m "feat(backend): SM-2-lite review scheduler as pure function"
```

---

### Task 3: GET /api/review/queue route

**Files:**
- Create: `backend/routes/review.py`
- Modify: `backend/main.py` (import at line 8, `include_router` after line 35)
- Test: `backend/tests/test_review_queue_route.py` (create)

**Interfaces:**
- Consumes: `EventRow`, `compute_schedule` from Task 2; `ReviewQueueItem`, `ReviewQueuePage` from Task 1; existing `current_user_id` (`services/auth.py`), `get_db` (`db/database.py`), `aware_utc` (`services/session_enrichment.py`).
- Produces: `GET /api/review/queue?limit&offset` returning `ReviewQueuePage`. Frontend Task 6 calls it.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_review_queue_route.py`:

```python
from datetime import datetime, timedelta, timezone

from db.models import LearningEvent, Session as SessionModel, User

T0 = datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc)


def _seed_session(db, session_id="s1", user_id="test-user", topic="biology"):
    if not db.get(User, user_id):
        db.add(User(id=user_id))
    db.add(SessionModel(id=session_id, user_id=user_id, topic=topic))
    db.commit()


def _seed_event(db, session_id, gap, correct, created_at):
    db.add(
        LearningEvent(
            session_id=session_id,
            gap_tested=gap,
            question="q",
            correct=correct,
            created_at=created_at,
        )
    )
    db.commit()


def test_empty_queue(client, db_session):
    r = client.get("/api/review/queue")
    assert r.status_code == 200
    body = r.json()
    assert body["items"] == []
    assert body["total"] == 0
    assert body["limit"] == 20
    assert body["offset"] == 0


def test_due_concept_appears_with_fields(client, db_session):
    _seed_session(db_session)
    # incorrect answer 3 days ago -> streak 0 -> due 1 day later -> overdue now
    _seed_event(db_session, "s1", "mitosis", False, T0)
    r = client.get("/api/review/queue")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["concept"] == "mitosis"
    assert item["source_session_id"] == "s1"
    assert item["source_topic"] == "biology"
    assert item["streak"] == 0
    assert item["last_tested_at"].startswith("2026-07-01")
    assert item["due_at"].startswith("2026-07-02")


def test_not_yet_due_concept_excluded(client, db_session):
    _seed_session(db_session)
    # correct answer just now -> streak 1 -> due in 1 day -> not due yet
    _seed_event(
        db_session, "s1", "osmosis", True, datetime.now(timezone.utc)
    )
    r = client.get("/api/review/queue")
    assert r.json()["total"] == 0


def test_cross_session_aggregation_and_pagination(client, db_session):
    _seed_session(db_session, session_id="s1", topic="biology")
    _seed_session(db_session, session_id="s2", topic="chemistry")
    _seed_event(db_session, "s1", "older", False, T0)
    _seed_event(db_session, "s2", "newer", False, T0 + timedelta(days=1))
    r = client.get("/api/review/queue", params={"limit": 1, "offset": 0})
    body = r.json()
    assert body["total"] == 2
    assert len(body["items"]) == 1
    assert body["items"][0]["concept"] == "older"  # most overdue first
    r2 = client.get("/api/review/queue", params={"limit": 1, "offset": 1})
    assert r2.json()["items"][0]["concept"] == "newer"


def test_user_isolation(client, db_session):
    _seed_session(db_session, session_id="s1", user_id="other-user")
    _seed_event(db_session, "s1", "mitosis", False, T0)
    # default client auth resolves to "test-user"; other-user's events invisible
    r = client.get("/api/review/queue")
    assert r.json()["total"] == 0


def test_queue_rejects_invalid_token(client, db_session):
    # conftest fake auth: a bearer token not prefixed "test-" raises 401
    r = client.get(
        "/api/review/queue", headers={"Authorization": "Bearer bogus"}
    )
    assert r.status_code == 401


def test_queue_makes_no_llm_call(client, db_session, monkeypatch):
    import litellm

    def _boom(*args, **kwargs):
        raise AssertionError("queue path must not call the LLM")

    monkeypatch.setattr(litellm, "acompletion", _boom, raising=False)
    monkeypatch.setattr(litellm, "completion", _boom, raising=False)
    _seed_session(db_session)
    _seed_event(db_session, "s1", "mitosis", False, T0)
    r = client.get("/api/review/queue")
    assert r.status_code == 200
    assert r.json()["total"] == 1
```

- [ ] **Step 2: Run tests to verify they fail**

From `backend/`: `pytest tests/test_review_queue_route.py -v`
Expected: FAIL — all tests 404 (route does not exist)

- [ ] **Step 3: Write the route**

Create `backend/routes/review.py`:

```python
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from contracts import ReviewQueueItem, ReviewQueuePage
from db.database import get_db
from db.models import LearningEvent, Session as SessionModel
from services.auth import current_user_id
from services.review_queue_service import EventRow, compute_schedule
from services.session_enrichment import aware_utc

router = APIRouter(prefix="/api")


@router.get("/review/queue", response_model=ReviewQueuePage)
def get_review_queue(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    rows = db.execute(
        select(LearningEvent, SessionModel.topic)
        .join(SessionModel, LearningEvent.session_id == SessionModel.id)
        .where(SessionModel.user_id == user_id)
        .order_by(LearningEvent.created_at.asc(), LearningEvent.id.asc())
    ).all()
    events = [
        EventRow(
            concept=ev.gap_tested,
            correct=ev.correct,
            created_at=aware_utc(ev.created_at),
            session_id=ev.session_id,
            topic=topic,
        )
        for ev, topic in rows
    ]
    due = compute_schedule(events, now=now)
    return ReviewQueuePage(
        items=[
            ReviewQueueItem(
                concept=e.concept,
                source_session_id=e.source_session_id,
                source_topic=e.source_topic,
                last_tested_at=e.last_tested_at,
                streak=e.streak,
                due_at=e.due_at,
            )
            for e in due[offset : offset + limit]
        ],
        total=len(due),
        limit=limit,
        offset=offset,
    )
```

- [ ] **Step 4: Register the router in `backend/main.py`**

Change line 8 from:

```python
from routes import chat, documents, health, profile, sessions, upload
```

to:

```python
from routes import chat, documents, health, profile, review, sessions, upload
```

and after `app.include_router(documents.router)` (line 35) add:

```python
app.include_router(review.router)
```

- [ ] **Step 5: Run tests to verify they pass**

From `backend/`: `pytest tests/test_review_queue_route.py -v`
Expected: 7 PASS

- [ ] **Step 6: Commit**

```bash
git add backend/routes/review.py backend/main.py backend/tests/test_review_queue_route.py
git commit -m "feat(backend): GET /api/review/queue cross-session due-concepts endpoint"
```

---

### Task 4: Integration test — grading moves the schedule (R2.2 AC3)

**Files:**
- Test: `backend/tests/test_review_queue_route.py` (append)

**Interfaces:**
- Consumes: route from Task 3; existing `learning_event_service.record_from_answer` (the sole grading write path — `check_question_service.answer` delegates to it).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_review_queue_route.py`:

```python
def test_grading_updates_schedule(client, db_session):
    """R2.2 AC3: completing a check moves due_at (via the events, no writes here)."""
    from services import learning_event_service

    _seed_session(db_session)
    # one correct answer 2 days ago -> streak 1 -> interval 1 day -> due (overdue)
    _seed_event(
        db_session,
        "s1",
        "mitosis",
        True,
        datetime.now(timezone.utc) - timedelta(days=2),
    )
    assert client.get("/api/review/queue").json()["total"] == 1

    # grade another correct answer now (same path check answers use)
    learning_event_service.record_from_answer(
        db_session, "s1", gap="mitosis", question="q2", correct=True
    )

    # streak 2 -> interval 2 days from now -> no longer due
    assert client.get("/api/review/queue").json()["total"] == 0
```

- [ ] **Step 2: Run test to verify it fails only for the right reason**

From `backend/`: `pytest tests/test_review_queue_route.py::test_grading_updates_schedule -v`
Expected: PASS immediately IF Tasks 2-3 are correct — this is an integration regression test, not a new-code driver. If it FAILS, the scheduler or route has a bug: stop and fix before proceeding.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_review_queue_route.py
git commit -m "test(backend): grading a check answer moves the review schedule"
```

---

### Task 5: Widen review_gaps target validation to mastered concepts

**Files:**
- Modify: `backend/routes/chat.py:83-87` (`_build_prompt_state` tail)
- Test: `backend/tests/test_chat.py` (append; existing review-gap tests at lines 151-205 must keep passing)

**Interfaces:**
- Consumes: existing `_build_prompt_state` signature (unchanged).
- Produces: `prompt_state["review_gaps_target"]` may now be a mastered concept; new key `prompt_state["review_gaps_retention"]: bool` — True when the target is mastered (not a confirmed gap). Task 6 reads this key.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_chat.py` (the `_fake_profile` / `_call_build_prompt_state` helpers at lines 132-148 already exist):

```python
def test_review_gap_mastered_target_accepted():
    profile = _fake_profile(
        confirmed_gaps=["gap-a"], mastered_concepts=["photosynthesis"]
    )
    state = _call_build_prompt_state(
        profile, review_gaps=True, review_gap="photosynthesis"
    )
    assert state["review_gaps_target"] == "photosynthesis"
    assert state["review_gaps_retention"] is True


def test_review_gap_gap_target_not_retention():
    profile = _fake_profile(
        confirmed_gaps=["gap-a"], mastered_concepts=["photosynthesis"]
    )
    state = _call_build_prompt_state(profile, review_gaps=True, review_gap="gap-a")
    assert state["review_gaps_target"] == "gap-a"
    assert state["review_gaps_retention"] is False


def test_review_gaps_activates_with_only_mastered():
    profile = _fake_profile(confirmed_gaps=[], mastered_concepts=["photosynthesis"])
    state = _call_build_prompt_state(profile, review_gaps=True)
    assert state["review_gaps_target"] == "photosynthesis"
    assert state["review_gaps_retention"] is True
    assert state["diagnostic_required"] is False


def test_review_gap_invalid_still_falls_back_to_first_gap():
    profile = _fake_profile(
        confirmed_gaps=["gap-a"], mastered_concepts=["photosynthesis"]
    )
    state = _call_build_prompt_state(profile, review_gaps=True, review_gap="junk")
    assert state["review_gaps_target"] == "gap-a"
    assert state["review_gaps_retention"] is False


def test_review_gaps_off_when_both_lists_empty():
    profile = _fake_profile(confirmed_gaps=[], mastered_concepts=[])
    state = _call_build_prompt_state(profile, review_gaps=True)
    assert "review_gaps_target" not in state
    assert "review_gaps_retention" not in state
```

- [ ] **Step 2: Run tests to verify they fail**

From `backend/`: `pytest tests/test_chat.py -k "review" -v`
Expected: the 5 new tests FAIL (`KeyError: 'review_gaps_target'` or missing `review_gaps_retention`); the 7 existing review tests PASS.

- [ ] **Step 3: Modify `_build_prompt_state`**

In `backend/routes/chat.py`, replace lines 83-87:

```python
    if review_gaps and profile.confirmed_gaps:
        target = review_gap if review_gap in profile.confirmed_gaps else profile.confirmed_gaps[0]
        prompt_state["review_gaps_target"] = target
        prompt_state["diagnostic_required"] = False
    return prompt_state
```

with:

```python
    if review_gaps:
        gaps = list(profile.confirmed_gaps or [])
        mastered = [
            c for c in (profile.mastered_concepts or []) if c not in gaps
        ]
        pool = gaps + mastered
        if pool:
            if review_gap in pool:
                target = review_gap
            else:
                target = gaps[0] if gaps else pool[0]
            prompt_state["review_gaps_target"] = target
            prompt_state["review_gaps_retention"] = target in mastered
            prompt_state["diagnostic_required"] = False
    return prompt_state
```

- [ ] **Step 4: Run tests to verify they pass**

From `backend/`: `pytest tests/test_chat.py -v`
Expected: all PASS (new 5 + all pre-existing).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/chat.py backend/tests/test_chat.py
git commit -m "feat(backend): review_gaps target accepts mastered concepts for retention review"
```

---

### Task 6: Retention framing in the system prompt

**Files:**
- Modify: `backend/agent/prompts.py` (REVIEW_GAPS label render at lines 201-202; REVIEW-GAPS MODE rules block at lines 90-99)
- Test: `backend/tests/test_prompts.py` (append)

**Interfaces:**
- Consumes: `state["review_gaps_target"]` and `state["review_gaps_retention"]` from Task 5.
- Produces: REVIEW_GAPS prompt line carries a "(retention check: ...)" suffix when retention; IMMUTABLE_RULES explains it.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_prompts.py`:

```python
def test_review_gaps_label_plain_for_gap_target():
    from agent.prompts import build_dynamic_context

    ctx = build_dynamic_context(
        {"review_gaps_target": "gap-a", "review_gaps_retention": False}
    )
    assert "REVIEW_GAPS: gap-a" in ctx
    assert "retention check" not in ctx


def test_review_gaps_label_marks_retention_for_mastered_target():
    from agent.prompts import build_dynamic_context

    ctx = build_dynamic_context(
        {"review_gaps_target": "photosynthesis", "review_gaps_retention": True}
    )
    assert "REVIEW_GAPS: photosynthesis (retention check:" in ctx


def test_immutable_rules_explain_retention_check():
    from agent.prompts import IMMUTABLE_RULES

    assert "retention check" in IMMUTABLE_RULES
```

- [ ] **Step 2: Run tests to verify they fail**

From `backend/`: `pytest tests/test_prompts.py -k "retention or review_gaps_label" -v`
Expected: FAIL (label has no retention suffix; IMMUTABLE_RULES has no mention)

- [ ] **Step 3: Modify the label render**

In `backend/agent/prompts.py`, replace lines 201-202:

```python
    review_gaps_target = state.get("review_gaps_target")
    review_gaps_label = review_gaps_target if review_gaps_target else "OFF"
```

with:

```python
    review_gaps_target = state.get("review_gaps_target")
    if review_gaps_target and state.get("review_gaps_retention"):
        review_gaps_label = (
            f"{review_gaps_target} (retention check: previously mastered; "
            "verify with check questions, do not re-teach from scratch)"
        )
    elif review_gaps_target:
        review_gaps_label = review_gaps_target
    else:
        review_gaps_label = "OFF"
```

- [ ] **Step 4: Extend the REVIEW-GAPS MODE rules block**

In `backend/agent/prompts.py`, inside the REVIEW-GAPS MODE block (after the bullet ending "...do not ask what they want to study first." at line 98, before "When REVIEW_GAPS is OFF"), add:

```
- If the REVIEW_GAPS line is marked "retention check", the learner previously
  mastered this concept: verify retention with check questions right away
  instead of re-teaching. Teach only if they answer incorrectly.
```

- [ ] **Step 5: Run tests to verify they pass**

From `backend/`: `pytest tests/test_prompts.py -v`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add backend/agent/prompts.py backend/tests/test_prompts.py
git commit -m "feat(agent): retention-check framing for mastered review targets"
```

---

### Task 7: Frontend — reviewApi + Due-for-review card on Home

**Files:**
- Create: `frontend/src/services/reviewApi.js`
- Modify: `frontend/src/views/HomeView.vue`
- Test: `frontend/src/__tests__/homeView.test.js` (extend)

**Interfaces:**
- Consumes: `GET /api/review/queue` from Task 3 (`apiGet` client already prefixes `/api`).
- Produces: `getReviewQueue(params) -> Promise<ReviewQueuePage>`; Home card with testids `home-mode-review`, `home-review-count`, `home-review-item`, `home-review-more`. Task 8 wires the interactions.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/__tests__/homeView.test.js`, add a module mock next to the existing ones (after the `profileApi` mock at line 22):

```js
const apiReviewQueue = vi.fn()
vi.mock('@/services/reviewApi.js', () => ({
  getReviewQueue: (...args) => apiReviewQueue(...args),
}))
```

Add to the `beforeEach` (after `apiAggregate.mockResolvedValue(...)`):

```js
apiReviewQueue.mockReset()
apiReviewQueue.mockResolvedValue({ items: [], total: 0, limit: 3, offset: 0 })
```

Add a factory helper near `makeSession`:

```js
function makeReviewItem(concept, overrides = {}) {
  return {
    concept,
    source_session_id: 's1',
    source_topic: 'biology',
    last_tested_at: '2026-07-01T00:00:00Z',
    streak: 1,
    due_at: '2026-07-02T00:00:00Z',
    ...overrides,
  }
}
```

Append tests:

```js
describe('HomeView review card', () => {
  beforeEach(() => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
  })

  it('hides the card when nothing is due', async () => {
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="home-mode-review"]').exists()).toBe(false)
  })

  it('renders count and items when concepts are due', async () => {
    apiReviewQueue.mockResolvedValue({
      items: [makeReviewItem('mitosis'), makeReviewItem('osmosis')],
      total: 2, limit: 3, offset: 0,
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="home-mode-review"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="home-review-count"]').text()).toContain('2 concepts')
    expect(wrapper.findAll('[data-testid="home-review-item"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('mitosis')
  })

  it('hides the card when the queue fetch fails', async () => {
    apiReviewQueue.mockRejectedValue(new Error('boom'))
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="home-mode-review"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="home-error"]').exists()).toBe(false)
  })

  it('shows View all only when total exceeds the shown items', async () => {
    apiReviewQueue.mockResolvedValue({
      items: [makeReviewItem('a'), makeReviewItem('b'), makeReviewItem('c')],
      total: 5, limit: 3, offset: 0,
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="home-review-more"]').text()).toContain('5')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

From `frontend/`: `npm run test:unit -- --run src/__tests__/homeView.test.js`
Expected: the 4 new tests FAIL (no review card markup); pre-existing HomeView tests PASS.

- [ ] **Step 3: Create `frontend/src/services/reviewApi.js`**

```js
import { apiGet } from './apiClient.js'

// params: { limit?: number, offset?: number }
export const getReviewQueue = (params) => apiGet('/review/queue', params)
```

- [ ] **Step 4: Add the card to `frontend/src/views/HomeView.vue`**

Script changes — extend the imports and setup:

```js
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '../stores/session.js'
import { getReviewQueue } from '../services/reviewApi.js'
import { friendlyError } from '../lib/errors.js'

const router = useRouter()
const store = useSessionStore()
const quickTopic = ref('')
const reviewQueue = ref({ items: [], total: 0 })
const reviewExpanded = ref(false)

onMounted(() => {
  store.listSessions().catch(() => {})
  loadReviewQueue()
})

async function loadReviewQueue(limit = 3) {
  try {
    reviewQueue.value = await getReviewQueue({ limit, offset: 0 })
  } catch {
    // The review card must never block Home; hide it on failure.
    reviewQueue.value = { items: [], total: 0 }
  }
}
```

Template — inside the `.modes` grid, after the existing quick-lesson `.mode-card` (line 35's closing `</div>`), add:

```html
        <div
          v-if="reviewQueue.total > 0"
          class="mode-card"
          data-testid="home-mode-review"
        >
          <h2 class="mode-title">Due for review</h2>
          <p class="mode-sub" data-testid="home-review-count">
            {{ reviewQueue.total }} concept{{ reviewQueue.total === 1 ? '' : 's' }} ready for a quick check.
          </p>
          <ul class="review-list">
            <li v-for="item in reviewQueue.items" :key="item.concept">
              <button
                type="button"
                class="review-item"
                data-testid="home-review-item"
                @click="startReview(item)"
              >
                <span class="review-concept">{{ item.concept }}</span>
                <span class="review-meta">{{ item.source_topic }} &middot; streak {{ item.streak }}</span>
              </button>
            </li>
          </ul>
          <button
            v-if="!reviewExpanded && reviewQueue.total > reviewQueue.items.length"
            type="button"
            class="review-more"
            data-testid="home-review-more"
            @click="expandReview"
          >
            View all {{ reviewQueue.total }}
          </button>
        </div>
```

For this task, add placeholder handlers so the template compiles (Task 8 implements them):

```js
async function startReview(item) {
  void item
}

async function expandReview() {
  reviewExpanded.value = true
  await loadReviewQueue(100)
}
```

Style — append to the scoped style block, matching existing tokens:

```css
.review-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.review-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.125rem;
  width: 100%;
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--motion-fast) ease;
}

.review-item:hover {
  border-color: var(--color-accent);
}

.review-item:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.review-concept {
  font-weight: 600;
  color: var(--color-heading);
}

.review-meta {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.review-more {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  font-family: var(--font-sans);
  font-size: 0.9rem;
  color: var(--color-accent);
  cursor: pointer;
}

.review-more:hover {
  text-decoration: underline;
}

.review-more:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
```

- [ ] **Step 5: Run tests to verify they pass**

From `frontend/`: `npm run test:unit -- --run src/__tests__/homeView.test.js`
Expected: all PASS (4 new + pre-existing)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/reviewApi.js frontend/src/views/HomeView.vue frontend/src/__tests__/homeView.test.js
git commit -m "feat(frontend): due-for-review card on Home backed by review queue API"
```

---

### Task 8: Frontend — start review + View all interactions

**Files:**
- Modify: `frontend/src/views/HomeView.vue` (fill the `startReview` placeholder from Task 7)
- Test: `frontend/src/__tests__/homeView.test.js` (extend)

**Interfaces:**
- Consumes: `store.continueTopic({ id, topic })` (existing, `frontend/src/stores/session.js:243` — creates a `seedMode: 'resume'` session and returns it); `SessionView` already consumes a `review_gap` route query and sends the visible seed message.
- Produces: clicking a review item lands the user in a new resumed session with the review-gap seed targeting that concept.

- [ ] **Step 1: Write the failing tests**

Append inside the `HomeView review card` describe block:

```js
  it('starts a review via continueTopic and navigates with review_gap query', async () => {
    apiReviewQueue.mockResolvedValue({
      items: [makeReviewItem('mitosis', { source_session_id: 'src9', source_topic: 'cells' })],
      total: 1, limit: 3, offset: 0,
    })
    const store = useSessionStore()
    vi.spyOn(store, 'continueTopic').mockResolvedValue({ id: 'newsess' })
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="home-review-item"]').trigger('click')
    await flushPromises()
    expect(store.continueTopic).toHaveBeenCalledWith({ id: 'src9', topic: 'cells' })
    expect(push).toHaveBeenCalledWith({
      name: 'session',
      params: { id: 'newsess' },
      query: { review_gap: 'mitosis' },
    })
  })

  it('stays on Home when continueTopic fails', async () => {
    apiReviewQueue.mockResolvedValue({
      items: [makeReviewItem('mitosis')], total: 1, limit: 3, offset: 0,
    })
    const store = useSessionStore()
    vi.spyOn(store, 'continueTopic').mockResolvedValue(undefined)
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="home-review-item"]').trigger('click')
    await flushPromises()
    expect(push).not.toHaveBeenCalled()
  })

  it('View all refetches with a large limit and hides itself', async () => {
    apiReviewQueue.mockResolvedValue({
      items: [makeReviewItem('a'), makeReviewItem('b'), makeReviewItem('c')],
      total: 5, limit: 3, offset: 0,
    })
    const wrapper = mountView()
    await flushPromises()
    apiReviewQueue.mockResolvedValue({
      items: ['a', 'b', 'c', 'd', 'e'].map((c) => makeReviewItem(c)),
      total: 5, limit: 100, offset: 0,
    })
    await wrapper.get('[data-testid="home-review-more"]').trigger('click')
    await flushPromises()
    expect(apiReviewQueue).toHaveBeenLastCalledWith({ limit: 100, offset: 0 })
    expect(wrapper.findAll('[data-testid="home-review-item"]')).toHaveLength(5)
    expect(wrapper.find('[data-testid="home-review-more"]').exists()).toBe(false)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

From `frontend/`: `npm run test:unit -- --run src/__tests__/homeView.test.js`
Expected: the two `startReview` tests FAIL (placeholder does nothing); the View-all test may already PASS (expand was implemented in Task 7) — that is fine.

- [ ] **Step 3: Implement `startReview`**

In `frontend/src/views/HomeView.vue`, replace the placeholder:

```js
async function startReview(item) {
  void item
}
```

with:

```js
async function startReview(item) {
  const created = await store.continueTopic({
    id: item.source_session_id,
    topic: item.source_topic,
  })
  if (created) {
    router.push({
      name: 'session',
      params: { id: created.id },
      query: { review_gap: item.concept },
    })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

From `frontend/`: `npm run test:unit -- --run src/__tests__/homeView.test.js`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/HomeView.vue frontend/src/__tests__/homeView.test.js
git commit -m "feat(frontend): start targeted review from Home via resume + review_gap seed"
```

---

### Task 9: Final gates

**Files:** none new — verification only.

- [ ] **Step 1: Full backend suite**

From `backend/`: `pytest`
Expected: all pass (baseline before slice: 539 pass / 5 skip; expect ~+24).

- [ ] **Step 2: Full frontend suite + lint**

From `frontend/`: `npm run test:unit -- --run` then `npm run lint`
Expected: all pass, lint clean.

- [ ] **Step 3: Contract drift check**

From repo root: `python backend/scripts/gen_contracts.py` then `git status --short backend/contracts/`
Expected: no diff (codegen is idempotent against committed models.py).

- [ ] **Step 4: Repo-wide testid sweep**

Native Grep for `home-mode-review|home-review-` across the repo including `frontend/e2e/` — new testids only added, none deleted, so no e2e breakage expected. Verify no stale references.

- [ ] **Step 5: Commit any stragglers and report**

Report gate results. PR to `dev` happens after review sign-off (superpowers:finishing-a-development-branch).
