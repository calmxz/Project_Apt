"""Session-wide document ingestion status (Spec: reference-files design 2026-06-14).

Replaces the per-call-site "latest document" lookups that previously decided
retrieval readiness and `ingestion_status`. Those keyed on the most-recent
document only, so a newer pending/failed upload masked an older ready one.
These helpers aggregate across all of a session's documents instead.
"""

import logging
from collections.abc import Iterable
from pathlib import Path
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from config import settings
from db.models import Document, Session as SessionModel
from services import pgvector_store

logger = logging.getLogger(__name__)

IngestionStatus = Literal["pending", "ready", "failed"]


def aggregate_status(statuses: Iterable[str]) -> IngestionStatus | None:
    """Aggregate a collection of document statuses into one session-wide status.

    Priority: pending > ready > failed > None (no documents). Pure helper so the
    route can derive the aggregate from documents it has already fetched, without
    a second query and without duplicating the priority logic.
    """
    seen = set(statuses)
    if not seen:
        return None
    if "pending" in seen:
        return "pending"
    if "ready" in seen:
        return "ready"
    return "failed"


def status_from_counts(total: int, pending: int, ready: int) -> IngestionStatus | None:
    """Counts-based twin of aggregate_status (pending > ready > failed > None).
    Used by the consolidated prepare-path session SELECT."""
    if total == 0:
        return None
    if pending > 0:
        return "pending"
    if ready > 0:
        return "ready"
    return "failed"


def session_ingestion_status(db: Session, session_id: str) -> IngestionStatus | None:
    """Return aggregate ingestion status across all documents in the session."""
    return aggregate_status(
        db.execute(
            select(Document.status).where(Document.session_id == session_id)
        ).scalars().all()
    )


def has_ready_document(db: Session, session_id: str) -> bool:
    """Return True if at least one document for the session has status 'ready'."""
    return (
        db.execute(
            select(Document.id)
            .where(Document.session_id == session_id, Document.status == "ready")
            .limit(1)
        ).first()
        is not None
    )


def list_document_statuses(db: Session, session_id: str) -> list[Document]:
    """Return all documents for the session ordered by creation time ascending."""
    return db.execute(
        select(Document)
        .where(Document.session_id == session_id)
        .order_by(Document.created_at.asc(), Document.id.asc())
    ).scalars().all()


class DocumentNotFound(Exception):
    """Raised when a document does not exist or is not owned by the caller."""


def delete_document(db: Session, document_id: int, user_id: str) -> None:
    """Delete a document: its chunk embeddings, on-disk file, and DB row.

    Raises DocumentNotFound if the document does not exist or its session is not
    owned by user_id (callers map this to HTTP 404 so existence is not leaked).
    """
    row = db.execute(
        select(Document, SessionModel.user_id)
        .join(SessionModel, Document.session_id == SessionModel.id)
        .where(Document.id == document_id)
    ).first()
    if row is None:
        raise DocumentNotFound(str(document_id))
    doc, owner_id = row
    if owner_id != user_id:
        raise DocumentNotFound(str(document_id))

    pgvector_store.delete_document_chunks(db, document_id)

    # Capture identity before the row is expired by commit.
    doc_id = doc.id
    filename = doc.filename

    db.delete(doc)
    db.commit()

    # Best-effort on-disk cleanup AFTER the DB + vector rows are committed, so a
    # locked/undeletable file (e.g. Windows WinError 32 while ingestion still
    # holds the PDF) cannot leave the request 500ing with chunks already gone.
    # Strip directory components and verify containment first (path traversal).
    uploads_root = Path(settings.uploads_path).resolve()
    candidate = (uploads_root / f"{doc_id}_{Path(filename).name}").resolve()
    if candidate.parent == uploads_root:
        try:
            candidate.unlink(missing_ok=True)
        except OSError:
            logger.warning("could not unlink file for document %s", doc_id)
