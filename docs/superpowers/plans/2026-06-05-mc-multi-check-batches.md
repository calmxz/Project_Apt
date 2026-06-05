# Multi-Question Check Batches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tutor turn pose a batch of 1-5 multiple-choice check-questions, advance the learner through them with Next/Done, and auto-fire a hidden tutor follow-up that reacts to the batch results.

**Architecture:** Migrate the single-question `pending_check` JSON blob to a batch with a `current_index` linear state machine. The tool `ask_check_question` becomes `ask_check_questions` (a 1-item batch is the old single case). Per-answer grading still runs deterministically server-side and records a `LearningEvent` (with demotion), but the batch is only cleared at the end by a new dedicated SSE endpoint `POST /sessions/{id}/check/complete`, which injects a server-built results summary as a non-persisted synthetic user turn so only the tutor's reaction is shown.

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic (codegen from `docs/api/openapi.yaml`), LiteLLM streaming, Vue 3 + Pinia, Vitest/pytest.

**Source of truth:** `docs/superpowers/specs/2026-06-04-mc-multi-check-design.md`. Read it before starting.

**Three landmines this plan defuses explicitly (verified against current code):**
1. `learning_event_service.record_from_answer` ends with `clear_pending_check(...)` (`learning_event_service.py:104`). In a batch, answering item *i* must NOT wipe the whole batch. Task 3 adds `clear_pending`/`commit` params; batch `answer()` passes `clear_pending=False, commit=False`.
2. The tool-name rename touches more than the spec's "four sites." Verified literal `ask_check_question` hits: `tools.py:61,91`, `tutor.py:102,136,219,391,446`, `prompts.py:55,62`, plus tests. The type symbol `AskCheckQuestionArgs` -> `AskCheckQuestionsArgs` is a *separate* rename. Task 6 starts with a grep.
3. `prompts.py:109` renders `pending_check.get("question")` from the RAW stored dict (`chat.py:106` injects the raw dict). The batch shape has no top-level `question` -> it would render `null`. Task 7 rewrites that render.

**Commands** (run from the stated dir):
- Backend tests: from `backend/`: `pytest -q`
- Single test: from `backend/`: `pytest tests/test_x.py::test_y -v`
- Regenerate contracts: from repo root: `python backend/scripts/gen_contracts.py`
- Frontend tests: from `frontend/`: `npm run test:unit -- --run`
- Frontend lint: from `frontend/`: `npm run lint`

---

## Task 1: Contract migration (openapi.yaml -> codegen)

Edit YAML first, never hand-edit `backend/contracts/models.py`. Replace the single-question schemas with batch-shaped ones.

**Files:**
- Modify: `docs/api/openapi.yaml:447-499` (the `AskCheckQuestionArgs` / `PendingCheck` / `CheckAnswerRequest` / `CheckAnswerResponse` block)
- Generated: `backend/contracts/models.py` (via codegen — do not hand-edit)
- Test: `backend/tests/test_contracts.py`

- [ ] **Step 1: Replace the four schemas in openapi.yaml**

Replace lines `447-499` (from `AskCheckQuestionArgs:` through the end of `CheckAnswerResponse:`) with:

```yaml
    AskCheckQuestionsArgs:
      type: object
      additionalProperties: false
      required: [session_id, gap, items]
      description: |
        Register an ordered batch of 1..5 multiple-choice check-questions and end
        the turn. The first question's text is also streamed as assistant text.
        Per-item correct_index must be < len(options); that cross-field rule is
        enforced in check_question_service, not here.
      properties:
        session_id: { type: string, maxLength: 64 }
        gap:        { type: string, maxLength: 200 }
        items:
          type: array
          minItems: 1
          maxItems: 5
          items:
            type: object
            additionalProperties: false
            required: [question, options, correct_index, explanation]
            properties:
              question:      { type: string, maxLength: 1000 }
              options:
                type: array
                minItems: 2
                maxItems: 4
                items: { type: string, maxLength: 200 }
              correct_index: { type: integer, minimum: 0 }
              explanation:   { type: string, maxLength: 500 }

    PendingCheck:
      type: object
      additionalProperties: false
      required: [gap, current_index, total, items]
      description: |
        An open check-question BATCH awaiting learner answers. PUBLIC projection.
        Per item: question + options always present. correct_index, explanation,
        selected_index, correct are present ONLY for already-answered or skipped
        items - never leaked for pending ones.
      properties:
        gap:           { type: string }
        current_index: { type: integer }
        total:         { type: integer }
        items:
          type: array
          items:
            type: object
            additionalProperties: false
            required: [question, options, status]
            properties:
              question: { type: string }
              options:  { type: array, items: { type: string } }
              status:   { type: string, enum: [pending, answered, skipped] }
              selected_index: { type: [integer, "null"], default: null }
              correct_index:  { type: [integer, "null"], default: null }
              correct:        { type: [boolean, "null"], default: null }
              explanation:    { type: [string, "null"],  default: null }

    CheckAnswerRequest:
      type: object
      additionalProperties: false
      required: [index, selected_index]
      description: A learner's clicked answer to item `index` of the open batch.
      properties:
        index:          { type: integer, minimum: 0 }
        selected_index: { type: integer, minimum: 0 }

    CheckAnswerResponse:
      type: object
      additionalProperties: false
      required: [correct, explanation, correct_index, current_index, total, has_next, done]
      description: Deterministic grade of a clicked answer plus batch progress.
      properties:
        correct:       { type: boolean }
        explanation:   { type: string }
        correct_index: { type: integer }
        current_index: { type: integer }
        total:         { type: integer }
        has_next:      { type: boolean }
        done:          { type: boolean }

    CheckSkipRequest:
      type: object
      additionalProperties: false
      required: [index]
      description: Skip item `index` of the open batch (no LearningEvent).
      properties:
        index: { type: integer, minimum: 0 }

    CheckSkipResponse:
      type: object
      additionalProperties: false
      required: [current_index, total, has_next, done]
      properties:
        current_index: { type: integer }
        total:         { type: integer }
        has_next:      { type: boolean }
        done:          { type: boolean }
```

(The `ChatResponse.pending_check` and `SessionDetail.pending_check` `oneOf[PendingCheck, null]` refs at `:545` and `:634` are unchanged — the shape flows through.)

- [ ] **Step 2: Regenerate contracts**

Run from repo root: `python backend/scripts/gen_contracts.py`
Expected: `backend/contracts/models.py` now exports `AskCheckQuestionsArgs`, `CheckSkipRequest`, `CheckSkipResponse`; `AskCheckQuestionArgs` is gone; `CheckAnswerRequest`/`CheckAnswerResponse`/`PendingCheck` are the new shape.

- [ ] **Step 3: Update contract tests (red first)**

In `backend/tests/test_contracts.py`, replace the `AskCheckQuestionArgs` import and its tests (`:5`, `:99-128`) with batch-shaped equivalents:

```python
from contracts import (
    AskCheckQuestionsArgs,
    # ...keep the rest of the existing imports...
)


def _one_item():
    return {
        "question": "What nets per glucose?",
        "options": ["2 ATP", "36 ATP"],
        "correct_index": 0,
        "explanation": "Net 2 ATP.",
    }


def test_ask_check_questions_args_required_fields():
    args = AskCheckQuestionsArgs(session_id="s1", gap="atp", items=[_one_item()])
    assert args.gap == "atp"
    assert len(args.items) == 1


def test_ask_check_questions_args_rejects_empty_items():
    import pytest
    with pytest.raises(Exception):
        AskCheckQuestionsArgs(session_id="s1", gap="atp", items=[])


def test_ask_check_questions_args_rejects_over_five_items():
    import pytest
    with pytest.raises(Exception):
        AskCheckQuestionsArgs(session_id="s1", gap="atp", items=[_one_item()] * 6)


def test_ask_check_questions_args_extra_fields_rejected():
    import pytest
    with pytest.raises(Exception):
        AskCheckQuestionsArgs(session_id="s1", gap="g", items=[_one_item()], surprise="x")
```

- [ ] **Step 4: Run contract + drift tests**

Run from `backend/`: `pytest tests/test_contracts.py -v`
Expected: PASS. (Other suites still red until later tasks — that is expected.)

There is a contract-drift guard test in the suite (codegen must equal committed `models.py`). After Step 2 it passes. If a drift test names a file, run it: `pytest -q -k contract`.

- [ ] **Step 5: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts/models.py backend/tests/test_contracts.py
git commit -m "feat(contracts): batch-shaped check-question schemas"
```

---

## Task 2: check_question_service batch state machine

**Files:**
- Modify: `backend/services/check_question_service.py`
- Test: `backend/tests/test_check_question_service.py`

- [ ] **Step 1: Write failing tests for the batch state machine**

Append to `backend/tests/test_check_question_service.py` (the file already has `db`, `ctx`, `session_id` fixtures at `:35-52`):

```python
from contracts import AskCheckQuestionsArgs


def _batch_args(session_id):
    return AskCheckQuestionsArgs(
        session_id=session_id,
        gap="atp",
        items=[
            {"question": "Q1?", "options": ["2 ATP", "36 ATP"],
             "correct_index": 0, "explanation": "Net 2."},
            {"question": "Q2?", "options": ["yes", "no", "maybe"],
             "correct_index": 1, "explanation": "It is no."},
        ],
    )


