# Quiz-Loop Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the tutor auto-re-quizzing after a check batch — make it re-teach on misses, end the loop on all-correct, and add a soft readiness nudge plus one deterministic hard floor on the synthetic follow-up turn.

**Architecture:** A new ephemeral `quiz_cooldown_json` column on the session row (mirrors `pending_check_json`) records the last batch outcome when it had a miss/skip. `build_dynamic_context` surfaces it as a `QUIZ_READINESS` line; new POST-QUIZ PROTOCOL prose in `IMMUTABLE_RULES` is the behavioral lever. A `suppress_check` flag on `ToolContext` lets `complete_check` hard-block `ask_check_questions` on the one server-injected follow-up turn.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Pydantic (contracts), pytest. Backend only — no frontend, no contract/openapi changes.

**Spec:** `docs/superpowers/specs/2026-06-05-quiz-loop-readiness-design.md`

**Branch:** `feat/quiz-loop-readiness` (already created off dev; spec committed at `bd21900`).

**Conventions to follow:**
- No emojis in code/comments.
- Run backend tests from `backend/` with `python -m pytest -q -p no:cacheprovider --no-header -o addopts="" <target>` (the `-o addopts=""` disables the coverage gate so a single-file run does not fail on threshold).
- TDD: failing test first, minimal code, green, commit.

---

## File Structure

- `backend/db/models.py` — add `quiz_cooldown_json` column to `Session` (modify).
- `backend/db/alembic/versions/0006_quiz_cooldown.py` — migration for the new column (create).
- `backend/services/check_question_service.py` — add cooldown helpers + `build_quiz_cooldown` + a `suppress_check` guard in `register` (modify).
- `backend/agent/types.py` — add `suppress_check: bool = False` to `ToolContext` (modify).
- `backend/agent/prompts.py` — render `QUIZ_READINESS`; add POST-QUIZ PROTOCOL block (modify).
- `backend/routes/sessions.py` — set cooldown + `suppress_check=True` + thread `quiz_cooldown` in `complete_check` (modify).
- `backend/routes/chat.py` — thread `quiz_cooldown` into `prompt_state` (modify).
- Tests: `backend/tests/test_quiz_cooldown_service.py` (create), `backend/tests/test_prompts.py` (modify), `backend/tests/test_check_question_service.py` or new (suppress_check), `backend/tests/test_check_complete_route.py` (modify).

---

## Task 1: Add `quiz_cooldown_json` column + migration

**Files:**
- Modify: `backend/db/models.py` (Session model, near `pending_check_json` at line 37)
- Create: `backend/db/alembic/versions/0006_quiz_cooldown.py`
- Test: `backend/tests/test_quiz_cooldown_service.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_quiz_cooldown_service.py`:

```python
"""TDD: sessions.quiz_cooldown_json column + cooldown helpers."""
import uuid

import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db.database import Base
import db.models  # noqa: F401 - registers models on Base.metadata
from db.models import Session as SessionModel, User


def _make_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_session_has_quiz_cooldown_column():
    db = _make_session()
    cols = {c["name"] for c in inspect(db.get_bind()).get_columns("sessions")}
    assert "quiz_cooldown_json" in cols
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest -q -p no:cacheprovider --no-header -o addopts="" tests/test_quiz_cooldown_service.py::test_session_has_quiz_cooldown_column`
Expected: FAIL — `quiz_cooldown_json` not in columns.

- [ ] **Step 3: Add the column to the model**

In `backend/db/models.py`, inside `class Session`, directly after the `pending_check_json` line (line 37), add:

```python
    quiz_cooldown_json: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest -q -p no:cacheprovider --no-header -o addopts="" tests/test_quiz_cooldown_service.py::test_session_has_quiz_cooldown_column`
Expected: PASS.

- [ ] **Step 5: Create the Alembic migration**

Create `backend/db/alembic/versions/0006_quiz_cooldown.py`:

```python
# backend/db/alembic/versions/0006_quiz_cooldown.py
"""add sessions.quiz_cooldown_json

Revision ID: 0006_quiz_cooldown
Revises: 0005_pending_check
Create Date: 2026-06-05

Adds a nullable Text column `quiz_cooldown_json` to sessions. Records the last
resolved check batch that had a miss/skip, so the tutor sees a QUIZ_READINESS
hint across re-teaching turns (the pending_check is cleared on completion).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_quiz_cooldown"
down_revision: Union[str, None] = "0005_pending_check"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("quiz_cooldown_json", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sessions", "quiz_cooldown_json")
```

