"""Pending check-question state machine (Spec workstream A1, Layer B).

A pending_check lives on the Session row as JSON:
    {"gap": str, "question": str, "asked_at_turn": iso8601}

The grading guard (is_gradable) enforces that a check-question can only be
graded in a LATER turn than the one that asked it, and only for the gap that
was actually asked. This makes "ask and self-grade in one turn" impossible.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from contracts import AskCheckQuestionArgs, ToolResult
from db.models import Session as SessionModel

if TYPE_CHECKING:
    from agent.types import ToolContext


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


def public_view(pc: dict | None) -> dict | None:
    """Project a stored pending_check to the PendingCheck contract shape.

    The stored dict carries an extra asked_at_turn key; PendingCheck is
    extra=forbid, so callers must strip to gap+question before returning it.
    """
    if not pc:
        return None
    return {"gap": pc["gap"], "question": pc["question"]}


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


def clear_pending_check(db: Session, session_id: str, commit: bool = True) -> None:
    row = db.get(SessionModel, session_id)
    if row is None:
        return
    row.pending_check_json = None
    if commit:
        db.commit()


def is_gradable(
    db: Session, session_id: str, gap: str, current_turn: datetime
) -> bool:
    pc = get_pending_check(db, session_id)
    if pc is None or pc.get("gap") != gap:
        return False
    return parse_asked_at(pc) < current_turn


def register(db: Session, ctx: ToolContext, args: AskCheckQuestionArgs) -> ToolResult:
    if args.session_id != ctx.session_id:
        return ToolResult(
            ok=False,
            status="failed",
            error=f"session_id mismatch: args={args.session_id} ctx={ctx.session_id}",
        )
    if get_pending_check(db, ctx.session_id) is not None:
        return ToolResult(
            ok=False,
            status="failed",
            error="a check-question is already open; grade or skip it first",
        )
    set_pending_check(
        db, ctx.session_id, gap=args.gap, question=args.question,
        asked_at=ctx.turn_started_at,
    )
    return ToolResult(ok=True, status="ok", data={"gap": args.gap, "question": args.question})
