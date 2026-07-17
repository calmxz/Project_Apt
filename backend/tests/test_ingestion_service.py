"""TDD: services.ingestion_service.run pipeline.

Pipeline: pypdf -> chunk -> embed -> pgvector_store.insert_chunks -> kw_index.
Tests mock the embed + storage layers so they run against in-memory SQLite.
"""

import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from contracts import TopicProfile
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
def insert_capture(monkeypatch):
    """Capture pgvector_store.insert_chunks calls instead of writing rows.

    SQLite has no `vector` type or cosine-distance operator, so the test
    DB can't accept ChunkEmbedding inserts. Capturing the call lets us
    assert the ingestion service hands the right payload to the storage
    layer; live row insertion is covered in test_pgvector_retrieval.py.
    """
    calls: list[dict] = []

    def fake(db, *, session_id, document_id, rows):
        calls.append(
            {
                "session_id": session_id,
                "document_id": document_id,
                "rows": list(rows),
            }
        )
        return len(rows)

    monkeypatch.setattr("services.ingestion_service.pgvector_store.insert_chunks", fake)
    return calls


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


def _write_blob_stub(monkeypatch, tmp_path, doc_id, filename, content=b"stub blob bytes"):
    """Point uploads_path at tmp_path and write a dummy blob under the store's
    doc-id-prefixed key. Extractors in these tests are separately mocked, so
    the content doesn't matter -- _load_blob just needs the key to exist."""
    monkeypatch.setattr("services.ingestion_service.settings.uploads_path", str(tmp_path))
    (tmp_path / f"{doc_id}_{filename}").write_bytes(content)


def test_embed_all_requests_configured_dimension(db_session, monkeypatch):
    """Embeddings must be requested at settings.embedding_dim so they match the
    chunk_embeddings.embedding column. Without an explicit dimensions argument
    the model emits its native size (e.g. gemini-embedding-2 -> 3072), which the
    768-dim pgvector column rejects, failing ingestion for every document."""
    from config import settings
    from services import ingestion_service

    captured = {}

    def fake_embedding(model, input, **kw):
        captured["dimensions"] = kw.get("dimensions")
        if isinstance(input, str):
            input = [input]
        return SimpleNamespace(
            data=[{"embedding": [0.1] * settings.embedding_dim} for _ in input]
        )

    monkeypatch.setattr(
        "services.ingestion_service.litellm.embedding", fake_embedding
    )
    ingestion_service._embed_all(
        db_session, ["hello world"], user_id=None, session_id="s_dim"
    )
    expected_dim = settings.embedding_dim  # local int: keep secrets out of failure repr
    assert captured["dimensions"] == expected_dim


def test_success_path(
    setup_doc, insert_capture, mock_pdf, mock_embed, db_session, monkeypatch, tmp_path
):
    _write_blob_stub(monkeypatch, tmp_path, setup_doc, "x.pdf")
    from services import ingestion_service

    ingestion_service.run(setup_doc)

    db_session.expire_all()
    doc = db_session.get(Document, setup_doc)
    assert doc.status == "ready"
    assert doc.error is None
    assert doc.page_count == 2

    assert len(insert_capture) == 1
    call = insert_capture[0]
    assert call["session_id"] == SESSION_ID
    assert call["document_id"] == setup_doc
    assert len(call["rows"]) >= 1
    chunk_idx, page, text, embedding = call["rows"][0]
    assert isinstance(chunk_idx, int)
    assert isinstance(text, str) and text
    assert isinstance(embedding, list) and len(embedding) == 8

    session = db_session.get(SessionModel, SESSION_ID)
    stems = set(json.loads(session.kw_index_json))
    assert len(stems) > 0


