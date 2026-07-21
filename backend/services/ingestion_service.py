"""File ingestion background pipeline (Spec §4.2, §3.1).

run(document_id) is invoked via FastAPI BackgroundTasks. Opens its own
SessionLocal because the request-scoped DB session is gone by the time the
background task fires.

Pipeline:
  1. Load Document; load the blob via services.object_store (R2 in prod,
     local disk in dev), not settings.uploads_path directly.
  2. _extract(blob, filename) -> [(page_num | None, text), ...] by extension.
     - .pdf  : pypdf -> [(page_num, text), ...]
     - .pptx : python-pptx -> [(slide_num, text), ...]
     - .txt / .md / .markdown : [(None, full_text)]
  3. lib.chunking.chunk_text (500 / 50 overlap).
  4. litellm.embedding in batches of 100.
  5. pgvector_store.insert_chunks (Postgres `chunk_embeddings` table).
  6. lib.keyword_index.merge_into_session(stems).
  7. Document.status = ready, page_count populated (None for plaintext).

Steps 5-7 share one transaction: insert_chunks and merge_into_session only
flush, and the single db.commit() after step 7 covers all three atomically
(F-27). On exception at any step: db.rollback() first (discards any
unflushed/uncommitted work from this run), then status=failed,
error=str(exc)[:1000], committed alone.

Embedding spend survives that rollback (final-review fix wave, Finding 1):
_embed_all's cost_meter.meter_embedding_response calls (deferred until after
the network loop, B-01) only flush into this same transaction, so a failure
after embeddings were purchased (e.g. merge_into_session raising) would
otherwise roll back a real vendor charge, undercounting it against the daily
cap (F-19). run() tracks the computed cost per batch in a holder list and,
if the run fails, re-records the accumulated total on the fresh
post-rollback transaction so it commits alongside the failure-status update.
"""

import io
import logging
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import litellm
from pptx import Presentation
from pypdf import PdfReader
from sqlalchemy import select, update

from config import settings
from db.database import SessionLocal
from db.models import Document
from db.models import Session as SessionModel
from lib import chunking, keyword_index
from services import cost_meter, object_store, pgvector_store


log = logging.getLogger(__name__)

EMBED_BATCH = 100

# F-26: ingestion is an in-process BackgroundTask; a restart kills it silently
# and the Document row stays "pending" forever (the session banner spins and
# aggregate status pins to pending). At startup, fail anything still pending
# from before the restart. The age guard avoids racing a live ingestion in an
# overlapping-deploy window; genuinely fresh uploads are left alone.
REAP_PENDING_AFTER_MINUTES = 10
REAP_ERROR = "ingestion interrupted by a server restart; please re-upload"


