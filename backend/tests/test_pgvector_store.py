"""Unit tests for pgvector_store module (SQLite + spy pattern, no real pgvector).

Tests the SQL generation of pgvector_store functions using a spy pattern that
captures the SQLAlchemy statement and compiles it for PostgreSQL, verifying the
query structure without needing a live Postgres + pgvector extension.
"""

from sqlalchemy.dialects import postgresql

from services import pgvector_store


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
