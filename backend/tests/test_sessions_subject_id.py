"""TDD: sessions list/detail surface subject_id so the dupe-guard can scope (Spec B)."""

import pytest

from contracts import TopicProfile
from db.models import Session as SessionModel, Subject, User

USER_ID = "u1"

@pytest.fixture
def seeded_user(db_session):
    db_session.add(User(id=USER_ID))
    db_session.commit()


def test_list_items_carry_subject_id(client, db_session, seeded_user):
    subj = Subject(user_id=USER_ID, title="Chem", per_session_minutes=30,
                   duration_mode="pace", pace_per_week=3)
    db_session.add(subj)
    db_session.flush()
    db_session.add(
        SessionModel(
            id="s_linked", user_id=USER_ID, topic="bonds", subject_id=subj.id,
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.add(
        SessionModel(
            id="s_quick", user_id=USER_ID, topic="recursion",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()

    items = {i["id"]: i for i in client.get(f"/api/sessions?user_id={USER_ID}").json()}
    assert items["s_linked"]["subject_id"] == subj.id
    assert items["s_quick"]["subject_id"] is None


def test_detail_carries_subject_id(client, db_session, seeded_user):
    subj = Subject(user_id=USER_ID, title="Chem", per_session_minutes=30,
                   duration_mode="pace", pace_per_week=3)
    db_session.add(subj)
    db_session.flush()
    db_session.add(
        SessionModel(
            id="s_linked", user_id=USER_ID, topic="bonds", subject_id=subj.id,
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.add(
        SessionModel(
            id="s_quick", user_id=USER_ID, topic="recursion",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()
    r = client.get(f"/api/sessions/s_linked?user_id={USER_ID}")
    assert r.json()["subject_id"] == subj.id
    r = client.get(f"/api/sessions/s_quick?user_id={USER_ID}")
    assert r.json()["subject_id"] is None
