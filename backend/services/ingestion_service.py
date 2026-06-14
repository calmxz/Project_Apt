"""File ingestion background pipeline (Spec §4.2, §3.1).

run(document_id) is invoked via FastAPI BackgroundTasks. Opens its own
SessionLocal because the request-scoped DB session is gone by the time the
background task fires.

Pipeline:
  1. Load Document; resolve file path from settings.uploads_path.
  2. _extract(path, filename) -> [(page_num | None, text), ...] by extension.
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

import logging
import os

import litellm
from pptx import Presentation
from pypdf import PdfReader

from config import settings
from db.database import SessionLocal
from db.models import Document
from lib import chunking, keyword_index
from services import pgvector_store


log = logging.getLogger(__name__)

EMBED_BATCH = 100


def _resolve_path(doc: Document) -> str:
    candidate = os.path.join(settings.uploads_path, f"{doc.id}_{doc.filename}")
    if os.path.exists(candidate):
        return candidate
    fallback = doc.filename
    if "/" in fallback or "\\" in fallback or ".." in fallback:
        raise ValueError(f"refusing unsafe filename in fallback: {fallback!r}")
    return os.path.join(settings.uploads_path, fallback)


def _extract_pages(path: str) -> list[tuple[int, str]]:
    reader = PdfReader(path)
    return [(i + 1, (page.extract_text() or "")) for i, page in enumerate(reader.pages)]


def _extract_slides(path: str) -> list[tuple[int, str]]:
    prs = Presentation(path)
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


def _extract_plaintext(path: str) -> list[tuple[None, str]]:
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return [(None, fh.read())]


def _extract(path: str, filename: str) -> list[tuple[int | None, str]]:
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".pdf":
        return _extract_pages(path)
    if ext == ".pptx":
        return _extract_slides(path)
    if ext in (".txt", ".md", ".markdown"):
        return _extract_plaintext(path)
    raise ValueError(f"unsupported file type: {ext!r}")


def _embed_all(texts: list[str]) -> list[list[float]]:
    out: list[list[float]] = []
    for i in range(0, len(texts), EMBED_BATCH):
        batch = texts[i : i + EMBED_BATCH]
        try:
            resp = litellm.embedding(
                model=settings.embedding_model,
                input=batch,
                dimensions=settings.embedding_dim,
            )
        except Exception as e:
            raise RuntimeError(f"embedding api failed: {e}") from e
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
            path = _resolve_path(doc)
            pages = _extract(path, doc.filename)
            # Count only pages/slides that carry a page number; plaintext yields
            # (None, text) so its sum is 0, which we collapse to None (no page
            # concept). Degenerate inputs (0-slide pptx) likewise store None.
            doc.page_count = sum(1 for p, _ in pages if p is not None) or None

            chunks = chunking.chunk_text(pages)
            if not chunks:
                doc.status = "ready"
                db.commit()
                return

            embeddings = _embed_all([c.text for c in chunks])

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
