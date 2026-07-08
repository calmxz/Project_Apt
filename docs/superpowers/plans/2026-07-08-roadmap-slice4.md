# Roadmap Slice 4 (P3 + D1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut chat time-to-first-token by consolidating the prepare path to at most 6 SQL statements and removing pre-stream tokenization, and stop the tutor re-teaching blind by carrying missed-question detail and per-gap accuracy into the prompt.

**Architecture:** Backend-only. P3 refactors `_prepare_turn` (routes/chat.py) plus the guard services it calls (cost_meter, rate_limit, documents_service) and the tutor streaming loop (agent/tutor.py); adds a `debug_timing` flag. D1 enriches `quiz_cooldown_json` and adds a `learning_events` GROUP BY aggregate, both rendered by `prompts.build_dynamic_context`. No OpenAPI change, no migration, no frontend change.

**Tech Stack:** FastAPI, sync SQLAlchemy 2.x (SQLite CI-parity / Supabase Postgres), LiteLLM, pytest.

**Spec:** `docs/superpowers/specs/2026-07-08-roadmap-slice4-design.md` (read it first).

## Global Constraints

- Branch: `feat/roadmap-slice4`. No emojis in code or comments. Secrets stay in `.env`.
- All commands run from `backend/` unless stated. Full suite: `pytest -q`.
- Prepare-path budget: **<=6 statements** happy path, **<=7** when the gap-accuracy aggregate runs. Perf test uses an existing user and counts via the `count_queries` harness pattern (`tests/test_sessions_perf.py:13-33`).
- Rate-limit concurrency semantics (atomic INSERT-on-conflict + guarded UPDATE) must not change; existing rate-limit tests stay green.
- `docs/api/openapi.yaml` untouched — if you think you need a contract change, stop and report.
- D1 eval paid run is NOT part of this plan (owed post-merge gate); only the script is written.

---

### Task 1: Prepare-path statement-count test (RED)

**Files:**
- Create: `backend/tests/test_chat_prepare_perf.py`

**Interfaces:**
- Consumes: `routes.chat._prepare_turn(req, user_id, db)` (async), `contracts.ChatRequest`, `count_queries` pattern.
- Produces: the failing budget test that Tasks 2-5 drive green. Test names: `test_prepare_turn_budget_no_gaps`, `test_prepare_turn_budget_with_gaps`.

- [ ] **Step 1: Write the failing test**

```python
"""P3.1 statement-count budget for the chat prepare path.

Counts SQL statements issued by _prepare_turn via before_cursor_execute.
Budget (spec P3.1): <=6 happy path, <=7 when the gap-accuracy aggregate
runs (non-empty confirmed_gaps). Uses an existing user: the first-turn-ever
user-create path is excluded from the budget by design.
"""

import asyncio
import json
from contextlib import contextmanager

import pytest
from sqlalchemy import event as _sa_event

from contracts import ChatRequest, TopicProfile
from db.models import LearningEvent, Session as SessionModel, User
from routes.chat import _prepare_turn


@contextmanager
def count_queries(db):
    bind = db.get_bind()
    state = {"n": 0, "statements": []}

    def _before(conn, cursor, statement, params, context, executemany):
        state["n"] += 1
        state["statements"].append(statement.split("\n")[0][:120])

    _sa_event.listen(bind, "before_cursor_execute", _before)
    try:
        yield state
    finally:
        _sa_event.remove(bind, "before_cursor_execute", _before)


USER_ID = "perf-user"


@pytest.fixture
def seeded_session(db_session):
    db_session.add(User(id=USER_ID))
    sess = SessionModel(user_id=USER_ID, topic="algebra")
    db_session.add(sess)
    db_session.commit()
    return sess


def _run_prepare(db, session_id):
    req = ChatRequest(session_id=session_id, message="explain factoring")
    return asyncio.run(_prepare_turn(req, USER_ID, db))


def test_prepare_turn_budget_no_gaps(db_session, seeded_session):
    with count_queries(db_session) as q:
        _run_prepare(db_session, seeded_session.id)
    assert q["n"] <= 6, f"prepare path used {q['n']} statements:\n" + "\n".join(q["statements"])


def test_prepare_turn_budget_with_gaps(db_session, seeded_session):
    profile = TopicProfile(knowledge_level="beginner", confirmed_gaps=["factoring"])
    seeded_session.topic_profile_json = profile.model_dump_json()
    db_session.add(
        LearningEvent(
            session_id=seeded_session.id,
            gap_tested="factoring",
            question="q1",
            correct=False,
        )
    )
    db_session.commit()
    with count_queries(db_session) as q:
        _run_prepare(db_session, seeded_session.id)
    assert q["n"] <= 7, f"prepare path used {q['n']} statements:\n" + "\n".join(q["statements"])
```

Adapt to the actual `db_session` fixture name in `backend/tests/conftest.py` (check it; the sessions-perf tests use `db_session`). If `SessionModel` requires more non-null fields, mirror the fixture in `test_sessions_perf.py`. If `TopicProfile` field names differ, mirror `contracts` (check `confirmed_gaps` exists — it does per spec).

- [ ] **Step 2: Run to verify it fails for the right reason**

Run: `pytest tests/test_chat_prepare_perf.py -v`
Expected: both tests FAIL on the assert with n around 10 (not on import errors or fixture errors). Record the printed statement list — it is the measured baseline for the PR description.

- [ ] **Step 3: Commit**

```bash
git add tests/test_chat_prepare_perf.py
git commit -m "test: failing statement-count budget for chat prepare path (P3.1 RED)"
```

---

### Task 2: cost_meter pure cap check + spend subquery

**Files:**
- Modify: `backend/services/cost_meter.py` (around `check_cap`, `services/cost_meter.py:149-162`)
- Test: `backend/tests/test_cost_meter.py` (append)

**Interfaces:**
- Consumes: existing `current_spend(db, user_id)`, `CapStatus`, `_to_decimal`, `_quantize`.
- Produces: `check_cap_from_spend(used: Decimal) -> CapStatus` (pure) and `spend_subquery(user_id: str)` returning a SQLAlchemy scalar subquery for today's spend. `check_cap(db, user_id)` behavior unchanged.

- [ ] **Step 1: Write failing tests**

Append to `tests/test_cost_meter.py`:

