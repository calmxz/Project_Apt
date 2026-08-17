"""Deterministic knowledge-level assignment from a diagnostic check batch."""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


def grade_if_diagnostic(db: "Session", session_id: str) -> None:
    """Grade a just-resolved diagnostic batch into topic_profile.knowledge_level.

    No-op unless the pending check's purpose is "diagnostic" AND it is fully
    resolved (is_done). Safe to call from any route that may resolve the final
    item of a batch (answer or skip) - resolving the same already-graded batch
    twice is a no-op because knowledge_level is only ever written from None
    (see the guard below), never overwritten once set.

    Local imports avoid circular imports (check_question_service and
    profile_service both sit alongside this module in services/).
    """
    from services import check_question_service, profile_service

    pc = check_question_service.get_pending_check(db, session_id)
    if not pc or pc.get("purpose") != "diagnostic" or not check_question_service.is_done(pc):
        return
    items = pc.get("items", [])
    graded = [it for it in items if it["status"] == "answered"]
    if not graded:
        # F-25: an all-skip batch is zero evidence. Leave knowledge_level None
        # so diagnostic_required fires again next turn instead of branding the
        # learner "beginner" forever.
        return
    n_correct = sum(1 for it in graded if it.get("correct"))
    level = level_for_score(n_correct, len(items))
    profile_service.lock_session_row(db, session_id)
    profile = profile_service.load_profile(db, session_id)
    if profile.knowledge_level is not None:
        # F-39: a user PATCH mid-batch already set the level; the diagnostic
        # must not clobber explicit user intent. This also makes re-grading
        # a resolved batch a no-op.
        return
    profile.knowledge_level = level
    profile_service.save_profile(db, session_id, profile)


def level_for_score(n_correct: int, total: int) -> str:
    """Map a diagnostic score to a coarse knowledge level.

    Tuned for a 3-question batch: 0-1 beginner, 2 intermediate, 3 advanced.
    Generalizes by ratio for other batch sizes."""
    if total <= 0:
        return "beginner"
    ratio = n_correct / total
    if ratio >= 1.0:
        return "advanced"
    if ratio >= (2 / 3):
        return "intermediate"
    return "beginner"
