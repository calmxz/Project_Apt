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
import logging
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.orm import Session

from contracts import AskCheckQuestionsArgs, ToolResult
from db.models import ChatMessage, LearningEvent, Session as SessionModel

log = logging.getLogger(__name__)

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


def is_done(pc: dict | None) -> bool:
    if not pc:
        return False
    return pc.get("current_index", 0) >= len(pc.get("items", []))


def register(db: Session, ctx: "ToolContext", args: AskCheckQuestionsArgs) -> ToolResult:
    if getattr(ctx, "suppress_check", False):
        return ToolResult(
            ok=False, status="failed",
            error="address the check results before quizzing again",
        )
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

    from services import profile_service  # local import avoids circular

    level = profile_service.load_profile(db, ctx.session_id).knowledge_level
    purpose = "diagnostic" if level is None else "check"

    pc = {
        "gap": args.gap,
        "purpose": purpose,
        "current_index": 0,
        "asked_at_turn": ctx.turn_started_at.isoformat(),
        "message_id": None,
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
    apply_effects = pc.get("purpose", "check") != "diagnostic"
    # Profile effect + LearningEvent, deferred into our single commit; does not clear.
    learning_event_service.record_from_answer(
        db, session_id, gap=pc["gap"], question=item["question"],
        correct=correct, clear_pending=False, commit=False,
        apply_profile_effects=apply_effects,
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


def load_session_learning_events(db: Session, session_id: str) -> list[LearningEvent]:
    """All LearningEvents for a session, oldest first. Loaded once per detail
    render so reconstruct_check_batch can match in memory instead of issuing one
    SELECT per check item (the former N+1)."""
    return db.execute(
        select(LearningEvent)
        .where(LearningEvent.session_id == session_id)
        .order_by(LearningEvent.created_at.asc(), LearningEvent.id.asc())
    ).scalars().all()


def reconstruct_check_batch(db: Session, msg: ChatMessage, events: list | None = None) -> dict | None:
    """Best-effort recap for an asking message with no persisted check_batch_json.

    Matches each item against the session's LearningEvents by
    (gap_tested, question) for the FIRST event at or after this message's turn.
    `events` may be preloaded (load_session_learning_events) to avoid N+1; when
    None it is loaded once here (single query, not per item).

    Pulls question/options/correct_index/explanation from the message's
    ask_check_questions tool call. selected_index is unknowable -> None.
    status = answered if an event matched, else skipped.

    Known tradeoff: if the same (gap, question) recurs in a LATER batch that
    was answered before this backfill runs, this message's item may be
    mis-marked "answered". Accepted as best-effort only."""
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

    if events is None:
        events = load_session_learning_events(db, msg.session_id)

    items = []
    for it in raw_items:
        question = it.get("question", "")
        # events are oldest-first; first match is the earliest at/after this turn.
        ev = next(
            (e for e in events
             if e.gap_tested == gap
             and e.question == question
             and e.created_at >= msg.created_at),
            None,
        )
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


def load_check_batch(db: Session, msg: ChatMessage, events: list | None = None) -> dict | None:
    """Recap payload for a message: persisted column first, else reconstruct.

    `events` is an optional preloaded list of this session's LearningEvents
    (see load_session_learning_events) so callers rendering many messages avoid
    one SELECT per item.
    """
    if msg.check_batch_json:
        try:
            data = json.loads(msg.check_batch_json)
        except (ValueError, TypeError):
            data = None
        if isinstance(data, dict):
            return data
    return reconstruct_check_batch(db, msg, events)