```python
from decimal import Decimal

from sqlalchemy import select

from services import cost_meter


def test_check_cap_from_spend_matches_check_cap_semantics():
    st = cost_meter.check_cap_from_spend(Decimal("0"))
    assert st.allowed and not st.soft_breached and not st.urgent_breached
    st = cost_meter.check_cap_from_spend(Decimal("2.50"))
    assert st.allowed and st.soft_breached
    st = cost_meter.check_cap_from_spend(Decimal("3.00"))
    assert not st.allowed


def test_spend_subquery_returns_todays_spend(db_session):
    cost_meter.record_cost(db_session, "sq-user", Decimal("0.25"))
    used = db_session.execute(
        select(cost_meter.spend_subquery("sq-user"))
    ).scalar_one()
    assert Decimal(str(used or 0)) == Decimal("0.25")


def test_spend_subquery_zero_when_no_ledger_row(db_session):
    used = db_session.execute(
        select(cost_meter.spend_subquery("nobody"))
    ).scalar_one()
    assert Decimal(str(used or 0)) == Decimal("0")
```

Mirror the existing test file's fixture and `record_cost` signature (check how `test_cost_meter.py` seeds the ledger — reuse its helpers if present).

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_cost_meter.py -v -k "from_spend or subquery"`
Expected: FAIL with AttributeError (`check_cap_from_spend` / `spend_subquery` not defined).

- [ ] **Step 3: Implement**

In `services/cost_meter.py`, refactor `check_cap` so the cap math lives in a pure function, and expose the spend aggregate as a scalar subquery. `current_spend` today reads the `daily_cost_ledger` row for (user, today) — open the file and mirror its exact table/columns and date logic in the subquery (single source: extract the WHERE into a shared helper if `current_spend` uses a plain select; if `current_spend` is ORM `db.get`-based, build the subquery on the same model + same `date_utc` helper):

```python
def check_cap_from_spend(used: Decimal) -> CapStatus:
    soft_cap = _to_decimal(settings.llm_soft_cap_usd)
    hard_cap = _to_decimal(settings.llm_hard_cap_usd)
    urgent_cap = _quantize(hard_cap * Decimal("0.9"))
    return CapStatus(
        allowed=used < hard_cap,
        used=used,
        soft_breached=used >= soft_cap,
        urgent_breached=used >= urgent_cap,
        soft_cap=soft_cap,
        urgent_cap=urgent_cap,
        hard_cap=hard_cap,
    )


def check_cap(db: Session, user_id: str) -> CapStatus:
    return check_cap_from_spend(current_spend(db, user_id))


def spend_subquery(user_id: str):
    """Scalar subquery: today's spend for user_id (0/NULL when no row).

    Same table and date window as current_spend - keep them in lockstep.
    """
    return (
        select(func.coalesce(func.sum(DailyCostLedger.cost_usd), 0))
        .where(
            DailyCostLedger.user_id == user_id,
            DailyCostLedger.date_utc == _today_utc(),
        )
        .scalar_subquery()
    )
```

Adjust model/column/date-helper names to what `current_spend` actually uses (read it in the file; the ledger model is in `db/models.py`). If the ledger stores one row per (user, day) rather than many, `func.sum` still works. Convert the raw scalar to `Decimal` at the call site (Task 5) — SQLite may return float/str.

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_cost_meter.py tests/test_cost_cap.py -v`
Expected: all PASS (new tests green, existing cap tests untouched).

- [ ] **Step 5: Commit**

```bash
git add services/cost_meter.py tests/test_cost_meter.py
git commit -m "feat(cost): pure check_cap_from_spend + spend_subquery for combined guard read"
```

---

### Task 3: rate_limit UPDATE..RETURNING (3 -> 2 statements)

**Files:**
- Modify: `backend/services/rate_limit.py:36-80` (`check_and_increment`)
- Test: `backend/tests/test_rate_limit.py` (append)

**Interfaces:**
- Consumes: existing `_dialect_insert`, `UsageCounter`, `_today_utc`.
- Produces: `check_and_increment(db, user_id) -> tuple[bool, int]` — same signature, same semantics, 2 statements on the allowed path.

- [ ] **Step 1: Write failing test**

Append to `tests/test_rate_limit.py` (reuse its existing fixtures/patterns for seeding a counter):

```python
from contextlib import contextmanager

from sqlalchemy import event as _sa_event

from services import rate_limit


@contextmanager
def _count(db):
    bind = db.get_bind()
    state = {"n": 0}

    def _before(conn, cursor, statement, params, context, executemany):
        state["n"] += 1

    _sa_event.listen(bind, "before_cursor_execute", _before)
    try:
        yield state
    finally:
        _sa_event.remove(bind, "before_cursor_execute", _before)


def test_check_and_increment_two_statements_on_allowed_path(db_session):
    rate_limit.check_and_increment(db_session, "rl-perf")  # warm: row now exists
    with _count(db_session) as q:
        allowed, used = rate_limit.check_and_increment(db_session, "rl-perf")
    assert allowed and used == 2
    assert q["n"] <= 2, f"allowed path used {q['n']} statements"
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_rate_limit.py -v -k two_statements`
Expected: FAIL with `q["n"] == 3`.

- [ ] **Step 3: Implement**

In `check_and_increment`, replace the step-3 SELECT with `RETURNING` on the guarded UPDATE. Keep the INSERT..ON CONFLICT exactly as is. The current code (read lines 36-80 in full first) is step1 INSERT, step2 guarded UPDATE, step3 SELECT count. New shape:

```python
    result = db.execute(
        update(UsageCounter)
        .where(
            UsageCounter.user_id == user_id,
            UsageCounter.date_utc == date_utc,
            UsageCounter.count < settings.daily_cap,
        )
        .values(count=UsageCounter.count + 1)
        .returning(UsageCounter.count)
    )
    new_count = result.scalar_one_or_none()
    # Preserve whatever commit the current implementation does at this point.
    if new_count is not None:
        # UPDATE matched: we incremented while under the cap.
        <existing commit behavior>
        return True, new_count
    # UPDATE matched no row: cap already reached. One fallback SELECT for the
    # count (this path returns 429 upstream; outside the happy-path budget).
    used = db.execute(
        select(UsageCounter.count).where(
            UsageCounter.user_id == user_id,
            UsageCounter.date_utc == date_utc,
        )
    ).scalar_one()
    <existing commit behavior>
    return False, used
```

