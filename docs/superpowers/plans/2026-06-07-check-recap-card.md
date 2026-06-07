# Check-Question Recap Card in Chat History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a read-only recap card in chat history for every resolved check-question batch, showing each question, its options, the learner's pick, the correct answer, and the explanation.

**Architecture:** A new nullable `chat_messages.check_batch_json` column stores the resolved batch (`public_view` shape) on the asking assistant message. The batch is linked to that message via a new `message_id` field on the `pending_check` record; per-answer/complete writes stamp the JSON. The session serializer returns a `check_batch` field per message (from the column, else best-effort read-time reconstruction from `tool_calls_json` + `LearningEvent`). The frontend renders `CheckRecap.vue` in `AssistantBubble`. The live interactive `CheckQuestion.vue` is untouched; the open batch's message is suppressed from recap to prevent a double-render.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Pydantic v2 (codegen from OpenAPI), Vue 3 + Pinia, pytest, vitest.

**Source of truth:** `docs/superpowers/specs/2026-06-06-check-recap-card-design.md`.

**Branch:** `feat/check-recap-card` (already created).

---

## File Structure

**Backend**
- `backend/db/alembic/versions/0007_check_batch.py` — *create*. Migration adding `chat_messages.check_batch_json`.
- `backend/db/models.py` — *modify*. Add `check_batch_json` column to `ChatMessage`.
- `backend/services/check_question_service.py` — *modify*. `message_id` in pc; `attach_message_id`, `write_check_batch`, `reconstruct_check_batch`, `load_check_batch` helpers.
- `backend/agent/tutor.py` — *modify*. Streaming path calls `attach_message_id` after persisting the asking message.
- `backend/routes/sessions.py` — *modify*. `answer`/`skip`/`complete` write the batch; serializer returns `check_batch` and suppresses the open batch's message.
- `docs/api/openapi.yaml` — *modify*. Add `check_batch` to `Message` (reuses `PendingCheck`).
- `backend/contracts/` — *regenerated* (do not hand-edit).

**Frontend**
- `frontend/src/components/chat/CheckRecap.vue` — *create*. Read-only recap card.
- `frontend/src/stores/session.js` — *modify*. Map `check_batch` (snake → camelCase) onto each message in `loadSession`.
- `frontend/src/components/chat/AssistantBubble.vue` — *modify*. Render `CheckRecap`, suppress chip row + empty pill when present.

**CI**
- `.github/codeql/codeql-config.yml` — *create*. `paths-ignore` for alembic versions.
- `.github/workflows/codeql.yml` — *modify*. Wire the config into the init step.

**Tests**
- `backend/tests/test_check_batch_persistence.py` — *create*. Service helpers + reconstruct.
- `backend/tests/test_check_answer_route.py`, `test_check_skip_route.py`, `test_check_complete_route.py` — *modify*. Assert `check_batch_json` is written.
- `backend/tests/test_session_detail_check_batch.py` — *create*. Serializer returns `check_batch`; open batch suppressed; backfill.
- `frontend/src/__tests__/checkRecap.test.js` — *create*. `CheckRecap.vue` branches.
- `frontend/src/__tests__/assistantBubble.test.js` — *create or modify*. Recap render + chip/pill suppression.

**Notes that are not tasks:**
- The non-streaming `run()` path (chat route fallback) does NOT attach a `message_id` — streaming is primary. Non-streaming asks rely on read-time reconstruction (`selected_index` lost → "answer not recorded"). This is acceptable per spec.
- The store keeps the camelCase item shape (mirrors `pendingCheck`) so `CheckRecap` props match `CheckQuestion` conventions.

---

### Task 1: Contract — add `check_batch` to `Message`

**Files:**
- Modify: `docs/api/openapi.yaml:643-660` (`Message` schema)
- Regenerate: `backend/contracts/models.py`

- [ ] **Step 1: Edit the OpenAPI `Message` schema**

In `docs/api/openapi.yaml`, inside `Message.properties` (after the `tool_calls` block, around line 660), add:

```yaml
        check_batch:
          oneOf:
            - $ref: "#/components/schemas/PendingCheck"
            - type: "null"
          default: null
```

Do NOT add `check_batch` to `Message.required`. It is additive + nullable.

- [ ] **Step 2: Regenerate contracts**

Run from repo root: `python backend/scripts/gen_contracts.py`
Expected: `ok: contracts written to .../backend/contracts/models.py`

- [ ] **Step 3: Verify the generated model has the field**

Run from `backend/`: `python -c "from contracts import Message; print('check_batch' in Message.model_fields)"`
Expected: `True`

- [ ] **Step 4: Verify no contract drift**

Run from `backend/`: `pytest tests/test_contract_drift.py -v` (or the existing drift test; search `pytest -k drift` if the path differs).
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts/
git commit -m "feat(contracts): add nullable check_batch to Message schema"
```

---

### Task 2: Migration 0007 + model column

**Files:**
- Create: `backend/db/alembic/versions/0007_check_batch.py`
- Modify: `backend/db/models.py:49-68` (`ChatMessage`)
- Test: `backend/tests/test_check_batch_persistence.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_check_batch_persistence.py`:

```python
"""Persistence of resolved check batches onto the asking ChatMessage."""

from datetime import datetime, timezone

import pytest

from contracts import AskCheckQuestionsArgs, TopicProfile
from agent.types import ToolContext
from db.models import ChatMessage, Session as SessionModel, User
from services import check_question_service


USER_ID = "u_batch_1"
SID = "s_batch_1"


@pytest.fixture
def seeded(db_session):
    db_session.add(User(id=USER_ID))
    db_session.add(SessionModel(
        id=SID, user_id=USER_ID, topic="bio",
        topic_profile_json=TopicProfile().model_dump_json(),
    ))
    db_session.commit()
    return db_session


def test_check_batch_json_column_roundtrips(seeded):
    db = seeded
    m = ChatMessage(session_id=SID, role="assistant", content="",
                    check_batch_json='{"gap": "atp"}')
    db.add(m)
    db.commit()
    db.refresh(m)
    assert m.check_batch_json == '{"gap": "atp"}'