- [ ] **Step 6: Commit**

```bash
git add backend/db/models.py backend/db/alembic/versions/0006_quiz_cooldown.py backend/tests/test_quiz_cooldown_service.py
git commit -m "feat(db): add sessions.quiz_cooldown_json column + migration 0006"
```

---

## Task 2: Cooldown helpers + `build_quiz_cooldown`

`build_quiz_cooldown(pc)` derives the cooldown dict from a resolved batch, returning `None` when every item was answered correctly (no miss, no skip). `set/get/clear_quiz_cooldown` mirror the `pending_check` helpers but operate on `quiz_cooldown_json`.

**Files:**
- Modify: `backend/services/check_question_service.py`
- Test: `backend/tests/test_quiz_cooldown_service.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_quiz_cooldown_service.py`:

```python
from services import check_question_service as cqs


def _seed_session(db, sid="s1", uid="u1"):
    db.add(User(id=uid))
    db.add(SessionModel(id=sid, user_id=uid, topic="t", topic_profile_json="{}"))
    db.commit()


def _resolved_pc(results):
    """results: list of 'correct' | 'wrong' | 'skip'."""
    items = []
    for n, r in enumerate(results):
        items.append({
            "question": f"q{n}",
            "options": ["a", "b"],
            "correct_index": 0,
            "explanation": "e",
            "status": "skipped" if r == "skip" else "answered",
            "selected_index": None if r == "skip" else (0 if r == "correct" else 1),
            "correct": None if r == "skip" else (r == "correct"),
        })
    return {"gap": "derivatives", "current_index": len(items), "asked_at_turn": "2026-06-05T00:00:00", "items": items}


def test_build_quiz_cooldown_none_when_all_correct():
    pc = _resolved_pc(["correct", "correct"])
    assert cqs.build_quiz_cooldown(pc) is None


def test_build_quiz_cooldown_set_on_miss():
    pc = _resolved_pc(["correct", "wrong"])
    cd = cqs.build_quiz_cooldown(pc)
    assert cd == {"gap": "derivatives", "last_score": "1/2", "missed": ["q1"]}


def test_build_quiz_cooldown_set_on_skip():
    pc = _resolved_pc(["correct", "skip"])
    cd = cqs.build_quiz_cooldown(pc)
    assert cd is not None
    assert cd["gap"] == "derivatives"
    assert cd["last_score"] == "1/1"  # graded excludes skips


def test_set_get_clear_quiz_cooldown_roundtrip():
    db = _make_session()
    _seed_session(db)
    assert cqs.get_quiz_cooldown(db, "s1") is None
    cqs.set_quiz_cooldown(db, "s1", {"gap": "g", "last_score": "0/1", "missed": ["q0"]})
    assert cqs.get_quiz_cooldown(db, "s1") == {"gap": "g", "last_score": "0/1", "missed": ["q0"]}
    cqs.set_quiz_cooldown(db, "s1", None)
    assert cqs.get_quiz_cooldown(db, "s1") is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest -q -p no:cacheprovider --no-header -o addopts="" tests/test_quiz_cooldown_service.py`
Expected: FAIL — `build_quiz_cooldown`/`get_quiz_cooldown`/`set_quiz_cooldown` undefined.

- [ ] **Step 3: Implement the helpers**

In `backend/services/check_question_service.py`, add after `build_results_summary` (end of file):

```python
def build_quiz_cooldown(pc: dict) -> dict | None:
    """Derive a quiz_cooldown record from a resolved batch.

    Returns None when every item was answered correctly (no miss, no skip) -
    an all-correct batch means the gap is mastered and the loop should end.
    `last_score` is n_correct over GRADED (answered) items, matching
    build_results_summary; skipped items count toward triggering the cooldown
    but not toward the score."""
    items = pc.get("items", [])
    graded = [it for it in items if it["status"] == "answered"]
    n_correct = sum(1 for it in graded if it.get("correct"))
    has_miss = any(it["status"] == "skipped" for it in items) or n_correct < len(graded)
    if not has_miss:
        return None
    missed = [it["question"] for it in graded if not it.get("correct")]
    return {
        "gap": pc["gap"],
        "last_score": f"{n_correct}/{len(graded)}",
        "missed": missed,
    }


def get_quiz_cooldown(db: Session, session_id: str) -> dict | None:
    row = db.get(SessionModel, session_id)
    if row is None or not row.quiz_cooldown_json:
        return None
    try:
        data = json.loads(row.quiz_cooldown_json)
    except (ValueError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def set_quiz_cooldown(db: Session, session_id: str, cd: dict | None, commit: bool = True) -> None:
    row = db.get(SessionModel, session_id)
    if row is None:
        raise ValueError(f"session not found: {session_id}")
    row.quiz_cooldown_json = json.dumps(cd) if cd is not None else None
    if commit:
        db.commit()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest -q -p no:cacheprovider --no-header -o addopts="" tests/test_quiz_cooldown_service.py`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/check_question_service.py backend/tests/test_quiz_cooldown_service.py
