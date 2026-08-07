"""Unit tests for pgvector_store module (SQLite + spy pattern, no real pgvector).

Tests the SQL generation of pgvector_store functions using a spy pattern that
captures the SQLAlchemy statement and compiles it for PostgreSQL, verifying the
query structure without needing a live Postgres + pgvector extension.
"""

from sqlalchemy.dialects import postgresql

from config import settings
from services import pgvector_store


def test_insert_chunks_is_idempotent(db_session):
    """ON CONFLICT DO NOTHING: a re-insert of the same (document_id,
    chunk_index) pairs (e.g. a retried ingestion) must not raise and must
    report 0 newly inserted rows the second time."""
    dim = settings.embedding_dim
    rows = [
        (0, 1, "alpha", [0.1] * dim),
        (1, 1, "beta", [0.2] * dim),
    ]
    n1 = pgvector_store.insert_chunks(
        db_session, session_id="s1", document_id=1, rows=rows
    )
    n2 = pgvector_store.insert_chunks(
        db_session, session_id="s1", document_id=1, rows=rows
    )
    assert n1 == 2
    assert n2 == 0


def test_insert_chunks_partial_conflict_counts_only_new_rows(db_session):
    """Partial overlap: re-inserting existing indexes alongside a new one must
    report only the newly inserted count. Task 20's per-batch resume logic
    reads this return value to decide how much of a batch actually landed."""
    dim = settings.embedding_dim
    pgvector_store.insert_chunks(
        db_session,
        session_id="s1",
        document_id=1,
        rows=[
            (0, 1, "alpha", [0.1] * dim),
            (1, 1, "beta", [0.2] * dim),
        ],
    )
    n2 = pgvector_store.insert_chunks(
        db_session,
        session_id="s1",
        document_id=1,
        rows=[
            (0, 1, "alpha", [0.1] * dim),
            (1, 1, "beta", [0.2] * dim),
            (2, 1, "gamma", [0.3] * dim),
        ],
    )
    assert n2 == 1
    from db.models import ChunkEmbedding

    total = db_session.query(ChunkEmbedding).filter_by(document_id=1).count()
    assert total == 3


def test_query_chunks_filters_to_ready_documents(db_session, monkeypatch):
    """query_chunks must filter to only ready documents — never serve chunks
    from a doc that is failed or mid-ingestion (F-27)."""
    captured = {}

    class EmptyResult:
        def all(self):
            return []

    def spy(stmt, *args, **kwargs):
        captured["stmt"] = stmt
        return EmptyResult()

    monkeypatch.setattr(db_session, "execute", spy)
    pgvector_store.query_chunks(db_session, "s1", [0.0] * 3, k=5)
    sql = str(captured["stmt"].compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": False}))
    assert "documents.status" in sql
