"""Persistence of resolved check batches onto the asking ChatMessage."""

import pytest

from contracts import TopicProfile
from db.models import ChatMessage, Session as SessionModel, User


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
