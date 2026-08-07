"""pgvector-backed embedding store. Replaces ChromaDB (Phase 7 T4).

Thin wrapper around the `chunk_embeddings` table so tests can monkeypatch
`insert_chunks` / `query_chunks` without standing up a real Postgres.

Cosine-distance search uses pgvector's `<=>` operator via the ORM's
`embedding.cosine_distance(...)` builder. On non-pgvector dialects (e.g.
SQLite in unit tests) the query is never executed because tests patch this
module.
"""

from dataclasses import dataclass
from typing import Sequence
from uuid import uuid4

from sqlalchemy import delete as _delete, select
from sqlalchemy.orm import Session

from db.models import ChunkEmbedding, Document
from services.sql_dialect import dialect_insert


@dataclass(frozen=True)
class RetrievedChunk:
    doc_id: int
    chunk_text: str
    page: int | None
    score: float | None
    doc_name: str | None = None


def insert_chunks(
    db: Session,
    session_id: str,
    document_id: int,
    rows: Sequence[tuple[int, int | None, str, list[float]]],
) -> int:
    """Bulk insert chunk embeddings. `rows` is `(chunk_index, page, text, embedding)`.
    Returns the number of rows inserted. Does NOT commit — the caller owns the
    transaction (F-27: ingestion commits chunks, keyword index, and status
    together, atomically).

    Idempotent: `(document_id, chunk_index)` is unique (migration 0023), and
    conflicting rows are skipped via ON CONFLICT DO NOTHING rather than
    raising — a retried ingestion attempt (e.g. after a crash between the
    chunk insert and the status commit) must not fail on rows it already
    wrote."""
    if not rows:
        return 0
    values = [
        {
            "id": str(uuid4()),
            "session_id": session_id,
            "document_id": document_id,
            "chunk_index": chunk_index,
            "page": page,
            "chunk_text": text,
            "embedding": embedding,
        }
        for (chunk_index, page, text, embedding) in rows
    ]
    ins = dialect_insert(db)(ChunkEmbedding).values(values)
    stmt = ins.on_conflict_do_nothing(
        index_elements=["document_id", "chunk_index"]
    ).returning(ChunkEmbedding.id)
    result = db.execute(stmt)
    inserted = len(result.fetchall())
    db.flush()
    return inserted


def delete_document_chunks(db: Session, document_id: int) -> int:
    """Delete all chunk embeddings for a document. Returns rows deleted.
    Does NOT commit — the caller owns the transaction (F-28: chunk delete and
    document-row delete must land atomically). The FK also carries
    ON DELETE CASCADE (migration 0018) as a schema-level backstop."""
    result = db.execute(
        _delete(ChunkEmbedding).where(ChunkEmbedding.document_id == document_id)
    )
    return result.rowcount or 0


def query_chunks(
    db: Session,
    session_id: str,
    query_embedding: list[float],
    k: int,
) -> list[RetrievedChunk]:
    """Return top-k chunks for the session, ordered by cosine distance asc."""
    distance = ChunkEmbedding.embedding.cosine_distance(query_embedding)
    stmt = (
        select(ChunkEmbedding, distance.label("score"), Document.filename)
        .join(Document, ChunkEmbedding.document_id == Document.id)
        .where(
            ChunkEmbedding.session_id == session_id,
            # F-27: never serve chunks from a doc that is not fully ingested.
            # A failed merge can leave committed chunks on a "failed" doc
            # (pre-F-27 data), and a mid-ingestion doc must not leak partials.
            Document.status == "ready",
        )
        .order_by(distance)
        .limit(k)
    )
    rows = db.execute(stmt).all()
    return [
        RetrievedChunk(
            doc_id=row[0].document_id,
            chunk_text=row[0].chunk_text,
            page=row[0].page,
            score=float(row[1]) if row[1] is not None else None,
            doc_name=row[2],
        )
        for row in rows
    ]
