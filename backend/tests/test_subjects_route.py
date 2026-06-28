"""TDD: subjects/lessons routes - auth scoping, draft vs blank, lifecycle."""

import pytest

from db.models import User
from services import plan_service


USER_ID = "u1"


@pytest.fixture
def seeded_user(db_session):
    db_session.add(User(id=USER_ID))
    db_session.commit()


def _create_blank(client, lessons=None):
    return client.post(
        "/api/subjects",
        json={
            "user_id": USER_ID,
            "title": "Organic Chem",
            "per_session_minutes": 30,
            "duration_mode": "deadline",
            "timeline_days": 14,
            "mode": "blank",
            "lessons": lessons or [{"title": "Bonding", "goal": "learn bonds"}],
        },
    )


def test_create_blank_persists_body_lessons(client, seeded_user):
    r = _create_blank(client, lessons=[{"title": "A", "goal": "g"}, {"title": "B", "goal": "g"}])
    assert r.status_code == 201, r.text
    body = r.json()
    assert [l["title"] for l in body["lessons"]] == ["A", "B"]
    assert body["progress"] == {"done_count": 0, "total_count": 2}
    assert body["duration_mode"] == "deadline"
    assert body["timeline_days"] == 14            # pinned
    assert body["pace_per_week"] == 1             # derived: ceil(2 / 2 weeks)


def test_create_draft_calls_plan_service(client, seeded_user, monkeypatch):
    from contracts import LessonDraft

    async def fake_draft(db, user_id, title, per_session_minutes, duration_mode, timeline_days, pace_per_week):
        assert duration_mode == "pace"
        assert pace_per_week == 2
        return [LessonDraft(title="Drafted 1", goal="g"), LessonDraft(title="Drafted 2", goal="g")]

    monkeypatch.setattr(plan_service, "draft_plan", fake_draft)
    r = client.post(
        "/api/subjects",
        json={
            "user_id": USER_ID,
            "title": "Quantum",
            "per_session_minutes": 60,
            "duration_mode": "pace",
            "pace_per_week": 2,
            "mode": "draft",
        },
    )
    assert r.status_code == 201, r.text
    assert [l["title"] for l in r.json()["lessons"]] == ["Drafted 1", "Drafted 2"]


def test_draft_plan_preview_returns_lessons_metered_no_persist(
    client, db_session, seeded_user, monkeypatch
):
    import json as _json
    from types import SimpleNamespace

    from services import cost_meter, subject_service

    # Force the real plan_service LLM path (not the stub) and mock LiteLLM so the
    # route exercises the same metering as the persist path.
    monkeypatch.setattr(plan_service.settings, "llm_stub", False)
    monkeypatch.setattr(plan_service.settings, "gemini_api_key", "live")
    payload = _json.dumps([{"title": f"P{i}", "goal": "g"} for i in range(3)])

    async def fake_acompletion(**kwargs):
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=payload))]
        )

    monkeypatch.setattr(plan_service.litellm, "acompletion", fake_acompletion)
    monkeypatch.setattr(plan_service.litellm, "completion_cost", lambda **kw: 0.02)

    r = client.post(
        "/api/subjects/draft-plan",
        json={
            "user_id": USER_ID,
            "title": "Organic Chem",
            "per_session_minutes": 30,
            "duration_mode": "deadline",
            "timeline_days": 14,
        },
    )
    assert r.status_code == 200, r.text
    assert [l["title"] for l in r.json()["lessons"]] == ["P0", "P1", "P2"]
    # persists nothing
    assert subject_service.list_subjects(db_session, USER_ID) == []
    # but is metered like the persist path
    assert cost_meter.current_spend(db_session, USER_ID) > 0


def test_list_subjects_scoped(client, seeded_user, db_session):
    _create_blank(client)
    db_session.add(User(id="other"))
    db_session.commit()
    r = client.get(f"/api/subjects?user_id={USER_ID}")
    assert r.status_code == 200
    assert len(r.json()) == 1
    # cross-user sees none
    assert client.get("/api/subjects?user_id=other").json() == []


def test_get_subject_404_cross_user(client, seeded_user, db_session):
    sid = _create_blank(client).json()["id"]
    db_session.add(User(id="other"))
    db_session.commit()
    assert client.get(f"/api/subjects/{sid}?user_id=other").status_code == 404


def test_patch_subject_archive(client, seeded_user):
    sid = _create_blank(client).json()["id"]
    r = client.patch(f"/api/subjects/{sid}?user_id={USER_ID}", json={"archived": True})
    assert r.status_code == 200, r.text
    assert r.json()["archived_at"] is not None
    # also surfaces archived in the list item
    item = next(i for i in client.get(f"/api/subjects?user_id={USER_ID}").json() if i["id"] == sid)
    assert item["archived"] is True


def test_patch_subject_empty_body_400(client, seeded_user):
    sid = _create_blank(client).json()["id"]
    assert client.patch(f"/api/subjects/{sid}?user_id={USER_ID}", json={}).status_code == 400


