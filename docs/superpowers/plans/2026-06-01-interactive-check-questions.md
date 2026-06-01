# Interactive Check-Questions + Profile-Update Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tutor unable to grade a check-question without a real learner answer (structural, not prompt-based), give the learner an interactive question/answer card with a hard composer lock, and stop `update_topic_profile` from silently failing on focus-only patches.

**Architecture:** Add server-owned `pending_check` state on the `sessions` row. A new turn-terminating `ask_check_question` tool registers the open question and breaks the agent loop (yield to human). `record_learning_event` is guarded: it rejects unless a `pending_check` set in a *prior* turn matches the graded gap, then clears it. The frontend renders a distinct `CheckQuestion` card and hard-locks the composer to Answer-or-Skip while a question is open. Workstream B makes `evidence_type` conditional and surfaces previously-swallowed tool errors at three layers.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (Supabase Postgres), LiteLLM tool-calling, Pydantic contracts generated from `docs/api/openapi.yaml`, Vue 3 + Pinia + Vite, pytest + vitest.

**Source of truth:** `docs/superpowers/specs/2026-06-01-interactive-check-questions-design.md`.

**Branch:** `feat/interactive-check-questions` (already created off `dev`).

**Hard rules (from CLAUDE.md):**
- Contracts are codegen. Edit `docs/api/openapi.yaml` first, then run `python backend/scripts/gen_contracts.py` from repo root. NEVER hand-edit `backend/contracts/`. CI fails on drift.
- No emojis in code/comments. Secrets stay in `.env` (never read/commit).
- Run backend tests from `backend/`: `pytest`. Frontend from `frontend/`: `npm run test:unit -- --run`.

---

## File Structure

**Backend — created:**
- `backend/services/check_question_service.py` — owns `pending_check` read/write/clear + the prior-turn guard helper. One responsibility: the pending-check state machine.
- `backend/db/alembic/versions/0002_pending_check.py` — adds `sessions.pending_check_json`.
- `backend/tests/test_check_question_service.py`, `backend/tests/test_ask_check_question.py`, `backend/tests/test_check_skip_route.py` — new tests.

**Backend — modified:**
- `docs/api/openapi.yaml` — new `AskCheckQuestionArgs`, `PendingCheck`; `evidence_type` made optional; `tool_calls` + `pending_check` added to `Message`/`SessionDetail`; `pending_check` on `ChatResponse`.
- `backend/db/models.py` — `Session.pending_check_json` column.
- `backend/agent/tools.py` — register `ask_check_question`; log swallowed exceptions.
- `backend/agent/tutor.py` — loop-break on `ask_check_question`; `check_question`/`check_result` stream events.
- `backend/agent/prompts.py` — FOCUS/END-OF-FOCUS protocol rewrite + `PENDING_CHECK` context line.
- `backend/services/learning_event_service.py` — prior-turn guard + clear on grade.
- `backend/services/profile_service.py` — `evidence_type` conditional.
- `backend/routes/chat.py` — include `pending_check` in `ChatResponse`.
- `backend/routes/sessions.py` — `POST /sessions/{id}/check/skip`; include `tool_calls` + `pending_check` in GET session.

**Frontend — created:**
- `frontend/src/components/chat/CheckQuestion.vue` — the question card (question + verdict marker).
- `frontend/src/__tests__/checkQuestion.test.js`, `frontend/src/__tests__/sessionCheckFlow.test.js`.

**Frontend — modified:**
- `frontend/src/stores/session.js` — `pendingCheck` state; handle `check_question`/`check_result`; `skipCheck()`.
- `frontend/src/services/sessionsApi.js` — `skipCheck(sessionId)`.
- `frontend/src/components/chat/Composer.vue` — `locked` prop + Skip button + `skip` emit.
- `frontend/src/components/chat/ToolCallChip.vue` — surface error string on title.
- `frontend/src/views/SessionView.vue` — render `CheckQuestion`, wire lock + skip.
- `frontend/src/components/chat/toolLabels.js` — label for `ask_check_question`.

---

## Task 1: Contracts — schema changes + codegen

**Files:**
- Modify: `docs/api/openapi.yaml` (schemas at lines ~398, ~471, ~533, ~548)
- Generated (do NOT hand-edit): `backend/contracts/models.py`
- Test: `backend/tests/test_contracts.py` (existing drift test)

- [ ] **Step 1: Make `evidence_type` optional on `UpdateTopicProfileArgs`**

In `docs/api/openapi.yaml`, the `UpdateTopicProfileArgs` schema currently has
`required: [session_id, evidence_type]` and `evidence_type: { $ref: ".../EvidenceType" }`.
Change to:

```yaml
    UpdateTopicProfileArgs:
      type: object
      additionalProperties: false
      required: [session_id]
      description: |
        Patch operation for a session's TopicProfile. Sending
        `focus_target_gap: null` explicitly clears focus and requires
        `focus_clear_reason` (server-side guard rail). `evidence_type` is
        required only when `add_mastered_concept` is present.
      properties:
        session_id:           { type: string, maxLength: 64 }
        knowledge_level:
          oneOf:
            - $ref: "#/components/schemas/KnowledgeLevel"
            - type: "null"
          default: null
        add_confirmed_gap:    { type: [string, "null"], default: null, maxLength: 200 }
        add_mastered_concept: { type: [string, "null"], default: null, maxLength: 200 }
        focus_target_gap:     { type: [string, "null"], default: null, maxLength: 200 }
        focus_clear_reason:
          oneOf:
            - $ref: "#/components/schemas/FocusClearReason"
            - type: "null"
          default: null
        evidence_type:
          oneOf:
            - $ref: "#/components/schemas/EvidenceType"
            - type: "null"
          default: null
```

- [ ] **Step 2: Add `AskCheckQuestionArgs` and `PendingCheck` schemas**

Add next to `RecordLearningEventArgs` (tool-argument schemas block):

```yaml
    AskCheckQuestionArgs:
      type: object
      additionalProperties: false
      required: [session_id, gap, question]
      description: |
        Register an open check-question and end the turn. The question text is
        also streamed to the learner as normal assistant text; gap+question
        here drive the server-side pending-check state and the grading guard.
      properties:
        session_id: { type: string, maxLength: 64 }
        gap:        { type: string, maxLength: 200 }
        question:   { type: string, maxLength: 1000 }

    PendingCheck:
      type: object
      additionalProperties: false
      required: [gap, question]
      description: An open check-question awaiting a learner answer.
      properties:
        gap:      { type: string }
        question: { type: string }
```

- [ ] **Step 3: Add `pending_check` to `ChatResponse`**

Under `ChatResponse.properties`, add:

```yaml
        pending_check:
          oneOf:
            - $ref: "#/components/schemas/PendingCheck"
            - type: "null"
          default: null
```

- [ ] **Step 4: Add `tool_calls` + `pending_check` to `Message`, and `pending_check` to `SessionDetail`**

In `Message.properties` add (alongside `citations`):

```yaml
        tool_calls:
          type: array
          items: { $ref: "#/components/schemas/ToolCallRecord" }
          default: []
```

In `SessionDetail.properties` add (alongside `pinned`):

```yaml
        pending_check:
          oneOf:
            - $ref: "#/components/schemas/PendingCheck"
            - type: "null"
          default: null
```

- [ ] **Step 5: Regenerate contracts**

Run from repo root:

