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

from sqlalchemy import delete as _delete, select
from sqlalchemy.orm import Session

from db.models import ChunkEmbedding, Document


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
    Returns the number of rows inserted."""
    objs = [
        ChunkEmbedding(
            session_id=session_id,
            document_id=document_id,
            chunk_index=chunk_index,
            page=page,
            chunk_text=text,
            embedding=embedding,
        )
        for (chunk_index, page, text, embedding) in rows
    ]
    db.add_all(objs)
    db.commit()
    return len(objs)


def delete_document_chunks(db: Session, document_id: int) -> int:
    """Delete all chunk embeddings for a document. Returns rows deleted.

    chunk_embeddings.document_id has no ON DELETE CASCADE, so callers deleting a
    Document must call this first to avoid orphaned vectors.
    """
    result = db.execute(
        _delete(ChunkEmbedding).where(ChunkEmbedding.document_id == document_id)
    )
    db.commit()
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
        .where(ChunkEmbedding.session_id == session_id)
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