def test_get_subject_returns_pinned_and_derived_duration(client, seeded_user):
    # deadline mode, 14-day timeline, 4 lessons -> derived pace = ceil(4/2) = 2.
    sid = _create_blank(
        client, lessons=[{"title": t, "goal": "g"} for t in ["a", "b", "c", "d"]]
    ).json()["id"]
    body = client.get(f"/api/subjects/{sid}?user_id={USER_ID}").json()
    assert body["duration_mode"] == "deadline"
    assert body["timeline_days"] == 14   # pinned
    assert body["pace_per_week"] == 2    # derived from current lesson_count


def test_patch_subject_change_duration_to_pace(client, seeded_user):
    # 4 lessons; switch to pace mode pinned at 1/week -> derived timeline = 4*7 = 28.
    sid = _create_blank(
        client, lessons=[{"title": t, "goal": "g"} for t in ["a", "b", "c", "d"]]
    ).json()["id"]
    r = client.patch(
        f"/api/subjects/{sid}?user_id={USER_ID}",
        json={"duration_mode": "pace", "pace_per_week": 1},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["duration_mode"] == "pace"
    assert body["pace_per_week"] == 1    # pinned
    assert body["timeline_days"] == 28   # derived: ceil(4/1) * 7


def test_patch_subject_invalid_duration_mode_422(client, seeded_user):
    # SubjectUpdateRequest enforces Literal["deadline","pace"] at the contract level,
    # so Pydantic rejects unknown values with 422 before the route handler runs.
    # (The brief expected 400 but that was before the enum was added to the contract.)
    sid = _create_blank(client).json()["id"]
    r = client.patch(
        f"/api/subjects/{sid}?user_id={USER_ID}", json={"duration_mode": "whenever"}
    )
    assert r.status_code == 422


def test_add_lesson_appends(client, seeded_user):
    sid = _create_blank(client, lessons=[{"title": "A", "goal": "g"}]).json()["id"]
    r = client.post(f"/api/subjects/{sid}/lessons?user_id={USER_ID}", json={"title": "B", "goal": "gb"})
    assert r.status_code == 201, r.text
    assert r.json()["order_idx"] == 1


def test_patch_lesson_status_done(client, seeded_user):
    body = _create_blank(client, lessons=[{"title": "A", "goal": "g"}]).json()
    lid = body["lessons"][0]["id"]
    r = client.patch(f"/api/lessons/{lid}?user_id={USER_ID}", json={"status": "done"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "done"


def test_patch_lesson_invalid_status_400(client, seeded_user):
    lid = _create_blank(client).json()["lessons"][0]["id"]
    assert client.patch(f"/api/lessons/{lid}?user_id={USER_ID}", json={"status": "bogus"}).status_code == 400


def test_open_lesson_idempotent(client, seeded_user):
    lid = _create_blank(client).json()["lessons"][0]["id"]
    r1 = client.post(f"/api/lessons/{lid}/open?user_id={USER_ID}")
    assert r1.status_code == 200, r1.text
    sid1 = r1.json()["session_id"]
    assert r1.json()["status"] == "in_progress"
    r2 = client.post(f"/api/lessons/{lid}/open?user_id={USER_ID}")
    assert r2.json()["session_id"] == sid1


def test_delete_lesson_with_session_409(client, seeded_user):
    lid = _create_blank(client).json()["lessons"][0]["id"]
    client.post(f"/api/lessons/{lid}/open?user_id={USER_ID}")
    assert client.delete(f"/api/lessons/{lid}?user_id={USER_ID}").status_code == 409


def test_delete_lesson_without_session_204(client, seeded_user):
    lid = _create_blank(client).json()["lessons"][0]["id"]
    assert client.delete(f"/api/lessons/{lid}?user_id={USER_ID}").status_code == 204


def test_delete_lesson_force_ends_session_and_deletes(client, db_session, seeded_user):
    from db.models import Lesson, Session as SessionModel

    lid = _create_blank(client).json()["lessons"][0]["id"]
    sid = client.post(f"/api/lessons/{lid}/open?user_id={USER_ID}").json()["session_id"]
    r = client.delete(f"/api/lessons/{lid}?user_id={USER_ID}&force=true")
    assert r.status_code == 204, r.text
    # lesson gone, session ended (session_id pointer was cleared before delete)
    assert db_session.get(Lesson, lid) is None
    sess = db_session.get(SessionModel, sid)
    assert sess is not None
    assert sess.ended_at is not None


def test_lesson_routes_404_cross_user(client, seeded_user, db_session):
    lid = _create_blank(client).json()["lessons"][0]["id"]
    db_session.add(User(id="other"))
    db_session.commit()
    assert client.patch(f"/api/lessons/{lid}?user_id=other", json={"status": "done"}).status_code == 404
    assert client.post(f"/api/lessons/{lid}/open?user_id=other").status_code == 404