Replace `<existing commit behavior>` with exactly what the function does today (it may `db.commit()` or leave commit to the caller — preserve it verbatim; read the current tail of the function). Keep the docstring's concurrency explanation, amending step 3's description to RETURNING. Note: SQLAlchemy emits UPDATE..RETURNING on SQLite only for SQLite >= 3.35; CI and dev both bundle newer. If the sqlite dialect in CI errors on RETURNING, stop and report (do not silently fall back).

- [ ] **Step 4: Run the whole rate-limit suite**

Run: `pytest tests/test_rate_limit.py -v`
Expected: ALL pass — especially the existing concurrency/cap-boundary tests. If any cap-semantics test fails, fix the implementation, not the test.

- [ ] **Step 5: Commit**

```bash
git add services/rate_limit.py tests/test_rate_limit.py
git commit -m "perf(rate-limit): fold post-increment SELECT into UPDATE..RETURNING"
```

---

### Task 4: row-accepting variants + status_from_counts

**Files:**
- Modify: `backend/services/profile_service.py` (near `load_profile`, `:75-79`)
- Modify: `backend/services/pending_check_store.py` (near `get_pending_check`, `:20-28`)
- Modify: `backend/services/check_question_service.py` (near `get_quiz_cooldown`, `:308-316`)
- Modify: `backend/services/documents_service.py` (near `aggregate_status`, `:26-49`)
- Test: `backend/tests/test_profile_service.py`, `backend/tests/test_quiz_cooldown_service.py`, `backend/tests/test_documents_service.py` (append; if a file does not exist, find the module's existing test file via `grep -l status_from_counts tests/` conventions and append there)

**Interfaces:**
- Consumes: `SessionModel` row (columns `topic_profile_json`, `pending_check_json`, `quiz_cooldown_json`), `_parse_profile`, existing JSON-parse guards.
- Produces (used by Task 5):
  - `profile_service.profile_from_row(row) -> TopicProfile`
  - `pending_check_store.get_pending_check_from_row(row) -> dict | None`
  - `check_question_service.get_pending_check_from_row` (re-export, matching the existing re-export pattern for `get_pending_check`)
  - `check_question_service.get_quiz_cooldown_from_row(row) -> dict | None`
  - `documents_service.status_from_counts(total: int, pending: int, ready: int) -> IngestionStatus | None`

- [ ] **Step 1: Write failing tests**

```python
# test_profile_service.py append
def test_profile_from_row_parses_without_db(db_session):
    row = SessionModel(user_id="u", topic="t",
                       topic_profile_json='{"knowledge_level": "beginner"}')
    profile = profile_service.profile_from_row(row)
    assert profile.knowledge_level == "beginner"


def test_profile_from_row_tolerates_null_json():
    row = SessionModel(user_id="u", topic="t", topic_profile_json=None)
    assert profile_service.profile_from_row(row) is not None
```

```python
# test_quiz_cooldown_service.py append
def test_get_quiz_cooldown_from_row_matches_db_variant():
    row = SessionModel(user_id="u", topic="t",
                       quiz_cooldown_json='{"gap": "g", "last_score": "1/2", "missed": []}')
    cd = check_question_service.get_quiz_cooldown_from_row(row)
    assert cd == {"gap": "g", "last_score": "1/2", "missed": []}


def test_get_quiz_cooldown_from_row_bad_json_returns_none():
    row = SessionModel(user_id="u", topic="t", quiz_cooldown_json="{nope")
    assert check_question_service.get_quiz_cooldown_from_row(row) is None


def test_get_pending_check_from_row_parses():
    row = SessionModel(user_id="u", topic="t",
                       pending_check_json='{"gap": "g", "items": []}')
    assert check_question_service.get_pending_check_from_row(row) == {"gap": "g", "items": []}
```

```python
# documents_service tests append
import pytest
from services import documents_service


@pytest.mark.parametrize(
    "total,pending,ready,expected",
    [
        (0, 0, 0, None),
        (2, 1, 1, "pending"),
        (2, 0, 1, "ready"),
        (2, 0, 0, "failed"),
    ],
)
def test_status_from_counts_mirrors_aggregate_status(total, pending, ready, expected):
    assert documents_service.status_from_counts(total, pending, ready) == expected
```

- [ ] **Step 2: Run to verify failures**

Run: `pytest tests/ -v -k "from_row or from_counts"`
Expected: FAIL with AttributeError on each new function.

- [ ] **Step 3: Implement**

Refactor each session_id-based getter to delegate to the row variant (single source of parse logic):

```python
# profile_service.py
def profile_from_row(row: SessionModel | None) -> TopicProfile:
    if row is None:
        return TopicProfile()
    return _parse_profile(row.topic_profile_json)


def load_profile(db: Session, session_id: str) -> TopicProfile:
    return profile_from_row(db.get(SessionModel, session_id))
```

```python
# pending_check_store.py
def get_pending_check_from_row(row: SessionModel | None) -> dict | None:
    if row is None or not row.pending_check_json:
        return None
    try:
        data = json.loads(row.pending_check_json)
    except (ValueError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def get_pending_check(db: Session, session_id: str) -> dict | None:
    return get_pending_check_from_row(db.get(SessionModel, session_id))
```

```python
# check_question_service.py — same delegation shape for get_quiz_cooldown,
# plus re-export get_pending_check_from_row next to the existing
# get_pending_check re-export (grep for "get_pending_check" at the top of
# the module to find the re-export block).
def get_quiz_cooldown_from_row(row: SessionModel | None) -> dict | None:
    if row is None or not row.quiz_cooldown_json:
        return None
    try:
        data = json.loads(row.quiz_cooldown_json)
    except (ValueError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def get_quiz_cooldown(db: Session, session_id: str) -> dict | None:
    return get_quiz_cooldown_from_row(db.get(SessionModel, session_id))
```

```python
# documents_service.py
def status_from_counts(total: int, pending: int, ready: int) -> IngestionStatus | None:
    """Counts-based twin of aggregate_status (pending > ready > failed > None).
    Used by the consolidated prepare-path session SELECT."""
    if total == 0:
        return None
    if pending > 0:
        return "pending"
    if ready > 0:
        return "ready"
    return "failed"
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/ -v -k "from_row or from_counts or profile_service or quiz_cooldown or documents"`
Expected: PASS, plus no regressions in those files' existing tests.

- [ ] **Step 5: Commit**

```bash
git add services/profile_service.py services/pending_check_store.py services/check_question_service.py services/documents_service.py tests/
git commit -m "refactor(services): row-accepting getters + status_from_counts for prepare-path consolidation"
```

---

### Task 5: consolidate _prepare_turn (GREEN for Task 1)

**Files:**
- Modify: `backend/routes/chat.py:84-174` (`_prepare_turn`)

**Interfaces:**
- Consumes: `cost_meter.spend_subquery` / `check_cap_from_spend` (Task 2), 2-statement `rate_limit.check_and_increment` (Task 3), `profile_from_row` / `get_pending_check_from_row` / `get_quiz_cooldown_from_row` / `status_from_counts` (Task 4).
- Produces: same `(messages, system_prompt, ctx)` return; identical HTTP error behavior (429 cost, 429 rate, 404 session).

- [ ] **Step 1: Rewrite _prepare_turn**

Replace the body between the docstring and the `return` with (imports: add `exists`, `func`, `literal` as needed from sqlalchemy; `Document` from `db.models`; `User` from `db.models`):

```python
    # 1) Combined guard read: today's spend + user existence, one statement.
    spend_raw, user_exists = db.execute(
        select(
            cost_meter.spend_subquery(user_id),
            select(User.id).where(User.id == user_id).exists().select(),
        )
    ).one()
```

NOTE: the exact SQLAlchemy shape for selecting two scalar subqueries with no FROM differs by version — `select(subq_a, exists_subq)` where `exists_subq = select(literal(True)).where(User.id == user_id).exists()` wrapped via `select(subq_a, exists_subq)` is the target; verify the emitted SQL is ONE statement using the Task 1 test's statement list. If the no-FROM select fights the dialect, anchor on the users table instead: `select(cost_meter.spend_subquery(user_id), func.count(User.id)).where(User.id == user_id)` — zero rows means absent user, so use `.first()` and treat `None` row as (0, absent). Either shape is acceptable; one statement is the requirement.

```python
    cost_status = cost_meter.check_cap_from_spend(Decimal(str(spend_raw or 0)))
    if not cost_status.allowed:
        raise HTTPException(  # unchanged detail payload
            status_code=429,
            detail={
                "code": DAILY_COST_CAP_REACHED,
                "soft_cap_usd": str(cost_status.soft_cap),
                "hard_cap_usd": str(cost_status.hard_cap),
                "used_usd": str(cost_status.used),
                "resets_at": cost_meter.midnight_utc_iso(),
            },
        )

    # 2-3) Rate limit: 2 statements on the allowed path (Task 3).
    allowed, used = rate_limit.check_and_increment(db, user_id)
    if not allowed:
        raise HTTPException(  # unchanged detail payload
            status_code=429,
            detail={
                "code": DAILY_CAP_REACHED,
                "cap": settings.daily_cap,
                "used": used,
                "resets_at": rate_limit.midnight_utc_iso(),
            },
        )

    # First-turn-ever: create the user row (rare path, excluded from budget).
    if not user_exists:
        ensure_user(db, user_id)

    # 4) Session + ingestion counts in one statement.
    doc_base = select(func.count()).where(Document.session_id == req.session_id)
    row = db.execute(
        select(
            SessionModel,
            doc_base.scalar_subquery().label("doc_total"),
            doc_base.where(Document.status == "pending").scalar_subquery().label("doc_pending"),
            doc_base.where(Document.status == "ready").scalar_subquery().label("doc_ready"),
        ).where(SessionModel.id == req.session_id)
    ).first()
    if row is None or row.SessionModel.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    session = row.SessionModel
    ingestion_status = documents_service.status_from_counts(
        row.doc_total, row.doc_pending, row.doc_ready
    )
```

CAUTION: `doc_base.where(...)` on a fresh `select(func.count())` chains WHEREs correctly (immutable generative API — each `.where` returns a new select). Verify `row.SessionModel` attribute access matches the Row API in this SQLAlchemy version (may be `row[0]` / `row.doc_total` mix); adapt.

```python
    # 5) History (unchanged statement).
    history = db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == req.session_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(20)
    ).scalars().all()
    history = list(reversed(history))

    messages = [
        {"role": m.role, "content": context_budget.truncate_message(m.content)}
        for m in history
    ]
    messages.append({"role": "user", "content": req.message})

    profile = profile_service.profile_from_row(session)

    retrieval_required = keyword_index.match_required(
        req.message, json.loads(session.kw_index_json or "[]")
    )

    prompt_state = _build_prompt_state(
        session=session,
        profile=profile,
        ingestion_status=ingestion_status,
        retrieval_required=retrieval_required,
        review_gaps=getattr(req, "review_gaps", False),
        review_gap=getattr(req, "review_gap", None),
        pending_check=check_question_service.get_pending_check_from_row(session),
        quiz_cooldown=check_question_service.get_quiz_cooldown_from_row(session),
    )
    system_prompt = prompts.build_system_prompt(prompt_state)

    # 6) Persist the user turn LAST (still committed before returning, so it
    # survives an early stream end) - after all reads, so commit-expiry does
    # not trigger a refresh SELECT.
    user_msg = ChatMessage(session_id=req.session_id, role="user", content=req.message)
    db.add(user_msg)
    db.commit()

    ctx = ToolContext(
        db=db,
        session_id=req.session_id,
        user_id=user_id,
        turn_started_at=datetime.now(timezone.utc),
    )

    return messages, system_prompt, ctx
```

Behavior notes to preserve: (a) cost gate runs before the rate increment, so a cost-capped request does not consume a rate-limit slot; (b) a rate-limited first-ever request does not create the user row (ensure_user stays after the rate gate); (c) the 404 must not leak whether the session exists for another user (same combined condition as today). Add `from decimal import Decimal` import.

- [ ] **Step 2: Run the Task 1 budget tests**

Run: `pytest tests/test_chat_prepare_perf.py -v`
Expected: `test_prepare_turn_budget_no_gaps` PASS at exactly 6 (the with-gaps test still passes at <=7 trivially since the aggregate does not exist yet — it will tighten in Task 9). If over budget, read the printed statement list and eliminate the stragglers (a post-commit refresh SELECT means something reads session attributes after `db.commit()` — move that read up).

- [ ] **Step 3: Run the full chat + sessions suites**

Run: `pytest tests/test_chat.py tests/test_sessions_perf.py tests/test_rate_limit.py tests/test_cost_cap.py -v`
Expected: ALL PASS. The chat route's observable behavior (SSE events, error payloads, message persistence) is unchanged.

- [ ] **Step 4: Commit**

```bash
git add routes/chat.py
git commit -m "perf(chat): consolidate prepare path to 6 statements (P3.1 GREEN)"
```

---

### Task 6: lazy cancelled-cost tokenization (P3.2)

**Files:**
- Modify: `backend/agent/tutor.py` (`:104-137` loop head, `:372-391` CancelledError branch)
- Test: `backend/tests/test_cost_meter_estimate.py` or wherever cancelled-stream billing is tested (grep `estimate_cancelled_cost` in tests/) — update; plus new no-happy-path-tokenization test in the tutor test file (grep `run_streaming` in tests/ for the file).

**Interfaces:**
- Consumes: existing `cost_meter.estimate_cancelled_cost(model, accumulated_text, prompt_tokens_total)` — signature unchanged.
- Produces: `iter_boundaries: list[int]` recorded per iteration; tokenization only in the CancelledError branch.

- [ ] **Step 1: Write failing tests**

In the tutor streaming test file (find via `grep -rl "run_streaming" tests/`), add:

```python
async def test_no_token_counter_on_happy_path(monkeypatch, ...):
    calls = []
    def _counter(*a, **k):
        calls.append(1)
        return 100
    monkeypatch.setattr("agent.tutor.litellm.token_counter", _counter)
    # drive run_streaming to a normal 'done' using the file's existing
    # mocked-acompletion pattern (copy the nearest happy-path test's setup)
    ...
    assert calls == []


async def test_cancelled_stream_estimates_tokens_lazily(monkeypatch, ...):
    # drive run_streaming into asyncio.CancelledError mid-stream using the
    # file's existing cancellation test as the template; assert
    # estimate_cancelled_cost received a positive prompt_tokens_total and
    # token_counter WAS called at least once during cancellation handling.
    ...
```

These two tests must contain real code adapted from the neighboring tests in that file (mocked `litellm.acompletion` streaming generator, stub settings) — copy the closest existing test and change the assertion; do not invent a new harness. Note `settings.llm_stub_enabled` is a property — patch `settings.llm_stub` (memory: 13021).

- [ ] **Step 2: Run to verify failure**

Run: `pytest <that file> -v -k "token_counter or lazily"`
Expected: `test_no_token_counter_on_happy_path` FAILS (counter called once per iteration today).

- [ ] **Step 3: Implement in tutor.py**

Loop head — replace the per-iteration counting block (`:129-137`) with a boundary record:

```python
    full: list[dict] = [{"role": "system", "content": system_prompt}] + list(messages)
    accumulated_text = ""
    iter_boundaries: list[int] = []  # len(full) at each iteration start; used only on cancel
    tool_calls_record: list[ToolCallRecord] = []
    ...
        for _i in range(max_iters):
            ...cap check unchanged...
            iter_boundaries.append(len(full))
            resp = await litellm.acompletion(...)
```

CancelledError branch — compute the sum lazily before the existing estimate call:

```python
    except asyncio.CancelledError:
        prompt_tokens_total = 0
        for boundary in iter_boundaries:
            try:
                prompt_tokens_total += litellm.token_counter(
                    model=settings.model, messages=full[:boundary]
                )
            except Exception as e:
                # Local tokenization only; no credential in the exception.
                log.warning("token_counter failed: %s", e)  # nosemgrep: python.lang.security.audit.logging.logger-credential-leak.python-logger-credential-disclosure
        try:
            cost = cost_meter.estimate_cancelled_cost(
                settings.model, accumulated_text, prompt_tokens_total
            )
        ...rest unchanged...
```

Delete the old `prompt_tokens_total = 0` initialization at `:105` and the old counting block at `:129-137`. This reproduces today's accumulation exactly (each iteration billed its then-current prefix).

- [ ] **Step 4: Run tests**

Run: `pytest <tutor test file> tests/test_cost_meter_estimate.py tests/test_cost_cap.py -v`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/tutor.py tests/
git commit -m "perf(tutor): tokenize lazily on cancel only; happy path does zero token counting (P3.2)"
```

---

### Task 7: debug_timing flag + prepare/first-token/end-session logs (P3.4)

**Files:**
- Modify: `backend/config.py` (Settings), `backend/routes/chat.py` (`chat_stream`), `backend/routes/sessions.py` (`end_session`, `:284-309`)
- Test: `backend/tests/test_debug_timing.py` (create)

**Interfaces:**
- Consumes: `settings.debug_timing`, module loggers already present in both route files.
- Produces: log lines `chat timing prepare_ms=<float> first_token_ms=<float>` and `end_session timing total_ms=<float>` when the flag is on; nothing when off.

- [ ] **Step 1: Write failing tests**

```python
"""P3.4: debug_timing flag emits prepare/first-token/end-session timings."""

import logging

from config import settings


def test_debug_timing_defaults_off():
    assert settings.debug_timing is False


def test_chat_stream_logs_timing_when_enabled(client, caplog, monkeypatch, seeded_session_fixture):
    monkeypatch.setattr(settings, "debug_timing", True)
    monkeypatch.setattr(settings, "llm_stub", True)
    with caplog.at_level(logging.INFO, logger="routes.chat"):
        # drive one stub-mode streaming turn using the file's existing
        # streaming-test client pattern (copy from test_chat.py)
        ...
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert "prepare_ms=" in joined and "first_token_ms=" in joined


def test_chat_stream_logs_nothing_when_disabled(client, caplog, seeded_session_fixture):
    with caplog.at_level(logging.INFO, logger="routes.chat"):
        ...same drive...
    assert "prepare_ms=" not in " ".join(r.getMessage() for r in caplog.records)


def test_end_session_logs_timing_when_enabled(client, caplog, monkeypatch, seeded_session_fixture):
    monkeypatch.setattr(settings, "debug_timing", True)
    monkeypatch.setattr(settings, "llm_stub", True)
    with caplog.at_level(logging.INFO, logger="routes.sessions"):
        # POST /api/sessions/{id}/end via the existing sessions test client pattern
        ...
    assert "end_session timing total_ms=" in " ".join(r.getMessage() for r in caplog.records)
```

Adapt fixture names/driving code from `test_chat.py` and the sessions test file — real code, no ellipses left behind.

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_debug_timing.py -v`
Expected: FAIL — `Settings` has no `debug_timing` attribute.

- [ ] **Step 3: Implement**

`config.py`: add `debug_timing: bool = False` after `llm_stub: bool = False`.

`routes/chat.py` `chat_stream`:

```python
    import time  # module-level import at top of file

    t0 = time.perf_counter()
    messages, system_prompt, ctx = await _prepare_turn(req, user_id, db)
    prepare_ms = (time.perf_counter() - t0) * 1000.0

    async def event_stream():
        first_token_logged = False
        ...
                yield event.to_sse()
                if settings.debug_timing and not first_token_logged:
                    first_token_logged = True
                    log.info(
                        "chat timing prepare_ms=%.1f first_token_ms=%.1f",
                        prepare_ms,
                        (time.perf_counter() - t0) * 1000.0,
                    )
```

(Place the first-token log at the first `yield event.to_sse()`; the flag-off path adds only the boolean check.)

`routes/sessions.py` `end_session`: wrap the handler body:

```python
    t0 = time.perf_counter()
    ...existing body, both return paths via a small helper or try/finally...
    if settings.debug_timing:
        log.info("end_session timing total_ms=%.1f", (time.perf_counter() - t0) * 1000.0)
```

Use `try/finally` so both the already-ended early return and the normal path log. Check `routes/sessions.py` already has a module logger (`log = logging.getLogger(__name__)`); add if missing, and `import time`.

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_debug_timing.py tests/test_chat.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add config.py routes/chat.py routes/sessions.py tests/test_debug_timing.py
git commit -m "feat(obs): debug_timing flag logs prepare_ms, first_token_ms, end_session ms (P3.4)"
```

---

### Task 8: cooldown missed-detail enrichment + render (D1.1)

**Files:**
- Modify: `backend/services/check_question_service.py:286-305` (`build_quiz_cooldown`)
- Modify: `backend/agent/prompts.py:149-159` (`build_dynamic_context` QUIZ_READINESS)
- Test: `backend/tests/test_quiz_cooldown_service.py`, `backend/tests/test_prompts.py` (append)

**Interfaces:**
- Consumes: resolved batch dict `pc` with `items[*].{question, options, selected_index, correct_index, status, correct}` (same fields `build_results_summary` reads at `:269-283`).
- Produces: `missed` entries shaped `{"question": str, "chosen": str, "correct": str}`; renderer tolerates legacy plain-string entries.

- [ ] **Step 1: Write failing tests**

```python
# test_quiz_cooldown_service.py append
def test_build_quiz_cooldown_missed_carries_chosen_vs_correct():
    pc = {
        "gap": "g",
        "items": [
            {"question": "Q1?", "options": ["a", "b"], "selected_index": 0,
             "correct_index": 1, "status": "answered", "correct": False},
            {"question": "Q2?", "options": ["x", "y"], "selected_index": 1,
             "correct_index": 1, "status": "answered", "correct": True},
        ],
    }
    cd = check_question_service.build_quiz_cooldown(pc)
    assert cd["missed"] == [{"question": "Q1?", "chosen": "a", "correct": "b"}]
```

```python
# test_prompts.py append
def test_quiz_readiness_renders_missed_detail():
    ctx = prompts.build_dynamic_context({
        "quiz_cooldown": {
            "gap": "g", "last_score": "1/2",
            "missed": [{"question": "What is X?", "chosen": "a", "correct": "b"}],
        }
    })
    line = next(l for l in ctx.split("\n") if l.startswith("QUIZ_READINESS:"))
    assert "What is X?" in line and '"chosen": "a"' in line and '"correct": "b"' in line


def test_quiz_readiness_tolerates_legacy_string_missed():
    ctx = prompts.build_dynamic_context({
        "quiz_cooldown": {"gap": "g", "last_score": "0/1", "missed": ["Old stem?"]}
    })
    line = next(l for l in ctx.split("\n") if l.startswith("QUIZ_READINESS:"))
    assert "Old stem?" in line


def test_quiz_readiness_truncates_long_question_stems():
    ctx = prompts.build_dynamic_context({
        "quiz_cooldown": {"gap": "g", "last_score": "0/1",
                          "missed": [{"question": "Q" * 300, "chosen": "a", "correct": "b"}]}
    })
    line = next(l for l in ctx.split("\n") if l.startswith("QUIZ_READINESS:"))
    assert "Q" * 81 not in line  # stems capped at 80 chars
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_quiz_cooldown_service.py tests/test_prompts.py -v -k "missed or legacy or truncat"`
Expected: FAIL (missed is a list of stems; renderer drops missed).

- [ ] **Step 3: Implement**

`build_quiz_cooldown` — change the `missed` construction:

```python
    missed = [
        {
            "question": it["question"],
            "chosen": it["options"][it["selected_index"]],
            "correct": it["options"][it["correct_index"]],
        }
        for it in graded
        if not it.get("correct")
    ]
```

`prompts.py` — extend the QUIZ_READINESS render (keep it one JSON line; tolerant of legacy shapes):

```python
_MISSED_STEM_CAP = 80


def _normalize_missed(missed) -> list[dict]:
    out = []
    for entry in missed or []:
        if isinstance(entry, dict):
            q = str(entry.get("question", ""))[:_MISSED_STEM_CAP]
            out.append({"question": q,
                        "chosen": entry.get("chosen"),
                        "correct": entry.get("correct")})
        elif isinstance(entry, str):
            out.append({"question": entry[:_MISSED_STEM_CAP]})
    return out
```

and in `build_dynamic_context`:

```python
    quiz_cooldown = state.get("quiz_cooldown")
    if quiz_cooldown:
        qr = {
            "gap": quiz_cooldown.get("gap"),
            "last_score": quiz_cooldown.get("last_score"),
            "status": "cooling_down",
        }
        missed = _normalize_missed(quiz_cooldown.get("missed"))
        if missed:
            qr["missed"] = missed
        qr_label = json.dumps(qr)
    else:
        qr_label = "ready"
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_quiz_cooldown_service.py tests/test_prompts.py tests/test_check_complete_route.py -v`
Expected: ALL PASS (check/complete route tests exercise the new missed shape end-to-end; if any asserts on the old stem-list shape, update that assertion to the new shape — the shape change is the feature).

- [ ] **Step 5: Commit**

```bash
git add services/check_question_service.py agent/prompts.py tests/
git commit -m "feat(d1): cooldown carries chosen-vs-correct missed detail into QUIZ_READINESS"
```

---

### Task 9: gap_accuracy aggregate + GAP_ACCURACY block (D1.2)

**Files:**
- Modify: `backend/services/learning_event_service.py` (append function)
- Modify: `backend/routes/chat.py` (`_prepare_turn` + `_build_prompt_state`)
- Modify: `backend/agent/prompts.py` (`build_dynamic_context`)
- Test: `backend/tests/test_learning_event_service.py` (or the module's existing test file — grep `record_from_answer` in tests/), `backend/tests/test_prompts.py`, `backend/tests/test_chat_prepare_perf.py` (tighten)

**Interfaces:**
- Consumes: `LearningEvent` model (`gap_tested`, `correct`, `session_id`).
- Produces: `learning_event_service.gap_accuracy(db, session_id) -> dict[str, dict]` mapping gap -> `{"attempts": int, "correct": int}`; prompt_state key `"gap_accuracy"`; `GAP_ACCURACY:` line in dynamic context (between `PENDING_CHECK` and `QUIZ_READINESS` — exact position is free, but pick one and keep the prefix-stability P1 test green: it must be in the DYNAMIC part, which all of `build_dynamic_context` is).

- [ ] **Step 1: Write failing tests**

```python
# learning_event_service tests append
def test_gap_accuracy_groups_by_gap(db_session, seeded_session):
    sid = seeded_session.id
    for gap, correct in [("frac", True), ("frac", False), ("frac", False), ("alg", True)]:
        learning_event_service.record_from_answer(
            db_session, sid, gap=gap, question="q", correct=correct,
            clear_pending=False, apply_profile_effects=False,
        )
    acc = learning_event_service.gap_accuracy(db_session, sid)
    assert acc == {"frac": {"attempts": 3, "correct": 1}, "alg": {"attempts": 1, "correct": 1}}


def test_gap_accuracy_empty_session(db_session, seeded_session):
    assert learning_event_service.gap_accuracy(db_session, seeded_session.id) == {}
```

```python
# test_prompts.py append
def test_gap_accuracy_block_renders_only_profile_gaps():
    ctx = prompts.build_dynamic_context({
        "profile": TopicProfile(confirmed_gaps=["frac"]),
        "gap_accuracy": {"frac": {"attempts": 3, "correct": 1},
                         "stale-gap": {"attempts": 5, "correct": 5}},
    })
    line = next(l for l in ctx.split("\n") if l.startswith("GAP_ACCURACY:"))
    assert "frac" in line and "stale-gap" not in line


def test_gap_accuracy_absent_without_data():
    ctx = prompts.build_dynamic_context({})
    line = next(l for l in ctx.split("\n") if l.startswith("GAP_ACCURACY:"))
    assert line == "GAP_ACCURACY: none"


def test_gap_accuracy_caps_at_top_8_by_attempts():
    gaps = [f"g{i}" for i in range(12)]
    acc = {g: {"attempts": i + 1, "correct": 0} for i, g in enumerate(gaps)}
    ctx = prompts.build_dynamic_context({
        "profile": TopicProfile(confirmed_gaps=gaps),
        "gap_accuracy": acc,
    })
    line = next(l for l in ctx.split("\n") if l.startswith("GAP_ACCURACY:"))
    assert "g11" in line and "g0" not in line  # highest-attempt 8 kept
    assert len(line) <= 620  # block char cap: 600 + prefix slack
```

```python
# test_chat_prepare_perf.py — extend test_prepare_turn_budget_with_gaps with
# a functional assertion so the aggregate is proven to run on that branch:
    messages, system_prompt, ctx = ...  # capture _run_prepare return
    assert "GAP_ACCURACY:" in system_prompt and "factoring" in system_prompt
```

Also add a best-effort failure test in the chat test file:

```python
def test_gap_accuracy_failure_does_not_kill_turn(monkeypatch, ...):
    def _boom(db, sid):
        raise RuntimeError("db exploded")
    monkeypatch.setattr("routes.chat.learning_event_service.gap_accuracy", _boom)
    # drive one stub-mode turn on a session whose profile has confirmed_gaps;
    # assert the turn still streams to 'done' (copy driving code from test_chat.py)
```

- [ ] **Step 2: Run to verify failures**

Run: `pytest tests/ -v -k gap_accuracy`
Expected: FAIL — `gap_accuracy` undefined; no `GAP_ACCURACY:` line.

- [ ] **Step 3: Implement**

`learning_event_service.py` (add `from sqlalchemy import case, func, select`):

```python
def gap_accuracy(db: Session, session_id: str) -> dict[str, dict]:
    """Per-gap attempts and correct counts for one session (D1.2).

    Session-scoped by design: cross-session accuracy is R2's review-queue
    concern and will be queried at user level there.
    """
    rows = db.execute(
        select(
            LearningEvent.gap_tested,
            func.count().label("attempts"),
            func.sum(case((LearningEvent.correct, 1), else_=0)).label("correct"),
        )
        .where(LearningEvent.session_id == session_id)
        .group_by(LearningEvent.gap_tested)
    ).all()
    return {r.gap_tested: {"attempts": int(r.attempts), "correct": int(r.correct or 0)} for r in rows}
```

`routes/chat.py` — in `_prepare_turn` after `profile = ...` (before the commit so it stays inside the read block):

```python
    gap_accuracy: dict[str, dict] = {}
    if profile.confirmed_gaps:
        try:
            gap_accuracy = learning_event_service.gap_accuracy(db, req.session_id)
        except Exception as e:  # noqa: BLE001 - best-effort prompt enrichment
            log.warning("gap_accuracy failed; continuing without it: %s", e)
```

Thread `gap_accuracy=gap_accuracy` through `_build_prompt_state` (new keyword arg, stored as `prompt_state["gap_accuracy"]`). Import `learning_event_service` in the `from services import (...)` block.

`prompts.py` — in `build_dynamic_context`:

```python
_GAP_ACCURACY_MAX_GAPS = 8
_GAP_ACCURACY_CHAR_CAP = 600


def _gap_accuracy_label(profile_dict: dict, gap_accuracy: dict) -> str:
    confirmed = profile_dict.get("confirmed_gaps") or []
    scoped = {g: gap_accuracy[g] for g in confirmed if g in (gap_accuracy or {})}
    if not scoped:
        return "none"
    top = sorted(scoped.items(), key=lambda kv: kv[1].get("attempts", 0), reverse=True)
    top = top[:_GAP_ACCURACY_MAX_GAPS]
    label = json.dumps(dict(top))
    while len(label) > _GAP_ACCURACY_CHAR_CAP and len(top) > 1:
        top = top[:-1]
        label = json.dumps(dict(top))
    return label
```

and add to the returned block (pick the line position once):

```python
        f"PENDING_CHECK: {pc_label}\n"
        f"GAP_ACCURACY: {_gap_accuracy_label(profile_dict, state.get('gap_accuracy') or {})}\n"
        f"QUIZ_READINESS: {qr_label}\n"
```

CHECK: slice 2's P1 prefix-stability test asserts the first N chars of the system prompt are constant — `build_dynamic_context` is entirely in the dynamic suffix, so adding a line is safe; run that test to confirm (grep `prefix` in tests/test_prompts.py).

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_prompts.py tests/test_chat_prepare_perf.py tests/test_chat.py -v` and the learning-event test file.
Expected: ALL PASS — including `test_prepare_turn_budget_with_gaps` at exactly 7.

- [ ] **Step 5: Commit**

```bash
git add services/learning_event_service.py routes/chat.py agent/prompts.py tests/
git commit -m "feat(d1): per-gap accuracy aggregate rendered as capped GAP_ACCURACY block"
```

---

### Task 10: D1 reliability eval script (owed paid gate)

**Files:**
- Create: `backend/scripts/eval_missed_concept_reference.py`
- Test: none automated (paid script); a `--dry-run` smoke assertion only.

**Interfaces:**
- Consumes: the pattern of `backend/scripts/eval_focus_clearing.py` (scripted patterns, replicates, >=85% threshold, appends findings to an analysis file).
- Produces: runnable script for the post-merge paid gate.

- [ ] **Step 1: Write the script**

Copy the structure of `eval_focus_clearing.py` (argparse `--replicates`, backend sys.path bootstrap, per-pattern loop, PASS threshold >=85%). Scenario per spec D1 AC3: seed a session whose `quiz_cooldown_json` carries a missed item (`{"gap": "fractions", "last_score": "0/1", "missed": [{"question": "What is 1/2 + 1/4?", "chosen": "2/6", "correct": "3/4"}]}`) and whose profile has `confirmed_gaps=["fractions"]` plus a `gap_accuracy`-visible failed event; send the user message "can you explain that again?"; PASS for a replicate when the tutor's reply references the missed concept (case-insensitive substring match on the chosen-vs-correct texts or the question stem — e.g. any of `"2/6"`, `"3/4"`, `"1/2 + 1/4"`). Write results to `analysis/d1_missed_concept_eval.md` (append a history block per run, same as the reference script). Include a `--dry-run` flag that builds the prompt and asserts the seeded missed detail appears in the system prompt without calling the LLM (free smoke).

- [ ] **Step 2: Run the free smoke**

Run: `python scripts/eval_missed_concept_reference.py --dry-run`
Expected: prints the assembled QUIZ_READINESS/GAP_ACCURACY lines and exits 0. (The paid `--replicates` run is the owed post-merge gate — do NOT run it.)

- [ ] **Step 3: Commit**

```bash
git add scripts/eval_missed_concept_reference.py
git commit -m "feat(d1): missed-concept-reference eval script (paid run owed post-merge)"
```

---

### Task 11: full suite, lint, docs status, wrap-up

**Files:**
- Modify: `docs/planning/2026-07-06-10x-roadmap.md` (P3/D1 status lines)
- Modify: `docs/superpowers/specs/2026-07-08-roadmap-slice4-design.md` (only if reality diverged; record deviations)

- [ ] **Step 1: Full backend suite**

Run: `pytest -q`
Expected: 0 failures. Coverage gate (75%) must hold — new code paths are all test-covered by Tasks 1-10.

- [ ] **Step 2: Lint / static checks used by CI**

Run: `ruff check .` (or the repo's configured linter — check `.github/workflows/ci.yml` backend job) from `backend/`.
Expected: clean.

- [ ] **Step 3: Update roadmap status lines**

Add "Status: in PR (`feat/roadmap-slice4`)" blocks under P3 and D1 in `docs/planning/2026-07-06-10x-roadmap.md`, mirroring the slice 1-3 status-line style, including: P3 AC1 budget 6/7 (deviation from <=3 recorded in spec), AC2 lazy-cancel tokenization, AC3 kept-synchronous decision, AC4 debug_timing; D1 AC1 missed detail, AC2 GAP_ACCURACY, AC3 eval script committed / paid run owed.

- [ ] **Step 4: Capture before/after numbers**

Run locally with `DEBUG_TIMING=1 LLM_STUB=1` against the dev DB: one chat turn before the refactor is not re-measurable now — use the Task 1 RED-run statement counts (recorded in the test failure output at Task 1 Step 2) as "before", and the passing counts + a `prepare_ms` log line as "after". Put both in the PR description.

- [ ] **Step 5: Commit docs + push**

```bash
git add docs/
git commit -m "docs: slice 4 status lines (P3/D1) + spec deviations"
git push -u origin feat/roadmap-slice4
```

---

## Self-review notes (already applied)

- Spec coverage: P3.1 -> Tasks 1-5; P3.2 -> Task 6; P3.3 -> no code (spec records rationale); P3.4 -> Task 7; D1.1 -> Task 8; D1.2 -> Task 9; D1 AC3 -> Task 10; AC8 suite -> Task 11.
- Type consistency: `check_cap_from_spend`/`spend_subquery` (Task 2) consumed in Task 5; `*_from_row` + `status_from_counts` (Task 4) consumed in Task 5; `gap_accuracy` name used identically in Task 9's service, route, and prompt layers.
- Known judgment points for implementers: exact SQLAlchemy shape of the no-FROM combined guard SELECT (two acceptable shapes given in Task 5); Row-API attribute access; fixture names in each test file. All bounded with fallbacks stated inline.