```bash
python backend/scripts/gen_contracts.py
```

Expected: `backend/contracts/models.py` rewritten; `git diff --stat` shows it changed. New classes `AskCheckQuestionArgs`, `PendingCheck` exist; `UpdateTopicProfileArgs.evidence_type` now `... | None = None`.

- [ ] **Step 6: Run the contract drift test**

Run from `backend/`:

```bash
pytest tests/test_contracts.py -v
```

Expected: PASS (generated file matches the YAML; zero drift).

- [ ] **Step 7: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts/models.py
git commit -m "feat(contracts): pending-check schemas, optional evidence_type, message tool_calls"
```

---

## Task 2: DB column + Alembic migration for `pending_check`

**Files:**
- Modify: `backend/db/models.py:35` (Session)
- Create: `backend/db/alembic/versions/0002_pending_check.py`

- [ ] **Step 1: Add the column to the ORM model**

In `backend/db/models.py`, in `class Session`, after the `kw_index_json` line add:

```python
    pending_check_json: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
```

- [ ] **Step 2: Find the current migration head**

Run from `backend/`:

```bash
alembic heads
```

Expected: prints one revision id (the baseline, e.g. `0001_phase7_baseline`). Note it for `down_revision`.

- [ ] **Step 3: Write the migration**

Create `backend/db/alembic/versions/0002_pending_check.py` (set `down_revision` to the id from Step 2):

```python
"""add sessions.pending_check_json

Revision ID: 0002_pending_check
Revises: 0001_phase7_baseline
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_pending_check"
down_revision = "0001_phase7_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("pending_check_json", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sessions", "pending_check_json")
```

- [ ] **Step 4: Apply and verify the migration**

Run from `backend/`:

```bash
alembic upgrade head
alembic current
```

Expected: `alembic current` shows `0002_pending_check (head)`. No error.

- [ ] **Step 5: Commit**

```bash
git add backend/db/models.py backend/db/alembic/versions/0002_pending_check.py
git commit -m "feat(db): add sessions.pending_check_json column + migration"
```

---

## Task 3: `check_question_service` — pending-check state machine

**Files:**
- Create: `backend/services/check_question_service.py`
- Test: `backend/tests/test_check_question_service.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_check_question_service.py`. Use the existing test DB fixtures
(see `backend/tests/test_profile_service.py` for the `db` + session-row setup pattern; mirror
its imports and fixtures exactly):

```python
from datetime import datetime, timezone, timedelta

from services import check_question_service as cq


def test_set_get_clear_pending_check(db, make_session):
    s = make_session()  # helper from conftest: creates a Session row, returns it
    t0 = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)

    assert cq.get_pending_check(db, s.id) is None

    cq.set_pending_check(db, s.id, gap="calvin_cycle", question="What are the inputs?", asked_at=t0)
    pc = cq.get_pending_check(db, s.id)
    assert pc is not None
    assert pc["gap"] == "calvin_cycle"
    assert pc["question"] == "What are the inputs?"
    assert cq.parse_asked_at(pc) == t0

    cq.clear_pending_check(db, s.id)
    assert cq.get_pending_check(db, s.id) is None


def test_is_gradable_requires_prior_turn(db, make_session):
    s = make_session()
    asked = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
    cq.set_pending_check(db, s.id, gap="g", question="q", asked_at=asked)

    same_turn = asked
    later_turn = asked + timedelta(seconds=5)

    # same turn -> not gradable; later turn + matching gap -> gradable
    assert cq.is_gradable(db, s.id, gap="g", current_turn=same_turn) is False
    assert cq.is_gradable(db, s.id, gap="g", current_turn=later_turn) is True
    # gap mismatch -> not gradable
    assert cq.is_gradable(db, s.id, gap="other", current_turn=later_turn) is False
```

If `conftest.py` lacks a `make_session` helper, add one there that inserts a `Session`
(mirror how `test_profile_service.py` creates session rows) and returns it.

- [ ] **Step 2: Run test to verify it fails**

Run from `backend/`:

```bash
pytest tests/test_check_question_service.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'services.check_question_service'`.

- [ ] **Step 3: Implement the service**

Create `backend/services/check_question_service.py`:

```python
"""Pending check-question state machine (Spec workstream A1, Layer B).

A pending_check lives on the Session row as JSON:
    {"gap": str, "question": str, "asked_at_turn": iso8601}