def test_register_batch_persists_items_pending(db, ctx, session_id):
    res = cq.register(db, ctx, _batch_args(session_id))
    assert res.ok is True
    assert res.data == {
        "gap": "atp",
        "total": 2,
        "items": [
            {"question": "Q1?", "options": ["2 ATP", "36 ATP"]},
            {"question": "Q2?", "options": ["yes", "no", "maybe"]},
        ],
    }
    pc = cq.get_pending_check(db, session_id)
    assert pc["current_index"] == 0
    assert pc["items"][0]["status"] == "pending"
    assert pc["items"][1]["correct_index"] == 1


def test_register_rejects_second_batch_while_open(db, ctx, session_id):
    cq.register(db, ctx, _batch_args(session_id))
    again = cq.register(db, ctx, _batch_args(session_id))
    assert again.ok is False
    assert "already open" in (again.error or "")


def test_register_rejects_bad_correct_index(db, ctx, session_id):
    bad = AskCheckQuestionsArgs(
        session_id=session_id, gap="g",
        items=[{"question": "q", "options": ["a", "b"],
                "correct_index": 5, "explanation": "e"}],
    )
    res = cq.register(db, ctx, bad)
    assert res.ok is False
    assert "correct_index" in (res.error or "")


def test_public_view_hides_pending_reveals_answered(db, ctx, session_id):
    cq.register(db, ctx, _batch_args(session_id))
    cq.answer(db, session_id, index=0, selected_index=1)  # wrong on Q1
    view = cq.public_view(cq.get_pending_check(db, session_id))
    assert view["current_index"] == 1
    assert view["total"] == 2
    answered, pending = view["items"][0], view["items"][1]
    assert answered["status"] == "answered"
    assert answered["selected_index"] == 1
    assert answered["correct_index"] == 0
    assert answered["correct"] is False
    assert answered["explanation"] == "Net 2."
    # pending item leaks nothing
    assert pending["status"] == "pending"
    assert pending["correct_index"] is None
    assert pending["explanation"] is None
    assert "options" in pending and "question" in pending


def test_answer_advances_and_reports_progress(db, ctx, session_id):
    cq.register(db, ctx, _batch_args(session_id))
    r0 = cq.answer(db, session_id, index=0, selected_index=0)
    assert r0 == {"correct": True, "explanation": "Net 2.", "correct_index": 0,
                  "current_index": 1, "total": 2, "has_next": True, "done": False}
    r1 = cq.answer(db, session_id, index=1, selected_index=1)
    assert r1["correct"] is True
    assert r1["has_next"] is False
    assert r1["done"] is True


def test_answer_out_of_order_rejected(db, ctx, session_id):
    cq.register(db, ctx, _batch_args(session_id))
    with pytest.raises(cq.CheckStateError):
        cq.answer(db, session_id, index=1, selected_index=0)


def test_answer_does_not_clear_batch(db, ctx, session_id):
    cq.register(db, ctx, _batch_args(session_id))
    cq.answer(db, session_id, index=0, selected_index=0)
    # The whole batch must survive the first answer (landmine 1).
    assert cq.get_pending_check(db, session_id) is not None


def test_skip_advances_no_event(db, ctx, session_id):
    cq.register(db, ctx, _batch_args(session_id))
    r = cq.skip(db, session_id, index=0)
    assert r == {"current_index": 1, "total": 2, "has_next": True, "done": False}
    pc = cq.get_pending_check(db, session_id)
    assert pc["items"][0]["status"] == "skipped"


def test_is_done_true_after_last(db, ctx, session_id):
    cq.register(db, ctx, _batch_args(session_id))
    cq.skip(db, session_id, index=0)
    cq.skip(db, session_id, index=1)
    assert cq.is_done(cq.get_pending_check(db, session_id)) is True


def test_build_results_summary_mentions_misses_and_skips(db, ctx, session_id):
    cq.register(db, ctx, _batch_args(session_id))
    cq.answer(db, session_id, index=0, selected_index=1)  # wrong
    cq.skip(db, session_id, index=1)
    summary = cq.build_results_summary(cq.get_pending_check(db, session_id))
    assert "gap=atp" in summary
    assert "0/1 correct" in summary or "0/2" in summary
    assert "skipped" in summary.lower()
```

Also DELETE the now-invalid single-question tests in this file: `test_set_get_clear_pending_check` (`:55`), `test_public_view_includes_options_never_answer_fields` (`:90`), `test_register_persists_options_and_rejects_bad_correct_index` (`:109`). Keep `test_is_gradable_requires_prior_turn` (`:74`) only if `set_pending_check` is retained — see Step 3; if `set_pending_check` is removed, delete that test too.

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_check_question_service.py -v`
Expected: FAIL — `AskCheckQuestionsArgs` import works but `cq.answer`, `cq.skip`, `cq.is_done`, `cq.build_results_summary`, `cq.CheckStateError` are undefined.

- [ ] **Step 3: Rewrite check_question_service.py**

Replace the whole file with:

```python
"""Pending check-question BATCH state machine.

A pending_check lives on the Session row as JSON:
    {
        "gap": str,
        "current_index": int,          # next unanswered item
        "asked_at_turn": iso8601,
        "items": [
            {"question": str, "options": [str], "correct_index": int,
             "explanation": str, "status": "pending"|"answered"|"skipped",
             "selected_index": int|None, "correct": bool|None},
            ...
        ],
    }

Anti-cheat: public_view() reveals correct_index / explanation / selected_index /
correct ONLY for items whose status != "pending". Pending items leak only
question + options.

State machine is linear: answer()/skip() require index == current_index.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from contracts import AskCheckQuestionsArgs, ToolResult
from db.models import Session as SessionModel

if TYPE_CHECKING:
    from agent.types import ToolContext


class CheckStateError(Exception):
    """Raised on an out-of-order or no-batch answer/skip."""


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


def is_gradable(db: Session, session_id: str, gap: str, current_turn: datetime) -> bool:
    """Legacy guard kept for learning_event_service.record() (the LLM tool path).
    Batch gap stays top-level so this still resolves."""
    pc = get_pending_check(db, session_id)
    if pc is None or pc.get("gap") != gap:
        return False
    return parse_asked_at(pc) < current_turn


def public_view(pc: dict | None) -> dict | None:
    if not pc:
        return None
    items = []
    for it in pc.get("items", []):
        revealed = it.get("status") != "pending"
        items.append(
            {
                "question": it["question"],
                "options": it.get("options", []),
                "status": it.get("status", "pending"),
                "selected_index": it.get("selected_index") if revealed else None,
                "correct_index": it.get("correct_index") if revealed else None,
                "correct": it.get("correct") if revealed else None,
                "explanation": it.get("explanation") if revealed else None,
            }
        )
    return {
        "gap": pc["gap"],
        "current_index": pc.get("current_index", 0),
        "total": len(items),
        "items": items,
    }


def _save(db: Session, session_id: str, pc: dict, commit: bool = True) -> None:
    row = db.get(SessionModel, session_id)
    if row is None:
        raise ValueError(f"session not found: {session_id}")
    row.pending_check_json = json.dumps(pc)
    if commit:
        db.commit()


def clear_pending_check(db: Session, session_id: str, commit: bool = True) -> None:
    row = db.get(SessionModel, session_id)
    if row is None:
        return
    row.pending_check_json = None
    if commit:
        db.commit()


def is_done(pc: dict | None) -> bool:
    if not pc:
        return False
    return pc.get("current_index", 0) >= len(pc.get("items", []))


def register(db: Session, ctx: "ToolContext", args: AskCheckQuestionsArgs) -> ToolResult:
    if args.session_id != ctx.session_id:
        return ToolResult(
            ok=False, status="failed",
            error=f"session_id mismatch: args={args.session_id} ctx={ctx.session_id}",
        )
    if not (1 <= len(args.items) <= 5):
        return ToolResult(
            ok=False, status="failed",
            error=f"items count {len(args.items)} out of range 1..5",
        )
    for n, it in enumerate(args.items):
        if not (0 <= it.correct_index < len(it.options)):
            return ToolResult(
                ok=False, status="failed",
                error=(
                    f"item {n}: correct_index {it.correct_index} out of range "
                    f"for {len(it.options)} options"
                ),
            )
    if get_pending_check(db, ctx.session_id) is not None:
        return ToolResult(
            ok=False, status="failed",
            error="a check-question batch is already open; resolve it first",
        )

    pc = {
        "gap": args.gap,
        "current_index": 0,
        "asked_at_turn": ctx.turn_started_at.isoformat(),
        "items": [
            {
                "question": it.question,
                "options": list(it.options),
                "correct_index": it.correct_index,
                "explanation": it.explanation,
                "status": "pending",
                "selected_index": None,
                "correct": None,
            }
            for it in args.items
        ],
    }
    _save(db, ctx.session_id, pc)
    return ToolResult(
        ok=True, status="ok",
        data={
            "gap": args.gap,
            "total": len(args.items),
            "items": [{"question": it.question, "options": list(it.options)} for it in args.items],
        },
    )


def _progress(pc: dict) -> dict:
    ci = pc["current_index"]
    total = len(pc["items"])
    done = ci >= total
    return {"current_index": ci, "total": total, "has_next": not done, "done": done}


def answer(db: Session, session_id: str, index: int, selected_index: int) -> dict:
    """Grade item `index` (must equal current_index), record the LearningEvent
    + profile effect, mark the item answered, advance current_index, persist -
    all in ONE commit. Does NOT clear the batch."""
    from services import learning_event_service  # local import avoids circular

    pc = get_pending_check(db, session_id)
    if pc is None:
        raise CheckStateError("no open check-question batch")
    ci = pc["current_index"]
    if index != ci:
        raise CheckStateError(f"out-of-order answer: index={index} current_index={ci}")
    if ci >= len(pc["items"]):
        raise CheckStateError("batch already resolved")
    item = pc["items"][ci]
    if not (0 <= selected_index < len(item["options"])):
        raise CheckStateError("selected_index out of range")

    correct = selected_index == item["correct_index"]
    # Profile effect + LearningEvent, deferred into our single commit; does not clear.
    learning_event_service.record_from_answer(
        db, session_id, gap=pc["gap"], question=item["question"],
        correct=correct, clear_pending=False, commit=False,
    )
    item["status"] = "answered"
    item["selected_index"] = selected_index
    item["correct"] = correct
    pc["current_index"] = ci + 1
    _save(db, session_id, pc, commit=False)
    db.commit()

    prog = _progress(pc)
    return {
        "correct": correct,
        "explanation": item["explanation"],
        "correct_index": item["correct_index"],
        **prog,
    }


def skip(db: Session, session_id: str, index: int) -> dict:
    pc = get_pending_check(db, session_id)
    if pc is None:
        raise CheckStateError("no open check-question batch")
    ci = pc["current_index"]
    if index != ci:
        raise CheckStateError(f"out-of-order skip: index={index} current_index={ci}")
    if ci >= len(pc["items"]):
        raise CheckStateError("batch already resolved")
    pc["items"][ci]["status"] = "skipped"
    pc["current_index"] = ci + 1
    _save(db, session_id, pc)
    return _progress(pc)


def build_results_summary(pc: dict) -> str:
    """Server-built summary injected as a synthetic user turn for the follow-up.
    Reflects post-answer profile state (demotions already applied per-answer)."""
    items = pc.get("items", [])
    graded = [it for it in items if it["status"] == "answered"]
    n_correct = sum(1 for it in graded if it.get("correct"))
    lines = [f"[check results] gap={pc['gap']}: {n_correct}/{len(graded)} correct."]
    for n, it in enumerate(items):
        if it["status"] == "skipped":
            lines.append(f"  Q{n + 1} skipped.")
        elif it["status"] == "answered" and not it.get("correct"):
            chose = it["options"][it["selected_index"]]
            right = it["options"][it["correct_index"]]
            lines.append(f'  Q{n + 1} missed: learner chose "{chose}", correct "{right}".')
    return "\n".join(lines)
```

