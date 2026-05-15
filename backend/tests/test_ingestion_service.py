"""TDD: services.ingestion_service.run pipeline (pypdf -> chunk -> embed -> chroma -> kw_index)."""

import json
from types import SimpleNamespace

import chromadb
import pytest

from contracts import TopicProfile
from db.database import SessionLocal
from db.models import Document, Session as SessionModel, User


SESSION_ID = "sess_ing"
USER_ID = "u_ing"


@pytest.fixture
def setup_doc(db_session, monkeypatch):
    """Seed user, session, document; patch SessionLocal to reuse the test db session."""
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
    db_session.flush()
    doc = Document(session_id=SESSION_ID, filename="x.pdf", status="pending")
    db_session.add(doc)
    db_session.commit()
    db_session.refresh(doc)

    # ingestion_service opens its own SessionLocal; redirect it to the in-memory test db
    test_bind = db_session.get_bind()
    from sqlalchemy.orm import sessionmaker

    monkeypatch.setattr(
        "services.ingestion_service.SessionLocal",
        sessionmaker(autocommit=False, autoflush=False, bind=test_bind),
    )
    return doc.id


@pytest.fixture
def chroma(monkeypatch):
    client = chromadb.EphemeralClient()
    monkeypatch.setattr("services.ingestion_service.chroma_client.get_chroma", lambda: client)
    return client


@pytest.fixture
def mock_pdf(monkeypatch):
    """Return a pypdf.PdfReader stub with two pages of text."""

    class FakePage:
        def __init__(self, text):
            self._text = text

        def extract_text(self):
            return self._text

    class FakeReader:
        def __init__(self, _path):
            self.pages = [
                FakePage("Indexes accelerate database queries."),
                FakePage("Joins combine rows from multiple tables."),
            ]

    monkeypatch.setattr("services.ingestion_service.PdfReader", FakeReader)


@pytest.fixture
def mock_embed(monkeypatch):
    def fake_embedding(model, input, **_):
        if isinstance(input, str):
            input = [input]
        return SimpleNamespace(data=[{"embedding": [0.1] * 8} for _ in input])

    monkeypatch.setattr(
        "services.ingestion_service.litellm.embedding", fake_embedding
    )


def _path_exists_stub(monkeypatch):
    monkeypatch.setattr("services.ingestion_service.os.path.exists", lambda p: True)


def test_success_path(setup_doc, chroma, mock_pdf, mock_embed, db_session, monkeypatch):
    _path_exists_stub(monkeypatch)
    from services import ingestion_service

    ingestion_service.run(setup_doc)

    db_session.expire_all()
    doc = db_session.get(Document, setup_doc)
    assert doc.status == "ready"
    assert doc.error is None
    assert doc.page_count == 2

    collection = chroma.get_collection(name=f"session_{SESSION_ID}")
    assert collection.count() >= 1

    session = db_session.get(SessionModel, SESSION_ID)
    stems = set(json.loads(session.kw_index_json))
    assert len(stems) > 0


def test_pypdf_failure_marks_failed(setup_doc, chroma, mock_embed, db_session, monkeypatch):
    _path_exists_stub(monkeypatch)

    def boom(_path):
        raise RuntimeError("corrupt pdf")

    monkeypatch.setattr("services.ingestion_service.PdfReader", boom)
    from services import ingestion_service

    ingestion_service.run(setup_doc)
    db_session.expire_all()
    doc = db_session.get(Document, setup_doc)
    assert doc.status == "failed"
    assert "corrupt" in (doc.error or "")


def test_embedding_failure_marks_failed(
    setup_doc, chroma, mock_pdf, db_session, monkeypatch
):
    _path_exists_stub(monkeypatch)

    def boom(model, input, **_):
        raise RuntimeError("embedding api down")

    monkeypatch.setattr("services.ingestion_service.litellm.embedding", boom)
    from services import ingestion_service

    ingestion_service.run(setup_doc)
    db_session.expire_all()
    doc = db_session.get(Document, setup_doc)
    assert doc.status == "failed"
    assert "embedding" in (doc.error or "")
