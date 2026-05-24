"""TDD: services.retrieval_service.retrieve (pgvector backend, Phase 7 T4).

Unit tests mock services.pgvector_store.query_chunks so they run against
the in-memory SQLite fixture. End-to-end cosine-distance behavior is
covered in tests/test_pgvector_retrieval.py against a live Postgres.
"""

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from agent.types import ToolContext
from contracts import RetrieveChunksArgs, TopicProfile
from db.models import Document, Session as SessionModel, User
from services import pgvector_store, retrieval_service


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
def mock_embed(monkeypatch):
    def fake_embedding(model, input, **_):
        if isinstance(input, str):
            input = [input]
        return SimpleNamespace(data=[{"embedding": [0.1] * 8} for _ in input])

    monkeypatch.setattr(
        "services.retrieval_service.litellm.embedding", fake_embedding
    )


def _stub_query(monkeypatch, hits: list[pgvector_store.RetrievedChunk]):
    def fake(db, *, session_id, query_embedding, k):
        assert session_id == SESSION_ID
        return list(hits)[:k]

    monkeypatch.setattr("services.retrieval_service.pgvector_store.query_chunks", fake)


def _seed_ready_doc(db_session) -> Document:
    doc = Document(session_id=SESSION_ID, filename="x.pdf", status="ready")
    db_session.add(doc)
    db_session.commit()
    db_session.refresh(doc)
    return doc


def test_ready_doc_returns_chunks(session, ctx, mock_embed, db_session, monkeypatch):
    doc = _seed_ready_doc(db_session)
    _stub_query(
        monkeypatch,
        [
            pgvector_store.RetrievedChunk(
                doc_id=doc.id,
                chunk_text="Inner joins return matching rows.",
                page=1,
                score=0.12,
            )
        ],
    )
    result = retrieval_service.retrieve(
        db_session, ctx, RetrieveChunksArgs(session_id=SESSION_ID, query="inner join", k=5)
    )
    assert result.ok is True
    assert result.status == "ok"
    chunks = (result.data or {}).get("chunks", [])
    assert len(chunks) == 1
    assert "matching rows" in chunks[0]["text"]
    assert chunks[0]["doc_id"] == str(doc.id)
    assert chunks[0]["page"] == 1


def test_pending_doc_returns_no_results(session, ctx, mock_embed, db_session):
    db_session.add(Document(session_id=SESSION_ID, filename="x.pdf", status="pending"))
    db_session.commit()
    result = retrieval_service.retrieve(
        db_session, ctx, RetrieveChunksArgs(session_id=SESSION_ID, query="q", k=5)
    )
    assert result.status == "no_results"
    assert (result.data or {}).get("chunks", []) == []


def test_no_documents_returns_no_results(session, ctx, mock_embed, db_session):
    result = retrieval_service.retrieve(
        db_session, ctx, RetrieveChunksArgs(session_id=SESSION_ID, query="q", k=5)
    )
    assert result.status == "no_results"


def test_empty_hits_returns_no_results(session, ctx, mock_embed, db_session, monkeypatch):
    _seed_ready_doc(db_session)
    _stub_query(monkeypatch, [])
    result = retrieval_service.retrieve(
        db_session, ctx, RetrieveChunksArgs(session_id=SESSION_ID, query="q", k=5)
    )
    assert result.status == "no_results"
    assert (result.data or {}).get("chunks", []) == []


def test_pgvector_exception_returns_failed(session, ctx, mock_embed, db_session, monkeypatch):
    _seed_ready_doc(db_session)

    def boom(*a, **k):
        raise RuntimeError("pgvector down")

    monkeypatch.setattr("services.retrieval_service.pgvector_store.query_chunks", boom)
    result = retrieval_service.retrieve(
        db_session, ctx, RetrieveChunksArgs(session_id=SESSION_ID, query="q", k=5)
    )
    assert result.ok is False
    assert result.status == "failed"
    assert result.error == "retrieval_failed"


def test_pgvector_exception_does_not_leak_internal_message(
    session, ctx, mock_embed, db_session, monkeypatch
):
    """H-5 regression: a future change that reintroduces str(e) into the
    error field would leak server internals (file paths, traceback fragments,
    or attacker-controlled input echoes) into chat tool-call traces. Lock
    the generic literal and assert the sentinel exception text is absent."""
    _seed_ready_doc(db_session)

    sentinel = "SENSITIVE_INTERNAL_PATH_/srv/secret/keys.db"

    def boom(*a, **k):
        raise RuntimeError(sentinel)

    monkeypatch.setattr("services.retrieval_service.pgvector_store.query_chunks", boom)
    result = retrieval_service.retrieve(
        db_session, ctx, RetrieveChunksArgs(session_id=SESSION_ID, query="q", k=5)
    )
    assert result.error == "retrieval_failed"
    serialized = result.model_dump_json()
    assert sentinel not in serialized, "raw exception message leaked into ToolResult"


def test_session_id_mismatch_returns_failed(session, ctx, mock_embed, db_session):
    result = retrieval_service.retrieve(
        db_session, ctx, RetrieveChunksArgs(session_id="other_session", query="q", k=5)
    )
    assert result.ok is False
    assert result.status == "failed"
    assert "mismatch" in (result.error or "")
