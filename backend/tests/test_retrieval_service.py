"""TDD: services.retrieval_service.retrieve."""

from datetime import datetime, timezone
from types import SimpleNamespace

import chromadb
import pytest

from agent.types import ToolContext
from contracts import RetrieveChunksArgs, TopicProfile
from db.models import Document, Session as SessionModel, User
from services import retrieval_service


SESSION_ID = "sess_ret"
USER_ID = "u_ret"


@pytest.fixture
def session(db_session):
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


@pytest.fixture
def ctx(db_session):
    return ToolContext(
        db=db_session,
        session_id=SESSION_ID,
        user_id=USER_ID,
        turn_started_at=datetime.now(timezone.utc),
    )


@pytest.fixture
def chroma(monkeypatch):
    client = chromadb.EphemeralClient()
    monkeypatch.setattr("services.retrieval_service.chroma_client.get_chroma", lambda: client)
    return client


@pytest.fixture
def mock_embed(monkeypatch):
    def fake_embedding(model, input, **_):
        if isinstance(input, str):
            input = [input]
        return SimpleNamespace(data=[{"embedding": [0.1] * 8} for _ in input])

    monkeypatch.setattr(
        "services.retrieval_service.litellm.embedding", fake_embedding
    )


def _seed_ready_doc(db_session, chroma):
    doc = Document(session_id=SESSION_ID, filename="x.pdf", status="ready")
    db_session.add(doc)
    db_session.commit()
    db_session.refresh(doc)
    collection = chroma.get_or_create_collection(name=f"session_{SESSION_ID}")
    collection.add(
        ids=[f"doc_{doc.id}_0"],
        embeddings=[[0.1] * 8],
        documents=["Inner joins return matching rows."],
        metadatas=[{"doc_id": str(doc.id), "chunk_idx": 0, "page": 1, "session_id": SESSION_ID}],
    )
    return doc


def test_ready_doc_returns_chunks(session, ctx, chroma, mock_embed, db_session):
    _seed_ready_doc(db_session, chroma)
    result = retrieval_service.retrieve(
        db_session, ctx, RetrieveChunksArgs(session_id=SESSION_ID, query="inner join", k=5)
    )
    assert result.ok is True
    assert result.status == "ok"
    chunks = (result.data or {}).get("chunks", [])
    assert len(chunks) >= 1
    assert "matching rows" in chunks[0]["text"]


def test_pending_doc_returns_no_results(session, ctx, chroma, mock_embed, db_session):
    db_session.add(Document(session_id=SESSION_ID, filename="x.pdf", status="pending"))
    db_session.commit()
    result = retrieval_service.retrieve(
        db_session, ctx, RetrieveChunksArgs(session_id=SESSION_ID, query="q", k=5)
    )
    assert result.status == "no_results"
    assert (result.data or {}).get("chunks", []) == []


def test_no_documents_returns_no_results(session, ctx, chroma, mock_embed, db_session):
    result = retrieval_service.retrieve(
        db_session, ctx, RetrieveChunksArgs(session_id=SESSION_ID, query="q", k=5)
    )
    assert result.status == "no_results"


def test_chroma_exception_returns_failed(session, ctx, chroma, mock_embed, db_session, monkeypatch):
    _seed_ready_doc(db_session, chroma)

    def boom(*a, **k):
        raise RuntimeError("chroma down")

    monkeypatch.setattr(
        "services.retrieval_service.chroma_client.get_chroma",
        lambda: SimpleNamespace(get_or_create_collection=boom),
    )
    result = retrieval_service.retrieve(
        db_session, ctx, RetrieveChunksArgs(session_id=SESSION_ID, query="q", k=5)
    )
    assert result.ok is False
    assert result.status == "failed"
    assert "chroma" in (result.error or "").lower()