Note: `set_pending_check` is removed. If `test_is_gradable_requires_prior_turn` referenced it, replace its body to seed a batch via `register` instead, or delete it (the `is_gradable`/`record()` tool path is dormant — `record_learning_event` is no longer a registered tool).

- [ ] **Step 4: Run service tests**

Run from `backend/`: `pytest tests/test_check_question_service.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/check_question_service.py backend/tests/test_check_question_service.py
git commit -m "feat(check-service): batch state machine with linear current_index"
```

---

## Task 3: record_from_answer — opt out of clearing/committing (Landmine 1)

`record_from_answer` is the deterministic grade path. Today it always clears the pending check and commits. Batch `answer()` calls it but must keep the batch open and own the commit.

**Files:**
- Modify: `backend/services/learning_event_service.py:64-107`
- Test: `backend/tests/test_learning_event_service.py`

- [ ] **Step 1: Write failing tests for the new params**

Append to `backend/tests/test_learning_event_service.py`:

```python
def test_record_from_answer_clear_pending_false_keeps_pending(session_row, db_session):
    from services import check_question_service as cq
    from contracts import AskCheckQuestionsArgs
    from agent.types import ToolContext
    from datetime import datetime, timezone

    ctx = ToolContext(db=db_session, session_id=session_row.id,
                      user_id=session_row.user_id,
                      turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    cq.register(db_session, ctx, AskCheckQuestionsArgs(
        session_id=session_row.id, gap="g",
        items=[{"question": "q", "options": ["a", "b"],
                "correct_index": 0, "explanation": "e"}]))
    learning_event_service.record_from_answer(
        db_session, session_row.id, gap="g", question="q",
        correct=True, clear_pending=False, commit=False)
    db_session.commit()
    assert cq.get_pending_check(db_session, session_row.id) is not None


def test_record_from_answer_defaults_still_clear(session_row, db_session):
    from services import check_question_service as cq
    from contracts import AskCheckQuestionsArgs
    from agent.types import ToolContext
    from datetime import datetime, timezone

    ctx = ToolContext(db=db_session, session_id=session_row.id,
                      user_id=session_row.user_id,
                      turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    cq.register(db_session, ctx, AskCheckQuestionsArgs(
        session_id=session_row.id, gap="g",
        items=[{"question": "q", "options": ["a", "b"],
                "correct_index": 0, "explanation": "e"}]))
    learning_event_service.record_from_answer(
        db_session, session_row.id, gap="g", question="q", correct=True)
    assert cq.get_pending_check(db_session, session_row.id) is None
```

- [ ] **Step 2: Run to verify failure**

Run from `backend/`: `pytest tests/test_learning_event_service.py -v`
Expected: FAIL — `record_from_answer() got an unexpected keyword argument 'clear_pending'`.

- [ ] **Step 3: Add the params**

Replace the signature and tail of `record_from_answer` (`learning_event_service.py:64-107`):

```python
def record_from_answer(
    db: Session,
    session_id: str,
    gap: str,
    question: str,
    correct: bool,
    clear_pending: bool = True,
    commit: bool = True,
) -> LearningEvent:
    """Record a learner's clicked check-question answer (deterministic path).

    clear_pending=False / commit=False let the batch caller (check_question_service.
    answer) keep the rest of the batch open and fold this into one commit.
    """
    event = LearningEvent(
        session_id=session_id,
        gap_tested=gap,
        question=question,
        correct=correct,
    )
    db.add(event)
    db.flush()

    profile = profile_service.load_profile(db, session_id)
    mastered = list(profile.mastered_concepts or [])
    if correct:
        if gap not in mastered:
            mastered.append(gap)
            profile.mastered_concepts = mastered
            profile_service.save_profile(db, session_id, profile, commit=False)
    else:
        if gap in mastered:
            profile.mastered_concepts = [c for c in mastered if c != gap]
            profile_service.save_profile(db, session_id, profile, commit=False)

    if clear_pending:
        check_question_service.clear_pending_check(db, session_id, commit=False)
    if commit:
        db.commit()
        db.refresh(event)
    return event
```

- [ ] **Step 4: Run tests**

Run from `backend/`: `pytest tests/test_learning_event_service.py tests/test_check_question_service.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/learning_event_service.py backend/tests/test_learning_event_service.py
git commit -m "feat(learning-event): clear_pending/commit opt-out for batch grading"
```

---

## Task 4: routes — /check/answer + /check/skip carry the index

**Files:**
- Modify: `backend/routes/sessions.py` (imports `:9-23`, `skip_check` `:264-274`, `answer_check` `:277-301`)
- Test: `backend/tests/test_check_answer_route.py`, `backend/tests/test_check_skip_route.py`

- [ ] **Step 1: Write failing route tests**

Replace `backend/tests/test_check_answer_route.py` with batch-shaped tests. The seed helper opens a 2-item batch via `register`:

```python
"""TDD: POST /sessions/{id}/check/answer over a batch."""

from datetime import datetime, timezone

import pytest

from contracts import AskCheckQuestionsArgs, TopicProfile
from agent.types import ToolContext
from db.models import Session as SessionModel, User
from services import check_question_service, profile_service


USER_ID = "u_ans_1"


@pytest.fixture
def seeded_session(db_session):
    db_session.add(User(id=USER_ID))
    session = SessionModel(
        id="s_ans_1", user_id=USER_ID, topic="biology",
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    db_session.add(session)
    db_session.commit()
    return session


def _open_batch(db, session_id):
    ctx = ToolContext(db=db, session_id=session_id, user_id=USER_ID,
                      turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    check_question_service.register(db, ctx, AskCheckQuestionsArgs(
        session_id=session_id, gap="atp",
        items=[
            {"question": "Q1?", "options": ["2 ATP", "36 ATP"],
             "correct_index": 0, "explanation": "Net 2 ATP."},
            {"question": "Q2?", "options": ["a", "b"],
             "correct_index": 1, "explanation": "b."},
        ]))


def test_answer_first_item_advances(client, db_session, seeded_session):
    sid = seeded_session.id
    _open_batch(db_session, sid)
    r = client.post(f"/api/sessions/{sid}/check/answer",
                    json={"index": 0, "selected_index": 0, "user_id": USER_ID})
    assert r.status_code == 200
    body = r.json()
    assert body["correct"] is True
    assert body["current_index"] == 1
    assert body["has_next"] is True
    assert body["done"] is False
    # batch still open
    assert check_question_service.get_pending_check(db_session, sid) is not None
    assert "atp" in profile_service.load_profile(db_session, sid).mastered_concepts


def test_answer_last_item_done(client, db_session, seeded_session):
    sid = seeded_session.id
    _open_batch(db_session, sid)
    client.post(f"/api/sessions/{sid}/check/answer",
                json={"index": 0, "selected_index": 0, "user_id": USER_ID})
    r = client.post(f"/api/sessions/{sid}/check/answer",
                    json={"index": 1, "selected_index": 1, "user_id": USER_ID})
    assert r.json()["done"] is True


def test_answer_out_of_order_is_409(client, db_session, seeded_session):
    sid = seeded_session.id
    _open_batch(db_session, sid)
    r = client.post(f"/api/sessions/{sid}/check/answer",
                    json={"index": 1, "selected_index": 0, "user_id": USER_ID})
    assert r.status_code == 409


def test_answer_no_batch_is_409(client, db_session, seeded_session):
    sid = seeded_session.id
    r = client.post(f"/api/sessions/{sid}/check/answer",
                    json={"index": 0, "selected_index": 0, "user_id": USER_ID})
    assert r.status_code == 409


def test_answer_foreign_session_is_404(client, db_session):
    db_session.add(User(id=USER_ID))
    db_session.commit()
    r = client.post("/api/sessions/nope/check/answer",
                    json={"index": 0, "selected_index": 0, "user_id": USER_ID})
    assert r.status_code == 404
```