def test_pypdf_failure_marks_failed(
    setup_doc, insert_capture, mock_embed, db_session, monkeypatch, tmp_path
):
    _write_blob_stub(monkeypatch, tmp_path, setup_doc, "x.pdf")

    def boom(_path):
        raise RuntimeError("corrupt pdf")

    monkeypatch.setattr("services.ingestion_service.PdfReader", boom)
    from services import ingestion_service

    ingestion_service.run(setup_doc)
    db_session.expire_all()
    doc = db_session.get(Document, setup_doc)
    assert doc.status == "failed"
    assert "corrupt" in (doc.error or "")
    assert insert_capture == []


def test_embedding_failure_marks_failed(
    setup_doc, insert_capture, mock_pdf, db_session, monkeypatch, tmp_path
):
    _write_blob_stub(monkeypatch, tmp_path, setup_doc, "x.pdf")

    def boom(model, input, **_):
        raise RuntimeError("embedding api down")

    monkeypatch.setattr("services.ingestion_service.litellm.embedding", boom)
    from services import ingestion_service

    ingestion_service.run(setup_doc)
    db_session.expire_all()
    doc = db_session.get(Document, setup_doc)
    assert doc.status == "failed"
    assert "embedding" in (doc.error or "")
    assert insert_capture == []


def test_pgvector_insert_failure_marks_failed(
    setup_doc, mock_pdf, mock_embed, db_session, monkeypatch, tmp_path
):
    _write_blob_stub(monkeypatch, tmp_path, setup_doc, "x.pdf")

    def boom(*a, **k):
        raise RuntimeError("pgvector insert failed")

    monkeypatch.setattr("services.ingestion_service.pgvector_store.insert_chunks", boom)
    from services import ingestion_service

    ingestion_service.run(setup_doc)
    db_session.expire_all()
    doc = db_session.get(Document, setup_doc)
    assert doc.status == "failed"
    assert "pgvector" in (doc.error or "")