git commit -m "feat(check): quiz_cooldown helpers + build_quiz_cooldown (None on all-correct)"
```

---

## Task 3: Render `QUIZ_READINESS` in dynamic context

**Files:**
- Modify: `backend/agent/prompts.py` (`build_dynamic_context`)
- Test: `backend/tests/test_prompts.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_prompts.py`:

```python
def test_quiz_readiness_ready_when_no_cooldown():
    out = prompts.build_dynamic_context({"topic": "x"})
    assert "QUIZ_READINESS: ready" in out


def test_quiz_readiness_cooling_down_with_cooldown():
    state = {
        "topic": "x",
        "quiz_cooldown": {"gap": "derivatives", "last_score": "1/2", "missed": ["q1"]},
    }
    out = prompts.build_dynamic_context(state)
    assert '"status": "cooling_down"' in out
    assert '"gap": "derivatives"' in out
    assert '"last_score": "1/2"' in out
```

(If `test_prompts.py` does not already `import prompts` / `from agent import prompts`, match the existing import style in that file.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest -q -p no:cacheprovider --no-header -o addopts="" tests/test_prompts.py -k quiz_readiness`
Expected: FAIL — no `QUIZ_READINESS` line.

- [ ] **Step 3: Render the line**

In `backend/agent/prompts.py`, inside `build_dynamic_context`, after the `pending_check` / `pc_label` block and before the `return`, add:

```python
    quiz_cooldown = state.get("quiz_cooldown")
    if quiz_cooldown:
        qr_label = json.dumps(
            {
                "gap": quiz_cooldown.get("gap"),
                "last_score": quiz_cooldown.get("last_score"),
                "status": "cooling_down",
            }
        )
    else:
        qr_label = "ready"
```

Then append `QUIZ_READINESS` to the returned f-string (after the `PENDING_CHECK` line):

```python
        f"PENDING_CHECK: {pc_label}\n"
        f"QUIZ_READINESS: {qr_label}"
```

