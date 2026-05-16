"""TDD: POST/GET sessions, GET single, POST end."""

from datetime import datetime, timedelta, timezone

import pytest

from contracts import TopicProfile
from db.models import Document, Session as SessionModel, User


USER_ID = "u1"


@pytest.fixture
def seeded_user(db_session):
    db_session.add(User(id=USER_ID))
    db_session.commit()


def test_post_fresh_creates_session(client):
    r = client.post(
        "/api/sessions",
        json={"user_id": USER_ID, "topic": "sql joins", "seed_mode": "fresh"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["user_id"] == USER_ID
    assert body["topic"] == "sql joins"
    assert body["topic_profile"]["confirmed_gaps"] == []
    assert body["topic_profile"]["mastered_concepts"] == []
    assert body["topic_profile"]["last_session_summary"] is None
    assert body["ended_at"] is None


def test_post_resume_without_prior_400(client, seeded_user):
    r = client.post(
        "/api/sessions",
        json={"user_id": USER_ID, "topic": "sql", "seed_mode": "resume"},
    )
    assert r.status_code == 400


def test_post_resume_with_ended_prior_copies_profile(client, db_session, seeded_user):
    prior = SessionModel(
        id="prior_1",
        user_id=USER_ID,
        topic="sql",
        topic_profile_json=TopicProfile(
            knowledge_level="beginner",
            confirmed_gaps=["joins"],
            mastered_concepts=["select"],
            last_session_summary="covered selects",
        ).model_dump_json(),
        ended_at=datetime.now(timezone.utc),
    )
    db_session.add(prior)
    db_session.commit()

    r = client.post(
        "/api/sessions",
        json={
            "user_id": USER_ID,
            "topic": "sql",
            "seed_mode": "resume",
            "prior_session_id": "prior_1",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["topic_profile"]["confirmed_gaps"] == ["joins"]
    assert body["topic_profile"]["mastered_concepts"] == ["select"]
    assert body["topic_profile"]["last_session_summary"] == "covered selects"


def test_post_resume_with_unended_prior_generates_summary(
    client, db_session, seeded_user, mock_litellm, llm_text, monkeypatch
):
    # Stub summary_service.acompletion call inside async path
    async def fake_acompletion(**kwargs):
        return llm_text("auto summary about joins")

    monkeypatch.setattr("services.summary_service.litellm.acompletion", fake_acompletion)

    prior = SessionModel(
        id="prior_2",
        user_id=USER_ID,
        topic="sql",
        topic_profile_json=TopicProfile(mastered_concepts=["select"]).model_dump_json(),
    )
    db_session.add(prior)
    db_session.commit()

    r = client.post(
        "/api/sessions",
        json={
            "user_id": USER_ID,
            "topic": "sql",
            "seed_mode": "resume",
            "prior_session_id": "prior_2",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["topic_profile"]["last_session_summary"] == "auto summary about joins"


def test_get_list_filters_by_user_desc(client, db_session, seeded_user):
    older = SessionModel(
        id="s_old",
        user_id=USER_ID,
        topic="x",
        topic_profile_json=TopicProfile().model_dump_json(),
        created_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )
    newer = SessionModel(
        id="s_new",
        user_id=USER_ID,
        topic="y",
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    other = SessionModel(
        id="s_other",
        user_id="u2",
        topic="z",
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    db_session.add_all([older, newer, other])
    db_session.add(User(id="u2"))
    db_session.commit()

    r = client.get(f"/api/sessions?user_id={USER_ID}")
    assert r.status_code == 200
    rows = r.json()
    assert [row["id"] for row in rows] == ["s_new", "s_old"]


def test_list_returns_tz_aware_timestamps(client, db_session, seeded_user):
    # SQLite drops tzinfo on read; the route must re-attach UTC so the wire format
    # includes an offset and the frontend can parse it as an absolute instant.
    db_session.add(
        SessionModel(
            id="s_tz",
            user_id=USER_ID,
            topic="x",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()

    r = client.get(f"/api/sessions?user_id={USER_ID}")
    assert r.status_code == 200
    rows = r.json()
    assert rows, "expected at least one session"
    iso = rows[0]["created_at"]
    assert iso.endswith("+00:00") or iso.endswith("Z"), iso


def test_get_single_404_missing(client):
    r = client.get("/api/sessions/does_not_exist")
    assert r.status_code == 404


def test_get_single_ingestion_status_null_when_no_documents(
    client, db_session, seeded_user
):
    db_session.add(
        SessionModel(
            id="s1",
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()
    r = client.get("/api/sessions/s1")
    assert r.status_code == 200
    assert r.json()["ingestion_status"] is None


def test_post_end_idempotent_when_already_ended(client, db_session, seeded_user):
    ended_at = datetime.now(timezone.utc) - timedelta(hours=1)
    db_session.add(
        SessionModel(
            id="s1",
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile(
                last_session_summary="existing summary"
            ).model_dump_json(),
            ended_at=ended_at,
        )
    )
    db_session.commit()

    r = client.post("/api/sessions/s1/end")
    assert r.status_code == 200
    body = r.json()
    assert body["summary"] == {"kind": "summary", "text": "existing summary"}


def test_post_end_returns_no_exchanges_kind_for_empty_session(
    client, db_session, seeded_user, mock_litellm, llm_text, monkeypatch
):
    async def fake_acompletion(**kwargs):
        return llm_text("")

    monkeypatch.setattr("services.summary_service.litellm.acompletion", fake_acompletion)

    db_session.add(
        SessionModel(
            id="s_empty",
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()

    r = client.post("/api/sessions/s_empty/end")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["summary"]["kind"] == "no_exchanges"
    assert "without any exchanges" in body["summary"]["text"].lower()


def test_get_session_returns_messages_array(client, db_session, seeded_user):
    from db.models import ChatMessage

    db_session.add(
        SessionModel(
            id="s_msgs",
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.add(ChatMessage(session_id="s_msgs", role="user", content="hi"))
    db_session.add(ChatMessage(session_id="s_msgs", role="assistant", content="hello back"))
    db_session.commit()

    r = client.get("/api/sessions/s_msgs")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == "s_msgs"
    assert [(m["role"], m["content"]) for m in body["messages"]] == [
        ("user", "hi"),
        ("assistant", "hello back"),
    ]


def test_reopen_flips_ended_at_to_null(client, db_session, seeded_user):
    db_session.add(
        SessionModel(
            id="s_re",
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
            ended_at=datetime.now(timezone.utc),
        )
    )
    db_session.commit()

    r = client.post("/api/sessions/s_re/reopen")
    assert r.status_code == 200, r.text
    assert r.json()["ended_at"] is None
    # idempotent: reopening an already-active session is a no-op
    r2 = client.post("/api/sessions/s_re/reopen")
    assert r2.status_code == 200
    assert r2.json()["ended_at"] is None


def test_reopen_404_when_missing(client):
    r = client.post("/api/sessions/no_such/reopen")
    assert r.status_code == 404


def test_post_end_generates_summary(
    client, db_session, seeded_user, mock_litellm, llm_text, monkeypatch
):
    async def fake_acompletion(**kwargs):
        return llm_text("learner covered joins")

    monkeypatch.setattr("services.summary_service.litellm.acompletion", fake_acompletion)

    db_session.add(
        SessionModel(
            id="s1",
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()

    r = client.post("/api/sessions/s1/end")
    assert r.status_code == 200
    body = r.json()
    assert body["summary"] == {"kind": "summary", "text": "learner covered joins"}
    assert body["ended_at"] is not None