Replace `backend/tests/test_check_skip_route.py` similarly (reuse the same `_open_batch` helper pattern):

```python
"""TDD: POST /sessions/{id}/check/skip over a batch."""

from datetime import datetime, timezone

import pytest

from contracts import AskCheckQuestionsArgs, TopicProfile
from agent.types import ToolContext
from db.models import Session as SessionModel, User
from services import check_question_service


USER_ID = "u_skip_1"


@pytest.fixture
def seeded_session(db_session):
    db_session.add(User(id=USER_ID))
    session = SessionModel(
        id="s_skip_1", user_id=USER_ID, topic="bio",
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    db_session.add(session)
    db_session.commit()
    return session


def _open_batch(db, session_id):
    ctx = ToolContext(db=db, session_id=session_id, user_id=USER_ID,
                      turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    check_question_service.register(db, ctx, AskCheckQuestionsArgs(
        session_id=session_id, gap="g",
        items=[{"question": "Q1?", "options": ["a", "b"],
                "correct_index": 0, "explanation": "a."},
               {"question": "Q2?", "options": ["a", "b"],
                "correct_index": 0, "explanation": "a."}]))


def test_skip_advances(client, db_session, seeded_session):
    sid = seeded_session.id
    _open_batch(db_session, sid)
    r = client.post(f"/api/sessions/{sid}/check/skip",
                    json={"index": 0, "user_id": USER_ID})
    assert r.status_code == 200
    body = r.json()
    assert body["current_index"] == 1
    assert body["done"] is False


def test_skip_out_of_order_is_409(client, db_session, seeded_session):
    sid = seeded_session.id
    _open_batch(db_session, sid)
    r = client.post(f"/api/sessions/{sid}/check/skip",
                    json={"index": 1, "user_id": USER_ID})
    assert r.status_code == 409


def test_skip_no_batch_is_409(client, db_session, seeded_session):
    sid = seeded_session.id
    r = client.post(f"/api/sessions/{sid}/check/skip",
                    json={"index": 0, "user_id": USER_ID})
    assert r.status_code == 409
```

- [ ] **Step 2: Run to verify failure**

Run from `backend/`: `pytest tests/test_check_answer_route.py tests/test_check_skip_route.py -v`
Expected: FAIL — current routes ignore `index` and `skip` clears unconditionally.

- [ ] **Step 3: Rewrite the two route handlers**

In `backend/routes/sessions.py`, update the contracts import block (`:9-23`) to add the new symbols:

```python
from contracts import (
    CheckAnswerRequest,
    CheckAnswerResponse,
    CheckSkipRequest,
    CheckSkipResponse,
    Citation,
    Message,
    SessionCreateRequest,
    SessionDetail,
    SessionEndResponse,
    SessionEndSummary,
    SessionListItem,
    SessionResponse,
    SessionUpdateRequest,
    ToolCallRecord,
    TopicProfile,
)
```

Remove the now-unused `learning_event_service` from the `services` import on `:26` (grading moved into `check_question_service.answer`); keep `check_question_service, profile_service, summary_service`.

Replace `skip_check` (`:264-274`) and `answer_check` (`:277-301`) with:

```python
@router.post("/sessions/{session_id}/check/skip", response_model=CheckSkipResponse)
def skip_check(
    session_id: str,
    req: CheckSkipRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    try:
        prog = check_question_service.skip(db, session_id, req.index)
    except check_question_service.CheckStateError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return CheckSkipResponse(**prog)


@router.post("/sessions/{session_id}/check/answer", response_model=CheckAnswerResponse)
def answer_check(
    session_id: str,
    req: CheckAnswerRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    try:
        result = check_question_service.answer(db, session_id, req.index, req.selected_index)
    except check_question_service.CheckStateError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return CheckAnswerResponse(**result)
```

- [ ] **Step 4: Run tests**

Run from `backend/`: `pytest tests/test_check_answer_route.py tests/test_check_skip_route.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/sessions.py backend/tests/test_check_answer_route.py backend/tests/test_check_skip_route.py
git commit -m "feat(routes): index-aware check/answer + check/skip over batch"
```

---

## Task 5: routes — POST /check/complete (hidden follow-up SSE)

This is the new endpoint that fires the reactive tutor follow-up. It mirrors `chat_stream`'s producer/queue pattern but injects a synthetic, non-persisted user turn (the results summary) and never increments the rate limit.

**Files:**
- Modify: `backend/routes/sessions.py` (add imports + the endpoint at end of file)
- Test: `backend/tests/test_check_complete_route.py` (Create)

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_check_complete_route.py`. The suite runs with `settings.llm_stub_enabled=True` in tests (stub streaming), so `run_streaming` yields a deterministic stub reply and persists exactly one assistant message:

```python
"""TDD: POST /sessions/{id}/check/complete fires the hidden follow-up."""

from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from contracts import AskCheckQuestionsArgs, TopicProfile
from agent.types import ToolContext
from db.models import ChatMessage, Session as SessionModel, User
from services import check_question_service


USER_ID = "u_done_1"