```

- [ ] **Step 2: Run test to verify it fails**

Run from `backend/`: `pytest tests/test_check_batch_persistence.py::test_check_batch_json_column_roundtrips -v`
Expected: FAIL — `TypeError: 'check_batch_json' is an invalid keyword argument for ChatMessage`

- [ ] **Step 3: Add the model column**

In `backend/db/models.py`, in `ChatMessage` (after `cancelled_at`, line 66), add:

```python
    check_batch_json: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
```

- [ ] **Step 4: Write the migration**

Create `backend/db/alembic/versions/0007_check_batch.py`:

```python
# backend/db/alembic/versions/0007_check_batch.py
"""add chat_messages.check_batch_json

Revision ID: 0007_check_batch
Revises: 0006_quiz_cooldown
Create Date: 2026-06-07

Adds a nullable Text column `check_batch_json` to chat_messages. Persists the
resolved check-question batch (public_view JSON) onto the asking assistant
message so chat history can render a read-only recap card.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007_check_batch"
down_revision: Union[str, None] = "0006_quiz_cooldown"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "chat_messages",
        sa.Column("check_batch_json", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("chat_messages", "check_batch_json")
```

- [ ] **Step 5: Run test to verify it passes**

Run from `backend/`: `pytest tests/test_check_batch_persistence.py::test_check_batch_json_column_roundtrips -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/db/models.py backend/db/alembic/versions/0007_check_batch.py backend/tests/test_check_batch_persistence.py
git commit -m "feat(db): add chat_messages.check_batch_json column + migration 0007"
```

---

### Task 3: `message_id` on pending_check + `attach_message_id` + `write_check_batch`

**Files:**
- Modify: `backend/services/check_question_service.py` (imports; `register` pc dict ~line 146; new helpers)
- Test: `backend/tests/test_check_batch_persistence.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_check_batch_persistence.py`:

```python
def _register_batch(db, gap="atp"):
    ctx = ToolContext(db=db, session_id=SID, user_id=USER_ID,
                      turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    check_question_service.register(db, ctx, AskCheckQuestionsArgs(
        session_id=SID, gap=gap,
        items=[{"question": "Q1?", "options": ["a", "b"],
                "correct_index": 0, "explanation": "a is right."}]))


def test_register_pc_has_null_message_id(seeded):
    db = seeded
    _register_batch(db)
    pc = check_question_service.get_pending_check(db, SID)
    assert pc["message_id"] is None


def test_attach_message_id_stamps_open_pc(seeded):
    db = seeded
    _register_batch(db)
    m = ChatMessage(session_id=SID, role="assistant", content="")
    db.add(m)
    db.commit()
    db.refresh(m)
    check_question_service.attach_message_id(db, SID, m.id)
    pc = check_question_service.get_pending_check(db, SID)
    assert pc["message_id"] == m.id


def test_attach_message_id_noop_when_no_pc(seeded):
    db = seeded
    # No open batch — must not raise.
    check_question_service.attach_message_id(db, SID, 999)
    assert check_question_service.get_pending_check(db, SID) is None


def test_write_check_batch_persists_public_view(seeded):
    db = seeded
    _register_batch(db)
    m = ChatMessage(session_id=SID, role="assistant", content="")
    db.add(m)
    db.commit()
    db.refresh(m)
    check_question_service.attach_message_id(db, SID, m.id)
    check_question_service.answer(db, SID, index=0, selected_index=0)
    pc = check_question_service.get_pending_check(db, SID)
    check_question_service.write_check_batch(db, pc)
    db.refresh(m)
    import json
    data = json.loads(m.check_batch_json)
    assert data["gap"] == "atp"
    assert data["items"][0]["selected_index"] == 0
    assert data["items"][0]["correct"] is True


def test_write_check_batch_noop_without_message_id(seeded):
    db = seeded
    _register_batch(db)
    pc = check_question_service.get_pending_check(db, SID)
    # message_id is None — must be a no-op, no raise.
    check_question_service.write_check_batch(db, pc)
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_check_batch_persistence.py -v`
Expected: FAIL — `KeyError: 'message_id'` / `AttributeError: module ... has no attribute 'attach_message_id'`

- [ ] **Step 3: Add `message_id` to the registered pc**

In `backend/services/check_question_service.py`, in `register`, the `pc` dict (line 146-162), add `"message_id": None,` after `"asked_at_turn": ...`:

```python
    pc = {
        "gap": args.gap,
        "current_index": 0,
        "asked_at_turn": ctx.turn_started_at.isoformat(),
        "message_id": None,
        "items": [
```

- [ ] **Step 4: Add the helpers + imports**

In `backend/services/check_question_service.py`, extend the imports near the top:

```python
from sqlalchemy import select
from sqlalchemy.orm import Session

from contracts import AskCheckQuestionsArgs, ToolResult
from db.models import ChatMessage, LearningEvent, Session as SessionModel
```

(Add `select`, `ChatMessage`, `LearningEvent` to the existing import lines.)

Add these functions (place after `clear_pending_check`):

```python
def attach_message_id(db: Session, session_id: str, message_id: int) -> None:
    """Stamp the asking assistant message id onto the open pending_check.

    No-op when there is no open batch (older flow / race). Read-time backfill
    covers messages whose batch was never linked."""
    pc = get_pending_check(db, session_id)
    if pc is None:
        return
    pc["message_id"] = message_id
    _save(db, session_id, pc)


def write_check_batch(db: Session, pc: dict | None) -> None:
    """Persist public_view(pc) JSON onto the linked ChatMessage.

    No-op when pc is falsy, carries no message_id, or the message is gone."""
    if not pc:
        return
    message_id = pc.get("message_id")
    if message_id is None:
        return
    msg = db.get(ChatMessage, message_id)
    if msg is None:
        log.debug("write_check_batch: message %s not found", message_id)
        return
    msg.check_batch_json = json.dumps(public_view(pc))
    db.commit()
```

Add a module logger near the top if not present:

```python
import logging

log = logging.getLogger(__name__)
```

- [ ] **Step 5: Run tests to verify they pass**

Run from `backend/`: `pytest tests/test_check_batch_persistence.py -v`
Expected: PASS (all tests in the file)

- [ ] **Step 6: Commit**

```bash
git add backend/services/check_question_service.py backend/tests/test_check_batch_persistence.py
git commit -m "feat(check): link batch to message + write_check_batch helper"
```

---

### Task 4: Read-time reconstruction (backfill) + `load_check_batch`

**Files:**
- Modify: `backend/services/check_question_service.py` (add `reconstruct_check_batch`, `load_check_batch`)
- Test: `backend/tests/test_check_batch_persistence.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_check_batch_persistence.py`:

```python
import json as _json
from db.models import LearningEvent


def test_reconstruct_from_tool_calls_and_event(seeded):
    db = seeded
    # Asking message with the ask_check_questions tool call, no check_batch_json.
    m = ChatMessage(
        session_id=SID, role="assistant", content="",
        tool_calls_json=_json.dumps([{
            "name": "ask_check_questions",
            "args": {"session_id": SID, "gap": "atp", "items": [
                {"question": "Q1?", "options": ["a", "b"],
                 "correct_index": 0, "explanation": "a is right."}]},
            "status": "ok", "error": None,
        }]),
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    # A graded LearningEvent created AFTER the ask.
    db.add(LearningEvent(session_id=SID, gap_tested="atp",
                         question="Q1?", correct=True))
    db.commit()

    batch = check_question_service.reconstruct_check_batch(db, m)
    assert batch["gap"] == "atp"
    item = batch["items"][0]
    assert item["status"] == "answered"
    assert item["correct"] is True
    assert item["selected_index"] is None
    assert item["correct_index"] == 0
    assert item["explanation"] == "a is right."


def test_reconstruct_skipped_when_no_event(seeded):
    db = seeded
    m = ChatMessage(
        session_id=SID, role="assistant", content="",
        tool_calls_json=_json.dumps([{
            "name": "ask_check_questions",
            "args": {"session_id": SID, "gap": "g", "items": [
                {"question": "Qx?", "options": ["a", "b"],
                 "correct_index": 1, "explanation": "b."}]},
            "status": "ok", "error": None,
        }]),
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    batch = check_question_service.reconstruct_check_batch(db, m)
    item = batch["items"][0]
    assert item["status"] == "skipped"
    assert item["correct"] is None
    assert item["selected_index"] is None


def test_reconstruct_none_without_ask_tool_call(seeded):
    db = seeded
    m = ChatMessage(session_id=SID, role="assistant", content="hi",
                    tool_calls_json="[]")
    db.add(m)
    db.commit()
    db.refresh(m)
    assert check_question_service.reconstruct_check_batch(db, m) is None


def test_load_check_batch_prefers_column(seeded):
    db = seeded
    m = ChatMessage(session_id=SID, role="assistant", content="",
                    check_batch_json='{"gap": "stored", "items": []}')
    db.add(m)
    db.commit()
    db.refresh(m)
    assert check_question_service.load_check_batch(db, m)["gap"] == "stored"


def test_load_check_batch_falls_through_on_malformed(seeded):
    db = seeded
    m = ChatMessage(session_id=SID, role="assistant", content="",
                    check_batch_json="{not json",
                    tool_calls_json="[]")
    db.add(m)
    db.commit()
    db.refresh(m)
    # Malformed column -> None, no ask tool call -> reconstruct returns None.
    assert check_question_service.load_check_batch(db, m) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_check_batch_persistence.py -k "reconstruct or load_check_batch" -v`
Expected: FAIL — `AttributeError: ... has no attribute 'reconstruct_check_batch'`

- [ ] **Step 3: Implement the helpers**

In `backend/services/check_question_service.py`, add:

```python
def reconstruct_check_batch(db: Session, msg: ChatMessage) -> dict | None:
    """Best-effort recap for an asking message with no persisted check_batch_json.

    Pulls question/options/correct_index/explanation from the message's
    ask_check_questions tool call. Joins LearningEvent by
    (session_id, gap_tested, question) for the FIRST event at or after this
    message's turn (deterministic when the same question recurs across turns).
    selected_index is unknowable -> None. status = answered if an event matched,
    else skipped."""
    try:
        tcs = json.loads(msg.tool_calls_json or "[]")
    except (ValueError, TypeError):
        return None
    ask = next((t for t in tcs if t.get("name") == "ask_check_questions"), None)
    if ask is None:
        return None
    args = ask.get("args") or {}
    gap = args.get("gap", "")
    raw_items = args.get("items", [])
    if not raw_items:
        return None

    items = []
    for it in raw_items:
        question = it.get("question", "")
        ev = db.execute(
            select(LearningEvent)
            .where(
                LearningEvent.session_id == msg.session_id,
                LearningEvent.gap_tested == gap,
                LearningEvent.question == question,
                LearningEvent.created_at >= msg.created_at,
            )
            .order_by(LearningEvent.created_at.asc())
            .limit(1)
        ).scalars().first()
        if ev is not None:
            status, correct = "answered", ev.correct
        else:
            status, correct = "skipped", None
        items.append({
            "question": question,
            "options": it.get("options", []),
            "status": status,
            "selected_index": None,
            "correct_index": it.get("correct_index"),
            "correct": correct,
            "explanation": it.get("explanation"),
        })

    return {
        "gap": gap,
        "current_index": len(items),
        "total": len(items),
        "items": items,
    }


def load_check_batch(db: Session, msg: ChatMessage) -> dict | None:
    """Recap payload for a message: persisted column first, else reconstruct."""
    if msg.check_batch_json:
        try:
            data = json.loads(msg.check_batch_json)
        except (ValueError, TypeError):
            data = None
        if isinstance(data, dict):
            return data
    return reconstruct_check_batch(db, msg)
```

- [ ] **Step 4: Run tests to verify they pass**

Run from `backend/`: `pytest tests/test_check_batch_persistence.py -v`
Expected: PASS (whole file)

- [ ] **Step 5: Commit**

```bash
git add backend/services/check_question_service.py backend/tests/test_check_batch_persistence.py
git commit -m "feat(check): read-time recap reconstruction + load_check_batch"
```

---

### Task 5: Tutor streaming attaches `message_id` after persisting the asking message

**Files:**
- Modify: `backend/agent/tutor.py` (import; `asked_check` persist block ~line 501-516)
- Test: `backend/tests/test_check_batch_persistence.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_check_batch_persistence.py`:

```python
import asyncio
from agent import tutor
from agent.stream_events import StreamEvent


def test_streaming_ask_attaches_message_id(seeded, monkeypatch):
    db = seeded

    async def fake_acompletion(*a, **k):
        raise AssertionError("LLM should not be called in this test")

    # Drive run_streaming through a stubbed iteration by registering the batch
    # via the real dispatch path is heavy; instead assert the wiring helper is
    # invoked. Simpler: register a batch, persist a message id via the same
    # call tutor makes, and confirm pc.message_id is set.
    ctx = ToolContext(db=db, session_id=SID, user_id=USER_ID,
                      turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    check_question_service.register(db, ctx, AskCheckQuestionsArgs(
        session_id=SID, gap="atp",
        items=[{"question": "Q1?", "options": ["a", "b"],
                "correct_index": 0, "explanation": "a."}]))

    msg_id = tutor._persist_assistant_message(ctx, "", "complete")
    check_question_service.attach_message_id(ctx.db, ctx.session_id, msg_id)

    pc = check_question_service.get_pending_check(db, SID)
    assert pc["message_id"] == msg_id
```

> Note: this test pins the wiring contract (`_persist_assistant_message` then `attach_message_id`). The end-to-end streaming path is exercised by `test_tutor_stream_check_events.py`; Step 5 below adds an assertion there.

- [ ] **Step 2: Run test to verify it fails**

Run from `backend/`: `pytest tests/test_check_batch_persistence.py::test_streaming_ask_attaches_message_id -v`

If this passes already (helpers exist from Tasks 2-3), it documents the contract — proceed to wire `tutor.py` so the streaming loop actually calls it.

- [ ] **Step 3: Wire `attach_message_id` into the streaming loop**

In `backend/agent/tutor.py`, add to the top-level imports (near `from services import cost_meter`):

```python
from services import check_question_service, cost_meter
```

In `run_streaming`, the `if asked_check:` block (around line 501-516), after `_persist_assistant_message(...)` returns `msg_id` and before `yield StreamEvent("done", ...)`:

```python
            if asked_check:
                msg_id = _persist_assistant_message(
                    ctx,
                    accumulated_text,
                    "complete",
                    tool_calls=tool_calls_record,
                    citations=citations,
                )
                check_question_service.attach_message_id(ctx.db, ctx.session_id, msg_id)
                yield StreamEvent("done", {"message_id": str(msg_id)})
                return
```

- [ ] **Step 4: Run test to verify it passes**

Run from `backend/`: `pytest tests/test_check_batch_persistence.py::test_streaming_ask_attaches_message_id -v`
Expected: PASS

- [ ] **Step 5: Guard the end-to-end streaming path**

In `backend/tests/test_tutor_stream_check_events.py`, find the test that drives `run_streaming` through a successful `ask_check_questions` and add, after collecting the `done` event:

```python
    pc = check_question_service.get_pending_check(db_session, <session_id_used_in_that_test>)
    assert pc is not None and pc["message_id"] is not None
```

(Import `check_question_service` in that file if not already imported. Use the same `db_session` / session id the test already uses.)

Run from `backend/`: `pytest tests/test_tutor_stream_check_events.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/agent/tutor.py backend/tests/test_check_batch_persistence.py backend/tests/test_tutor_stream_check_events.py
git commit -m "feat(tutor): attach message_id to batch after persisting asking message"
```

---

### Task 6: Routes write the batch on answer / skip / complete

**Files:**
- Modify: `backend/routes/sessions.py` (`answer_check` ~line 289, `skip_check` ~line 272, `complete_check` ~line 334-341)
- Test: `backend/tests/test_check_answer_route.py`, `test_check_skip_route.py`, `test_check_complete_route.py`

- [ ] **Step 1: Write the failing test (answer route)**

In `backend/tests/test_check_answer_route.py`, add a test asserting the asking message gets `check_batch_json` after a `/check/answer`. Pattern (adapt to the file's existing fixtures — it already seeds a session and an open batch):

```python
import json
from db.models import ChatMessage
from services import check_question_service


def test_answer_writes_check_batch_to_message(client, db_session, <existing_open_batch_fixture>):
    sid = <session id from fixture>
    # Link the open batch to an asking message (tutor does this in prod).
    m = ChatMessage(session_id=sid, role="assistant", content="")
    db_session.add(m)
    db_session.commit()
    db_session.refresh(m)
    check_question_service.attach_message_id(db_session, sid, m.id)

    r = client.post(f"/api/sessions/{sid}/check/answer",
                    json={"index": 0, "selected_index": 0})
    assert r.status_code == 200

    db_session.refresh(m)
    data = json.loads(m.check_batch_json)
    assert data["items"][0]["status"] == "answered"
    assert data["items"][0]["selected_index"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run from `backend/`: `pytest tests/test_check_answer_route.py::test_answer_writes_check_batch_to_message -v`
Expected: FAIL — `check_batch_json` is `None`

- [ ] **Step 3: Wire the answer + skip routes**

In `backend/routes/sessions.py`, in `answer_check`, after the `result = check_question_service.answer(...)` call (line 300) and before the return:

```python
    check_question_service.write_check_batch(
        db, check_question_service.get_pending_check(db, session_id)
    )
    return CheckAnswerResponse(**result)
```

In `skip_check`, after `prog = check_question_service.skip(...)` (line 283) and before the return:

```python
    check_question_service.write_check_batch(
        db, check_question_service.get_pending_check(db, session_id)
    )
    return CheckSkipResponse(**prog)
```

- [ ] **Step 4: Wire the complete route**

In `complete_check`, the batch is resolved then cleared. Insert `write_check_batch` BEFORE `clear_pending_check` (line 340), using the `pc` already fetched at line 334:

```python
    summary = check_question_service.build_results_summary(pc)
    cooldown = check_question_service.build_quiz_cooldown(pc)
    check_question_service.write_check_batch(db, pc)
    check_question_service.clear_pending_check(db, session_id)
    check_question_service.set_quiz_cooldown(db, session_id, cooldown)
```

- [ ] **Step 5: Add a complete-route test**

In `backend/tests/test_check_complete_route.py`, extend the existing `_resolved_batch` flow so the batch is linked to a message, then assert the message has `check_batch_json` after complete. Adapt `_resolved_batch` to attach a message id:

```python
def _resolved_batch(db, sid):
    ctx = ToolContext(db=db, session_id=sid, user_id=USER_ID,
                      turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    check_question_service.register(db, ctx, AskCheckQuestionsArgs(
        session_id=sid, gap="atp",
        items=[{"question": "Q1?", "options": ["a", "b"],
                "correct_index": 0, "explanation": "a."}]))
    m = ChatMessage(session_id=sid, role="assistant", content="")
    db.add(m)
    db.commit()
    db.refresh(m)
    check_question_service.attach_message_id(db, sid, m.id)
    check_question_service.answer(db, sid, index=0, selected_index=0)
    return m.id
```

New test:

```python
def test_complete_writes_check_batch_before_clear(client, db_session, seeded_session, monkeypatch):
    sid = seeded_session.id
    msg_id = _resolved_batch(db_session, sid)
    monkeypatch.setattr("agent.tutor.run_streaming",
                        _make_fake_run_streaming(db_session, sid))
    r = client.post(f"/api/sessions/{sid}/check/complete", json={"user_id": USER_ID})
    assert r.status_code == 200
    import json
    msg = db_session.get(ChatMessage, msg_id)
    data = json.loads(msg.check_batch_json)
    assert data["gap"] == "atp"
    assert data["items"][0]["correct"] is True
    assert check_question_service.get_pending_check(db_session, sid) is None
```

(Existing `_resolved_batch` callers in this file return nothing today; updating it to return `msg_id` is backward-compatible — other tests ignore the return value.)

- [ ] **Step 6: Run the route tests**

Run from `backend/`: `pytest tests/test_check_answer_route.py tests/test_check_skip_route.py tests/test_check_complete_route.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/routes/sessions.py backend/tests/test_check_answer_route.py backend/tests/test_check_skip_route.py backend/tests/test_check_complete_route.py
git commit -m "feat(check): persist resolved batch on answer/skip/complete"
```

---

### Task 7: Session serializer returns `check_batch`, suppressing the open batch

**Files:**
- Modify: `backend/routes/sessions.py` (`_load_messages` line 146-172; `get_session` line 182-203)
- Test: `backend/tests/test_session_detail_check_batch.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_session_detail_check_batch.py`:

```python
"""GET /sessions/{id} returns check_batch per message; open batch suppressed."""

import json
from datetime import datetime, timezone

import pytest

from contracts import AskCheckQuestionsArgs, TopicProfile
from agent.types import ToolContext
from db.models import ChatMessage, LearningEvent, Session as SessionModel, User
from services import check_question_service

USER_ID = "u_detail_1"
SID = "s_detail_1"


@pytest.fixture
def seeded(db_session):
    db_session.add(User(id=USER_ID))
    db_session.add(SessionModel(
        id=SID, user_id=USER_ID, topic="bio",
        topic_profile_json=TopicProfile().model_dump_json(),
    ))
    db_session.commit()
    return db_session


def _msg(db, **kw):
    m = ChatMessage(session_id=SID, role="assistant", content="", **kw)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


def test_check_batch_returned_from_column(client, seeded):
    db = seeded
    _msg(db, check_batch_json=json.dumps({
        "gap": "atp", "current_index": 1, "total": 1,
        "items": [{"question": "Q1?", "options": ["a", "b"], "status": "answered",
                   "selected_index": 0, "correct_index": 0, "correct": True,
                   "explanation": "a."}],
    }))
    r = client.get(f"/api/sessions/{SID}")
    assert r.status_code == 200
    msgs = r.json()["messages"]
    assert msgs[0]["check_batch"]["gap"] == "atp"
    assert msgs[0]["check_batch"]["items"][0]["selected_index"] == 0


def test_open_batch_message_suppressed(client, seeded):
    db = seeded
    ctx = ToolContext(db=db, session_id=SID, user_id=USER_ID,
                      turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    check_question_service.register(db, ctx, AskCheckQuestionsArgs(
        session_id=SID, gap="atp",
        items=[{"question": "Q1?", "options": ["a", "b"],
                "correct_index": 0, "explanation": "a."}]))
    m = _msg(db)
    check_question_service.attach_message_id(db, SID, m.id)
    # Answer one item -> per-answer write stamps check_batch_json while OPEN.
    check_question_service.answer(db, SID, index=0, selected_index=0)
    check_question_service.write_check_batch(
        db, check_question_service.get_pending_check(db, SID))

    r = client.get(f"/api/sessions/{SID}")
    msg = next(x for x in r.json()["messages"] if x["id"] == m.id)
    # Batch still open (pending_check present) -> recap suppressed; live card owns it.
    assert msg["check_batch"] is None


def test_backfill_when_no_column(client, seeded):
    db = seeded
    m = _msg(db, tool_calls_json=json.dumps([{
        "name": "ask_check_questions",
        "args": {"session_id": SID, "gap": "g", "items": [
            {"question": "Qb?", "options": ["a", "b"],
             "correct_index": 1, "explanation": "b."}]},
        "status": "ok", "error": None,
    }]))
    db.add(LearningEvent(session_id=SID, gap_tested="g",
                         question="Qb?", correct=False))
    db.commit()
    r = client.get(f"/api/sessions/{SID}")
    cb = next(x for x in r.json()["messages"] if x["id"] == m.id)["check_batch"]
    assert cb["items"][0]["status"] == "answered"
    assert cb["items"][0]["correct"] is False
    assert cb["items"][0]["selected_index"] is None


def test_plain_message_has_null_check_batch(client, seeded):
    db = seeded
    m = _msg(db, content="hello", tool_calls_json="[]")
    r = client.get(f"/api/sessions/{SID}")
    cb = next(x for x in r.json()["messages"] if x["id"] == m.id)["check_batch"]
    assert cb is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_session_detail_check_batch.py -v`
Expected: FAIL — `check_batch` missing from message payload / `Message` has no such field (if Task 1 not yet merged) — Task 1 must be done first.

- [ ] **Step 3: Thread the open batch id and populate `check_batch`**

In `backend/routes/sessions.py`, change `_load_messages` to accept `open_message_id` and populate `check_batch`:

```python
def _load_messages(
    db: Session, session_id: str, open_message_id: int | None = None
) -> list[Message]:
    rows = db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
    ).scalars().all()
    out: list[Message] = []
    for m in rows:
        try:
            citations = [Citation(**c) for c in json.loads(m.citations_json or "[]")]
        except (ValueError, TypeError):
            citations = []
        try:
            tool_calls = [ToolCallRecord(**t) for t in json.loads(m.tool_calls_json or "[]")]
        except (ValueError, TypeError):
            tool_calls = []
        # Suppress recap for the message whose batch is still OPEN: the live
        # CheckQuestion card (driven by pending_check) owns that batch until
        # it resolves. Otherwise both cards render for the same batch.
        check_batch = None
        if m.id != open_message_id:
            check_batch = check_question_service.load_check_batch(db, m)
        out.append(
            Message(
                id=m.id,
                role=m.role,
                content=m.content,
                created_at=_aware_utc(m.created_at),
                citations=citations,
                tool_calls=tool_calls,
                check_batch=check_batch,
            )
        )
    return out
```

In `get_session`, compute the open message id from the already-fetched `pc` and pass it:

```python
    pc = check_question_service.get_pending_check(db, row.id)
    open_msg_id = pc.get("message_id") if pc else None
    return SessionDetail(
        id=row.id,
        user_id=row.user_id,
        topic=row.topic,
        topic_profile=profile_service.load_profile(db, row.id),
        created_at=_aware_utc(row.created_at),
        ended_at=_aware_utc(row.ended_at),
        ingestion_status=_latest_ingestion_status(db, row.id),
        messages=_load_messages(db, row.id, open_msg_id),
        pinned=row.pinned,
        pending_check=check_question_service.public_view(pc),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run from `backend/`: `pytest tests/test_session_detail_check_batch.py -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run from `backend/`: `pytest -q`
Expected: PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add backend/routes/sessions.py backend/tests/test_session_detail_check_batch.py
git commit -m "feat(sessions): serialize check_batch per message, suppress open batch"
```

---

### Task 8: `CheckRecap.vue` component

**Files:**
- Create: `frontend/src/components/chat/CheckRecap.vue`
- Test: `frontend/src/__tests__/checkRecap.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/checkRecap.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CheckRecap from '../components/chat/CheckRecap.vue'

const batch = (overrides = {}) => ({
  gap: 'glycolysis',
  total: 1,
  items: [
    {
      question: 'Which enzyme catalyzes the rate-limiting step?',
      options: ['PFK-1', 'Pyruvate kinase', 'Hexokinase'],
      status: 'answered',
      selectedIndex: 0,
      correctIndex: 0,
      correct: true,
      explanation: 'PFK-1 catalyzes the committed step.',
      ...overrides,
    },
  ],
})

describe('CheckRecap', () => {
  it('marks the chosen-correct option as your answer + correct', () => {
    const w = mount(CheckRecap, { props: { batch: batch() } })
    const opts = w.findAll('[data-testid="recap-option"]')
    expect(opts[0].classes()).toContain('is-correct')
    expect(opts[0].text()).toMatch(/your answer/i)
  })

  it('marks wrong pick incorrect and the correct option correct', () => {
    const w = mount(CheckRecap, {
      props: { batch: batch({ selectedIndex: 1, correct: false }) },
    })
    const opts = w.findAll('[data-testid="recap-option"]')
    expect(opts[1].classes()).toContain('is-incorrect')
    expect(opts[0].classes()).toContain('is-correct')
  })

  it('shows "answer not recorded" when selectedIndex is null', () => {
    const w = mount(CheckRecap, {
      props: { batch: batch({ selectedIndex: null, correct: null, status: 'answered' }) },
    })
    expect(w.text()).toMatch(/answer not recorded/i)
    const opts = w.findAll('[data-testid="recap-option"]')
    expect(opts.some((o) => o.classes().includes('is-incorrect'))).toBe(false)
  })

  it('renders explanation and a score header', () => {
    const w = mount(CheckRecap, { props: { batch: batch() } })
    expect(w.text()).toContain('PFK-1 catalyzes the committed step.')
    expect(w.text()).toMatch(/1\s*\/\s*1/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `frontend/`: `npm run test:unit -- --run checkRecap`
Expected: FAIL — cannot resolve `CheckRecap.vue`

- [ ] **Step 3: Implement `CheckRecap.vue`**

Create `frontend/src/components/chat/CheckRecap.vue`:

```vue
<script setup>
import { computed } from 'vue'

// Batch (camelCase, mapped by the session store):
//   { gap, total, items: [
//     { question, options, status, selectedIndex, correctIndex, correct, explanation } ] }
const props = defineProps({
  batch: { type: Object, required: true },
})

const items = computed(() => props.batch.items || [])
const graded = computed(() => items.value.filter((it) => it.status === 'answered'))
const nCorrect = computed(() => graded.value.filter((it) => it.correct === true).length)

function optionClass(item, i) {
  if (i === item.correctIndex) return 'is-correct'
  if (item.selectedIndex != null && i === item.selectedIndex) return 'is-incorrect'
  return ''
}
function isYourAnswer(item, i) {
  return item.selectedIndex != null && i === item.selectedIndex
}
</script>

<template>
  <section class="recap-card" data-testid="check-recap">
    <header class="recap-header">
      <span class="recap-eyebrow">Check question recap</span>
      <span class="recap-score" data-testid="recap-score">
        {{ nCorrect }} / {{ graded.length }} &middot; {{ batch.gap }}
      </span>
    </header>

    <div v-for="(item, qi) in items" :key="qi" class="recap-item">
      <p class="recap-question">{{ item.question }}</p>
      <ul class="recap-options">
        <li
          v-for="(opt, i) in item.options"
          :key="i"
          class="recap-option"
          :class="optionClass(item, i)"
          data-testid="recap-option"
        >
          <span class="recap-option-text">{{ opt }}</span>
          <span v-if="isYourAnswer(item, i)" class="recap-tag">your answer</span>
          <span v-else-if="i === item.correctIndex" class="recap-tag">correct</span>
        </li>
      </ul>
      <p
        v-if="item.status === 'answered' && item.selectedIndex == null"
        class="recap-norecord"
      >
        Answer not recorded
      </p>
      <p v-if="item.explanation" class="recap-explanation">{{ item.explanation }}</p>
    </div>
  </section>
</template>

<style scoped>
.recap-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.125rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-raised);
}
.recap-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
}
.recap-eyebrow {
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-text-faint);
}
.recap-score {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--color-text-muted);
}
.recap-item {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.recap-question {
  margin: 0;
  font-weight: 600;
  color: var(--color-text);
}
.recap-options {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.recap-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 0.6rem);
  color: var(--color-text);
}
.recap-option.is-correct {
  border-color: var(--signal-success, #2e7d32);
  background: color-mix(in srgb, var(--signal-success, #2e7d32) 14%, transparent);
}
.recap-option.is-incorrect {
  border-color: var(--signal-warning, #b26a00);
  background: color-mix(in srgb, var(--signal-warning, #b26a00) 14%, transparent);
}
.recap-tag {
  flex-shrink: 0;
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-text-muted);
}
.recap-norecord {
  margin: 0;
  font-size: 0.8125rem;
  font-style: italic;
  color: var(--color-text-muted);
}
.recap-explanation {
  margin: 0;
  color: var(--color-text-muted);
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run from `frontend/`: `npm run test:unit -- --run checkRecap`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/chat/CheckRecap.vue frontend/src/__tests__/checkRecap.test.js
git commit -m "feat(ui): CheckRecap read-only recap card component"
```

---

### Task 9: Store maps `check_batch` onto messages in `loadSession`

**Files:**
- Modify: `frontend/src/stores/session.js` (`loadSession` message map, line 79-85)
- Test: `frontend/src/__tests__/sessionCheckFlow.test.js` (extend) or new

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/__tests__/sessionCheckFlow.test.js` (it already mocks `sessionsApi`). New test:

```js
it('loadSession maps check_batch onto messages (camelCase)', async () => {
  const store = useSessionStore()
  vi.spyOn(sessionsApi, 'getSession').mockResolvedValue({
    id: 's1', user_id: 'u1', topic: 't', topic_profile: {},
    created_at: '2026-06-07T00:00:00Z', messages: [
      {
        id: 1, role: 'assistant', content: '', created_at: '2026-06-07T00:00:00Z',
        citations: [], tool_calls: [],
        check_batch: {
          gap: 'atp', current_index: 1, total: 1,
          items: [{ question: 'Q?', options: ['a', 'b'], status: 'answered',
                    selected_index: 0, correct_index: 0, correct: true,
                    explanation: 'a.' }],
        },
      },
    ],
    pending_check: null,
  })
  await store.loadSession('s1')
  const cb = store.messages[0].check_batch
  expect(cb.gap).toBe('atp')
  expect(cb.items[0].selectedIndex).toBe(0)
  expect(cb.items[0].correctIndex).toBe(0)
  expect(cb.items[0].correct).toBe(true)
})
```

(Match the existing import style in that test file for `useSessionStore` / `sessionsApi`.)

- [ ] **Step 2: Run test to verify it fails**

Run from `frontend/`: `npm run test:unit -- --run sessionCheckFlow`
Expected: FAIL — `store.messages[0].check_batch` is `undefined`

- [ ] **Step 3: Map `check_batch` in `loadSession`**

In `frontend/src/stores/session.js`, in `loadSession`, replace the message map (line 79-85) with:

```js
      messages.value = (s.messages || []).map((m) => ({
        role: m.role,
        content: m.content,
        message_id: m.id,
        citations: m.citations || [],
        created_at: m.created_at,
        check_batch: m.check_batch
          ? {
              gap: m.check_batch.gap,
              total: m.check_batch.total,
              items: (m.check_batch.items || []).map((it) => ({
                question: it.question,
                options: it.options || [],
                status: it.status,
                selectedIndex: it.selected_index,
                correctIndex: it.correct_index,
                correct: it.correct,
                explanation: it.explanation,
              })),
            }
          : null,
      }))
```

- [ ] **Step 4: Run test to verify it passes**

Run from `frontend/`: `npm run test:unit -- --run sessionCheckFlow`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/session.js frontend/src/__tests__/sessionCheckFlow.test.js
git commit -m "feat(store): map check_batch onto messages on session load"
```

---

### Task 10: `AssistantBubble` renders `CheckRecap`, suppresses chip + empty pill

**Files:**
- Modify: `frontend/src/components/chat/AssistantBubble.vue`
- Test: `frontend/src/__tests__/assistantBubble.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/assistantBubble.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AssistantBubble from '../components/chat/AssistantBubble.vue'

const recapBatch = {
  gap: 'atp', total: 1,
  items: [{ question: 'Q?', options: ['a', 'b'], status: 'answered',
            selectedIndex: 0, correctIndex: 0, correct: true, explanation: 'a.' }],
}

describe('AssistantBubble check_batch', () => {
  it('renders CheckRecap and suppresses tool-call chips when check_batch present', () => {
    const w = mount(AssistantBubble, {
      props: { message: { content: '', check_batch: recapBatch,
                          tool_calls: [{ id: 't1', name: 'ask_check_questions', state: 'done' }] } },
    })
    expect(w.find('[data-testid="check-recap"]').exists()).toBe(true)
    expect(w.find('.tool-call-row').exists()).toBe(false)
  })

  it('does not render the empty content pill when check_batch present and content empty', () => {
    const w = mount(AssistantBubble, {
      props: { message: { content: '', check_batch: recapBatch } },
    })
    expect(w.find('.content').exists()).toBe(false)
  })

  it('still renders non-empty content alongside the recap', () => {
    const w = mount(AssistantBubble, {
      props: { message: { content: 'Nice work!', check_batch: recapBatch } },
    })
    expect(w.find('[data-testid="check-recap"]').exists()).toBe(true)
    expect(w.text()).toContain('Nice work!')
  })

  it('unchanged when check_batch absent', () => {
    const w = mount(AssistantBubble, {
      props: { message: { content: 'hello', tool_calls: [] } },
    })
    expect(w.find('[data-testid="check-recap"]').exists()).toBe(false)
    expect(w.find('.content').exists()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `frontend/`: `npm run test:unit -- --run assistantBubble`
Expected: FAIL — recap not rendered

- [ ] **Step 3: Update `AssistantBubble.vue`**

In `frontend/src/components/chat/AssistantBubble.vue`, add the import and branch the body. Replace the `<script setup>` import block (lines 1-4) to add `CheckRecap`:

```js
import MarkdownContent from './MarkdownContent.vue'
import ToolCallChip from './ToolCallChip.vue'
import CitationsList from './CitationsList.vue'
import CheckRecap from './CheckRecap.vue'
```

Replace the `.msg-body` inner content (lines 25-37) with:

```html
    <div class="msg-body">
      <span class="role-tag">tutor</span>
      <template v-if="message.check_batch">
        <CheckRecap :batch="message.check_batch" />
        <MarkdownContent
          v-if="message.content"
          class="content"
          :text="message.content"
          :streaming="streaming"
        />
      </template>
      <template v-else>
        <span
          v-for="(tc, ti) in (message.tool_calls || [])"
          :key="tc.id ?? ti"
          class="tool-call-row"
        >
          <ToolCallChip :tool_call="tc" :state="tc.state || 'done'" />
        </span>
        <MarkdownContent class="content" :text="message.content || ''" :streaming="streaming" />
      </template>
      <span v-if="message.status === 'cancelled'" class="cancelled-marker">(stopped)</span>
      <CitationsList :citations="message.citations || []" />
    </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run from `frontend/`: `npm run test:unit -- --run assistantBubble`
Expected: PASS

- [ ] **Step 5: Run the full frontend suite**

Run from `frontend/`: `npm run test:unit -- --run`
Expected: PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/chat/AssistantBubble.vue frontend/src/__tests__/assistantBubble.test.js
git commit -m "feat(ui): render CheckRecap in AssistantBubble, suppress chip + empty pill"
```

---

### Task 11: CodeQL config — stop alembic false positives

**Files:**
- Create: `.github/codeql/codeql-config.yml`
- Modify: `.github/workflows/codeql.yml` (init step, line 28-32)

- [ ] **Step 1: Create the CodeQL config**

Create `.github/codeql/codeql-config.yml`:

```yaml
name: "Project_Apt CodeQL config"
paths-ignore:
  - "backend/db/alembic/versions/**"
```

- [ ] **Step 2: Wire it into the workflow**

In `.github/workflows/codeql.yml`, update the Init step (lines 28-32) to reference the config:

```yaml
      - name: Init CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: ${{ matrix.language }}
          queries: security-and-quality
          config-file: ./.github/codeql/codeql-config.yml
```

- [ ] **Step 3: Validate YAML**

Run from repo root: `python -c "import yaml; yaml.safe_load(open('.github/codeql/codeql-config.yml')); yaml.safe_load(open('.github/workflows/codeql.yml')); print('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add .github/codeql/codeql-config.yml .github/workflows/codeql.yml
git commit -m "ci(codeql): ignore alembic versions to stop migration false positives"
```

---

### Task 12: Apply migration 0007 to live Supabase (manual / deploy)

**Files:** none (operational step). Per the spec Deployment Note: the running server reads schema from the live DB, so the column must exist before the model selects it, or authed endpoints 503.

- [ ] **Step 1: Apply the migration to the live DB**

This is a manual step the user runs against the live Supabase database (do NOT run it automatically). From `backend/` with the live `DATABASE_URL` in the environment:

```bash
python -m alembic upgrade head
```

Expected: alembic reports upgrade `0006_quiz_cooldown -> 0007_check_batch`.

- [ ] **Step 2: Verify the column exists**

Confirm `chat_messages.check_batch_json` exists on the live DB (Supabase SQL editor or `\d chat_messages`). Stop and report if the column is absent.

- [ ] **Step 3: Manual live smoke (after deploy)**

In a real session against the live LLM: ask the tutor to quiz, answer a batch, let it complete, reload the session. Confirm the resolved batch renders as a recap card (question, options, your pick, correct answer, explanation) and that no blank gray bubble remains. Confirm a mid-batch reload shows the live card only (no duplicate recap).

---

## Self-Review

**Spec coverage:**
- New column `check_batch_json` → Task 2. ✅
- `pending_check.message_id` + `attach_message_id` → Task 3. ✅
- `write_check_batch` on answer/complete (+skip for in-progress) → Tasks 3 (helper), 6 (wiring). ✅
- Read path `check_batch` from column → Task 7. ✅
- Contract change (codegen) → Task 1. ✅
- Backfill (read-time reconstruct) → Task 4 (helper), 7 (wiring). ✅
- `CheckRecap.vue` → Task 8. ✅
- `AssistantBubble.vue` (replace chip + empty pill) → Task 10. ✅
- Live `CheckQuestion.vue` untouched → no task touches it; double-render avoided via open-batch suppression (Task 7). ✅
- Error handling (missing/malformed JSON, message not found, event miss) → covered in helpers (Tasks 3, 4) + tests. ✅
- CodeQL config → Task 11. ✅
- Deployment note (apply 0007) → Task 12. ✅

**Advisor-flagged items resolved:**
- #1 double-render → Task 7 suppresses recap for the open batch's message (`open_message_id`), with a dedicated test. ✅
- #2 backfill join determinism → `reconstruct_check_batch` orders by `created_at` and restricts to events at/after the asking message's turn, taking the earliest. ✅
- #3 contract/migration/deploy as explicit tasks → Tasks 1, 2, 12. ✅
- #4 non-streaming path note → stated in File Structure notes. ✅
- #5 non-empty-content guard + camelCase store mapping → Task 10 (`v-if="message.content"` inside the recap branch) + Task 9. ✅

**Type consistency:** `check_batch` (snake, backend/contract) → store maps to camelCase item fields (`selectedIndex`/`correctIndex`) consumed by `CheckRecap` props — matches `CheckQuestion`/`pendingCheck` conventions. `write_check_batch`/`attach_message_id`/`load_check_batch`/`reconstruct_check_batch` names are used identically across service, routes, tutor, and tests.

**Placeholder scan:** Route/test tasks reference `<existing_open_batch_fixture>` and `<session_id_used_in_that_test>` — these are deliberate pointers to existing fixtures in those test files (the executor must read the file and substitute the actual fixture/ids). All production code steps contain complete code.
