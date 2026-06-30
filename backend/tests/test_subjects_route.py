"""TDD: subjects/lessons routes - auth scoping, single-seed, lifecycle."""

import pytest

from db.models import User


USER_ID = "u1"


@pytest.fixture
def seeded_user(db_session):
    db_session.add(User(id=USER_ID))
    db_session.commit()


def _create(client, title="Organic Chem", duration_mode="deadline",
            timeline_days=14, pace_per_week=None):
    body = {
        "user_id": USER_ID,
        "title": title,
        "per_session_minutes": 30,
        "duration_mode": duration_mode,
    }
    if timeline_days is not None:
        body["timeline_days"] = timeline_days
    if pace_per_week is not None:
        body["pace_per_week"] = pace_per_week
    return client.post("/api/subjects", json=body)


def test_create_seeds_one_lesson_titled_after_subject(client, seeded_user):
    r = _create(client, title="Organic Chem")
    assert r.status_code == 201, r.text
    body = r.json()
    assert [l["title"] for l in body["lessons"]] == ["Organic Chem"]
    assert body["lessons"][0]["goal"] == "Introduction to Organic Chem."
    assert body["lessons"][0]["status"] == "not_started"
    assert body["progress"] == {"done_count": 0, "total_count": 1}
    assert body["duration_mode"] == "deadline"
    assert body["timeline_days"] == 14


def _add_lessons(client, sid, n):
    for i in range(n):
        client.post(f"/api/subjects/{sid}/lessons?user_id={USER_ID}",
                    json={"title": f"L{i}", "goal": "g"})


def test_list_subjects_scoped(client, seeded_user, db_session):
    _create(client)
    db_session.add(User(id="other"))
    db_session.commit()
    r = client.get(f"/api/subjects?user_id={USER_ID}")
    assert r.status_code == 200
    assert len(r.json()) == 1
    # cross-user sees none
    r = client.get("/api/subjects?user_id=other")
    assert r.json() == []


def test_get_subject_404_cross_user(client, seeded_user, db_session):
    sid = _create(client).json()["id"]
    db_session.add(User(id="other"))
    db_session.commit()
    r = client.get(f"/api/subjects/{sid}?user_id=other")
    assert r.status_code == 404


def test_patch_subject_archive(client, seeded_user):
    sid = _create(client).json()["id"]
    r = client.patch(f"/api/subjects/{sid}?user_id={USER_ID}", json={"archived": True})
    assert r.status_code == 200, r.text
    assert r.json()["archived_at"] is not None
    # also surfaces archived in the list item
    item = next(i for i in client.get(f"/api/subjects?user_id={USER_ID}").json() if i["id"] == sid)
    assert item["archived"] is True


def test_patch_subject_empty_body_400(client, seeded_user):
    sid = _create(client).json()["id"]
    r = client.patch(f"/api/subjects/{sid}?user_id={USER_ID}", json={})
    assert r.status_code == 400


def test_get_subject_returns_pinned_and_derived_duration(client, seeded_user):
    # 1 seeded + 3 added = 4 lessons; deadline 14d -> derived pace ceil(4/2)=2.
    sid = _create(client).json()["id"]
    _add_lessons(client, sid, 3)
    body = client.get(f"/api/subjects/{sid}?user_id={USER_ID}").json()
    assert body["duration_mode"] == "deadline"
    assert body["timeline_days"] == 14
    assert body["pace_per_week"] == 2