@pytest.fixture
def seeded_session(db_session):
    db_session.add(User(id=USER_ID))
    session = SessionModel(
        id="s_done_1", user_id=USER_ID, topic="bio",
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    db_session.add(session)
    db_session.commit()
    return session


def _resolved_batch(db, sid):
    ctx = ToolContext(db=db, session_id=sid, user_id=USER_ID,
                      turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    check_question_service.register(db, ctx, AskCheckQuestionsArgs(
        session_id=sid, gap="atp",
        items=[{"question": "Q1?", "options": ["a", "b"],
                "correct_index": 0, "explanation": "a."}]))
    check_question_service.answer(db, sid, index=0, selected_index=0)


def test_complete_streams_reply_clears_batch_no_user_message(client, db_session, seeded_session):
    sid = seeded_session.id
    _resolved_batch(db_session, sid)
    r = client.post(f"/api/sessions/{sid}/check/complete", json={"user_id": USER_ID})
    assert r.status_code == 200
    assert "text/event-stream" in r.headers["content-type"]
    body = r.text
    assert "event: done" in body
    # batch cleared
    assert check_question_service.get_pending_check(db_session, sid) is None
    # exactly one assistant message persisted, zero new user messages
    rows = db_session.execute(
        select(ChatMessage).where(ChatMessage.session_id == sid)
    ).scalars().all()
    assert [m.role for m in rows] == ["assistant"]


def test_complete_409_when_not_done(client, db_session, seeded_session):
    sid = seeded_session.id
    ctx = ToolContext(db=db_session, session_id=sid, user_id=USER_ID,
                      turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    check_question_service.register(db_session, ctx, AskCheckQuestionsArgs(
        session_id=sid, gap="g",
        items=[{"question": "q", "options": ["a", "b"],
                "correct_index": 0, "explanation": "a."}]))
    r = client.post(f"/api/sessions/{sid}/check/complete", json={"user_id": USER_ID})
    assert r.status_code == 409


def test_complete_409_when_no_batch(client, db_session, seeded_session):
    sid = seeded_session.id
    r = client.post(f"/api/sessions/{sid}/check/complete", json={"user_id": USER_ID})
    assert r.status_code == 409


def test_complete_foreign_session_404(client, db_session):
    db_session.add(User(id=USER_ID))
    db_session.commit()
    r = client.post("/api/sessions/nope/check/complete", json={"user_id": USER_ID})
    assert r.status_code == 404
```

Note: `test_complete_streams_reply_clears_batch_no_user_message` asserts the rate limit is NOT touched implicitly — the endpoint never calls `rate_limit.check_and_increment`. If the suite has a rate-limit spy fixture, assert it was not called; otherwise the "no user message + single assistant" assertion plus code review covers it.

- [ ] **Step 2: Run to verify failure**

Run from `backend/`: `pytest tests/test_check_complete_route.py -v`
Expected: FAIL with 404/405 — endpoint does not exist.

- [ ] **Step 3: Add the endpoint**

In `backend/routes/sessions.py`, add these imports near the top (after the existing imports):

```python
import asyncio

from fastapi import Request
from fastapi.responses import StreamingResponse

from agent import prompts, tutor
from agent.types import ToolContext
from db.models import Document
```

(If `select`, `datetime`, `timezone` are already imported — they are, at `:3,6` — do not duplicate.)

Append at the end of the file:

```python
def _recent_history(db: Session, session_id: str) -> list[dict]:
    rows = db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(20)
    ).scalars().all()
    return [{"role": m.role, "content": m.content} for m in reversed(rows)]


@router.post("/sessions/{session_id}/check/complete")
async def complete_check(
    session_id: str,
    request: Request,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    """Hidden reactive follow-up after a batch fully resolves.

    Builds a server-side results summary, injects it as a NON-persisted synthetic
    user turn, clears the batch, and streams the tutor's reaction. Only the
    assistant reply is persisted. Does NOT increment the daily rate limit (this is
    a system-initiated turn); cost is still metered inside run_streaming.
    """
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")

    pc = check_question_service.get_pending_check(db, session_id)
    if pc is None or not check_question_service.is_done(pc):
        raise HTTPException(status_code=409, detail="no resolved batch to complete")

    summary = check_question_service.build_results_summary(pc)
    check_question_service.clear_pending_check(db, session_id)

    profile = profile_service.load_profile(db, session_id)
    latest_doc = db.execute(
        select(Document)
        .where(Document.session_id == session_id)
        .order_by(Document.created_at.desc())
        .limit(1)
    ).scalars().first()
    ingestion_status = latest_doc.status if latest_doc else None

    messages = _recent_history(db, session_id)
    messages.append({"role": "user", "content": summary})

    prompt_state = {
        "topic": row.topic,
        "profile": profile,
        "ingestion_status": ingestion_status,
        "retrieval_required": False,
        "seed_mode": None,
        "last_session_summary": profile.last_session_summary,
        "pending_check": None,
    }
    system_prompt = prompts.build_system_prompt(prompt_state)
    ctx = ToolContext(
        db=db, session_id=session_id, user_id=user_id,
        turn_started_at=datetime.now(timezone.utc),
    )

    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()

        async def produce():
            try:
                async for event in tutor.run_streaming(messages, system_prompt, ctx):
                    await queue.put(event)
            finally:
                await queue.put(None)

        task = asyncio.create_task(produce())
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=0.25)
                except asyncio.TimeoutError:
                    continue
                if event is None:
                    break
                yield event.to_sse()
                if event.type in ("done", "error", "cancelled"):
                    break
        finally:
            if not task.done():
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

The cost cap is handled inside `run_streaming` (its first iteration checks `cost_meter.check_cap` and emits a `daily_cost_cap_reached` error event), so no separate gate is needed here — the card is already closed client-side by the time this fires.

- [ ] **Step 4: Run tests**

Run from `backend/`: `pytest tests/test_check_complete_route.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/sessions.py backend/tests/test_check_complete_route.py
git commit -m "feat(routes): POST check/complete hidden reactive follow-up SSE"
```

---

## Task 6: tutor.py + tools.py — rename to ask_check_questions + batch event

The literal `ask_check_question` and the type `AskCheckQuestionArgs` both change. Do not trust a hardcoded site count — grep first.

**Files:**
- Modify: `backend/agent/tools.py` (`:14,61,70,91,93`)
- Modify: `backend/agent/tutor.py` (`:95,102,136,219,386,391,446-455`)
- Test: `backend/tests/test_tutor_loop.py`, `test_tutor_stream.py`, `test_tutor_ask_breaks_loop.py`, `test_tutor_stream_check_events.py`, `test_ask_check_question.py`, `test_tools_dispatch_logging.py`

- [ ] **Step 1: Enumerate every site**

Run from repo root: `rg -n "ask_check_question|AskCheckQuestionArgs" backend/`
Expected hits to change (verified 2026-06-05): `tools.py:14,61,70,91,93`; `tutor.py:95,102,136,219,386,391,446`; `check_question_service.py` already migrated in Task 2; tests listed above; `prompts.py:55,62` handled in Task 7. Treat the tool-name string (`"ask_check_question"`) and the type symbol (`AskCheckQuestionArgs`) as two separate renames.

- [ ] **Step 2: Update tools.py**

In `backend/agent/tools.py`:
- `:14` import: `AskCheckQuestionArgs,` -> `AskCheckQuestionsArgs,`
- `:61` `"name": "ask_check_question",` -> `"name": "ask_check_questions",`
- `:62-69` description -> batch wording:

```python
            "description": (
                "The ONLY way to quiz, test, or check the learner's understanding."
                " Pose a BATCH of 1-5 multiple-choice questions probing one focus"
                " gap via items[]. Each item: 2-4 plausible options, the 0-based"
                " correct_index, and a one-sentence explanation shown after answering."
                " This ends your turn. The learner answers each; the server grades"
                " deterministically and updates the profile. You do NOT grade."
            ),
```

- `:70` `_schema(AskCheckQuestionArgs)` -> `_schema(AskCheckQuestionsArgs)`
- `:91` `if name == "ask_check_question":` -> `if name == "ask_check_questions":`
- `:93` `AskCheckQuestionArgs.model_validate(args)` -> `AskCheckQuestionsArgs.model_validate(args)`

- [ ] **Step 3: Update tutor.py**

Replace every literal `"ask_check_question"` with `"ask_check_questions"` at `:102, :136, :391, :446`, and the comments at `:95, :386`. At `:219` (`_summarize`): `if name == "ask_check_question":` -> `if name == "ask_check_questions":` (label stays `"Question asked"` or change to `"Questions asked"`).

Replace the `check_question` event emit block (`:446-456`) with the batch payload:

```python
                if name == "ask_check_questions" and result.ok:
                    data = result.data or {}
                    yield StreamEvent(
                        "check_question",
                        {
                            "gap": data.get("gap"),
                            "items": data.get("items", []),
                            "total": data.get("total", 0),
                        },
                    )
                    asked_check = True
```

- [ ] **Step 4: Update the tutor tests**

Rename `backend/tests/test_ask_check_question.py` references and the args it builds to `AskCheckQuestionsArgs(... items=[{...}])`, and the dispatch name to `"ask_check_questions"`. In `test_tutor_loop.py:232-264`, `test_tutor_stream.py:402-448`, `test_tutor_ask_breaks_loop.py`, and `test_tutor_stream_check_events.py`, change the tool-call name the mock emits from `ask_check_question` to `ask_check_questions` and the tool args from the flat single-question JSON to the batch shape, e.g.:

```python
"arguments": json.dumps({
    "session_id": SESSION_ID, "gap": "recursion",
    "items": [{"question": "Base case?", "options": ["yes", "no"],
               "correct_index": 0, "explanation": "Needed."}],
}),
```

In `test_tutor_stream_check_events.py`, update the asserted `check_question` event payload to expect `{gap, items, total}` instead of `{gap, question, options}`. In `test_tools_dispatch_logging.py:47-49`, change `"ask_check_question"` -> `"ask_check_questions"`.

- [ ] **Step 5: Run the tutor + tools suites**

Run from `backend/`: `pytest tests/test_tutor_loop.py tests/test_tutor_stream.py tests/test_tutor_ask_breaks_loop.py tests/test_tutor_stream_check_events.py tests/test_ask_check_question.py tests/test_tools_dispatch_logging.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/agent/tools.py backend/agent/tutor.py backend/tests/
git commit -m "feat(tutor): rename ask_check_question -> ask_check_questions, batch event"
```

---

## Task 7: prompts.py — batch protocol + batch-aware PENDING_CHECK render (Landmine 3)

**Files:**
- Modify: `backend/agent/prompts.py` (`:53-71` protocol, `:107-114` render)
- Test: `backend/tests/test_prompts.py`

- [ ] **Step 1: Write failing tests**

In `backend/tests/test_prompts.py`, update `test_immutable_rules_mention_ask_check_question` (`:22`) to assert the new name, and add a render test:

```python
def test_immutable_rules_mention_ask_check_questions():
    assert "ask_check_questions" in prompts.IMMUTABLE_RULES


def test_pending_check_render_is_batch_aware():
    state = {
        "pending_check": {
            "gap": "atp",
            "current_index": 1,
            "items": [
                {"question": "Q1", "options": ["a", "b"], "status": "answered"},
                {"question": "Q2", "options": ["a", "b"], "status": "pending"},
            ],
        }
    }
    ctx = prompts.build_dynamic_context(state)
    assert '"gap": "atp"' in ctx
    assert '"answered": 1' in ctx
    assert '"total": 2' in ctx
    # must NOT crash on missing top-level "question" and must not render null
    assert "null" not in ctx.split("PENDING_CHECK:")[1]
```

- [ ] **Step 2: Run to verify failure**

Run from `backend/`: `pytest tests/test_prompts.py -v`
Expected: FAIL — old render reads `pending_check.get("question")` (-> `null`) and rules say `ask_check_question`.

- [ ] **Step 3: Rewrite the protocol block**

Replace `prompts.py:53-71` (the `CHECK-QUESTION PROTOCOL` block) with:

```python
CHECK-QUESTION PROTOCOL (interactive multiple-choice, batched):
- Whenever you want to quiz, test, or check the learner's understanding, you MUST
  do it by calling ask_check_questions(gap, items) where items is a batch of 1-5
  questions probing ONE focus gap. That tool call is the ONLY sanctioned way to
  pose check-questions. Writing a quiz as plain prose WITHOUT calling the tool is
  a protocol violation: no interactive card renders and the learner cannot answer.
- Each item: 2-4 plausible options, exactly one correct, the 0-based correct_index,
  and a one-sentence explanation shown after the learner answers. Do NOT number or
  letter the options inside the question text; the options array is the UI.
- Calling ask_check_questions ends your turn. The learner answers each item; the
  server grades deterministically and updates the profile.
- You do NOT grade answers. You learn the outcome from the CURRENT TOPIC PROFILE:
  a correct answer adds the gap to mastered_concepts; an incorrect answer demotes it.
- Only one batch can be open at a time.
```

- [ ] **Step 4: Rewrite the PENDING_CHECK render**

Replace `prompts.py:107-114`:

```python
    pending_check = state.get("pending_check")
    if pending_check:
        items = pending_check.get("items", [])
        answered = sum(1 for it in items if it.get("status") != "pending")
        pc_label = (
            f'{{"gap": {json.dumps(pending_check.get("gap"))}, '
            f'"answered": {answered}, "total": {len(items)}}}'
        )
    else:
        pc_label = "none"
```

- [ ] **Step 5: Run tests**

Run from `backend/`: `pytest tests/test_prompts.py -v`
Expected: PASS.

- [ ] **Step 6: Full backend sweep + commit**

Run from `backend/`: `pytest -q`
Expected: PASS (all suites green). Fix any stragglers (e.g. a leftover `set_pending_check` reference) before committing.

```bash
git add backend/agent/prompts.py backend/tests/test_prompts.py
git commit -m "feat(prompts): batch check protocol + batch-aware PENDING_CHECK render"
```

---

## Task 8: Frontend API client + SSE client for completeCheck

The existing SSE client hardcodes `/chat/stream`; `completeCheck` needs its own.

**Files:**
- Modify: `frontend/src/services/sessionsApi.js:27-30`
- Modify: `frontend/src/services/chatStreamService.js`
- Test: `frontend/src/__tests__/sessionsApi.test.js` (Create if absent; otherwise extend)

- [ ] **Step 1: Update sessionsApi.js**

Replace `:27-30`:

```javascript
export const skipCheck = (sessionId, index) =>
  apiPost(`/sessions/${sessionId}/check/skip`, { index })

export const answerCheck = (sessionId, index, selectedIndex) =>
  apiPost(`/sessions/${sessionId}/check/answer`, {
    index,
    selected_index: selectedIndex,
  })
```

- [ ] **Step 2: Add a check-complete SSE client**

Append to `frontend/src/services/chatStreamService.js` a sibling that POSTs the empty-body `/check/complete` stream (factor the shared fetch+parse if you prefer; shown inline for clarity):

```javascript
export async function streamCheckComplete({ sessionId, onEvent, signal }) {
  const headers = { 'content-type': 'application/json' }
  const token = _authToken()
  if (token) headers['authorization'] = `Bearer ${token}`

  let resp
  try {
    resp = await fetch(`${BASE_URL}/sessions/${sessionId}/check/complete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      signal,
    })
  } catch (e) {
    throw new ApiError(0, { detail: e.message }, '/check/complete')
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    let body
    try { body = text ? JSON.parse(text) : null } catch { body = text }
    throw new ApiError(resp.status, body, '/check/complete')
  }

  await parseSSEStream(resp.body, onEvent, { signal })
}
```

- [ ] **Step 3: Lint**

Run from `frontend/`: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/sessionsApi.js frontend/src/services/chatStreamService.js
git commit -m "feat(fe-api): index-aware check answer/skip + completeCheck SSE client"
```

