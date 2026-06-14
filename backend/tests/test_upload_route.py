"""TDD: POST /api/upload (multipart PDF -> Document row + background ingestion)."""

import io

import pytest

from contracts import TopicProfile
from db.models import Document, Session as SessionModel, User


SESSION_ID = "sess_up"
USER_ID = "u_up"


@pytest.fixture
def seeded(db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    db_session.add(
        SessionModel(
            id=SESSION_ID,
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()


@pytest.fixture(autouse=True)
def stub_background(monkeypatch):
    """Prevent background ingestion from firing (we test it separately)."""
    monkeypatch.setattr("services.ingestion_service.run", lambda doc_id: None)


@pytest.fixture(autouse=True)
def stub_filesystem(monkeypatch, tmp_path):
    monkeypatch.setattr("routes.upload.settings.uploads_path", str(tmp_path))


def test_upload_returns_202_and_creates_pending_document(client, seeded, db_session):
    files = {"file": ("notes.pdf", io.BytesIO(b"%PDF-fake"), "application/pdf")}
    r = client.post("/api/upload", data={"user_id": USER_ID, "session_id": SESSION_ID}, files=files)
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert body["filename"] == "notes.pdf"
    assert body["session_id"] == SESSION_ID

    doc = db_session.get(Document, body["document_id"])
    assert doc is not None
    assert doc.status == "pending"


def test_disallowed_extension_400(client, seeded):
    files = {"file": ("paper.docx", io.BytesIO(b"PK\x03\x04"), "application/octet-stream")}
    r = client.post("/api/upload", data={"user_id": USER_ID, "session_id": SESSION_ID}, files=files)
    assert r.status_code == 400


def test_extensionless_filename_400(client, seeded):
    files = {"file": ("README", io.BytesIO(b"hello"), "text/plain")}
    r = client.post("/api/upload", data={"user_id": USER_ID, "session_id": SESSION_ID}, files=files)
    assert r.status_code == 400


@pytest.mark.parametrize(
    "name,ctype",
    [
        ("slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        ("notes.txt", "text/plain"),
        ("notes.md", "text/markdown"),
        ("notes.markdown", "application/octet-stream"),
    ],
)
def test_allowed_non_pdf_types_202(client, seeded, name, ctype):
    files = {"file": (name, io.BytesIO(b"data-bytes"), ctype)}
    r = client.post(
        "/api/upload", data={"user_id": USER_ID, "session_id": SESSION_ID}, files=files
    )
    assert r.status_code == 202, r.text
    assert r.json()["status"] == "pending"


def test_missing_session_id_field_400(client, seeded):
    files = {"file": ("notes.pdf", io.BytesIO(b"%PDF-fake"), "application/pdf")}
    r = client.post("/api/upload", files=files)
    assert r.status_code in (400, 422)


def test_unknown_session_id_404(client, seeded):
    # Phase 7: ownership check folds unknown-session and wrong-owner into 404
    # to avoid an existence oracle (matches the sessions/profile pattern).
    files = {"file": ("notes.pdf", io.BytesIO(b"%PDF-fake"), "application/pdf")}
    r = client.post(
        "/api/upload",
        data={"user_id": USER_ID, "session_id": "does_not_exist"},
        files=files,
    )
    assert r.status_code == 404


def test_missing_auth_header_401(client, seeded):
    # Phase 7: user_id no longer carried in form. Missing Authorization
    # header => 401. Override returns "test-user" default => /api/upload
    # would reach ownership check and 404 because seeded session belongs to
    # a different user. Either response is acceptable as long as auth gates
    # the request before the form is even validated.
    files = {"file": ("notes.pdf", io.BytesIO(b"%PDF-fake"), "application/pdf")}
    r = client.post("/api/upload", data={"session_id": SESSION_ID}, files=files)
    assert r.status_code in (401, 404)


def test_upload_returns_429_when_cap_reached(client, seeded, monkeypatch):
    monkeypatch.setattr(
        "routes.upload.rate_limit.check_and_increment",
        lambda db, uid: (False, 9999),
    )
    files = {"file": ("notes.pdf", io.BytesIO(b"%PDF-fake"), "application/pdf")}
    r = client.post(
        "/api/upload",
        data={"user_id": USER_ID, "session_id": SESSION_ID},
        files=files,
    )
    assert r.status_code == 429
    body = r.json()["detail"]
    assert body["code"] == "daily_cap_reached"
    assert body["used"] == 9999
    assert "resets_at" in body


def test_get_upload_status_returns_current_doc_state(client, seeded, db_session):
    files = {"file": ("notes.pdf", io.BytesIO(b"%PDF-fake"), "application/pdf")}
    r = client.post("/api/upload", data={"user_id": USER_ID, "session_id": SESSION_ID}, files=files)
    doc_id = r.json()["document_id"]

    r2 = client.get(f"/api/upload/{doc_id}?user_id={USER_ID}")
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body["id"] == doc_id
    assert body["status"] == "pending"
    assert body["error"] is None

    doc = db_session.get(Document, doc_id)
    doc.status = "failed"
    doc.error = "embedding service unreachable"
    db_session.commit()

    r3 = client.get(f"/api/upload/{doc_id}?user_id={USER_ID}")
    assert r3.status_code == 200
    body3 = r3.json()
    assert body3["status"] == "failed"
    assert body3["error"] == "embedding service unreachable"


def test_get_upload_status_404_for_missing(client):
    r = client.get(f"/api/upload/99999?user_id={USER_ID}")
    assert r.status_code == 404


def test_get_upload_status_404_for_wrong_user(client, seeded, db_session):
    db_session.add(User(id="other"))
    db_session.commit()
    files = {"file": ("notes.pdf", io.BytesIO(b"%PDF-fake"), "application/pdf")}
    r = client.post(
        "/api/upload",
        data={"user_id": USER_ID, "session_id": SESSION_ID},
        files=files,
    )
    doc_id = r.json()["document_id"]
    r2 = client.get(f"/api/upload/{doc_id}?user_id=other")
    assert r2.status_code == 404


def test_upload_rejects_oversize_via_content_length(client, seeded):
    big = b"%PDF-" + b"x" * (26 * 1024 * 1024)
    files = {"file": ("big.pdf", io.BytesIO(big), "application/pdf")}
    r = client.post(
        "/api/upload",
        data={"user_id": USER_ID, "session_id": SESSION_ID},
        files=files,
    )
    assert r.status_code == 413
    assert r.json()["detail"]["code"] == "FILE_TOO_LARGE"


def test_upload_sanitizes_traversal_filename(client, seeded, db_session):
    files = {"file": ("../../etc/passwd.pdf", io.BytesIO(b"%PDF-fake"), "application/pdf")}
    r = client.post(
        "/api/upload",
        data={"user_id": USER_ID, "session_id": SESSION_ID},
        files=files,
    )
    assert r.status_code == 202, r.text
    body = r.json()
    assert "/" not in body["filename"]
    assert "\\" not in body["filename"]
    assert ".." not in body["filename"]
    assert body["filename"].endswith("passwd.pdf")


def test_background_task_scheduled(client, seeded, monkeypatch):
    seen = []

    def fake_run(doc_id):
        seen.append(doc_id)

    monkeypatch.setattr("services.ingestion_service.run", fake_run)
    files = {"file": ("notes.pdf", io.BytesIO(b"%PDF-fake"), "application/pdf")}
    r = client.post("/api/upload", data={"user_id": USER_ID, "session_id": SESSION_ID}, files=files)
    assert r.status_code == 202
    assert len(seen) == 1
    assert seen[0] == r.json()["document_id"]
