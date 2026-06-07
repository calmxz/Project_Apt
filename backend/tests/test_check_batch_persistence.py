"""Persistence of resolved check batches onto the asking ChatMessage."""

import pytest
from datetime import datetime, timezone

from contracts import AskCheckQuestionsArgs, TopicProfile
from db.models import ChatMessage, Session as SessionModel, User
from agent.types import ToolContext
from services import check_question_service


USER_ID = "u_batch_1"
SID = "s_batch_1"


@pytest.fixture
def seeded(db_session):
    db_session.add(User(id=USER_ID))
    db_session.add(SessionModel(
        id=SID, user_id=USER_ID, topic="bio",
        topic_profile_json=TopicProfile().model_dump_json(),
    ))
    db_session.commit()
    return db_session


def test_check_batch_json_column_roundtrips(seeded):
    db = seeded
    m = ChatMessage(session_id=SID, role="assistant", content="",
                    check_batch_json='{"gap": "atp"}')
    db.add(m)
    db.commit()
    db.refresh(m)
    assert m.check_batch_json == '{"gap": "atp"}'


def _register_batch(db, gap="atp"):
    ctx = ToolContext(db=db, session_id=SID, user_id=USER_ID,
                      turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    check_question_service.register(db, ctx, AskCheckQuestionsArgs(
        session_id=SID, gap=gap,
        items=[{"question": "Q1?", "options": ["a", "b"],
                "correct_index": 0, "explanation": "a is right."}]))


def test_register_pc_has_null_message_id(seeded):
    db = seeded
    _register_batch(db)
    pc = check_question_service.get_pending_check(db, SID)
    assert pc["message_id"] is None


def test_attach_message_id_stamps_open_pc(seeded):
    db = seeded
    _register_batch(db)
    m = ChatMessage(session_id=SID, role="assistant", content="")
    db.add(m)
    db.commit()
    db.refresh(m)
    check_question_service.attach_message_id(db, SID, m.id)
    pc = check_question_service.get_pending_check(db, SID)
    assert pc["message_id"] == m.id


def test_attach_message_id_noop_when_no_pc(seeded):
    db = seeded
    # No open batch - must not raise.
    check_question_service.attach_message_id(db, SID, 999)
    assert check_question_service.get_pending_check(db, SID) is None


def test_write_check_batch_persists_public_view(seeded):
    db = seeded
    _register_batch(db)
    m = ChatMessage(session_id=SID, role="assistant", content="")
    db.add(m)
    db.commit()
    db.refresh(m)
    check_question_service.attach_message_id(db, SID, m.id)
    check_question_service.answer(db, SID, index=0, selected_index=0)
    pc = check_question_service.get_pending_check(db, SID)
    check_question_service.write_check_batch(db, pc)
    db.refresh(m)
    import json
    data = json.loads(m.check_batch_json)
    assert data["gap"] == "atp"
    assert data["items"][0]["selected_index"] == 0
    assert data["items"][0]["correct"] is True


def test_write_check_batch_noop_without_message_id(seeded):
    db = seeded
    _register_batch(db)
    pc = check_question_service.get_pending_check(db, SID)
    # message_id is None - must be a no-op, no raise.
    check_question_service.write_check_batch(db, pc)