---

## Task 9: Frontend store — batch pendingCheck + viewIndex/currentIndex

**Files:**
- Modify: `frontend/src/stores/session.js` (`:86-93` load mapping, `:254-289` check API, `:341` mid-batch guard)
- Test: `frontend/src/__tests__/sessionCheckFlow.test.js`

- [ ] **Step 1: Write failing store tests**

Extend `frontend/src/__tests__/sessionCheckFlow.test.js`. Mock `sessionsApi` and `chatStreamService`. Cover: 1/N nav, Next advances viewIndex, last-answer -> done shows Done, per-item skip advances, skip-resolves fires completeCheck once, completeCheck single-fire guard, resume mid-batch. Example core cases:

```javascript
import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSessionStore } from '@/stores/session.js'
import * as sessionsApi from '@/services/sessionsApi.js'
import * as streamSvc from '@/services/chatStreamService.js'

vi.mock('@/services/sessionsApi.js')
vi.mock('@/services/chatStreamService.js')

function batchEvent() {
  return {
    gap: 'atp',
    total: 2,
    items: [
      { question: 'Q1', options: ['a', 'b'] },
      { question: 'Q2', options: ['a', 'b'] },
    ],
  }
}

describe('multi-check store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('answer advances currentIndex but keeps viewIndex (verdict visible)', async () => {
    const s = useSessionStore()
    s.currentSessionId = 'sid'
    s.handleCheckQuestion(batchEvent())
    expect(s.pendingCheck.viewIndex).toBe(0)
    sessionsApi.answerCheck.mockResolvedValue({
      correct: true, explanation: 'a.', correct_index: 0,
      current_index: 1, total: 2, has_next: true, done: false,
    })
    await s.answerCheck(0)
    expect(s.pendingCheck.currentIndex).toBe(1)
    expect(s.pendingCheck.viewIndex).toBe(0) // verdict still showing
    expect(s.pendingCheck.items[0].status).toBe('answered')
    expect(s.pendingCheck.items[0].correct).toBe(true)
  })

  it('nextCheck moves view to the next unanswered item', async () => {
    const s = useSessionStore()
    s.currentSessionId = 'sid'
    s.handleCheckQuestion(batchEvent())
    sessionsApi.answerCheck.mockResolvedValue({
      correct: true, explanation: 'a.', correct_index: 0,
      current_index: 1, total: 2, has_next: true, done: false,
    })
    await s.answerCheck(0)
    s.nextCheck()
    expect(s.pendingCheck.viewIndex).toBe(1)
  })

  it('answering the last item marks done; completeCheck fires once', async () => {
    const s = useSessionStore()
    s.currentSessionId = 'sid'
    s.handleCheckQuestion(batchEvent())
    sessionsApi.answerCheck
      .mockResolvedValueOnce({ correct: true, explanation: 'a.', correct_index: 0, current_index: 1, total: 2, has_next: true, done: false })
      .mockResolvedValueOnce({ correct: true, explanation: 'a.', correct_index: 0, current_index: 2, total: 2, has_next: false, done: true })
    streamSvc.streamCheckComplete.mockResolvedValue(undefined)
    await s.answerCheck(0)
    s.nextCheck()
    await s.answerCheck(0)
    expect(s.pendingCheck.items[1].status).toBe('answered')
    await s.completeCheck()
    await s.completeCheck() // second call is a no-op
    expect(streamSvc.streamCheckComplete).toHaveBeenCalledTimes(1)
    expect(s.pendingCheck).toBeNull()
  })

  it('per-item skip that resolves the batch fires completeCheck', async () => {
    const s = useSessionStore()
    s.currentSessionId = 'sid'
    s.handleCheckQuestion({ gap: 'atp', total: 1, items: [{ question: 'Q1', options: ['a', 'b'] }] })
    sessionsApi.skipCheck.mockResolvedValue({ current_index: 1, total: 1, has_next: false, done: true })
    streamSvc.streamCheckComplete.mockResolvedValue(undefined)
    await s.skipCheck()
    expect(streamSvc.streamCheckComplete).toHaveBeenCalledTimes(1)
    expect(s.pendingCheck).toBeNull()
  })

  it('loadSession rebuilds batch at current_index with prior verdicts', async () => {
    const s = useSessionStore()
    sessionsApi.getSession.mockResolvedValue({
      id: 'sid', messages: [],
      pending_check: {
        gap: 'atp', current_index: 1, total: 2,
        items: [
          { question: 'Q1', options: ['a', 'b'], status: 'answered',
            selected_index: 0, correct_index: 0, correct: true, explanation: 'a.' },
          { question: 'Q2', options: ['a', 'b'], status: 'pending',
            selected_index: null, correct_index: null, correct: null, explanation: null },
        ],
      },
    })
    await s.loadSession('sid')
    expect(s.pendingCheck.currentIndex).toBe(1)
    expect(s.pendingCheck.viewIndex).toBe(1)
    expect(s.pendingCheck.items[0].correct).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run from `frontend/`: `npm run test:unit -- --run sessionCheckFlow`
Expected: FAIL — `handleCheckQuestion` sets the old flat shape; `nextCheck`/`completeCheck` undefined.

- [ ] **Step 3: Rewrite the check API in the store**

Replace `frontend/src/stores/session.js:254-289` (the `pendingCheck`/`checkLocked`/`handleCheckQuestion`/`answerCheck`/`skipCheck` block) with:

```javascript
  // Batch shape: { gap, total, currentIndex, viewIndex, items: [
  //   { question, options, status, selectedIndex, correctIndex, correct, explanation } ] }
  const pendingCheck = ref(null)
  // Typing mid-batch is allowed (spec section 3), so the composer never locks on
  // an open check. Kept as a computed for the SessionView/Composer binding.
  const checkLocked = computed(() => false)
  const checkAnswering = ref(false)
  const checkCompleting = ref(false)

  function handleCheckQuestion({ gap, items, total }) {
    pendingCheck.value = {
      gap,
      total: total ?? (items || []).length,
      currentIndex: 0,
      viewIndex: 0,
      items: (items || []).map((it) => ({
        question: it.question,
        options: it.options || [],
        status: 'pending',
        selectedIndex: null,
        correctIndex: null,
        correct: null,
        explanation: null,
      })),
    }
  }

  async function answerCheck(selectedIndex) {
    const id = currentSessionId.value
    const pc = pendingCheck.value
    if (!id || !pc) return
    const i = pc.currentIndex
    const item = pc.items[i]
    // Guard re-answer + concurrent double-click (would POST twice -> two events).
    if (!item || item.status !== 'pending') return
    if (checkAnswering.value) return
    checkAnswering.value = true
    try {
      const resp = await sessionsApi.answerCheck(id, i, selectedIndex)
      item.status = 'answered'
      item.selectedIndex = selectedIndex
      item.correct = resp.correct
      item.correctIndex = resp.correct_index
      item.explanation = resp.explanation
      pc.currentIndex = resp.current_index
      // viewIndex intentionally stays at i so the verdict + explanation persist.
    } finally {
      checkAnswering.value = false
    }
  }

  function nextCheck() {
    const pc = pendingCheck.value
    if (pc) pc.viewIndex = pc.currentIndex
  }

  async function skipCheck() {
    const id = currentSessionId.value
    const pc = pendingCheck.value
    if (!id || !pc) return
    const i = pc.currentIndex
    const item = pc.items[i]
    if (!item || item.status !== 'pending') return
    const resp = await sessionsApi.skipCheck(id, i)
    item.status = 'skipped'
    pc.currentIndex = resp.current_index
    if (resp.done) {
      // No verdict to dwell on -> resolve the batch immediately.
      await completeCheck()
    } else {
      pc.viewIndex = pc.currentIndex
    }
  }

  async function completeCheck() {
    const id = currentSessionId.value
    if (!id || !pendingCheck.value) return
    if (checkCompleting.value) return // single-fire guard
    checkCompleting.value = true
    pendingCheck.value = null
    streamingMessage.value = { role: 'assistant', content: '', tool_calls: [], citations: [] }
    streamState.value = 'streaming'
    const ctrl = new AbortController()
    abortController.value = ctrl
    error.value = null
    try {
      await streamChat // placeholder to keep import; replaced below
    } finally {
      // real body in Step 4
    }
  }
