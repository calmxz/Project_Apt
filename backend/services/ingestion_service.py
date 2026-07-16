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

On exception at any step: status=failed, error=str(exc)[:1000]. Always commit.
"""

import io
import logging
import os

import litellm
from pptx import Presentation
from pypdf import PdfReader
from sqlalchemy import select

from config import settings
from db.database import SessionLocal
from db.models import Document
from db.models import Session as SessionModel
from lib import chunking, keyword_index
from services import cost_meter, object_store, pgvector_store


log = logging.getLogger(__name__)

EMBED_BATCH = 100


def _load_blob(store: "object_store.ObjectStore", doc: Document) -> bytes:
    try:
        return store.get(object_store.key_for(doc.id, doc.filename))
    except object_store.ObjectNotFound:
        pass
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
    db, texts: list[str], *, user_id: str | None, session_id: str
) -> list[list[float]]:
    out: list[list[float]] = []
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
            # F-19: ingestion is the largest embedding spender; meter it.
            # Metering only -- NO cap gate here. Ingestion is already
            # rate-limited at upload time, and failing a document mid-pipeline
            # for a cap breach would strand it (F-26 territory, Batch 5).
            cost_meter.meter_embedding_response(
                db, resp, user_id=user_id, session_id=session_id, texts=batch,
            )
        for item in resp.data:
            out.append(item["embedding"] if isinstance(item, dict) else item.embedding)
    return out


def run(document_id: int) -> None:
    db = SessionLocal()
    try:
        doc = db.get(Document, document_id)
        if doc is None:
            log.warning("ingestion run: document %s not found", document_id)
            return

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
                db, [c.text for c in chunks], user_id=owner_id, session_id=doc.session_id
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
            log.error(
                "ingestion failed",
                extra={"err_type": type(e).__name__, "doc_id": document_id},
                exc_info=settings.env != "prod",
            )
            doc.status = "failed"
            doc.error = str(e)[:1000]
            db.commit()
    finally:
        db.close()
