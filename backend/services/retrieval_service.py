"""Vector retrieval via pgvector (Spec §3.3, §4.2; Phase 7 T4).

retrieve() checks whether any document for the session is ready. If none is
ready, returns status="no_results". Otherwise embeds the query and runs a
cosine-distance search over `chunk_embeddings` scoped to the session.
"""

import logging
import math

import litellm
from pgvector.sqlalchemy import Vector
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from agent.types import ToolContext
from config import settings
from contracts import RetrieveChunksArgs, ToolResult
from db.models import ChunkEmbedding
from services import documents_service, pgvector_store


log = logging.getLogger(__name__)


def retrieve(db: Session, ctx: ToolContext, args: RetrieveChunksArgs) -> ToolResult:
    if args.session_id != ctx.session_id:
        return ToolResult(
            ok=False,
            status="failed",
            error=f"session_id mismatch: args={args.session_id} ctx={ctx.session_id}",
        )

    if not documents_service.has_ready_document(db, ctx.session_id):
        agg = documents_service.session_ingestion_status(db, ctx.session_id)
        return ToolResult(
            ok=True,
            status="no_results",
            error="ingestion_not_ready" if agg is None else f"ingestion_status={agg}",
            data={"chunks": []},
        )

    try:
        resp = litellm.embedding(
            model=settings.embedding_model,
            input=[args.query],
            dimensions=settings.embedding_dim,
        )
        query_vec = (
            resp.data[0]["embedding"]
            if isinstance(resp.data[0], dict)
            else resp.data[0].embedding
        )
        hits = pgvector_store.query_chunks(
            db, session_id=ctx.session_id, query_embedding=query_vec, k=args.k or 5
        )
    except Exception as e:
        log.error(
            "retrieval failed",
            extra={"err_type": type(e).__name__, "session_id": ctx.session_id},
            exc_info=settings.env != "prod",
        )
        return ToolResult(ok=False, status="failed", error="retrieval_failed")

    chunks = [
        {
            "doc_id": str(h.doc_id),
            "text": h.chunk_text,
            "page": h.page,
            "score": h.score,
            "doc_name": h.doc_name,
        }
        for h in hits
    ]

    if not chunks:
        return ToolResult(
            ok=True, status="no_results", error=None, data={"chunks": []}
        )
    return ToolResult(ok=True, status="ok", data={"chunks": chunks})


def _session_centroid(db: Session, session_id: str) -> list[float] | None:
    """Mean embedding over the session's chunks; None off-Postgres or empty."""
    if db.get_bind().dialect.name != "postgresql":
        return None
    centroid = db.execute(
        select(
            func.avg(ChunkEmbedding.embedding, type_=Vector(settings.embedding_dim))
        ).where(ChunkEmbedding.session_id == session_id)
    ).scalar()
    if centroid is None:
        return None
    return list(centroid)


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def semantic_fallback_required(db: Session, session_id: str, query: str) -> bool:
    """D2.2: escalate the OPTIONAL lexical gate when the query is semantically
    close to the session's uploaded material (paraphrase/acronym misses that
    the stem overlap cannot catch). Best-effort by design: any failure keeps
    the gate OPTIONAL, mirroring gap_accuracy in routes/chat.py.
    """
    if settings.llm_stub_enabled:
        return False
    try:
        if not documents_service.has_ready_document(db, session_id):
            return False
        centroid = _session_centroid(db, session_id)
        if centroid is None:
            return False
        resp = litellm.embedding(
            model=settings.embedding_model,
            input=[query],
            dimensions=settings.embedding_dim,
        )
        query_vec = (
            resp.data[0]["embedding"]
            if isinstance(resp.data[0], dict)
            else resp.data[0].embedding
        )
        sim = _cosine_similarity(list(query_vec), centroid)
        return sim >= settings.retrieval_fallback_threshold
    except Exception as e:
        log.warning("semantic fallback check failed; keeping OPTIONAL: %s", e)
        return False