def test_patch_subject_change_duration_to_pace(client, seeded_user):
    # 4 lessons; switch to pace pinned 1/week -> derived timeline 4*7=28.
    sid = _create(client).json()["id"]
    _add_lessons(client, sid, 3)
    r = client.patch(
        f"/api/subjects/{sid}?user_id={USER_ID}",
        json={"duration_mode": "pace", "pace_per_week": 1},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["duration_mode"] == "pace"
    assert body["pace_per_week"] == 1
    assert body["timeline_days"] == 28


def test_patch_subject_invalid_duration_mode_422(client, seeded_user):
    # SubjectUpdateRequest enforces Literal["deadline","pace"] at the contract level,
    # so Pydantic rejects unknown values with 422 before the route handler runs.
    # (The brief expected 400 but that was before the enum was added to the contract.)
    sid = _create(client).json()["id"]
    r = client.patch(
        f"/api/subjects/{sid}?user_id={USER_ID}", json={"duration_mode": "whenever"}
    )
    assert r.status_code == 422


def test_add_lesson_appends(client, seeded_user):
    sid = _create(client).json()["id"]
    r = client.post(f"/api/subjects/{sid}/lessons?user_id={USER_ID}", json={"title": "B", "goal": "gb"})
    assert r.status_code == 201, r.text
    assert r.json()["order_idx"] == 1


def test_patch_lesson_status_done(client, seeded_user):
    body = _create(client).json()
    lid = body["lessons"][0]["id"]
    r = client.patch(f"/api/lessons/{lid}?user_id={USER_ID}", json={"status": "done"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "done"


def test_patch_lesson_invalid_status_400(client, seeded_user):
    lid = _create(client).json()["lessons"][0]["id"]
    r = client.patch(f"/api/lessons/{lid}?user_id={USER_ID}", json={"status": "bogus"})
    assert r.status_code == 400


def test_open_lesson_idempotent(client, seeded_user):
    lid = _create(client).json()["lessons"][0]["id"]
    r1 = client.post(f"/api/lessons/{lid}/open?user_id={USER_ID}")
    assert r1.status_code == 200, r1.text
    sid1 = r1.json()["session_id"]
    assert r1.json()["status"] == "in_progress"
    r2 = client.post(f"/api/lessons/{lid}/open?user_id={USER_ID}")
    assert r2.json()["session_id"] == sid1


def test_delete_lesson_with_session_409(client, seeded_user):
    lid = _create(client).json()["lessons"][0]["id"]
    client.post(f"/api/lessons/{lid}/open?user_id={USER_ID}")
    r = client.delete(f"/api/lessons/{lid}?user_id={USER_ID}")
    assert r.status_code == 409


def test_delete_lesson_without_session_204(client, seeded_user):
    lid = _create(client).json()["lessons"][0]["id"]
    r = client.delete(f"/api/lessons/{lid}?user_id={USER_ID}")
    assert r.status_code == 204


def test_delete_lesson_force_ends_session_and_deletes(client, db_session, seeded_user):
    from db.models import Lesson, Session as SessionModel

    lid = _create(client).json()["lessons"][0]["id"]
    sid = client.post(f"/api/lessons/{lid}/open?user_id={USER_ID}").json()["session_id"]
    r = client.delete(f"/api/lessons/{lid}?user_id={USER_ID}&force=true")
    assert r.status_code == 204, r.text
    # lesson gone, session ended (session_id pointer was cleared before delete)
    assert db_session.get(Lesson, lid) is None
    sess = db_session.get(SessionModel, sid)
    assert sess is not None
    assert sess.ended_at is not None


def test_lesson_routes_404_cross_user(client, seeded_user, db_session):
    lid = _create(client).json()["lessons"][0]["id"]
    db_session.add(User(id="other"))
    db_session.commit()
    r = client.patch(f"/api/lessons/{lid}?user_id=other", json={"status": "done"})
    assert r.status_code == 404
    r = client.post(f"/api/lessons/{lid}/open?user_id=other")
    assert r.status_code == 404
    r = client.delete(f"/api/lessons/{lid}?user_id=other")
    assert r.status_code == 404


def test_patch_subject_404_cross_user(client, seeded_user, db_session):
    sid = _create(client).json()["id"]
    db_session.add(User(id="other"))
    db_session.commit()
    r = client.patch(f"/api/subjects/{sid}?user_id=other", json={"archived": True})
    assert r.status_code == 404


# --- Fix 2: cross-user 404 for addLesson ---

def test_add_lesson_404_cross_user(client, seeded_user, db_session):
    sid = _create(client).json()["id"]
    db_session.add(User(id="other"))
    db_session.commit()
    r = client.post(
        f"/api/subjects/{sid}/lessons?user_id=other",
        json={"title": "Sneaky", "goal": "g"},
    )
    assert r.status_code == 404


# --- Fix 3: duration invariant validation on create ---

def test_create_deadline_missing_timeline_days_400(client, seeded_user):
    r = client.post(
        "/api/subjects",
        json={"user_id": USER_ID, "title": "Bad Deadline",
              "per_session_minutes": 30, "duration_mode": "deadline"},
    )
    assert r.status_code == 400


def test_create_pace_missing_pace_per_week_400(client, seeded_user):
    r = client.post(
        "/api/subjects",
        json={"user_id": USER_ID, "title": "Bad Pace",
              "per_session_minutes": 30, "duration_mode": "pace"},
    )
    assert r.status_code == 400


def test_create_deadline_complement_nulled(client, seeded_user):
    # Sending both: complement (pace_per_week) nulled; response derives from the
    # single seeded lesson -> ceil(1 / 1 week) = 1.
    r = client.post(
        "/api/subjects",
        json={"user_id": USER_ID, "title": "Deadline Both",
              "per_session_minutes": 30, "duration_mode": "deadline",
              "timeline_days": 7, "pace_per_week": 99},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["duration_mode"] == "deadline"
    assert body["timeline_days"] == 7
    assert body["pace_per_week"] == 1
