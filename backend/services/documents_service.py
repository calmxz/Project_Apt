"""Session-wide document ingestion status (Spec: reference-files design 2026-06-14).

Replaces the per-call-site "latest document" lookups that previously decided
retrieval readiness and `ingestion_status`. Those keyed on the most-recent
document only, so a newer pending/failed upload masked an older ready one.
These helpers aggregate across all of a session's documents instead.
"""

from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import Document


def session_ingestion_status(
    db: Session, session_id: str
) -> Literal["pending", "ready", "failed"] | None:
    """Return aggregate ingestion status across all documents in the session.

    Priority: pending > ready > failed > None (no documents).
    """
    statuses = set(
        db.execute(
            select(Document.status).where(Document.session_id == session_id)
        ).scalars().all()
    )
    if not statuses:
        return None
    if "pending" in statuses:
        return "pending"
    if "ready" in statuses:
        return "ready"
    return "failed"


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