def reap_stale_pending(db, *, now: datetime | None = None) -> int:
    """Mark stale 'pending' documents as failed. Returns how many were reaped."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=REAP_PENDING_AFTER_MINUTES)
    result = db.execute(
        update(Document)
        .where(Document.status == "pending", Document.created_at < cutoff)
        .values(status="failed", error=REAP_ERROR)
    )
    db.commit()
    count = result.rowcount or 0
    if count:
        log.warning("reaped %d stale pending document(s) at startup", count)
    return count


def _load_blob(store: "object_store.ObjectStore", doc: Document) -> bytes:
    try:
        return store.get(object_store.key_for(doc.id, doc.filename))
    except object_store.ObjectNotFound:
        # Not under the canonical key - try the legacy layout below.
        log.debug("blob miss on canonical key for doc %s; trying legacy key", doc.id)
    # Legacy fallback: pre-F-15 uploads were stored under the bare filename.
    # LocalDiskStore path-containment rejects traversal in doc.filename.
    try:
        return store.get(doc.filename)
    except object_store.ObjectNotFound:
        raise RuntimeError(f"uploaded file not found in object store: {doc.filename}") from None


def _extract_pages(blob: bytes) -> list[tuple[int, str]]:
    reader = PdfReader(io.BytesIO(blob))
    return [(i + 1, (page.extract_text() or "")) for i, page in enumerate(reader.pages)]


def _extract_slides(blob: bytes) -> list[tuple[int, str]]:
    prs = Presentation(io.BytesIO(blob))
    out: list[tuple[int, str]] = []
    for i, slide in enumerate(prs.slides, start=1):
        parts: list[str] = []
        for shape in slide.shapes:
            if getattr(shape, "has_text_frame", False):
                parts.append(shape.text_frame.text)
            if getattr(shape, "has_table", False):
                for row in shape.table.rows:
                    parts.append(" ".join(cell.text for cell in row.cells))
        out.append((i, "\n".join(p for p in parts if p)))
    return out


def _extract_plaintext(blob: bytes) -> list[tuple[None, str]]:
    return [(None, blob.decode("utf-8", errors="replace"))]


def _extract(blob: bytes, filename: str) -> list[tuple[int | None, str]]:
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".pdf":
        return _extract_pages(blob)
    if ext == ".pptx":
        return _extract_slides(blob)
    if ext in (".txt", ".md", ".markdown"):
        return _extract_plaintext(blob)
    raise ValueError(f"unsupported file type: {ext!r}")


def _embed_all(
    db, texts: list[str], *, user_id: str | None, session_id: str,
    cost_holder: list[Decimal] | None = None,
) -> list[list[float]]:
    """cost_holder, if given, collects the metered cost of each successfully
    embedded batch (Decimal per batch). It is a mutable out-param rather than
    part of the return value so a caller can read what was actually spent
    even if a later batch in this same call raises -- run() needs that to
    re-record spend after a rollback (see module docstring, Finding 1)."""
    out: list[list[float]] = []
    pending_meter: list[tuple[object, list[str]]] = []
    for i in range(0, len(texts), EMBED_BATCH):
        batch = texts[i : i + EMBED_BATCH]
        try:
            resp = litellm.embedding(
                model=settings.embedding_model,
                input=batch,
                dimensions=settings.embedding_dim,
                timeout=settings.embedding_timeout_s,
            )
        except Exception as e:
            raise RuntimeError(f"embedding api failed: {e}") from e
        if user_id is not None:
            # B-01: cost is computed eagerly (pure arithmetic) so cost_holder
            # stays accurate if a later batch raises, but the ledger/log
            # writes are deferred below the loop -- record_cost's upsert
            # takes a row lock on the user's daily ledger row, and doing it
            # here would hold that lock across every remaining embedding
            # HTTP call, blocking the same user's concurrent chat stream.
            if cost_holder is not None:
                try:
                    cost_holder.append(
                        cost_meter.embedding_cost(settings.embedding_model, resp, batch)
                    )
                except Exception as e:  # noqa: BLE001
                    log.warning("embedding cost estimate failed: %s", e)
            pending_meter.append((resp, batch))
        for item in resp.data:
            out.append(item["embedding"] if isinstance(item, dict) else item.embedding)
    for resp, batch in pending_meter:
        # F-19: ingestion is the largest embedding spender; meter it.
        # Metering only -- NO cap gate here. Ingestion is already
        # rate-limited at upload time, and failing a document mid-pipeline
        # for a cap breach would strand it (F-26 territory, Batch 5).
        cost_meter.meter_embedding_response(
            db, resp, user_id=user_id, session_id=session_id, texts=batch,
        )
    return out


def run(document_id: int) -> None:
    db = SessionLocal()
    try:
        doc = db.get(Document, document_id)
        if doc is None:
            log.warning("ingestion run: document %s not found", document_id)
            return

        owner_id: str | None = None
        embed_cost_holder: list[Decimal] = []
        try:
            blob = _load_blob(object_store.get_store(), doc)
            pages = _extract(blob, doc.filename)
            # Count only pages/slides that carry a page number; plaintext yields
            # (None, text) so its sum is 0, which we collapse to None (no page
            # concept). Degenerate inputs (0-slide pptx) likewise store None.
            doc.page_count = sum(1 for p, _ in pages if p is not None) or None

            chunks = chunking.chunk_text(pages)
            if not chunks:
                doc.status = "ready"
                db.commit()
                return

            owner_id = db.execute(
                select(SessionModel.user_id).where(SessionModel.id == doc.session_id)
            ).scalar_one_or_none()
            embeddings = _embed_all(
                db, [c.text for c in chunks], user_id=owner_id, session_id=doc.session_id,
                cost_holder=embed_cost_holder,
            )

            pgvector_store.insert_chunks(
                db,
                session_id=doc.session_id,
                document_id=doc.id,
                rows=[
                    (c.chunk_idx, c.page, c.text, embedding)
                    for c, embedding in zip(chunks, embeddings)
                ],
            )

            stems: set[str] = set()
            for c in chunks:
                stems |= keyword_index.build_from_text(c.text)
            if stems:
                keyword_index.merge_into_session(db, doc.session_id, stems)

            doc.status = "ready"
            doc.error = None
            db.commit()
        except Exception as e:
            db.rollback()
            log.error(
                "ingestion failed",
                extra={"err_type": type(e).__name__, "doc_id": document_id},
                exc_info=settings.env != "prod",
            )
            # Finding 1: db.rollback() above also discarded the ledger
            # increment(s) meter_embedding_response flushed inside
            # _embed_all -- F-27 gives this run a single end-of-pipeline
            # commit, so nothing embedding-related was durable yet. The
            # vendor was still paid for any batches that got that far, so
            # re-record that real spend on the fresh transaction and let it
            # ride along with the failure-status commit below.
            total_embed_cost = sum(embed_cost_holder, Decimal("0"))
            if total_embed_cost > Decimal("0") and owner_id is not None:
                try:
                    cost_meter.record_cost(db, owner_id, total_embed_cost)
                except Exception:
                    log.error(
                        "failed to re-record embedding spend after rollback",
                        extra={"doc_id": document_id},
                        exc_info=settings.env != "prod",
                    )
            doc = db.get(Document, document_id)
            if doc is not None:
                doc.status = "failed"
                doc.error = str(e)[:1000]
                db.commit()
    finally:
        db.close()
