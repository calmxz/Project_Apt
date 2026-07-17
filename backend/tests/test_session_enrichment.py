import json
from datetime import datetime, timedelta, timezone

from db.models import ChatMessage, Session as SessionModel, User
from services.session_enrichment import compute_enrichment

USER_ID = "u1"


def _seed(db):
    db.add(User(id=USER_ID))
    db.flush()
    base = datetime(2026, 6, 1, tzinfo=timezone.utc)
    prof = {
        "focus_target_gap": "ATP yield",
        "mastered_concepts": ["a", "b", "c"],
        "confirmed_gaps": [],
        "last_session_summary": "[auto] recap of glycolysis",
    }
    db.add(SessionModel(id="s_rich", user_id=USER_ID, topic="Glycolysis",
                        topic_profile_json=json.dumps(prof)))
    db.add(ChatMessage(session_id="s_rich", role="user", content="hi", created_at=base))
    db.add(ChatMessage(session_id="s_rich", role="assistant",
                       content="glycolysis nets 2 ATP per glucose",
                       created_at=base + timedelta(minutes=1)))
    # Aborted-stream trailing-whitespace turn must be skipped by the preview.
    db.add(ChatMessage(session_id="s_rich", role="assistant", content="\n  \n",
                       created_at=base + timedelta(minutes=2)))
    # Empty session: no messages.
    db.add(SessionModel(id="s_empty", user_id=USER_ID, topic="Empty",
                        topic_profile_json="{}"))
    db.commit()


def test_compute_enrichment_fields(db_session):
    _seed(db_session)
    rows = db_session.query(SessionModel).all()
    enr = compute_enrichment(db_session, rows)

    rich = enr["s_rich"]
    assert rich.message_count == 3
    # Newest non-blank message wins; the "\n  \n" turn is skipped.
    assert rich.last_message_preview == "glycolysis nets 2 ATP per glucose"
    assert rich.last_activity_at is not None
    assert rich.last_activity_at.tzinfo is not None
    assert rich.progress.focus_target_gap == "ATP yield"
    assert rich.progress.mastered_count == 3
    # Backend stores the summary raw (with any [auto] prefix); stripping is frontend-side.
    assert rich.last_session_summary == "[auto] recap of glycolysis"

    empty = enr["s_empty"]
    assert empty.message_count == 0
    assert empty.last_message_preview is None
    assert empty.last_activity_at is None
    assert empty.last_session_summary is None
    assert empty.progress.mastered_count == 0
    assert empty.progress.focus_target_gap is None


def test_compute_enrichment_empty_rows(db_session):
    assert compute_enrichment(db_session, []) == {}
