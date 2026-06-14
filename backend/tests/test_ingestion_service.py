"""TDD: services.ingestion_service.run pipeline.

Pipeline: pypdf -> chunk -> embed -> pgvector_store.insert_chunks -> kw_index.
Tests mock the embed + storage layers so they run against in-memory SQLite.
"""

import json
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


def _path_exists_stub(monkeypatch):
    monkeypatch.setattr("services.ingestion_service.os.path.exists", lambda p: True)


def test_success_path(setup_doc, insert_capture, mock_pdf, mock_embed, db_session, monkeypatch):
    _path_exists_stub(monkeypatch)
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


def test_pypdf_failure_marks_failed(setup_doc, insert_capture, mock_embed, db_session, monkeypatch):
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
    assert insert_capture == []


def test_embedding_failure_marks_failed(
    setup_doc, insert_capture, mock_pdf, db_session, monkeypatch
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
    assert insert_capture == []


def test_pgvector_insert_failure_marks_failed(
    setup_doc, mock_pdf, mock_embed, db_session, monkeypatch
):
    _path_exists_stub(monkeypatch)

    def boom(*a, **k):
        raise RuntimeError("pgvector insert failed")

    monkeypatch.setattr("services.ingestion_service.pgvector_store.insert_chunks", boom)
    from services import ingestion_service

    ingestion_service.run(setup_doc)
    db_session.expire_all()
    doc = db_session.get(Document, setup_doc)
    assert doc.status == "failed"
    assert "pgvector" in (doc.error or "")


def test_extract_plaintext_txt_and_md(tmp_path):
    from services import ingestion_service

    txt = tmp_path / "notes.txt"
    txt.write_text("Plain text reference content.", encoding="utf-8")
    assert ingestion_service._extract(str(txt), "notes.txt") == [
        (None, "Plain text reference content.")
    ]

    md = tmp_path / "notes.md"
    md.write_text("# Heading\n\nBody.", encoding="utf-8")
    assert ingestion_service._extract(str(md), "notes.md") == [
        (None, "# Heading\n\nBody.")
    ]

    markdown = tmp_path / "notes.markdown"
    markdown.write_text("Long-form note.", encoding="utf-8")
    assert ingestion_service._extract(str(markdown), "notes.markdown") == [
        (None, "Long-form note.")
    ]


def test_extract_unknown_extension_raises(tmp_path):
    from services import ingestion_service

    f = tmp_path / "data.bin"
    f.write_bytes(b"\x00\x01")
    with pytest.raises(ValueError):
        ingestion_service._extract(str(f), "data.bin")


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
    pages = ingestion_service._extract("x.pptx", "x.pptx")
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
    pages = ingestion_service._extract("x.pptx", "x.pptx")
    assert pages[0][0] == 1
    assert "r1c1 r1c2" in pages[0][1]
    assert "r2c1 r2c2" in pages[0][1]


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
