from contracts import TopicProfile
from db.models import Lesson, Session as SessionModel, Subject, User

OWNER = "u_owner"
OTHER = "u_other"


def _seed(db, owner=OWNER):
    db.add(User(id=owner))
    db.add(Subject(id="sub1", user_id=owner, title="Bio",
                   per_session_minutes=30, timeline_days=14, duration_mode="deadline"))
    db.add(SessionModel(id="s0", user_id=owner, topic="cells",
                        topic_profile_json=TopicProfile(
                            mastered_concepts=["mitosis"], confirmed_gaps=["meiosis"]
                        ).model_dump_json()))
    db.add(Lesson(id="l0", subject_id="sub1", order_idx=0, title="Cell division",
                  goal="g", status="in_progress", session_id="s0"))
    db.commit()


def test_get_subject_profile_ok(client, db_session):
    _seed(db_session)
    r = client.get("/api/subjects/sub1/profile", params={"user_id": OWNER})
    assert r.status_code == 200
    body = r.json()
    assert body["subject_title"] == "Bio"
    assert body["mastered_concepts"] == ["mitosis"]
    assert body["open_gaps"] == ["meiosis"]
    assert body["lessons"][0]["lesson_title"] == "Cell division"


def test_get_subject_profile_cross_user_404(client, db_session):
    _seed(db_session)
    db_session.add(User(id=OTHER))
    db_session.commit()
    r = client.get("/api/subjects/sub1/profile", params={"user_id": OTHER})
    assert r.status_code == 404


def test_get_subject_profile_missing_404(client, db_session):
    db_session.add(User(id=OWNER))
    db_session.commit()
    r = client.get("/api/subjects/ghost/profile", params={"user_id": OWNER})
    assert r.status_code == 404
