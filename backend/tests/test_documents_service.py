"""TDD: services.documents_service aggregate status + ready gate."""

import pytest

from contracts import TopicProfile
from db.models import Document, Session as SessionModel, User
from services import documents_service


SID = "sess_docs"
UID = "u_docs"


def _seed_session(db):
    db.add(User(id=UID))
    db.flush()
    db.add(
        SessionModel(
            id=SID,
            user_id=UID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db.commit()


def _add_doc(db, status):
    doc = Document(session_id=SID, filename=f"{status}.pdf", status=status)
    db.add(doc)
    db.commit()


def test_status_none_when_no_documents(db_session):
    _seed_session(db_session)
    assert documents_service.session_ingestion_status(db_session, SID) is None
    assert documents_service.has_ready_document(db_session, SID) is False


def test_status_pending_when_any_pending(db_session):
    _seed_session(db_session)
    _add_doc(db_session, "ready")
    _add_doc(db_session, "pending")
    assert documents_service.session_ingestion_status(db_session, SID) == "pending"


def test_status_ready_when_any_ready_and_none_pending(db_session):
    _seed_session(db_session)
    _add_doc(db_session, "ready")
    _add_doc(db_session, "failed")
    assert documents_service.session_ingestion_status(db_session, SID) == "ready"
    assert documents_service.has_ready_document(db_session, SID) is True


def test_status_failed_when_all_failed(db_session):
    _seed_session(db_session)
    _add_doc(db_session, "failed")
    _add_doc(db_session, "failed")
    assert documents_service.session_ingestion_status(db_session, SID) == "failed"
    assert documents_service.has_ready_document(db_session, SID) is False


def test_list_document_statuses_orders_oldest_first(db_session):
    _seed_session(db_session)
    _add_doc(db_session, "ready")
    _add_doc(db_session, "pending")
    docs = documents_service.list_document_statuses(db_session, SID)
    assert [d.status for d in docs] == ["ready", "pending"]


def test_retrieval_gate_uses_any_ready_not_latest(db_session, monkeypatch):
    """Regression: a newer pending doc must NOT mask an older ready doc."""
    from agent.types import ToolContext
    from contracts import RetrieveChunksArgs
    from services import retrieval_service

    _seed_session(db_session)
    _add_doc(db_session, "ready")    # older
    _add_doc(db_session, "pending")  # newer - previously masked the ready one

    captured = {}

    def fake_embedding(model, input, **_):
        from types import SimpleNamespace
        data_item = {"embedding": [0.1] * 8}
        return SimpleNamespace(data=[data_item])

    def fake_query_chunks(db, *, session_id, query_embedding, k):
        captured["called"] = True
        return []

    monkeypatch.setattr("services.retrieval_service.litellm.embedding", fake_embedding)
    monkeypatch.setattr(
        "services.retrieval_service.pgvector_store.query_chunks", fake_query_chunks
    )

    ctx = ToolContext(
        db=db_session,
        session_id=SID,
        user_id=UID,
        turn_started_at=None,
    )
    result = retrieval_service.retrieve(
        db_session, ctx, RetrieveChunksArgs(session_id=SID, query="indexes", k=5)
    )
    assert captured.get("called") is True, "gate should pass when an older doc is ready"
    # The fake query_chunks returns [] so status is "no_results", but the gate
    # passed: ok is True with no ingestion error. Under the old latest-doc logic
    # the newer pending doc masked the ready one -> error="ingestion_status=pending".
    assert result.ok is True
    assert result.error is None


def _seed_doc(db, *, user_id="u1", session_id="s1", filename="notes.pdf"):
    db.add(User(id=user_id))
    db.flush()
    db.add(SessionModel(id=session_id, user_id=user_id, topic="t", topic_profile_json="{}"))
    db.flush()
    doc = Document(session_id=session_id, filename=filename, status="ready")
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def test_delete_document_removes_row_chunks_and_file(db_session, monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(
        "services.documents_service.pgvector_store.delete_document_chunks",
        lambda db, document_id: calls.append(document_id) or 3,
    )
    monkeypatch.setattr("services.documents_service.settings.uploads_path", str(tmp_path))

    doc = _seed_doc(db_session)
    disk = tmp_path / f"{doc.id}_{doc.filename}"
    disk.write_bytes(b"%PDF-fake")

    documents_service.delete_document(db_session, document_id=doc.id, user_id="u1")

    assert calls == [doc.id]
    assert db_session.get(Document, doc.id) is None
    assert not disk.exists()


def test_delete_document_missing_raises_not_found(db_session, monkeypatch, tmp_path):
    monkeypatch.setattr(
        "services.documents_service.pgvector_store.delete_document_chunks",
        lambda db, document_id: 0,
    )
    monkeypatch.setattr("services.documents_service.settings.uploads_path", str(tmp_path))
    with pytest.raises(documents_service.DocumentNotFound):
        documents_service.delete_document(db_session, document_id=999, user_id="u1")


def test_delete_document_other_user_raises_not_found(db_session, monkeypatch, tmp_path):
    monkeypatch.setattr(
        "services.documents_service.pgvector_store.delete_document_chunks",
        lambda db, document_id: 0,
    )
    monkeypatch.setattr("services.documents_service.settings.uploads_path", str(tmp_path))
    doc = _seed_doc(db_session, user_id="owner", session_id="s_owner")
    with pytest.raises(documents_service.DocumentNotFound):
        documents_service.delete_document(db_session, document_id=doc.id, user_id="intruder")
    # Row must remain intact.
    assert db_session.get(Document, doc.id) is not None


def test_delete_document_tolerates_missing_file(db_session, monkeypatch, tmp_path):
    monkeypatch.setattr(
        "services.documents_service.pgvector_store.delete_document_chunks",
        lambda db, document_id: 0,
    )
    monkeypatch.setattr("services.documents_service.settings.uploads_path", str(tmp_path))
    doc = _seed_doc(db_session)
    # No file on disk.
    documents_service.delete_document(db_session, document_id=doc.id, user_id="u1")
    assert db_session.get(Document, doc.id) is None
