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


def is_done(pc: dict | None) -> bool:
    if not pc:
        return False
    return pc.get("current_index", 0) >= len(pc.get("items", []))


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


# Current-check pointer (#340). A check is 1..3 sets; pending_check holds only
# the open set and is cleared when it completes, so the check-level state
# lives here and survives between sets:
#     {"set_total": int, "last_set_index": int, "gaps": [str]}
# last_set_index is the most recently REGISTERED set. Cleared when the final
# set closes, when the learner stops, and on session end.


def get_current_check_from_row(row: SessionModel | None) -> dict | None:
    if row is None or not row.current_check_json:
        return None
    try:
        data = json.loads(row.current_check_json)
    except (ValueError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def get_current_check(db: Session, session_id: str) -> dict | None:
    return get_current_check_from_row(db.get(SessionModel, session_id))


def set_current_check(
    db: Session, session_id: str, cc: dict | None, commit: bool = True
) -> None:
    row = db.get(SessionModel, session_id)
    if row is None:
        if cc is None:
            return
        raise ValueError(f"session not found: {session_id}")
    row.current_check_json = json.dumps(cc) if cc is not None else None
    if commit:
        db.commit()
