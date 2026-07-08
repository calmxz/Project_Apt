"""Low-level pending check-question state accessors.

The pending_check lives on the Session row as JSON (see check_question_service
for the full batch shape). These helpers are the leaf layer that reads, writes,
and clears that JSON. They import nothing from check_question_service or
learning_event_service, so both can depend on this module without forming an
import cycle (CodeQL cyclic-import).
"""

from __future__ import annotations

import json
from datetime import datetime

from sqlalchemy.orm import Session

from db.models import Session as SessionModel


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


def parse_asked_at(pc: dict) -> datetime:
    return datetime.fromisoformat(pc["asked_at_turn"])


def is_gradable(db: Session, session_id: str, gap: str, current_turn: datetime) -> bool:
    """Legacy turn-barrier guard, no longer called from the record path (that path
    was record_learning_event, removed when it stopped being an LLM tool). Kept
    for its own direct test coverage; batch gap stays top-level so it still resolves."""
    pc = get_pending_check(db, session_id)
    if pc is None or pc.get("gap") != gap:
        return False
    return parse_asked_at(pc) < current_turn


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