```

- [ ] **Step 4: Implement completeCheck body + imports + mid-batch guard**

At the top of `session.js`, add `streamCheckComplete` to the stream import (`:6`):

```javascript
import { streamChat, streamCheckComplete } from '../services/chatStreamService.js'
```

Replace the placeholder `completeCheck` body with the real streaming loop (mirror of `sendMessageStreaming` minus the user push):

```javascript
  async function completeCheck() {
    const id = currentSessionId.value
    if (!id || !pendingCheck.value) return
    if (checkCompleting.value) return
    checkCompleting.value = true
    pendingCheck.value = null
    streamingMessage.value = { role: 'assistant', content: '', tool_calls: [], citations: [] }
    streamState.value = 'streaming'
    const ctrl = new AbortController()
    abortController.value = ctrl
    error.value = null
    try {
      await streamCheckComplete({
        sessionId: id,
        signal: ctrl.signal,
        onEvent: ({ event, data }) => {
          switch (event) {
            case 'tool_call_start': recordToolCall({ kind: 'start', tool_call: data }); break
            case 'tool_call_done': recordToolCall({ kind: 'done', tool_call: data }); break
            case 'assistant_delta': appendAssistantDelta(data.text); break
            case 'citations': setCitations(data); break
            case 'cost_warning': reportCostWarning(data); break
            case 'done': finalizeMessage(data.message_id); break
            case 'cancelled': handleCancelled(data.message_id, data.partial_content_chars, data.estimated_cost_usd); break
            case 'error':
              error.value = data.message || data.code
              streamingMessage.value = null
              streamState.value = 'idle'
              abortController.value = null
              break
          }
        },
      })
    } catch (e) {
      streamingMessage.value = null
      streamState.value = 'idle'
      abortController.value = null
      _setError(e)
    } finally {
      checkCompleting.value = false
    }
  }
```

Update the mid-batch typing guard at `:341` inside `sendMessageStreaming`. The old line clears a verdict-bearing single check; for batches, typing must NOT clear an unfinished batch (spec section 8). Replace:

```javascript
    if (pendingCheck.value && pendingCheck.value.verdict !== null) pendingCheck.value = null
```

with nothing (delete the line) — the batch persists while the learner types; the server still holds it and re-injects it into the next prompt. Do the same in `sendMessage` (non-streaming) if a comparable line exists (it does not in current code — the old single-question clear lived only in the streaming path).

- [ ] **Step 5: Rewrite the loadSession mapping**

Replace `frontend/src/stores/session.js:86-93`:

```javascript
      pendingCheck.value = s.pending_check
        ? {
            gap: s.pending_check.gap,
            total: s.pending_check.total,
            currentIndex: s.pending_check.current_index,
            viewIndex: s.pending_check.current_index,
            items: (s.pending_check.items || []).map((it) => ({
              question: it.question,
              options: it.options || [],
              status: it.status,
              selectedIndex: it.selected_index,
              correctIndex: it.correct_index,
              correct: it.correct,
              explanation: it.explanation,
            })),
          }
        : null
```

Also remove the non-streaming `sendMessage` pending_check write at `:126-133` and replace it with the batch shape (the non-streaming `/chat` response carries `pending_check` as the batch public_view):

```javascript
      pendingCheck.value = resp.pending_check
        ? {
            gap: resp.pending_check.gap,
            total: resp.pending_check.total,
            currentIndex: resp.pending_check.current_index,
            viewIndex: resp.pending_check.current_index,
            items: (resp.pending_check.items || []).map((it) => ({
              question: it.question,
              options: it.options || [],
              status: it.status,
              selectedIndex: it.selected_index,
              correctIndex: it.correct_index,
              correct: it.correct,
              explanation: it.explanation,
            })),
          }
        : null
```

- [ ] **Step 6: Export the new actions**

In the store's return object (`:399-440`), add `nextCheck` and `completeCheck` alongside `answerCheck`, `skipCheck`, `handleCheckQuestion`. `checkLocked` is already exported. Remove nothing else.

- [ ] **Step 7: Run tests + lint**

Run from `frontend/`: `npm run test:unit -- --run sessionCheckFlow` then `npm run lint`
Expected: PASS, no lint errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/stores/session.js
git commit -m "feat(fe-store): batch pendingCheck with viewIndex + completeCheck follow-up"
```

---

## Task 10: CheckQuestion.vue — 1/N nav + Next/Done + SessionView wiring

**Files:**
- Modify: `frontend/src/components/chat/CheckQuestion.vue`
- Modify: `frontend/src/views/SessionView.vue` (`:67-72` template, `:386-399` handlers)
- Test: `frontend/src/__tests__/checkQuestion.test.js`

- [ ] **Step 1: Write failing component tests**

Rewrite `frontend/src/__tests__/checkQuestion.test.js` to drive the batch shape. The component now takes the whole batch and renders `items[viewIndex]`:

```javascript
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import CheckQuestion from '@/components/chat/CheckQuestion.vue'

function batch(overrides = {}) {
  return {
    gap: 'atp', total: 2, currentIndex: 0, viewIndex: 0,
    items: [
      { question: 'Q1', options: ['a', 'b'], status: 'pending',
        selectedIndex: null, correctIndex: null, correct: null, explanation: null },
      { question: 'Q2', options: ['a', 'b'], status: 'pending',
        selectedIndex: null, correctIndex: null, correct: null, explanation: null },
    ],
    ...overrides,
  }
}

describe('CheckQuestion batch', () => {
  it('shows N of M eyebrow when total > 1', () => {
    const w = mount(CheckQuestion, { props: { check: batch() } })
    expect(w.text()).toContain('1/2')
  })

  it('emits answer with the clicked option index', async () => {
    const w = mount(CheckQuestion, { props: { check: batch() } })
    await w.findAll('[data-testid="check-option"]')[1].trigger('click')
    expect(w.emitted('answer')[0]).toEqual([1])
  })

  it('shows Next when an answered item is not the last', () => {
    const b = batch({ currentIndex: 1 })
    b.items[0] = { ...b.items[0], status: 'answered', selectedIndex: 0, correctIndex: 0, correct: true, explanation: 'a.' }
    const w = mount(CheckQuestion, { props: { check: b } })
    expect(w.find('[data-testid="check-next"]').exists()).toBe(true)
    expect(w.find('[data-testid="check-done"]').exists()).toBe(false)
  })

  it('shows Done on the last answered item', () => {
    const b = batch({ total: 1, currentIndex: 1, viewIndex: 0,
      items: [{ question: 'Q1', options: ['a', 'b'], status: 'answered',
                selectedIndex: 0, correctIndex: 0, correct: true, explanation: 'a.' }] })
    const w = mount(CheckQuestion, { props: { check: b } })
    expect(w.find('[data-testid="check-done"]').exists()).toBe(true)
  })

  it('emits next / done', async () => {
    const b = batch({ currentIndex: 1 })
    b.items[0] = { ...b.items[0], status: 'answered', correct: true, correctIndex: 0, selectedIndex: 0, explanation: 'a.' }
    const w = mount(CheckQuestion, { props: { check: b } })
    await w.find('[data-testid="check-next"]').trigger('click')
    expect(w.emitted('next')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run from `frontend/`: `npm run test:unit -- --run checkQuestion`
Expected: FAIL — component reads flat `check.question`/`check.verdict`.

- [ ] **Step 3: Rewrite CheckQuestion.vue**

Replace the `<script setup>` and `<template>` (`:1-62`) with:

```vue
<script setup>
import { computed } from 'vue'

