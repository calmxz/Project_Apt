"""subject_profile_service.aggregate_for_subject — pure read, no LLM."""

from contracts import TopicProfile
from db.models import Lesson, Session as SessionModel, Subject, User
from services import subject_profile_service


USER_ID = "u_subj"


def _session(db, sid, *, mastered=None, gaps=None):
    s = SessionModel(
        id=sid,
        user_id=USER_ID,
        topic="",
        topic_profile_json=TopicProfile(
            mastered_concepts=mastered or [],
            confirmed_gaps=gaps or [],
        ).model_dump_json(),
    )
    db.add(s)
    return s


def _subject_with_lessons(db, subject_id="sub1"):
    db.add(User(id=USER_ID))
    db.add(Subject(id=subject_id, user_id=USER_ID, title="Organic Chemistry",
                   per_session_minutes=30, timeline_days=14, duration_mode="deadline"))
    # Lesson 0: opened, mastered bonding/hybridization
    _session(db, "s0", mastered=["bonding", "hybridization"], gaps=[])
    db.add(Lesson(id="l0", subject_id=subject_id, order_idx=0, title="Bonding basics",
                  goal="g", status="done", session_id="s0"))
    # Lesson 1: opened, gap chirality + bonding-as-gap (must be subtracted at subject level)
    _session(db, "s1", mastered=[], gaps=["chirality", "bonding"])
    db.add(Lesson(id="l1", subject_id=subject_id, order_idx=1, title="Stereochemistry",
                  goal="g", status="in_progress", session_id="s1"))
    # Lesson 2: not opened (session_id NULL) -> empty rollup
    db.add(Lesson(id="l2", subject_id=subject_id, order_idx=2, title="Spectroscopy",
                  goal="g", status="not_started", session_id=None))
    db.commit()


def test_aggregate_unions_dedupes_and_subtracts_mastered(db_session):
    _subject_with_lessons(db_session)
    out = subject_profile_service.aggregate_for_subject(db_session, "sub1")
    assert out is not None
    assert out.subject_title == "Organic Chemistry"
    assert set(out.mastered_concepts) == {"bonding", "hybridization"}
    # chirality stays a gap; bonding removed because it is mastered subject-wide
    assert out.open_gaps == ["chirality"]
    assert len(out.lessons) == 3
    roll = {r.lesson_id: r for r in out.lessons}
    assert roll["l0"].mastered == ["bonding", "hybridization"]
    assert roll["l1"].gaps == ["chirality", "bonding"]  # rollup keeps raw per-lesson view
    assert roll["l2"].mastered == [] and roll["l2"].gaps == []  # unopened


def test_aggregate_missing_subject_returns_none(db_session):
    assert subject_profile_service.aggregate_for_subject(db_session, "nope") is None


def test_aggregate_empty_subject_valid_shape(db_session):
    db_session.add(User(id=USER_ID))
    db_session.add(Subject(id="empty", user_id=USER_ID, title="New",
                           per_session_minutes=15, timeline_days=7, duration_mode="deadline"))
    db_session.commit()
    out = subject_profile_service.aggregate_for_subject(db_session, "empty")
    assert out.mastered_concepts == [] and out.open_gaps == [] and out.lessons == []
