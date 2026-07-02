"""TDD: learning_event_service.record + demotion side effect."""

from datetime import datetime, timedelta, timezone

import pytest

from agent.types import ToolContext
from contracts import AskCheckQuestionsArgs, RecordLearningEventArgs, TopicProfile
from db.models import LearningEvent, Session as SessionModel, User
from services import check_question_service as cq
from services import learning_event_service, profile_service


SESSION_ID = "sess_1"
USER_ID = "u1"


@pytest.fixture
def session_row(db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    db_session.add(
        SessionModel(
            id=SESSION_ID,
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile(
                mastered_concepts=["joins"]
            ).model_dump_json(),
        )
    )
    db_session.commit()
    return db_session.get(SessionModel, SESSION_ID)


@pytest.fixture
def ctx(db_session):
    return ToolContext(
        db=db_session,
        session_id=SESSION_ID,
        user_id=USER_ID,
        turn_started_at=datetime.now(timezone.utc),
    )


def _args(**kw) -> RecordLearningEventArgs:
    kw.setdefault("session_id", SESSION_ID)
    kw.setdefault("gap_tested", "indexes")
    kw.setdefault("question", "what is a btree?")
    kw.setdefault("correct", True)
    return RecordLearningEventArgs(**kw)


def _seed_check(db_session, ctx, gap, question, asked_at):
    """Seed a single-item batch so is_gradable resolves for the record() LLM path."""
    seed_ctx = ToolContext(
        db=db_session,
        session_id=SESSION_ID,
        user_id=USER_ID,
        turn_started_at=asked_at,
    )
    cq.register(db_session, seed_ctx, AskCheckQuestionsArgs(
        session_id=SESSION_ID,
        gap=gap,
        items=[{"question": question, "options": ["a", "b"],
                "correct_index": 0, "explanation": "a."}],
    ))


def test_correct_event_recorded(session_row, ctx, db_session):
    # A prior-turn pending check is required by the grading guard.
    _seed_check(db_session, ctx, gap="indexes", question="what is a btree?",
                asked_at=ctx.turn_started_at - timedelta(seconds=5))
    result = learning_event_service.record(db_session, ctx, _args(correct=True))
    assert result.ok is True
    assert result.status == "ok"
    rows = db_session.query(LearningEvent).all()
    assert len(rows) == 1
    assert rows[0].correct is True


def test_incorrect_on_non_mastered_does_not_demote(session_row, ctx, db_session):
    # A prior-turn pending check is required by the grading guard.
    _seed_check(db_session, ctx, gap="indexes", question="what is a btree?",
                asked_at=ctx.turn_started_at - timedelta(seconds=5))
    result = learning_event_service.record(
        db_session, ctx, _args(gap_tested="indexes", correct=False)
    )
    assert result.ok is True
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert profile.mastered_concepts == ["joins"]


def test_incorrect_on_mastered_demotes(session_row, ctx, db_session):
    # A prior-turn pending check is required by the grading guard.
    _seed_check(db_session, ctx, gap="joins", question="what is a join?",
                asked_at=ctx.turn_started_at - timedelta(seconds=5))
    result = learning_event_service.record(
        db_session, ctx, _args(gap_tested="joins", correct=False)
    )
    assert result.ok is True
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert "joins" not in profile.mastered_concepts
    assert cq.get_pending_check(db_session, SESSION_ID) is None


# --- Grading guard tests (Task 8) ---


def test_grade_rejected_without_pending_check(session_row, ctx, db_session):
    args = RecordLearningEventArgs(
        session_id=SESSION_ID, gap_tested="g", question="q?", correct=True
    )
    result = learning_event_service.record(db_session, ctx, args)
    assert result.ok is False
    assert "no open check-question" in (result.error or "").lower()


def test_grade_rejected_when_asked_this_turn(session_row, ctx, db_session):
    _seed_check(db_session, ctx, gap="g", question="q?",
                asked_at=ctx.turn_started_at)
    args = RecordLearningEventArgs(
        session_id=SESSION_ID, gap_tested="g", question="q?", correct=True
    )
    result = learning_event_service.record(db_session, ctx, args)
    assert result.ok is False
    assert cq.get_pending_check(db_session, SESSION_ID) is not None


def test_grade_accepted_from_prior_turn_and_clears(session_row, ctx, db_session):
    _seed_check(db_session, ctx, gap="g", question="q?",
                asked_at=ctx.turn_started_at - timedelta(seconds=5))
    args = RecordLearningEventArgs(
        session_id=SESSION_ID, gap_tested="g", question="q?", correct=True
    )
    result = learning_event_service.record(db_session, ctx, args)
    assert result.ok is True
    assert result.data["correct"] is True
    assert cq.get_pending_check(db_session, SESSION_ID) is None


# --- record_from_answer tests (Task 3: deterministic click path) ---


def test_record_from_answer_correct_adds_mastered_and_clears(session_row, db_session):
    seed_ctx = ToolContext(
        db=db_session, session_id=SESSION_ID, user_id=USER_ID,
        turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    cq.register(db_session, seed_ctx, AskCheckQuestionsArgs(
        session_id=SESSION_ID, gap="atp",
        items=[{"question": "q?", "options": ["a", "b"],
                "correct_index": 0, "explanation": "e"}],
    ))
    event = learning_event_service.record_from_answer(
        db_session, SESSION_ID, gap="atp", question="q?", correct=True,
    )
    assert event.correct is True
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert "atp" in profile.mastered_concepts
    assert cq.get_pending_check(db_session, SESSION_ID) is None


def test_record_from_answer_incorrect_demotes_mastered(session_row, db_session):
    profile = profile_service.load_profile(db_session, SESSION_ID)
    profile.mastered_concepts = ["atp"]
    profile_service.save_profile(db_session, SESSION_ID, profile)
    seed_ctx = ToolContext(
        db=db_session, session_id=SESSION_ID, user_id=USER_ID,
        turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    cq.register(db_session, seed_ctx, AskCheckQuestionsArgs(
        session_id=SESSION_ID, gap="atp",
        items=[{"question": "q?", "options": ["a", "b"],
                "correct_index": 0, "explanation": "e"}],
    ))
    learning_event_service.record_from_answer(
        db_session, SESSION_ID, gap="atp", question="q?", correct=False,
    )
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert "atp" not in profile.mastered_concepts


def test_record_from_answer_incorrect_non_mastered_is_noop_on_profile(session_row, db_session):
    seed_ctx = ToolContext(
        db=db_session, session_id=SESSION_ID, user_id=USER_ID,
        turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    cq.register(db_session, seed_ctx, AskCheckQuestionsArgs(
        session_id=SESSION_ID, gap="krebs",
        items=[{"question": "q?", "options": ["a", "b"],
                "correct_index": 0, "explanation": "e"}],
    ))
    learning_event_service.record_from_answer(
        db_session, SESSION_ID, gap="krebs", question="q?", correct=False,
    )
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert "krebs" not in (profile.mastered_concepts or [])


# --- Task 3 new tests: clear_pending / commit opt-out ---


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


# --- Task 5: apply_profile_effects bypass (diagnostic profile-pollution guard) ---


@pytest.fixture
def db(db_session):
    """Alias mirroring this file's db_session fixture under the brief's name."""
    return db_session


@pytest.fixture
def session_id(session_row):
    """Alias mirroring this file's session_row fixture under the brief's name."""
    return session_row.id


def test_record_from_answer_skips_mastery_when_disabled(db, session_id):
    from services import learning_event_service as les, profile_service
    les.record_from_answer(db, session_id, gap="warmup", question="q",
                           correct=True, clear_pending=False,
                           apply_profile_effects=False)
    prof = profile_service.load_profile(db, session_id)
    assert "warmup" not in (prof.mastered_concepts or [])


def test_record_from_answer_applies_mastery_by_default(db, session_id):
    from services import learning_event_service as les, profile_service
    les.record_from_answer(db, session_id, gap="loops", question="q",
                           correct=True, clear_pending=False)
    prof = profile_service.load_profile(db, session_id)
    assert "loops" in (prof.mastered_concepts or [])