const props = defineProps({
  // Batch: { gap, total, currentIndex, viewIndex, items: [
  //   { question, options, status, selectedIndex, correctIndex, correct, explanation } ] }
  check: { type: Object, required: true },
})
const emit = defineEmits(['answer', 'skip', 'next', 'done'])

const item = computed(() => props.check.items[props.check.viewIndex] || {})
const answered = computed(() => item.value.status === 'answered' || item.value.status === 'skipped')
const correct = computed(() => item.value.correct === true)
const isLast = computed(() => props.check.viewIndex >= props.check.total - 1)
const showProgress = computed(() => props.check.total > 1)

function optionClass(i) {
  if (item.value.status !== 'answered') return ''
  if (i === item.value.correctIndex) return 'is-correct'
  if (i === item.value.selectedIndex) return 'is-incorrect'
  return ''
}
</script>

<template>
  <section
    class="check-card"
    :class="{ answered, correct, incorrect: answered && !correct }"
    data-testid="check-card"
  >
    <span class="check-eyebrow">
      Check question<template v-if="showProgress"> &middot; {{ check.viewIndex + 1 }}/{{ check.total }}</template>
    </span>
    <p class="check-question">{{ item.question }}</p>

    <ul class="check-options">
      <li v-for="(opt, i) in item.options" :key="i">
        <button
          type="button"
          class="check-option"
          :class="optionClass(i)"
          data-testid="check-option"
          :disabled="answered"
          @click="emit('answer', i)"
        >
          {{ opt }}
        </button>
      </li>
    </ul>

    <div v-if="item.status === 'answered'" class="check-verdict" data-testid="check-verdict">
      {{ correct ? 'Correct' : 'Not quite' }}
    </div>
    <p v-if="item.status === 'answered' && item.explanation" class="check-explanation">
      {{ item.explanation }}
    </p>

    <button
      v-if="!answered"
      type="button"
      class="check-skip"
      data-testid="check-skip"
      @click="emit('skip')"
    >
      Skip this question
    </button>

    <button
      v-if="answered && !isLast"
      type="button"
      class="check-next"
      data-testid="check-next"
      @click="emit('next')"
    >
      Next
    </button>
    <button
      v-if="answered && isLast"
      type="button"
      class="check-next"
      data-testid="check-done"
      @click="emit('done')"
    >
      Done
    </button>
  </section>
</template>
```

Keep the existing `<style scoped>` block (`:64-150`) and add `.check-next` reusing the skip/pill styling:

```css
.check-next {
  align-self: flex-start;
  background: var(--color-accent);
  color: var(--color-accent-text, #fff);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-pill);
  padding: 0.4rem 1.1rem;
  font-weight: 600;
  cursor: pointer;
}
.check-next:hover,
.check-next:focus-visible {
  outline: none;
  filter: brightness(1.05);
}
```

- [ ] **Step 4: Wire SessionView**

In `frontend/src/views/SessionView.vue`, extend the `<CheckQuestion>` element (`:67-72`) with the new events:

```vue
      <CheckQuestion
        v-if="store.pendingCheck"
        :check="store.pendingCheck"
        @answer="onAnswerCheck"
        @skip="onSkipCheck"
        @next="store.nextCheck"
        @done="onDoneCheck"
      />
```

Add the `onDoneCheck` handler next to `onAnswerCheck`/`onSkipCheck` (`:386-399`):

```javascript
async function onDoneCheck() {
  try {
    await store.completeCheck()
  } catch (e) {
    lastError.value = e
  }
}
```

(`store.nextCheck` is synchronous, so it can bind inline.)

- [ ] **Step 5: Run tests + lint**

Run from `frontend/`: `npm run test:unit -- --run` then `npm run lint`
Expected: PASS, no lint errors. The whole frontend suite must be green (existing tests that referenced the old `verdict`/flat shape were rewritten in Tasks 9-10).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/chat/CheckQuestion.vue frontend/src/views/SessionView.vue frontend/src/__tests__/checkQuestion.test.js
git commit -m "feat(fe-ui): batch check card with 1/N nav, Next/Done, per-item skip"
```

---

## Task 11: Full-suite verification + contract drift

**Files:** none (verification only)

- [ ] **Step 1: Backend full suite + drift**

Run from `backend/`: `pytest -q`
Expected: all PASS. Then from repo root: `python backend/scripts/gen_contracts.py` and `git diff --stat backend/contracts/models.py` — expect zero diff (contracts already committed in Task 1).

- [ ] **Step 2: Frontend full suite + lint**

Run from `frontend/`: `npm run test:unit -- --run` then `npm run lint`
Expected: all PASS, no lint errors.

- [ ] **Step 3: Grep for stragglers**

Run from repo root: `rg -n "ask_check_question\b|AskCheckQuestionArgs|set_pending_check|\.verdict\b" backend frontend/src`
Expected: no production hits (the old single-question name, removed type, removed setter, and the old `verdict` field should all be gone except possibly in comments — fix any real reference).

- [ ] **Step 4: Commit any cleanup**

```bash
git add -A
git commit -m "chore(mc-multi-check): final verification cleanup"
```

- [ ] **Step 5: Manual smoke (paid, deferred — like prior MC work)**

Document in the plan that a live-LLM smoke remains: start the stack, ask the tutor to quiz on a topic, verify a multi-question batch renders with `1/N`, Next/Done advance, a per-item skip advances, and the hidden follow-up reacts to results with NO visible user bubble. This is a manual paid step, run after merge per the project's MC-smoke convention; it is NOT a code task.

> **Execution status (2026-06-05):** All 11 tasks coded + reviewed (spec + quality + final integration) on `feat/mc-multi-check`, commits `a698a43`..`cc44449`. Backend `pytest -q` = 274 passed / 4 skipped (92% cov); frontend `test:unit` = 373 passed; lint clean; contract drift zero. **Outstanding: this paid live-LLM smoke only.**
>
> Known accepted divergences surfaced in review (NOT bugs, deliberate plan decisions):
> - On resume mid-batch, `viewIndex = current_index` jumps to the next pending item; prior answered verdicts are not re-shown (no Prev nav). Spec §8 implies prior verdicts visible — accepted per plan (Task 9 test pins this).
> - `CheckAnswerResponse.has_next`/`total` and `CheckSkipResponse.has_next`/`total` are sent by the server but unused by the store (the component recomputes is-last from local `total`). Harmless redundancy.
> - Pre-existing doc drift (out of scope): `CLAUDE.md` §Agent Architecture still describes a focus-clear `LearningEvent`-verification guard that an earlier feature removed. Fix in a follow-up.

---

## Self-review notes (resolved before handoff)

- **Spec coverage:** §4 -> Task 1; §5 -> Task 2 (+ Task 3 for the clear-conflict the spec omits); §6 -> Tasks 4-5; §7 -> Tasks 6-7; §8 -> Tasks 8-10; §9 tests woven per task; §10 risks 1-9 addressed in code, risk 10 (batch-sizing reliability) and 11 (mid-batch lingering) are accepted/watch per spec.
- **Landmine 1** (record_from_answer clear) -> Task 3 + `test_answer_does_not_clear_batch`.
- **Landmine 2** (rename undercount) -> Task 6 Step 1 grep, two separate renames.
- **Landmine 3** (raw-dict prompt render) -> Task 7 Step 4 + `test_pending_check_render_is_batch_aware`.
- **checkLocked ambiguity** resolved: typing mid-batch allowed (spec §3), so `checkLocked` is `computed(() => false)`; the `:341` clear line is deleted.
- **SSE-client ambiguity** resolved: `streamCheckComplete` added (Task 8); `completeCheck` is a `sendMessageStreaming` clone minus the user push (Task 9).
- **Atomicity:** `check_question_service.answer` folds event + profile effect + item mutation + index advance into one `db.commit()` via `record_from_answer(..., commit=False)`.
- **Known acceptance:** pre-existing flat `pending_check_json` rows do not parse under the new shape; acceptable pre-launch (Phase 8 not shipped). No migration written.
