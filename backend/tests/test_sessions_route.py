"""TDD: POST/GET sessions, GET single, POST end."""

from datetime import datetime, timedelta, timezone

import pytest

from config import settings
from contracts import TopicProfile
from db.models import ChatMessage, Document, Session as SessionModel, UsageCounter, User


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
            confirmed_gaps=[{"name": "joins"}],
            mastered_concepts=[{"name": "select"}],
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
    assert [g["name"] for g in body["topic_profile"]["confirmed_gaps"]] == ["joins"]
    assert [c["name"] for c in body["topic_profile"]["mastered_concepts"]] == ["select"]
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
        topic_profile_json=TopicProfile(mastered_concepts=[{"name": "select"}]).model_dump_json(),
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
    r = client.get(f"/api/sessions/does_not_exist?user_id={USER_ID}")
    assert r.status_code == 404


def test_get_single_404_for_wrong_user(client, db_session, seeded_user):
    db_session.add(User(id="other"))
    db_session.add(
        SessionModel(
            id="s_owned",
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()
    r = client.get("/api/sessions/s_owned?user_id=other")
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
    r = client.get(f"/api/sessions/s1?user_id={USER_ID}")
    assert r.status_code == 200
    assert r.json()["ingestion_status"] is None


def test_post_end_404_for_wrong_user(client, db_session, seeded_user):
    """H-4 regression: POST /sessions/{id}/end must 404 when ?user_id does
    not match the session owner (no silent cross-user session termination)."""
    db_session.add(User(id="other"))
    db_session.add(
        SessionModel(
            id="s_end_other",
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()
    r = client.post("/api/sessions/s_end_other/end?user_id=other")
    assert r.status_code == 404


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

    r = client.post(f"/api/sessions/s1/end?user_id={USER_ID}")
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

    r = client.post(f"/api/sessions/s_empty/end?user_id={USER_ID}")
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

    r = client.get(f"/api/sessions/s_msgs?user_id={USER_ID}")
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

    r = client.post(f"/api/sessions/s_re/reopen?user_id={USER_ID}")
    assert r.status_code == 200, r.text
    assert r.json()["ended_at"] is None
    # idempotent: reopening an already-active session is a no-op
    r2 = client.post(f"/api/sessions/s_re/reopen?user_id={USER_ID}")
    assert r2.status_code == 200
    assert r2.json()["ended_at"] is None


def test_reopen_404_when_missing(client):
    r = client.post(f"/api/sessions/no_such/reopen?user_id={USER_ID}")
    assert r.status_code == 404


def test_reopen_404_for_wrong_user(client, db_session, seeded_user):
    db_session.add(User(id="other"))
    db_session.add(
        SessionModel(
            id="s_re_other",
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
            ended_at=datetime.now(timezone.utc),
        )
    )
    db_session.commit()
    r = client.post("/api/sessions/s_re_other/reopen?user_id=other")
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

    r = client.post(f"/api/sessions/s1/end?user_id={USER_ID}")
    assert r.status_code == 200
    body = r.json()
    assert body["summary"] == {"kind": "summary", "text": "learner covered joins"}
    assert body["ended_at"] is not None


# ---------------------------------------------------------------------------
# F-03: end/resume summary trigger consumes a daily rate-limit slot
# ---------------------------------------------------------------------------


def _create_active_session_with_messages(db_session, sid="s_rate"):
    """Active (unended) session with a couple of exchanges, so the mechanical
    fallback summary is non-empty and lands in the "summary" kind, not
    "no_exchanges". Creates the owning user too."""
    db_session.add(User(id=USER_ID))
    db_session.add(
        SessionModel(
            id=sid,
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.add(ChatMessage(session_id=sid, role="user", content="what are joins"))
    db_session.add(ChatMessage(session_id=sid, role="assistant", content="joins combine tables"))
    db_session.commit()
    return sid


def _usage_count(db_session, user_id=USER_ID):
    row = db_session.query(UsageCounter).filter_by(user_id=user_id).one_or_none()
    return row.count if row else 0


def test_end_session_at_rate_cap_returns_mechanical_summary(client, db_session, monkeypatch):
    # F-03: end must never 429, but a rate-capped user must not trigger LLM spend.
    # Force the non-stub branch (mirrors Task 4's pattern) so a rate-gate bypass
    # would actually reach litellm.acompletion instead of being masked by stub mode.
    monkeypatch.setattr(settings, "llm_stub", False)
    monkeypatch.setattr(settings, "gemini_api_key", "real")
    monkeypatch.setattr(settings, "daily_cap", 0)

    called = []

    async def fake_acompletion(**kwargs):
        called.append(1)

    monkeypatch.setattr("services.summary_service.litellm.acompletion", fake_acompletion)

    session_id = _create_active_session_with_messages(db_session)
    resp = client.post(f"/api/sessions/{session_id}/end?user_id={USER_ID}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert called == []  # rate cap must short-circuit before any LLM call
    assert body["summary"]["kind"] == "summary"
    assert "joins combine tables" in body["summary"]["text"]


def test_end_session_consumes_rate_limit_slot(
    client, db_session, monkeypatch, llm_text
):
    async def fake_acompletion(**kwargs):
        return llm_text("a fresh summary")

    monkeypatch.setattr("services.summary_service.litellm.acompletion", fake_acompletion)

    session_id = _create_active_session_with_messages(db_session)
    before = _usage_count(db_session)
    resp = client.post(f"/api/sessions/{session_id}/end?user_id={USER_ID}")
    assert resp.status_code == 200, resp.text
    assert _usage_count(db_session) == before + 1


# ---------------------------------------------------------------------------
# PATCH /sessions/{session_id} — rename + pin (Task 8)
# ---------------------------------------------------------------------------


def _make_session(db_session, sid, pinned=False, ended=False):
    s = SessionModel(
        id=sid,
        user_id=USER_ID,
        topic="orig",
        topic_profile_json=TopicProfile().model_dump_json(),
        pinned=pinned,
        ended_at=datetime.now(timezone.utc) if ended else None,
    )
    db_session.add(s)
    db_session.commit()
    return s


def test_patch_renames_session(client, db_session, seeded_user):
    _make_session(db_session, "s_rename")
    r = client.patch(f"/api/sessions/s_rename?user_id={USER_ID}", json={"topic": "new name"})
    assert r.status_code == 200, r.text
    assert r.json()["topic"] == "new name"


def test_patch_pins_active_session(client, db_session, seeded_user):
    _make_session(db_session, "s_pin")
    r = client.patch(f"/api/sessions/s_pin?user_id={USER_ID}", json={"pinned": True})
    assert r.status_code == 200, r.text
    assert r.json()["pinned"] is True


def test_patch_pin_on_ended_session_400(client, db_session, seeded_user):
    _make_session(db_session, "s_ended", ended=True)
    r = client.patch(f"/api/sessions/s_ended?user_id={USER_ID}", json={"pinned": True})
    assert r.status_code == 400


def test_patch_rename_allowed_on_ended_session(client, db_session, seeded_user):
    _make_session(db_session, "s_ended2", ended=True)
    r = client.patch(f"/api/sessions/s_ended2?user_id={USER_ID}", json={"topic": "renamed ended"})
    assert r.status_code == 200, r.text
    assert r.json()["topic"] == "renamed ended"


def test_patch_404_for_other_user(client, db_session, seeded_user):
    other = SessionModel(
        id="s_other_patch",
        user_id="someone_else",
        topic="x",
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    db_session.add(other)
    db_session.commit()
    r = client.patch(f"/api/sessions/s_other_patch?user_id={USER_ID}", json={"topic": "hijack"})
    assert r.status_code == 404


def test_list_and_detail_include_pinned(client, db_session, seeded_user):
    _make_session(db_session, "s_list", pinned=True)
    list_items = client.get(f"/api/sessions?user_id={USER_ID}").json()
    s_list_item = next((item for item in list_items if item["id"] == "s_list"), None)
    assert s_list_item is not None, "s_list not found in list response"
    assert s_list_item["pinned"] is True
    assert client.get(f"/api/sessions/s_list?user_id={USER_ID}").json()["pinned"] is True


def test_patch_empty_body_400(client, db_session, seeded_user):
    _make_session(db_session, "s_empty")
    r = client.patch(f"/api/sessions/s_empty?user_id={USER_ID}", json={})
    assert r.status_code == 400


def test_get_session_ingestion_aggregates_documents(client, db_session, seeded_user):
    db_session.add(
        SessionModel(
            id="s_ing",
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.flush()
    db_session.add(Document(session_id="s_ing", filename="a.pdf", status="ready"))
    db_session.add(Document(session_id="s_ing", filename="b.pptx", status="pending"))
    db_session.commit()

    r = client.get(f"/api/sessions/s_ing/ingestion?user_id={USER_ID}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert len(body["documents"]) == 2
    assert {d["filename"] for d in body["documents"]} == {"a.pdf", "b.pptx"}


def test_get_session_ingestion_404_for_wrong_user(client, db_session, seeded_user):
    db_session.add(User(id="other2"))
    db_session.add(
        SessionModel(
            id="s_ing_owned",
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()
    r = client.get("/api/sessions/s_ing_owned/ingestion?user_id=other2")
    assert r.status_code == 404


def test_get_session_ingestion_empty_when_no_documents(client, db_session, seeded_user):
    db_session.add(
        SessionModel(
            id="s_ing_empty",
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()
    r = client.get(f"/api/sessions/s_ing_empty/ingestion?user_id={USER_ID}")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] is None
    assert body["documents"] == []