The grading guard (is_gradable) enforces that a check-question can only be
graded in a LATER turn than the one that asked it, and only for the gap that
was actually asked. This makes "ask and self-grade in one turn" impossible.
"""

import json
from datetime import datetime

from sqlalchemy.orm import Session

from db.models import Session as SessionModel


def get_pending_check(db: Session, session_id: str) -> dict | None:
    row = db.get(SessionModel, session_id)
    if row is None or not row.pending_check_json:
        return None
    try:
        data = json.loads(row.pending_check_json)
    except (ValueError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def parse_asked_at(pc: dict) -> datetime:
    return datetime.fromisoformat(pc["asked_at_turn"])


def set_pending_check(
    db: Session, session_id: str, gap: str, question: str, asked_at: datetime
) -> None:
    row = db.get(SessionModel, session_id)
    if row is None:
        raise ValueError(f"session not found: {session_id}")
    row.pending_check_json = json.dumps(
        {"gap": gap, "question": question, "asked_at_turn": asked_at.isoformat()}
    )
    db.commit()


def clear_pending_check(db: Session, session_id: str) -> None:
    row = db.get(SessionModel, session_id)
    if row is None:
        return
    row.pending_check_json = None
    db.commit()


def is_gradable(
    db: Session, session_id: str, gap: str, current_turn: datetime
) -> bool:
    pc = get_pending_check(db, session_id)
    if pc is None or pc.get("gap") != gap:
        return False
    return parse_asked_at(pc) < current_turn
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_check_question_service.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/check_question_service.py backend/tests/test_check_question_service.py backend/tests/conftest.py
git commit -m "feat(check): pending-check state machine + prior-turn guard"
```

---

## Task 4: `evidence_type` conditional in `profile_service` (Workstream B1)

**Files:**
- Modify: `backend/services/profile_service.py:117`
- Test: `backend/tests/test_profile_service.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_profile_service.py` (reuse its existing `db`/`ctx` fixtures and
`UpdateTopicProfileArgs` import):

```python
def test_focus_only_patch_without_evidence_type_succeeds(db, ctx):
    args = UpdateTopicProfileArgs(
        session_id=ctx.session_id,
        focus_target_gap="calvin_cycle",
        evidence_type=None,
    )
    result = profile_service.apply_patch(db, ctx, args)
    assert result.ok is True
    assert profile_service.load_profile(db, ctx.session_id).focus_target_gap == "calvin_cycle"


def test_mastered_concept_requires_evidence_type(db, ctx):
    args = UpdateTopicProfileArgs(
        session_id=ctx.session_id,
        add_mastered_concept="light_reactions",
        evidence_type=None,
    )
    result = profile_service.apply_patch(db, ctx, args)
    assert result.ok is False
    assert "evidence_type" in (result.error or "")


def test_mastered_concept_with_declared_promotes(db, ctx):
    args = UpdateTopicProfileArgs(
        session_id=ctx.session_id,
        add_mastered_concept="light_reactions",
        evidence_type="declared",
    )
    result = profile_service.apply_patch(db, ctx, args)
    assert result.ok is True
    assert "light_reactions" in profile_service.load_profile(db, ctx.session_id).mastered_concepts
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_profile_service.py -k "evidence_type or mastered_concept_with_declared" -v
```

Expected: FAIL — `test_mastered_concept_requires_evidence_type` errors (no guard yet);
`test_focus_only...` may already pass once Task 1 made the field optional, but keep it as a regression guard.

- [ ] **Step 3: Implement the conditional guard**

In `backend/services/profile_service.py`, replace the `add_mastered_concept` block
(currently lines 117-119):

```python
    if args.add_mastered_concept:
        if args.evidence_type not in ("declared", "tested"):
            return ToolResult(
                ok=False,
                status="failed",
                error=(
                    "evidence_type must be 'declared' or 'tested' when "
                    "add_mastered_concept is set"
                ),
            )
        if args.add_mastered_concept not in mastered:
            mastered.append(args.add_mastered_concept)
```

(`evidence_type` is now ignored entirely for focus-only / level-only / gap-only patches.)

- [ ] **Step 4: Run to verify pass**

```bash
pytest tests/test_profile_service.py -v
```

Expected: PASS (all, including pre-existing).

- [ ] **Step 5: Commit**

```bash
git add backend/services/profile_service.py backend/tests/test_profile_service.py
git commit -m "fix(profile): evidence_type required only for mastered-concept promotion"
```

---

## Task 5: Log swallowed tool errors (Workstream B2 — backend dispatch)

**Files:**
- Modify: `backend/agent/tools.py:84-85`
- Test: `backend/tests/test_tools_dispatch_logging.py` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_tools_dispatch_logging.py`:

```python
import logging

from agent import tools


def test_dispatch_logs_validation_error(caplog, db, ctx):
    # Missing required gap_tested/question/correct -> ValidationError caught in dispatch.
    bad_args = {"session_id": ctx.session_id}
    with caplog.at_level(logging.WARNING):
        result = tools.dispatch("record_learning_event", bad_args, ctx)
    assert result.ok is False
    assert any("record_learning_event" in r.message for r in caplog.records)
```

Reuse the `db`/`ctx` fixtures from the other backend tests (import-compatible conftest).

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_tools_dispatch_logging.py -v
```

Expected: FAIL — no log record emitted (assert on `caplog.records` fails).

- [ ] **Step 3: Add the logger and log line**

In `backend/agent/tools.py`, add at top (after imports):

```python
import logging

log = logging.getLogger(__name__)
```

Replace the `except` block (currently lines 84-85):

```python
    except Exception as e:
        log.warning("tool dispatch failed name=%s error=%s", name, e)
        return ToolResult(ok=False, status="failed", error=str(e))
```

- [ ] **Step 4: Run to verify pass**

```bash
pytest tests/test_tools_dispatch_logging.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agent/tools.py backend/tests/test_tools_dispatch_logging.py
git commit -m "fix(tools): log swallowed tool-dispatch errors"
```

---

## Task 6: GET session returns `tool_calls` + `pending_check` (Workstream B2 — API)

**Files:**
- Modify: `backend/routes/sessions.py` (`_load_messages` ~135; the `SessionDetail` builder ~166-185)
- Test: `backend/tests/test_session_detail_tool_calls.py` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_session_detail_tool_calls.py` (mirror the existing session-route
test client setup — see `backend/tests/test_profile_route.py` for the `client` + auth-header
fixtures):

```python
import json


def test_get_session_returns_tool_calls(client, db, make_session, auth_headers):
    s = make_session()
    from db.models import ChatMessage
    db.add(ChatMessage(
        session_id=s.id, role="assistant", content="hi",
        tool_calls_json=json.dumps([
            {"name": "update_topic_profile", "args": {}, "status": "failed",
             "error": "evidence_type must be ..."}
        ]),
    ))
    db.commit()

    resp = client.get(f"/api/sessions/{s.id}", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    msg = [m for m in body["messages"] if m["role"] == "assistant"][0]
    assert msg["tool_calls"][0]["status"] == "failed"
    assert "evidence_type" in msg["tool_calls"][0]["error"]
    assert body["pending_check"] is None
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_session_detail_tool_calls.py -v
```

Expected: FAIL — `KeyError: 'tool_calls'` (the `Message` payload omits it).

- [ ] **Step 3: Populate `tool_calls` in `_load_messages` and `pending_check` in the detail builder**

In `backend/routes/sessions.py`, update `_load_messages` to parse `tool_calls_json` and pass it
to the `Message` model. Add the `ToolCallRecord` import to the existing `from contracts import ...`
line. Inside the row loop, before building `Message`:

```python
        try:
            tool_calls = [ToolCallRecord(**t) for t in json.loads(m.tool_calls_json or "[]")]
        except (ValueError, TypeError):
            tool_calls = []
```

and add `tool_calls=tool_calls,` to the `Message(...)` constructor call.

In the `SessionDetail(...)` builder (the function returning `SessionDetail`, ~166-185), add:

```python
        pending_check=check_question_service.get_pending_check(db, row.id),
```

Add the import at the top of the file:

```python
from services import check_question_service
```

`get_pending_check` returns `dict | None` matching the `PendingCheck` shape (`gap`, `question`);
Pydantic validates extra keys away only if present — it returns exactly `{gap, question, asked_at_turn}`,
so map it explicitly to avoid `extra=forbid` rejection:

```python
        pending_check=(
            {"gap": pc["gap"], "question": pc["question"]}
            if (pc := check_question_service.get_pending_check(db, row.id))
            else None
        ),
```

(Use this explicit-map form; remove the simpler line above.)

- [ ] **Step 4: Run to verify pass**

```bash
pytest tests/test_session_detail_tool_calls.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/sessions.py backend/tests/test_session_detail_tool_calls.py
git commit -m "feat(sessions): expose tool_calls + pending_check on session detail"
```

---

## Task 7: Frontend — surface tool error string (Workstream B2 — UI)

**Files:**
- Modify: `frontend/src/stores/session.js:248-252` (recordToolCall done branch)
- Modify: `frontend/src/components/chat/ToolCallChip.vue`
- Test: `frontend/src/__tests__/toolCallChip.test.js` (existing) + store test

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/__tests__/toolCallChip.test.js`:

```js
it('shows the error string as title on the error state', () => {
  const wrapper = mount(ToolCallChip, {
    props: {
      tool_call: { name: 'update_topic_profile', error: 'evidence_type must be ...' },
      state: 'error',
    },
  })
  expect(wrapper.find('.tool-pill').attributes('title')).toContain('evidence_type')
})
```

- [ ] **Step 2: Run to verify failure**

Run from `frontend/`:

```bash
npm run test:unit -- --run toolCallChip
```

Expected: FAIL — `title` attribute is undefined.

- [ ] **Step 3: Carry the error through the store and render it as a title**

In `frontend/src/stores/session.js`, in `recordToolCall` done branch (line ~250), also store the error:

```js
    } else if (kind === 'done') {
      const tc = streamingMessage.value.tool_calls.find((t) => t.id === tool_call.id)
      if (tc) {
        tc.state = tool_call.status === 'error' ? 'error' : 'done'
        tc.summary = tool_call.summary
        tc.error = tool_call.error
      }
      streamState.value = 'streaming'
    }
```

In `frontend/src/components/chat/ToolCallChip.vue`, add a title binding on the pill:

```vue
  <span
    class="tool-pill"
    :class="`tool-pill--${state}`"
    :title="state === 'error' ? (tool_call.error || display) : undefined"
  >
```

- [ ] **Step 4: Run to verify pass**

```bash
npm run test:unit -- --run toolCallChip
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/session.js frontend/src/components/chat/ToolCallChip.vue frontend/src/__tests__/toolCallChip.test.js
git commit -m "fix(ui): surface tool error string on chip title"
```

---

## Task 8: Grading guard in `record_learning_event` (Workstream A1, Layer B)

**Files:**
- Modify: `backend/services/learning_event_service.py`
- Test: `backend/tests/test_learning_event_service.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_learning_event_service.py` (reuse its `db`/`ctx` fixtures; `ctx` carries
`turn_started_at`):

```python
from datetime import timedelta

from contracts import RecordLearningEventArgs
from services import check_question_service as cq


def test_grade_rejected_without_pending_check(db, ctx):
    args = RecordLearningEventArgs(
        session_id=ctx.session_id, gap_tested="g", question="q?", correct=True
    )
    result = learning_event_service.record(db, ctx, args)
    assert result.ok is False
    assert "no open check-question" in (result.error or "").lower()


def test_grade_rejected_when_asked_this_turn(db, ctx):
    # pending_check asked at the same instant the turn started -> not gradable
    cq.set_pending_check(db, ctx.session_id, gap="g", question="q?", asked_at=ctx.turn_started_at)
    args = RecordLearningEventArgs(
        session_id=ctx.session_id, gap_tested="g", question="q?", correct=True
    )
    result = learning_event_service.record(db, ctx, args)
    assert result.ok is False


def test_grade_accepted_from_prior_turn_and_clears(db, ctx):
    cq.set_pending_check(
        db, ctx.session_id, gap="g", question="q?",
        asked_at=ctx.turn_started_at - timedelta(seconds=5),
    )
    args = RecordLearningEventArgs(
        session_id=ctx.session_id, gap_tested="g", question="q?", correct=True
    )
    result = learning_event_service.record(db, ctx, args)
    assert result.ok is True
    assert result.data["correct"] is True
    assert cq.get_pending_check(db, ctx.session_id) is None
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_learning_event_service.py -v
```

Expected: FAIL — current `record` ignores pending_check; rejection tests fail.

- [ ] **Step 3: Implement the guard + clear**

In `backend/services/learning_event_service.py`, add the import:

```python
from services import check_question_service
```

After the `session_id` mismatch check and before creating the `LearningEvent`, insert:

```python
    if not check_question_service.is_gradable(
        db, ctx.session_id, gap=args.gap_tested, current_turn=ctx.turn_started_at
    ):
        return ToolResult(
            ok=False,
            status="failed",
            error=(
                "no open check-question for this gap from a prior turn; "
                "ask one with ask_check_question and wait for the learner's answer"
            ),
        )
```

At the end, before `return`, clear the pending check and include `correct` in the result data:

```python
    check_question_service.clear_pending_check(db, ctx.session_id)
    return ToolResult(ok=True, status="ok", data={"event_id": event.id, "correct": args.correct})
```

(Keep the existing demotion-on-incorrect logic between flush and clear.)

- [ ] **Step 4: Run to verify pass**

```bash
pytest tests/test_learning_event_service.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/learning_event_service.py backend/tests/test_learning_event_service.py
git commit -m "feat(check): guard record_learning_event behind prior-turn pending check"
```

---

## Task 9: `ask_check_question` tool (Workstream A1, Layer A — registration + service)

**Files:**
- Modify: `backend/agent/tools.py` (TOOLS list + dispatch)
- Modify: `backend/services/check_question_service.py` (add `register` entry point)
- Test: `backend/tests/test_ask_check_question.py` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ask_check_question.py`:

```python
from contracts import AskCheckQuestionArgs
from agent import tools
from services import check_question_service as cq


def test_ask_sets_pending_check(db, ctx):
    args = {"session_id": ctx.session_id, "gap": "calvin_cycle", "question": "Inputs?"}
    result = tools.dispatch("ask_check_question", args, ctx)
    assert result.ok is True
    pc = cq.get_pending_check(db, ctx.session_id)
    assert pc["gap"] == "calvin_cycle"
    assert cq.parse_asked_at(pc) == ctx.turn_started_at


def test_ask_rejected_when_one_already_open(db, ctx):
    tools.dispatch("ask_check_question",
                   {"session_id": ctx.session_id, "gap": "g1", "question": "q1?"}, ctx)
    result = tools.dispatch("ask_check_question",
                            {"session_id": ctx.session_id, "gap": "g2", "question": "q2?"}, ctx)
    assert result.ok is False
    assert "already" in (result.error or "").lower()
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_ask_check_question.py -v
```

Expected: FAIL — `unknown tool: ask_check_question`.

- [ ] **Step 3: Add the `register` function to the service**

In `backend/services/check_question_service.py`, add (imports: `ToolContext`, `ToolResult`,
`AskCheckQuestionArgs` from `contracts`, plus `agent.types`):

```python
from agent.types import ToolContext
from contracts import AskCheckQuestionArgs, ToolResult


def register(db: Session, ctx: ToolContext, args: AskCheckQuestionArgs) -> ToolResult:
    if args.session_id != ctx.session_id:
        return ToolResult(
            ok=False, status="failed",
            error=f"session_id mismatch: args={args.session_id} ctx={ctx.session_id}",
        )
    if get_pending_check(db, ctx.session_id) is not None:
        return ToolResult(
            ok=False, status="failed",
            error="a check-question is already open; grade or skip it first",
        )
    set_pending_check(
        db, ctx.session_id, gap=args.gap, question=args.question,
        asked_at=ctx.turn_started_at,
    )
    return ToolResult(ok=True, status="ok", data={"gap": args.gap, "question": args.question})
```

- [ ] **Step 4: Register the tool + dispatch route in `tools.py`**

Add `AskCheckQuestionArgs` to the `from contracts import (...)` block and
`check_question_service` to the `from services import (...)` block.

Add to the `TOOLS` list:

```python
    {
        "type": "function",
        "function": {
            "name": "ask_check_question",
            "description": (
                "Pose ONE check-question to the learner and end your turn. Also"
                " write the question text in your normal reply. Do NOT call"
                " record_learning_event in the same turn -- you will grade the"
                " learner's answer on the NEXT turn."
            ),
            "parameters": _schema(AskCheckQuestionArgs),
        },
    },
```

Add to `dispatch`:

```python
        if name == "ask_check_question":
            return check_question_service.register(
                ctx.db, ctx, AskCheckQuestionArgs.model_validate(args)
            )
```

- [ ] **Step 5: Run to verify pass**

```bash
pytest tests/test_ask_check_question.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/agent/tools.py backend/services/check_question_service.py backend/tests/test_ask_check_question.py
git commit -m "feat(check): ask_check_question tool registers pending check"
```

---

## Task 10: Turn-terminating loop-break in `tutor.run` + `pending_check` in chat response

**Files:**
- Modify: `backend/agent/tutor.py` (`run`, lines 106-159)
- Modify: `backend/routes/chat.py` (`/chat` handler, lines 128-153)
- Test: `backend/tests/test_tutor_ask_breaks_loop.py` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_tutor_ask_breaks_loop.py`. Follow the existing tutor-loop test
pattern (see how other tutor tests monkeypatch `litellm.acompletion` to return a scripted
message with `tool_calls`; if none exists, build a small fake that yields one assistant
message calling `ask_check_question`, then a second that would call another tool):

```python
import pytest

from agent import tutor
from services import check_question_service as cq


@pytest.mark.asyncio
async def test_ask_check_question_terminates_turn(monkeypatch, db, ctx, fake_completion):
    # fake_completion[0]: assistant text "Q?" + tool_call ask_check_question
    # fake_completion[1]: would call update_topic_profile (must NOT be reached)
    monkeypatch.setattr("litellm.acompletion", fake_completion([
        {"content": "Here is a question: Inputs?",
         "tool_calls": [("ask_check_question",
                         {"session_id": ctx.session_id, "gap": "g", "question": "Inputs?"})]},
        {"content": "SHOULD-NOT-APPEAR", "tool_calls": [("update_topic_profile", {})]},
    ]))
    reply, tool_calls, _ = await tutor.run(
        [{"role": "user", "content": "quiz me"}], "sys", ctx
    )
    assert "SHOULD-NOT-APPEAR" not in reply
    assert any(t.name == "ask_check_question" for t in tool_calls)
    assert cq.get_pending_check(db, ctx.session_id) is not None
```

Add a `fake_completion` fixture to `conftest.py` that returns an async function producing the
scripted responses (one per loop iteration), each exposing `.choices[0].message.content` and
`.choices[0].message.tool_calls` (list of objects with `.id`, `.type`, `.function.name`,
`.function.arguments` JSON string). Mirror the shape `tutor.run` already consumes.

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_tutor_ask_breaks_loop.py -v
```

Expected: FAIL — without the break, the loop runs the 2nd iteration and `SHOULD-NOT-APPEAR` leaks in.

- [ ] **Step 3: Implement the loop-break in `run`**

In `backend/agent/tutor.py`, inside `run`, in the `for tc in msg_tool_calls:` loop, after the
`full.append({... tool result ...})` for the dispatched call, track whether an
`ask_check_question` succeeded. After the `for tc` loop, break the outer iteration:

```python
        asked_check = False
        for tc in msg_tool_calls:
            # ... existing dispatch + record + full.append(tool result) ...
            if tc.function.name == "ask_check_question" and result.ok:
                asked_check = True

        if asked_check:
            # Turn-terminating: yield the question to the learner; grading happens next turn.
            return (msg.content or "", tool_calls_record, citations)
```

(Place the `asked_check` flag init just before the `for tc` loop; set it inside; check it after.)

- [ ] **Step 4: Include `pending_check` in the `/chat` response**

In `backend/routes/chat.py`, add to the `from services import (...)` line:
`check_question_service`. In the `chat` handler, after `db.refresh(assistant_msg)` and before
`return ChatResponse(...)`:

```python
    pc = check_question_service.get_pending_check(db, req.session_id)
    pending_check = {"gap": pc["gap"], "question": pc["question"]} if pc else None
```

Add `pending_check=pending_check,` to the `ChatResponse(...)` constructor.

- [ ] **Step 5: Run to verify pass**

```bash
pytest tests/test_tutor_ask_breaks_loop.py tests/test_tutor*.py -v
```

Expected: PASS (new test + existing tutor tests still green).

- [ ] **Step 6: Commit**

```bash
git add backend/agent/tutor.py backend/routes/chat.py backend/tests/test_tutor_ask_breaks_loop.py backend/tests/conftest.py
git commit -m "feat(tutor): ask_check_question terminates the turn; pending_check in chat response"
```

---

## Task 11: Streaming path — loop-break + `check_question`/`check_result` events

**Files:**
- Modify: `backend/agent/tutor.py` (`run_streaming`, dispatch loop ~383-457; `_summarize` ~193-200)
- Modify: `backend/agent/stream_events.py:14-15` (doc comment — add new event names)
- Test: `backend/tests/test_tutor_stream_check_events.py` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_tutor_stream_check_events.py` (mirror the existing streaming test
fixture that drives `run_streaming` with a fake streaming `acompletion`):

```python
import pytest

from agent import tutor


@pytest.mark.asyncio
async def test_stream_emits_check_question_and_breaks(monkeypatch, db, ctx, fake_stream):
    monkeypatch.setattr("litellm.acompletion", fake_stream([
        {"content": "Question: Inputs?",
         "tool_calls": [("ask_check_question",
                         {"session_id": ctx.session_id, "gap": "g", "question": "Inputs?"})]},
        {"content": "SHOULD-NOT-APPEAR", "tool_calls": []},
    ]))
    events = [e async for e in tutor.run_streaming(
        [{"role": "user", "content": "quiz me"}], "sys", ctx)]
    types = [e.type for e in events]
    assert "check_question" in types
    assert "done" in types
    cq_event = next(e for e in events if e.type == "check_question")
    assert cq_event.data["question"] == "Inputs?"
    # turn terminated -> the 2nd iteration's text never streamed
    assert all("SHOULD-NOT-APPEAR" not in (e.data.get("text", "") if isinstance(e.data, dict) else "")
               for e in events)
```

Add a `fake_stream` fixture to `conftest.py` producing async-iterable chunk objects shaped like
the ones `run_streaming` consumes (each chunk: `.choices[0].delta` with `.content` and
`.tool_calls`).

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_tutor_stream_check_events.py -v
```

Expected: FAIL — no `check_question` event emitted; loop continues.

- [ ] **Step 3: Emit events + break in `run_streaming`**

In `backend/agent/tutor.py` `run_streaming`, inside the `for slot in ordered:` dispatch loop,
after the existing `tool_call_done` emission and the per-tool result handling, add handling for
the two new tools. After the `for slot` loop, break if a check-question was asked:

```python
            # inside the for slot loop, after result is computed and tool_call_done emitted:
            if name == "ask_check_question" and result.ok:
                data = result.data or {}
                yield StreamEvent("check_question",
                                  {"gap": data.get("gap"), "question": data.get("question")})
                asked_check = True
            if name == "record_learning_event" and result.ok:
                data = result.data or {}
                yield StreamEvent("check_result",
                                  {"gap": args.get("gap_tested"), "correct": data.get("correct")})
```

Initialize `asked_check = False` just before the `for slot in ordered:` loop. After that loop and
its `full.append(...)` tool-result entries, add:

```python
            if asked_check:
                msg_id = _persist_assistant_message(
                    ctx, accumulated_text, "complete",
                    tool_calls=tool_calls_record, citations=citations,
                )
                yield StreamEvent("done", {"message_id": str(msg_id)})
                return
```

In `_summarize`, add labels:

```python
    if name == "ask_check_question":
        return "Question asked"
    if name == "record_learning_event":
        return "Answer recorded"
```

Update the `stream_events.py` doc comment (lines 14-15) to list `check_question` and
`check_result` among the event types.

- [ ] **Step 4: Run to verify pass**

```bash
pytest tests/test_tutor_stream_check_events.py tests/test_tutor*.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agent/tutor.py backend/agent/stream_events.py backend/tests/test_tutor_stream_check_events.py backend/tests/conftest.py
git commit -m "feat(tutor): stream check_question/check_result and terminate ask turn"
```

---

## Task 12: Skip endpoint `POST /sessions/{id}/check/skip`

**Files:**
- Modify: `backend/routes/sessions.py`
- Test: `backend/tests/test_check_skip_route.py` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_check_skip_route.py`:

```python
from datetime import datetime, timezone

from services import check_question_service as cq


def test_skip_clears_pending_check(client, db, make_session, auth_headers):
    s = make_session()
    cq.set_pending_check(db, s.id, gap="g", question="q?",
                         asked_at=datetime(2026, 6, 1, tzinfo=timezone.utc))
    resp = client.post(f"/api/sessions/{s.id}/check/skip", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert cq.get_pending_check(db, s.id) is None


def test_skip_idempotent_when_none(client, db, make_session, auth_headers):
    s = make_session()
    resp = client.post(f"/api/sessions/{s.id}/check/skip", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_check_skip_route.py -v
```

Expected: FAIL — 404 (route not defined).

- [ ] **Step 3: Add the route**

In `backend/routes/sessions.py`, add (follow the existing ownership-check pattern used by
`/end` and `/reopen` — load the session, 404 if missing or `user_id` mismatch):

```python
@router.post("/sessions/{session_id}/check/skip")
def skip_check(
    session_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    check_question_service.clear_pending_check(db, session_id)
    return {"ok": True}
```

(`check_question_service`, `SessionModel`, `current_user_id`, `HTTPException`, `Depends`, `get_db`
are already imported from Task 6 / existing route code — confirm and add any missing import.)

- [ ] **Step 4: Run to verify pass**

```bash
pytest tests/test_check_skip_route.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/sessions.py backend/tests/test_check_skip_route.py
git commit -m "feat(sessions): POST /sessions/{id}/check/skip clears pending check"
```

---

## Task 13: Prompt protocol rewrite

**Files:**
- Modify: `backend/agent/prompts.py` (IMMUTABLE_RULES 42-58; `build_dynamic_context` 85-101)
- Test: `backend/tests/test_prompts.py` (create or extend)

- [ ] **Step 1: Write the failing test**

Create/extend `backend/tests/test_prompts.py`:

```python
from agent import prompts


def test_dynamic_context_includes_pending_check():
    state = {"topic": "Photosynthesis", "profile": {}, "pending_check":
             {"gap": "calvin_cycle", "question": "Inputs?"}}
    out = prompts.build_dynamic_context(state)
    assert "PENDING_CHECK" in out
    assert "calvin_cycle" in out


def test_dynamic_context_pending_check_none():
    out = prompts.build_dynamic_context({"topic": "x", "profile": {}})
    assert "PENDING_CHECK: none" in out


def test_immutable_rules_mention_ask_check_question():
    assert "ask_check_question" in prompts.IMMUTABLE_RULES
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_prompts.py -v
```

Expected: FAIL — no `PENDING_CHECK` line; `ask_check_question` absent.

- [ ] **Step 3: Rewrite the protocol + add context line**

In `backend/agent/prompts.py`, replace the FOCUS PROTOCOL + END-OF-FOCUS-AREA PROTOCOL
sections (lines 42-58) with:

```text
FOCUS PROTOCOL:
- When concentrating on a specific gap, set focus_target_gap via
  update_topic_profile (evidence_type is optional for a focus-only patch).
- Clear focus_target_gap (set it to null) only when one of these happens, and
  you MUST supply focus_clear_reason:
  - "demonstrated": the learner gave a clean explanation without a check-question.
  - "tested_correct": a record_learning_event for that gap returned correct=true
    this turn. Log the event BEFORE you clear focus, or the server rejects the clear.
  - "user_redirected": the learner explicitly redirected the conversation.
- Do NOT clear focus just because turns passed.

CHECK-QUESTION PROTOCOL (interactive, one question per turn):
- To test understanding, call ask_check_question(gap, question) with ONE question,
  AND write that same question as your normal reply. This ENDS your turn -- you are
  handing the question to the learner and waiting for their answer.
- NEVER call record_learning_event in the same turn you asked the question. You have
  not seen an answer yet. The server will reject it.
- If CHECK-QUESTION CONTEXT shows PENDING_CHECK is set, the learner's next message is
  their answer. Grade it by calling record_learning_event(gap, question, correct) for
  that gap. The server then clears the pending check.
- To cover a focus area, ask up to 2-3 such questions, ONE PER TURN (ask, wait, grade,
  then optionally ask the next). Do not batch them.
- Only one check-question can be open at a time.
```

In `build_dynamic_context`, add a `pending_check` line. After the `last_session_summary` read,
add:

```python
    pending_check = state.get("pending_check")
    if pending_check:
        pc_label = f'{{"gap": {json.dumps(pending_check.get("gap"))}, "question": {json.dumps(pending_check.get("question"))}}}'
    else:
        pc_label = "none"
```

and append to the returned f-string a new final line:

```python
        f"\nPENDING_CHECK: {pc_label}"
```

- [ ] **Step 4: Wire `pending_check` into the prompt state in `chat.py`**

In `backend/routes/chat.py` `_prepare_turn`, add to the `prompt_state` dict:

```python
        "pending_check": check_question_service.get_pending_check(db, req.session_id),
```

(`check_question_service` imported in Task 10.)

- [ ] **Step 5: Run to verify pass**

```bash
pytest tests/test_prompts.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/agent/prompts.py backend/routes/chat.py backend/tests/test_prompts.py
git commit -m "feat(prompts): interactive one-question-per-turn check protocol + PENDING_CHECK context"
```

---

## Task 14: Frontend store — `pendingCheck` state + event handling + skip

**Files:**
- Modify: `frontend/src/stores/session.js`
- Modify: `frontend/src/services/sessionsApi.js`
- Test: `frontend/src/__tests__/sessionCheckFlow.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/sessionCheckFlow.test.js`:

```js
import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/stores/session.js'

describe('check-question flow', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('sets pendingCheck on check_question and locks; clears verdict on check_result', () => {
    const store = useSessionStore()
    store.handleCheckQuestion({ gap: 'g', question: 'Inputs?' })
    expect(store.pendingCheck).toEqual({ gap: 'g', question: 'Inputs?', verdict: null })
    expect(store.checkLocked).toBe(true)

    store.handleCheckResult({ gap: 'g', correct: true })
    expect(store.pendingCheck.verdict).toBe(true)
    expect(store.checkLocked).toBe(false) // answered -> unlocked
  })

  it('skipCheck calls API and clears pendingCheck', async () => {
    const store = useSessionStore()
    store.currentSessionId = 's1'
    store.handleCheckQuestion({ gap: 'g', question: 'q?' })
    const api = await import('@/services/sessionsApi.js')
    vi.spyOn(api, 'skipCheck').mockResolvedValue({ ok: true })
    await store.skipCheck()
    expect(api.skipCheck).toHaveBeenCalledWith('s1')
    expect(store.pendingCheck).toBe(null)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm run test:unit -- --run sessionCheckFlow
```

Expected: FAIL — `handleCheckQuestion`/`pendingCheck`/`skipCheck` undefined.

- [ ] **Step 3: Add `skipCheck` to the API client**

In `frontend/src/services/sessionsApi.js` add:

```js
export const skipCheck = (sessionId) => apiPost(`/sessions/${sessionId}/check/skip`, {})
```

- [ ] **Step 4: Add state, handlers, and event wiring to the store**

In `frontend/src/stores/session.js`:

Add `import { skipCheck as apiSkipCheck } from '../services/sessionsApi.js'` (or extend the existing
`* as sessionsApi` usage — match the file's import style; it uses `* as sessionsApi`, so call
`sessionsApi.skipCheck`).

Add state + computed near `streamingMessage`:

```js
  const pendingCheck = ref(null) // { gap, question, verdict: boolean|null } | null
  const checkLocked = computed(
    () => pendingCheck.value !== null && pendingCheck.value.verdict === null,
  )

  function handleCheckQuestion({ gap, question }) {
    pendingCheck.value = { gap, question, verdict: null }
  }
  function handleCheckResult({ correct }) {
    if (pendingCheck.value) pendingCheck.value = { ...pendingCheck.value, verdict: correct }
  }
  function clearPendingCheck() {
    pendingCheck.value = null
  }
  async function skipCheck() {
    const id = currentSessionId.value
    if (!id) return
    await sessionsApi.skipCheck(id)
    pendingCheck.value = null
  }
```

In `sendMessageStreaming`'s `onEvent` switch, add cases:

```js
            case 'check_question': handleCheckQuestion(data); break
            case 'check_result': handleCheckResult(data); break
```

In `finalizeMessage`, do NOT touch `pendingCheck` (the asking turn ends with the card still open;
the grading turn's `check_result` resolves it). When the learner sends their answer, clear the
*resolved* card first: at the top of `sendMessageStreaming`, before pushing the user message, add:

```js
    if (pendingCheck.value && pendingCheck.value.verdict !== null) pendingCheck.value = null
```

In `loadSession`, set the card from the resumed detail:

```js
      pendingCheck.value = s.pending_check
        ? { gap: s.pending_check.gap, question: s.pending_check.question, verdict: null }
        : null
```

In `reset`, add `pendingCheck.value = null`.

Export `pendingCheck`, `checkLocked`, `handleCheckQuestion`, `handleCheckResult`,
`clearPendingCheck`, `skipCheck` in the store's return object.

- [ ] **Step 5: Run to verify pass**

```bash
npm run test:unit -- --run sessionCheckFlow
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/stores/session.js frontend/src/services/sessionsApi.js frontend/src/__tests__/sessionCheckFlow.test.js
git commit -m "feat(ui): pendingCheck store state, check event handling, skip action"
```

---

## Task 15: `CheckQuestion.vue` card

**Files:**
- Create: `frontend/src/components/chat/CheckQuestion.vue`
- Modify: `frontend/src/components/chat/toolLabels.js`
- Test: `frontend/src/__tests__/checkQuestion.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/checkQuestion.test.js`:

```js
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CheckQuestion from '@/components/chat/CheckQuestion.vue'

describe('CheckQuestion', () => {
  it('renders the question and a Skip button while unanswered', () => {
    const w = mount(CheckQuestion, { props: { check: { gap: 'g', question: 'Inputs?', verdict: null } } })
    expect(w.text()).toContain('Inputs?')
    expect(w.find('[data-testid="check-skip"]').exists()).toBe(true)
  })

  it('shows a correct marker when verdict is true', () => {
    const w = mount(CheckQuestion, { props: { check: { gap: 'g', question: 'q?', verdict: true } } })
    expect(w.find('[data-testid="check-verdict"]').text().toLowerCase()).toContain('correct')
  })

  it('emits skip when the Skip button is clicked', async () => {
    const w = mount(CheckQuestion, { props: { check: { gap: 'g', question: 'q?', verdict: null } } })
    await w.find('[data-testid="check-skip"]').trigger('click')
    expect(w.emitted('skip')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm run test:unit -- --run checkQuestion
```

Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement the card**

Create `frontend/src/components/chat/CheckQuestion.vue`:

```vue
<script setup>
import { computed } from 'vue'

const props = defineProps({
  check: { type: Object, required: true }, // { gap, question, verdict: boolean|null }
})
const emit = defineEmits(['skip'])

const answered = computed(() => props.check.verdict !== null)
const correct = computed(() => props.check.verdict === true)
</script>

<template>
  <section class="check-card" :class="{ answered, correct, incorrect: answered && !correct }" data-testid="check-card">
    <span class="check-eyebrow">Check question</span>
    <p class="check-question">{{ check.question }}</p>
    <div v-if="answered" class="check-verdict" data-testid="check-verdict">
      {{ correct ? 'Correct' : 'Not quite' }}
    </div>
    <button
      v-else
      type="button"
      class="check-skip"
      data-testid="check-skip"
      @click="emit('skip')"
    >
      Skip this question
    </button>
  </section>
</template>

<style scoped>
.check-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem 1.125rem;
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-lg);
  background: var(--color-accent-soft);
}
.check-eyebrow {
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-accent-text);
}
.check-question {
  margin: 0;
  font-weight: 600;
  color: var(--color-text);
}
.check-skip {
  align-self: flex-start;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  padding: 0.35rem 0.9rem;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  cursor: pointer;
}
.check-skip:hover,
.check-skip:focus-visible { border-color: var(--color-accent); color: var(--color-accent); outline: none; }
.check-verdict { font-weight: 600; }
.check-card.correct { border-color: var(--signal-success, #2e7d32); }
.check-card.incorrect { border-color: var(--signal-warning, #b26a00); }
</style>
```

- [ ] **Step 4: Add the tool label**

In `frontend/src/components/chat/toolLabels.js`, add to `TOOL_LABELS`:

```js
  ask_check_question: {
    running: 'Asking a question…',
    done: 'Question asked',
    error: 'Could not ask question',
  },
```

- [ ] **Step 5: Run to verify pass**

```bash
npm run test:unit -- --run checkQuestion
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/chat/CheckQuestion.vue frontend/src/components/chat/toolLabels.js frontend/src/__tests__/checkQuestion.test.js
git commit -m "feat(ui): CheckQuestion card + ask_check_question label"
```

---

## Task 16: Composer lock + SessionView wiring

**Files:**
- Modify: `frontend/src/components/chat/Composer.vue`
- Modify: `frontend/src/views/SessionView.vue`
- Test: `frontend/src/__tests__/composerLock.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/composerLock.test.js`:

```js
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Composer from '@/components/chat/Composer.vue'

describe('Composer lock', () => {
  it('shows a Skip button and an answer placeholder when locked', () => {
    const w = mount(Composer, { props: { modelValue: '', locked: true } })
    expect(w.find('[data-testid="composer-skip"]').exists()).toBe(true)
    expect(w.find('.composer-input').attributes('placeholder')).toMatch(/answer/i)
  })

  it('emits skip when the lock Skip button is clicked', async () => {
    const w = mount(Composer, { props: { modelValue: '', locked: true } })
    await w.find('[data-testid="composer-skip"]').trigger('click')
    expect(w.emitted('skip')).toBeTruthy()
  })

  it('does not show Skip when unlocked', () => {
    const w = mount(Composer, { props: { modelValue: '', locked: false } })
    expect(w.find('[data-testid="composer-skip"]').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm run test:unit -- --run composerLock
```

Expected: FAIL — no `locked` prop / Skip button.

- [ ] **Step 3: Add the `locked` prop, dynamic placeholder, Skip button to Composer**

In `frontend/src/components/chat/Composer.vue`:

Add to `defineProps`:

```js
  locked: { type: Boolean, default: false },
```

Add `'skip'` to `defineEmits`: `const emit = defineEmits(['update:modelValue', 'send', 'stop', 'attach', 'skip'])`.

Make the textarea placeholder dynamic. Add a computed:

```js
const placeholder = computed(() =>
  props.locked
    ? 'Answer the question, or Skip…'
    : 'Ask anything. Press Enter to send · Shift + Enter for a new line.',
)
```

Bind it: change the textarea's `placeholder="..."` to `:placeholder="placeholder"`.

Disable the attach button while locked: change its `:disabled="disabled || uploading"` to
`:disabled="disabled || uploading || locked"`.

Add a Skip button next to the send button (inside `.composer`, after the send/stop buttons),
shown only when locked:

```vue
      <button
        v-if="locked"
        type="button"
        class="composer-skip"
        data-testid="composer-skip"
        aria-label="Skip this question"
        @click="emit('skip')"
      >
        Skip
      </button>
```

Add minimal styling in the `<style scoped>` block:

```css
.composer-skip {
  grid-column: 3;
  align-self: end;
  margin-bottom: 0.1rem;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  color: var(--color-text-muted);
  padding: 0 0.75rem;
  height: 2.5rem;
  font-size: 0.8125rem;
  cursor: pointer;
}
```

(The Skip button shares grid-column 3 with send; when `locked` the learner still types an answer
and sends normally, and Skip sits beside it. If layout crowds, place Skip in the hints row instead —
acceptable either way; keep the `data-testid`.)

- [ ] **Step 4: Wire lock + skip + card into SessionView**

In `frontend/src/views/SessionView.vue`:

Import the card: `import CheckQuestion from '../components/chat/CheckQuestion.vue'`.

Render the card between `<UploadStatus .../>` and `<Composer .../>`:

```vue
      <CheckQuestion
        v-if="store.pendingCheck"
        :check="store.pendingCheck"
        @skip="onSkipCheck"
      />
```

Pass `:locked="store.checkLocked"` and `@skip="onSkipCheck"` to the `<Composer>` element.

Add the handler in `<script setup>`:

```js
async function onSkipCheck() {
  try {
    await store.skipCheck()
  } catch (e) {
    lastError.value = e
  }
}
```

- [ ] **Step 5: Run to verify pass**

```bash
npm run test:unit -- --run composerLock
npm run test:unit -- --run
```

Expected: PASS (new test + full frontend suite green).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/chat/Composer.vue frontend/src/views/SessionView.vue frontend/src/__tests__/composerLock.test.js
git commit -m "feat(ui): hard composer lock + Skip + CheckQuestion card wiring"
```

---

## Task 17: Full-suite verification + focus-clear interaction guard test

**Files:**
- Test: `backend/tests/test_focus_clear_grading_turn.py` (create)

- [ ] **Step 1: Write the interaction test (Spec A5)**

Create `backend/tests/test_focus_clear_grading_turn.py`:

```python
from datetime import timedelta

from contracts import RecordLearningEventArgs, UpdateTopicProfileArgs
from services import check_question_service as cq, learning_event_service, profile_service


def test_grade_then_clear_focus_tested_correct_same_turn(db, ctx):
    # focus set, question asked in a PRIOR turn
    profile_service.apply_patch(db, ctx, UpdateTopicProfileArgs(
        session_id=ctx.session_id, focus_target_gap="g", evidence_type=None))
    cq.set_pending_check(db, ctx.session_id, gap="g", question="q?",
                         asked_at=ctx.turn_started_at - timedelta(seconds=5))

    # grading turn: log correct event, then clear focus with tested_correct
    rec = learning_event_service.record(db, ctx, RecordLearningEventArgs(
        session_id=ctx.session_id, gap_tested="g", question="q?", correct=True))
    assert rec.ok is True

    clr = profile_service.apply_patch(db, ctx, UpdateTopicProfileArgs(
        session_id=ctx.session_id, focus_target_gap=None,
        focus_clear_reason="tested_correct", evidence_type=None))
    assert clr.ok is True
    assert profile_service.load_profile(db, ctx.session_id).focus_target_gap is None
```

- [ ] **Step 2: Run it**

```bash
pytest tests/test_focus_clear_grading_turn.py -v
```

Expected: PASS (the LearningEvent and the focus-clear co-occur in the grading turn; the
`created_at >= turn_started_at` guard is satisfied).

- [ ] **Step 3: Run the full backend + frontend suites**

```bash
cd backend && pytest
cd ../frontend && npm run test:unit -- --run && npm run lint
```

Expected: all green; lint clean.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_focus_clear_grading_turn.py
git commit -m "test(check): focus-clear tested_correct holds in grading turn"
```

---

## Task 18: Live smoke test (manual, real LLM)

**Files:** none (verification only)

- [ ] **Step 1: Start the stack** — `docker compose up` (or the running dev servers on 5173/8000).
- [ ] **Step 2:** Open a session, send "quiz me on photosynthesis".
- [ ] **Step 3: Verify** a `CheckQuestion` card renders, the composer is locked (Answer/Skip only),
  and NO "Answer recorded" chip appears on the asking turn.
- [ ] **Step 4:** Answer the question. Verify a `check_result` verdict shows on the card, the
  composer unlocks, and an explanation follows.
- [ ] **Step 5:** Ask again, then click Skip. Verify the card clears and the composer unlocks with
  no `LearningEvent` logged.
- [ ] **Step 6:** Trigger a focus change ("set focus to the Calvin cycle"). Verify NO
  "Profile update failed" chip (or, if one appears, read its hover title — now populated — and
  file the exact error for follow-up).
- [ ] **Step 7:** Reload the page mid-open-question. Verify the card + lock survive (resumed from
  `SessionDetail.pending_check`).

---

## Self-Review

**Spec coverage:**
- A1 Layer B guard → Tasks 3, 8. Layer A turn-terminating tool → Tasks 9, 10, 11.
- A2 prompt rewrite + PENDING_CHECK → Task 13.
- A3 Skip endpoint + hard lock → Tasks 12, 16.
- A4 grading flow + events → Tasks 8, 11, 14.
- A5 focus-clear interaction → Task 17.
- A6 frontend card + lock → Tasks 14, 15, 16.
- B1 evidence_type conditional → Tasks 1, 4.
- B2 diagnosability (3 layers) → Tasks 5, 6, 7.
- B3 confirm exact error → Task 18 step 6.
- Contracts/migration → Tasks 1, 2. Resume support → Tasks 6 (SessionDetail.pending_check) + 14 (loadSession).

**Placeholder scan:** No "TBD"/"handle errors"/"similar to". Test code and impl code are inline.
Two fixtures (`make_session`, `fake_completion`/`fake_stream`) are introduced in Task 3 / Tasks 10-11
with explicit shape requirements rather than full bodies — the engineer mirrors existing tutor/route
tests; this is a known, bounded dependency, not a hidden placeholder.

**Type consistency:** `pending_check` JSON shape `{gap, question, asked_at_turn}` is consistent
across `check_question_service`, the guard, the route mappers (which strip to `{gap, question}` for
the `PendingCheck` contract), and the store (`{gap, question, verdict}` adds a UI-only field).
`is_gradable(db, session_id, gap, current_turn)` signature matches its call in
`learning_event_service`. `checkLocked` (verdict === null) is used identically in store, Composer,
and SessionView.
