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
    r = client.post("/api/upload", data={"session_id": SESSION_ID}, files=files)
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert body["filename"] == "notes.pdf"
    assert body["session_id"] == SESSION_ID

    doc = db_session.get(Document, body["document_id"])
    assert doc is not None
    assert doc.status == "pending"


def test_non_pdf_content_type_400(client, seeded):
    files = {"file": ("notes.txt", io.BytesIO(b"hello"), "text/plain")}
    r = client.post("/api/upload", data={"session_id": SESSION_ID}, files=files)
    assert r.status_code == 400


def test_missing_session_id_field_400(client, seeded):
    files = {"file": ("notes.pdf", io.BytesIO(b"%PDF-fake"), "application/pdf")}
    r = client.post("/api/upload", files=files)
    assert r.status_code in (400, 422)


def test_unknown_session_id_400(client, seeded):
    files = {"file": ("notes.pdf", io.BytesIO(b"%PDF-fake"), "application/pdf")}
    r = client.post("/api/upload", data={"session_id": "does_not_exist"}, files=files)
    assert r.status_code == 400


def test_background_task_scheduled(client, seeded, monkeypatch):
    seen = []

    def fake_run(doc_id):
        seen.append(doc_id)

    monkeypatch.setattr("services.ingestion_service.run", fake_run)
    files = {"file": ("notes.pdf", io.BytesIO(b"%PDF-fake"), "application/pdf")}
    r = client.post("/api/upload", data={"session_id": SESSION_ID}, files=files)
    assert r.status_code == 202
    assert len(seen) == 1
    assert seen[0] == r.json()["document_id"]