def test_merge_failure_leaves_no_chunks_and_marks_failed(db_session, monkeypatch, tmp_path):
    """F-27: insert_chunks and merge_into_session no longer commit -- the
    caller (ingestion_service.run) owns the transaction. A failure in the
    keyword-merge step (after chunks are inserted but before the single
    end-of-run commit) must roll back the whole unit of work, so no
    ChunkEmbedding rows are left committed for a document marked failed."""
    from sqlalchemy.orm import sessionmaker

    from config import settings
    from db.models import ChunkEmbedding
    from services import ingestion_service

    db_session.add(User(id="u_merge_boom"))
    db_session.flush()
    db_session.add(
        SessionModel(
            id="s_merge_boom",
            user_id="u_merge_boom",
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.flush()
    doc = Document(session_id="s_merge_boom", filename="ref.txt", status="pending")
    db_session.add(doc)
    db_session.commit()
    db_session.refresh(doc)

    monkeypatch.setattr("services.ingestion_service.settings.uploads_path", str(tmp_path))
    (tmp_path / f"{doc.id}_ref.txt").write_text(
        "Indexes accelerate database queries. " * 20, encoding="utf-8"
    )
    monkeypatch.setattr(
        "services.ingestion_service.SessionLocal",
        sessionmaker(autocommit=False, autoflush=False, bind=db_session.get_bind()),
    )

    def fake_embedding(model, input, **_):
        if isinstance(input, str):
            input = [input]
        return SimpleNamespace(
            data=[{"embedding": [0.1] * settings.embedding_dim} for _ in input]
        )

    monkeypatch.setattr("services.ingestion_service.litellm.embedding", fake_embedding)

    def boom(db, session_id, stems):
        raise RuntimeError("kw merge exploded")

    monkeypatch.setattr("services.ingestion_service.keyword_index.merge_into_session", boom)

    ingestion_service.run(doc.id)
    db_session.expire_all()
    doc = db_session.get(Document, doc.id)
    assert doc.status == "failed"
    assert "kw merge exploded" in doc.error
    assert db_session.query(ChunkEmbedding).filter_by(document_id=doc.id).count() == 0


def test_merge_failure_still_records_embedding_spend_after_rollback(
    db_session, monkeypatch, tmp_path
):
    """Final-review fix wave, Finding 1 (F-27 x F-19 interaction): F-27 made
    the pipeline atomic (one commit at the end), so db.rollback() in run()'s
    except block also discards the ledger increment meter_embedding_response
    flushed during _embed_all. But the embedding vendor was genuinely paid
    for those tokens before the later merge_into_session failure -- that
    real spend must still land on the daily cost ledger even though the doc
    ends up 'failed' with zero committed chunks."""
    from decimal import Decimal
    from sqlalchemy.orm import sessionmaker

    from config import settings
    from db.models import ChunkEmbedding
    from services import cost_meter, ingestion_service

    db_session.add(User(id="u_merge_boom2"))
    db_session.flush()
    db_session.add(
        SessionModel(
            id="s_merge_boom2",
            user_id="u_merge_boom2",
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.flush()
    doc = Document(session_id="s_merge_boom2", filename="ref.txt", status="pending")
    db_session.add(doc)
    db_session.commit()
    db_session.refresh(doc)

    monkeypatch.setattr("services.ingestion_service.settings.uploads_path", str(tmp_path))
    (tmp_path / f"{doc.id}_ref.txt").write_text(
        "Indexes accelerate database queries. " * 20, encoding="utf-8"
    )
    monkeypatch.setattr(
        "services.ingestion_service.SessionLocal",
        sessionmaker(autocommit=False, autoflush=False, bind=db_session.get_bind()),
    )

    def fake_embedding(model, input, **_):
        if isinstance(input, str):
            input = [input]
        return SimpleNamespace(
            data=[{"embedding": [0.1] * settings.embedding_dim} for _ in input]
        )

    monkeypatch.setattr("services.ingestion_service.litellm.embedding", fake_embedding)
    monkeypatch.setattr(
        "services.ingestion_service.cost_meter.litellm.completion_cost",
        lambda **kw: 0.004,
    )

    def boom(db, session_id, stems):
        raise RuntimeError("kw merge exploded")

    monkeypatch.setattr("services.ingestion_service.keyword_index.merge_into_session", boom)

    ingestion_service.run(doc.id)
    db_session.expire_all()
    refreshed = db_session.get(Document, doc.id)
    assert refreshed.status == "failed"
    assert db_session.query(ChunkEmbedding).filter_by(document_id=doc.id).count() == 0
    assert cost_meter.current_spend(db_session, "u_merge_boom2") == Decimal("0.0040")


def test_extract_plaintext_txt_and_md():
    from services import ingestion_service

    assert ingestion_service._extract(
        b"Plain text reference content.", "notes.txt"
    ) == [(None, "Plain text reference content.")]

    assert ingestion_service._extract(b"# Heading\n\nBody.", "notes.md") == [
        (None, "# Heading\n\nBody.")
    ]

    assert ingestion_service._extract(b"Long-form note.", "notes.markdown") == [
        (None, "Long-form note.")
    ]


def test_extract_unknown_extension_raises():
    from services import ingestion_service

    with pytest.raises(ValueError):
        ingestion_service._extract(b"\x00\x01", "data.bin")


def test_extract_slides_uses_python_pptx(monkeypatch):
    from services import ingestion_service

    class FakeTextFrame:
        def __init__(self, text):
            self.text = text

    class FakeShape:
        def __init__(self, text):
            self.has_text_frame = True
            self.has_table = False
            self.text_frame = FakeTextFrame(text)

    class FakeSlide:
        def __init__(self, texts):
            self.shapes = [FakeShape(t) for t in texts]

    class FakePresentation:
        def __init__(self, _path):
            self.slides = [
                FakeSlide(["Title one", "Bullet a"]),
                FakeSlide(["Title two"]),
            ]

    monkeypatch.setattr("services.ingestion_service.Presentation", FakePresentation)
    pages = ingestion_service._extract(b"stub pptx bytes", "x.pptx")
    assert pages[0][0] == 1 and "Title one" in pages[0][1] and "Bullet a" in pages[0][1]
    assert pages[1][0] == 2 and "Title two" in pages[1][1]


def test_extract_slides_includes_table_cell_text(monkeypatch):
    from services import ingestion_service

    class FakeCell:
        def __init__(self, text):
            self.text = text

    class FakeRow:
        def __init__(self, cells):
            self.cells = [FakeCell(c) for c in cells]

    class FakeTable:
        def __init__(self, rows):
            self.rows = [FakeRow(r) for r in rows]

    class FakeTableShape:
        def __init__(self, rows):
            self.has_text_frame = False
            self.has_table = True
            self.table = FakeTable(rows)

    class FakeSlide:
        def __init__(self, shapes):
            self.shapes = shapes

    class FakePresentation:
        def __init__(self, _path):
            self.slides = [
                FakeSlide([FakeTableShape([["r1c1", "r1c2"], ["r2c1", "r2c2"]])])
            ]

    monkeypatch.setattr("services.ingestion_service.Presentation", FakePresentation)
    pages = ingestion_service._extract(b"stub pptx bytes", "x.pptx")
    assert pages[0][0] == 1
    assert "r1c1 r1c2" in pages[0][1]
    assert "r2c1 r2c2" in pages[0][1]


def test_ingestion_meters_embedding_spend(
    db_session, insert_capture, mock_embed, monkeypatch, tmp_path
):
    """F-19: ingestion is the largest embedding spender; its litellm.embedding
    calls must land on the same daily_cost_ledger as chat/retrieval spend."""
    from decimal import Decimal

    from sqlalchemy import select
    from sqlalchemy.orm import sessionmaker

    from services import cost_meter, ingestion_service

    db_session.add(User(id="u_meter"))
    db_session.flush()
    db_session.add(
        SessionModel(
            id="s_meter",
            user_id="u_meter",
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.flush()
    doc = Document(session_id="s_meter", filename="ref.txt", status="pending")
    db_session.add(doc)
    db_session.commit()
    db_session.refresh(doc)

    monkeypatch.setattr("services.ingestion_service.settings.uploads_path", str(tmp_path))
    (tmp_path / f"{doc.id}_ref.txt").write_text(
        "Indexes accelerate database queries. " * 20, encoding="utf-8"
    )
    monkeypatch.setattr(
        "services.ingestion_service.SessionLocal",
        sessionmaker(autocommit=False, autoflush=False, bind=db_session.get_bind()),
    )
    monkeypatch.setattr(
        "services.ingestion_service.cost_meter.litellm.completion_cost",
        lambda **kw: 0.004,
    )

    ingestion_service.run(doc.id)

    user_id = db_session.execute(
        select(SessionModel.user_id).where(SessionModel.id == doc.session_id)
    ).scalar_one()
    assert cost_meter.current_spend(db_session, user_id) == Decimal("0.0040")


def test_missing_blob_marks_failed(setup_doc, db_session, monkeypatch, tmp_path):
    """F-15: if the blob isn't in the object store (and no legacy bare-filename
    fallback exists either), ingestion must fail the document, not crash."""
    monkeypatch.setattr("services.ingestion_service.settings.uploads_path", str(tmp_path))
    from services import ingestion_service

    ingestion_service.run(setup_doc)
    db_session.expire_all()
    doc = db_session.get(Document, setup_doc)
    assert doc.status == "failed"
    assert doc.error


def test_extract_plaintext_from_bytes():
    from services import ingestion_service

    assert ingestion_service._extract(b"hello world", "notes.txt") == [(None, "hello world")]


def test_legacy_bare_filename_fallback(db_session, insert_capture, mock_embed, monkeypatch, tmp_path):
    """Pre-F-15 files were stored under the bare filename (no doc-id prefix).
    _load_blob must fall back to that layout so old uploads keep ingesting."""
    from sqlalchemy.orm import sessionmaker

    from services import ingestion_service

    db_session.add(User(id="u_legacy"))
    db_session.flush()
    db_session.add(
        SessionModel(
            id="s_legacy",
            user_id="u_legacy",
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.flush()
    doc = Document(session_id="s_legacy", filename="ref.txt", status="pending")
    db_session.add(doc)
    db_session.commit()
    db_session.refresh(doc)

    monkeypatch.setattr("services.ingestion_service.settings.uploads_path", str(tmp_path))
    (tmp_path / doc.filename).write_bytes(b"legacy content")
    monkeypatch.setattr(
        "services.ingestion_service.SessionLocal",
        sessionmaker(autocommit=False, autoflush=False, bind=db_session.get_bind()),
    )

    ingestion_service.run(doc.id)
    db_session.expire_all()
    refreshed = db_session.get(Document, doc.id)
    assert refreshed.status == "ready"


def test_run_txt_success(db_session, insert_capture, mock_embed, monkeypatch, tmp_path):
    from contracts import TopicProfile
    from db.models import Document, Session as SessionModel, User
    from sqlalchemy.orm import sessionmaker
    from services import ingestion_service

    db_session.add(User(id="u_txt"))
    db_session.flush()
    db_session.add(
        SessionModel(
            id="s_txt",
            user_id="u_txt",
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.flush()
    doc = Document(session_id="s_txt", filename="ref.txt", status="pending")
    db_session.add(doc)
    db_session.commit()
    db_session.refresh(doc)

    monkeypatch.setattr("services.ingestion_service.settings.uploads_path", str(tmp_path))
    (tmp_path / f"{doc.id}_ref.txt").write_text(
        "Indexes accelerate database queries. " * 20, encoding="utf-8"
    )
    monkeypatch.setattr(
        "services.ingestion_service.SessionLocal",
        sessionmaker(autocommit=False, autoflush=False, bind=db_session.get_bind()),
    )

    ingestion_service.run(doc.id)
    db_session.expire_all()
    refreshed = db_session.get(Document, doc.id)
    assert refreshed.status == "ready"
    assert refreshed.page_count is None
    assert len(insert_capture) == 1
    assert len(insert_capture[0]["rows"]) >= 1


# --- F-26: startup reaper for stale pending documents ---------------------


@pytest.fixture
def seeded_session(db_session):
    """Seed a user + session for reaper tests, returning the Session row
    (so callers can use seeded_session.id)."""
    db_session.add(User(id="u_reap"))
    db_session.flush()
    session = SessionModel(
        id="s_reap",
        user_id="u_reap",
        topic="sql",
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    db_session.add(session)
    db_session.commit()
    db_session.refresh(session)
    return session


def _doc(db, session_id, status, age_minutes):
    doc = Document(
        session_id=session_id,
        filename="f.txt",
        status=status,
        created_at=datetime.now(timezone.utc) - timedelta(minutes=age_minutes),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def test_reaper_fails_stale_pending_only(db_session, seeded_session):
    from services import ingestion_service

    stale = _doc(db_session, seeded_session.id, "pending", age_minutes=60)
    fresh = _doc(db_session, seeded_session.id, "pending", age_minutes=1)
    ready = _doc(db_session, seeded_session.id, "ready", age_minutes=60)

    count = ingestion_service.reap_stale_pending(db_session)

    assert count == 1
    db_session.expire_all()
    assert db_session.get(Document, stale.id).status == "failed"
    assert "restart" in db_session.get(Document, stale.id).error
    assert db_session.get(Document, fresh.id).status == "pending"
    assert db_session.get(Document, ready.id).status == "ready"


def test_reaper_returns_zero_when_nothing_stale(db_session, seeded_session):
    from services import ingestion_service

    _doc(db_session, seeded_session.id, "pending", age_minutes=1)
    assert ingestion_service.reap_stale_pending(db_session) == 0
