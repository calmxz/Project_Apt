from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session


@dataclass
class ToolContext:
    db: Session
    session_id: str
    user_id: str
    turn_started_at: datetime
    suppress_check: bool = False
    # F-59: the turn's diagnostic decision, made when the prompt was built
    # (including the review-gaps override). register() must not re-derive it
    # from live knowledge_level -- a review quiz posed while level is None
    # was being misrecorded as diagnostic.
    diagnostic_required: bool = False
    # F-56: citations for server-prefetched excerpts; None when the turn had
    # no prefetch. Wired in the force-retrieve task.
    prefetched_citations: list | None = None