(Move the existing trailing newline/format so `PENDING_CHECK` ends with `\n` and `QUIZ_READINESS` is last.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest -q -p no:cacheprovider --no-header -o addopts="" tests/test_prompts.py -k quiz_readiness`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agent/prompts.py backend/tests/test_prompts.py
git commit -m "feat(prompts): render QUIZ_READINESS line in dynamic context"
```

---

## Task 4: POST-QUIZ PROTOCOL in `IMMUTABLE_RULES`

**Files:**
- Modify: `backend/agent/prompts.py` (`IMMUTABLE_RULES`)
- Test: `backend/tests/test_prompts.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_prompts.py`:

```python
def test_immutable_rules_has_post_quiz_protocol():
    rules = prompts.IMMUTABLE_RULES
    assert "POST-QUIZ PROTOCOL" in rules
    # all-correct must end the loop
    assert "do NOT re-quiz the same gap" in rules
    # insist overrides the nudge
    assert "insist" in rules.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest -q -p no:cacheprovider --no-header -o addopts="" tests/test_prompts.py::test_immutable_rules_has_post_quiz_protocol`
Expected: FAIL.

- [ ] **Step 3: Add the protocol block**

In `backend/agent/prompts.py`, inside the `IMMUTABLE_RULES` string, add this block immediately AFTER the existing `CHECK-QUESTION PROTOCOL` block (before `RETRIEVAL POLICY`):

```
POST-QUIZ PROTOCOL:
- After a batch resolves you receive a "[check results]" summary as the latest
  user turn. Address those results FIRST. Do NOT immediately call
  ask_check_questions again.
- If the learner missed or skipped items: re-teach the missed concept(s) in
  plain language, then offer (do not force) another check when they seem ready.
- If every answer was correct: acknowledge the mastery, move the conversation
  forward, and do NOT re-quiz the same gap. The quiz loop ends here.
- QUIZ_READINESS carries the last quiz outcome for a gap. "cooling_down" means
  the learner recently missed items on that gap; treat it as judgment input,
  not a hard rule.
- If the learner asks to be quizzed while QUIZ_READINESS shows "cooling_down"
  for that gap, you may note that a quick recap could help first. If the learner
  insists ("just quiz me"), quiz them. The learner stays in control.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest -q -p no:cacheprovider --no-header -o addopts="" tests/test_prompts.py::test_immutable_rules_has_post_quiz_protocol`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agent/prompts.py backend/tests/test_prompts.py
git commit -m "feat(prompts): add POST-QUIZ PROTOCOL (re-teach, all-correct ends loop, insist overrides)"
```

---

## Task 5: `suppress_check` flag + hard-floor guard in `register`

**Files:**
- Modify: `backend/agent/types.py` (`ToolContext`)
- Modify: `backend/services/check_question_service.py` (`register`)
- Test: `backend/tests/test_quiz_cooldown_service.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_quiz_cooldown_service.py`:

```python
from datetime import datetime, timezone

from agent.types import ToolContext
from contracts import AskCheckQuestionsArgs


def _one_item_args(sid="s1"):
    return AskCheckQuestionsArgs(
        session_id=sid,
        gap="derivatives",
        items=[{
            "question": "q0",
            "options": ["a", "b"],
            "correct_index": 0,
            "explanation": "e",
        }],
    )


def test_register_blocked_when_suppress_check():
    db = _make_session()
    _seed_session(db)
    ctx = ToolContext(
        db=db, session_id="s1", user_id="u1",
        turn_started_at=datetime.now(timezone.utc), suppress_check=True,
    )
    res = cqs.register(db, ctx, _one_item_args())
    assert res.ok is False
    assert cqs.get_pending_check(db, "s1") is None  # no batch opened


def test_register_allowed_when_not_suppressed():
    db = _make_session()
    _seed_session(db)
    ctx = ToolContext(
        db=db, session_id="s1", user_id="u1",
        turn_started_at=datetime.now(timezone.utc),
    )
    res = cqs.register(db, ctx, _one_item_args())
    assert res.ok is True
    assert cqs.get_pending_check(db, "s1") is not None
```

(Match `AskCheckQuestionsArgs` construction to the real contract — if items require a Pydantic sub-model rather than a dict, import and use it. Verify against `backend/contracts/models.py`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest -q -p no:cacheprovider --no-header -o addopts="" tests/test_quiz_cooldown_service.py -k register`
Expected: FAIL — `ToolContext` has no `suppress_check`.

- [ ] **Step 3: Add the flag**

In `backend/agent/types.py`, add a field to `ToolContext`:

```python
@dataclass
class ToolContext:
    db: Session
    session_id: str
    user_id: str
    turn_started_at: datetime
    suppress_check: bool = False
```

- [ ] **Step 4: Add the guard in `register`**

In `backend/services/check_question_service.py`, at the TOP of `register` (before the `session_id` mismatch check), add:

```python
    if getattr(ctx, "suppress_check", False):
        return ToolResult(
            ok=False, status="failed",
            error="address the check results before quizzing again",
        )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest -q -p no:cacheprovider --no-header -o addopts="" tests/test_quiz_cooldown_service.py -k register`
Expected: PASS (both).

- [ ] **Step 6: Commit**

```bash
git add backend/agent/types.py backend/services/check_question_service.py backend/tests/test_quiz_cooldown_service.py
git commit -m "feat(check): suppress_check ToolContext flag blocks ask_check_questions on follow-up turn"
```

---

## Task 6: Thread cooldown + hard floor into `complete_check`

**Files:**
- Modify: `backend/routes/sessions.py` (`complete_check`, around lines 332-366)
- Test: `backend/tests/test_check_complete_route.py`

- [ ] **Step 1: Write the failing tests**

`test_check_complete_route.py` already has `seeded_session`, `_resolved_batch` (registers + answers CORRECTLY), `_make_fake_run_streaming`, and posts via `client.post(f"/api/sessions/{sid}/check/complete", json={"user_id": USER_ID})`. The route shares `db_session`, so `get_quiz_cooldown(db_session, sid)` sees the route's commit. Append:

```python
def _resolved_batch_miss(db, sid):
    """Same as _resolved_batch but answers WRONG (selected_index=1, correct=0)."""
    ctx = ToolContext(db=db, session_id=sid, user_id=USER_ID,
                      turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    check_question_service.register(db, ctx, AskCheckQuestionsArgs(
        session_id=sid, gap="atp",
        items=[{"question": "Q1?", "options": ["a", "b"],
                "correct_index": 0, "explanation": "a."}]))
    check_question_service.answer(db, sid, index=0, selected_index=1)


def test_complete_sets_quiz_cooldown_on_miss(client, db_session, seeded_session, monkeypatch):
    sid = seeded_session.id
    _resolved_batch_miss(db_session, sid)
    monkeypatch.setattr("agent.tutor.run_streaming",
                        _make_fake_run_streaming(db_session, sid))
    r = client.post(f"/api/sessions/{sid}/check/complete", json={"user_id": USER_ID})
    assert r.status_code == 200
    cd = check_question_service.get_quiz_cooldown(db_session, sid)
    assert cd is not None
    assert cd["gap"] == "atp"
    assert cd["last_score"] == "0/1"


def test_complete_no_cooldown_on_all_correct(client, db_session, seeded_session, monkeypatch):
    sid = seeded_session.id
    _resolved_batch(db_session, sid)  # answers correctly
    monkeypatch.setattr("agent.tutor.run_streaming",
                        _make_fake_run_streaming(db_session, sid))
    r = client.post(f"/api/sessions/{sid}/check/complete", json={"user_id": USER_ID})
    assert r.status_code == 200
    assert check_question_service.get_quiz_cooldown(db_session, sid) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest -q -p no:cacheprovider --no-header -o addopts="" tests/test_check_complete_route.py -k cooldown`
Expected: FAIL — cooldown not set (helper not called yet).

- [ ] **Step 3: Wire `complete_check`**

In `backend/routes/sessions.py`, in `complete_check`, change the summary/clear block (currently lines 336-337):

```python
    summary = check_question_service.build_results_summary(pc)
    check_question_service.clear_pending_check(db, session_id)
```

to:

```python
    summary = check_question_service.build_results_summary(pc)
    cooldown = check_question_service.build_quiz_cooldown(pc)
    check_question_service.clear_pending_check(db, session_id)
    check_question_service.set_quiz_cooldown(db, session_id, cooldown)
```

Add `"quiz_cooldown": cooldown` to the `prompt_state` dict (alongside `"pending_check": None`):

```python
    prompt_state = {
        "topic": row.topic,
        "profile": profile,
        "ingestion_status": ingestion_status,
        "retrieval_required": False,
        "seed_mode": None,
        "last_session_summary": profile.last_session_summary,
        "pending_check": None,
        "quiz_cooldown": cooldown,
    }
```

Set `suppress_check=True` on the `ToolContext` (currently lines 361-366):

```python
    ctx = ToolContext(
        db=db,
        session_id=session_id,
        user_id=user_id,
        turn_started_at=datetime.now(timezone.utc),
        suppress_check=True,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest -q -p no:cacheprovider --no-header -o addopts="" tests/test_check_complete_route.py`
Expected: PASS (new cooldown tests + existing route tests still green).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/sessions.py backend/tests/test_check_complete_route.py
git commit -m "feat(sessions): complete_check sets quiz_cooldown + suppress_check hard floor"
```

---

## Task 7: Thread cooldown into the normal chat turn

**Files:**
- Modify: `backend/routes/chat.py` (the `prompt_state` in the shared turn-prep, around line 99 — used by both `/chat` and `/chat/stream`)
- Test: `backend/tests/test_chat_stream_route.py`

Note: ensure the `quiz_cooldown` threading goes into the SHARED turn-prep `prompt_state` (the one at ~line 99 that builds `system_prompt` for both routes), so the stream route picks it up too.

- [ ] **Step 1: Write the failing test**

`test_chat_stream_route.py` already defines `SESSION_ID`, `USER_ID`, `AUTH_HEADERS`, an autouse `seed_session(db_session)` fixture, and monkeypatches `agent.tutor.run_streaming`. The fake's signature is `fake(messages, system_prompt, ctx)` — capture `system_prompt`. Append:

```python
def test_chat_stream_includes_quiz_readiness(client, db_session, monkeypatch):
    from services import check_question_service
    check_question_service.set_quiz_cooldown(
        db_session, SESSION_ID, {"gap": "joins", "last_score": "0/1", "missed": ["q0"]}
    )

    captured = {}

    async def fake(messages, system_prompt, ctx):
        captured["system_prompt"] = system_prompt
        yield StreamEvent("done", {"message_id": "1"})

    monkeypatch.setattr("agent.tutor.run_streaming", fake)

    with client.stream(
        "POST", "/api/chat/stream",
        json={"session_id": SESSION_ID, "message": "hello"},
        headers=AUTH_HEADERS,
    ) as resp:
        assert resp.status_code == 200
        for _ in resp.iter_lines():
            pass

    assert "cooling_down" in captured["system_prompt"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest -q -p no:cacheprovider --no-header -o addopts="" tests/test_chat_stream_route.py -k quiz_readiness`
Expected: FAIL — `quiz_cooldown` not threaded, so the prompt shows `QUIZ_READINESS: ready`.

- [ ] **Step 3: Thread it**

In `backend/routes/chat.py`, in the `prompt_state` dict (around line 99-107), add a `quiz_cooldown` key:

```python
    prompt_state = {
        "topic": session.topic,
        "profile": profile,
        "ingestion_status": ingestion_status,
        "retrieval_required": retrieval_required,
        "seed_mode": None,
        "last_session_summary": profile.last_session_summary,
        "pending_check": check_question_service.get_pending_check(db, req.session_id),
        "quiz_cooldown": check_question_service.get_quiz_cooldown(db, req.session_id),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest -q -p no:cacheprovider --no-header -o addopts="" tests/test_chat_stream_route.py -k quiz_readiness`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/chat.py backend/tests/test_chat_stream_route.py
git commit -m "feat(chat): thread quiz_cooldown into turn prompt_state"
```

---

## Task 8: Full-suite regression + push

- [ ] **Step 1: Run the entire backend suite**

Run: `python -m pytest -q -p no:cacheprovider --no-header -o addopts=""`
Expected: all pass (274 baseline + the new tests added here).

- [ ] **Step 2: If anything is red, fix before proceeding.** Do not push a red suite. Common culprit: a `test_prompts.py` assertion that pinned the exact `build_dynamic_context` output string (the new `QUIZ_READINESS` line changes it) — update that assertion to include the new trailing line.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/quiz-loop-readiness
```

- [ ] **Step 4: Stop and report.** Summarize: tasks complete, suite green, branch pushed. Then hand off to a live-LLM smoke test (below) before opening a PR — the behavioral rules (re-teach, all-correct-ends, insist-override) are prompt-compliance and need a real model run, mirroring the prior check-question reliability checkpoints.

---

## Manual smoke (post-implementation, requires paid live LLM)

Not an automated task — run interactively in the app:

1. Start a session, get the tutor to open a batch, answer at least one item WRONG, finish the batch.
2. Verify the follow-up turn RE-TEACHES (does not immediately open a new batch). The hard floor guarantees no instant re-quiz; confirm the tutor's prose actually teaches.
3. Continue the conversation; verify `QUIZ_READINESS` cooling_down influences the tutor (it waits / offers recap) but a direct "just quiz me" still produces a batch.
4. Run a batch with ALL correct; verify the tutor acknowledges mastery and does NOT re-quiz the same gap (the loop ends).

If step 2 or 4 fails on prose (tutor teaches poorly or re-quizzes anyway on a real turn): iterate the POST-QUIZ PROTOCOL wording (2-3 passes), then escalate model per the CLAUDE.md reliability-checkpoint rule. The hard floor on the follow-up turn is deterministic and should never regress.

---

## Self-Review Notes (author)

- **Spec coverage:** Task 1 (state column) + Task 2 (helpers, all-correct→None) + Task 3 (QUIZ_READINESS) + Task 4 (POST-QUIZ PROTOCOL prose incl. all-correct-ends + insist) + Task 5/6 (section 8 hard floor: flag + guard + complete_check wiring) + Task 6/7 (threading 3 sites: complete_check, chat.py, build_dynamic_context). All spec sections mapped.
- **Type consistency:** cooldown dict shape `{gap, last_score, missed}` is identical across `build_quiz_cooldown`, `set/get_quiz_cooldown`, the `QUIZ_READINESS` renderer, and both route prompt_states. Flag name `suppress_check` consistent across `ToolContext`, `register`, and `complete_check`.
- **Known adaptation points (not placeholders — real-codebase matching):** Tasks 6 and 7 tests must match the existing test modules' fixtures (`test_check_complete_route.py`, the chat-route test module) and the real `AskCheckQuestionsArgs` item sub-model. The executor verifies those against the live files; the production code edits are fully specified.
