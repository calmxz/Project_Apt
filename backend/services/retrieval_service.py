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
from services import cost_meter, documents_service, pgvector_store


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
            timeout=settings.embedding_timeout_s,
        )
        query_vec = (
            resp.data[0]["embedding"]
            if isinstance(resp.data[0], dict)
            else resp.data[0].embedding
        )
        cost_meter.meter_embedding_response(
            db, resp, user_id=ctx.user_id, session_id=ctx.session_id,
            texts=[args.query],
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


async def prefetch_for_prompt(
    db: Session, session_id: str, user_id: str, query: str, k: int = 5,
    cost_holder: list | None = None,
) -> list[dict] | None:
    """F-56: server-side retrieval for REQUIRED turns. The REQUIRED flag was
    advisory -- the model could answer ungrounded without calling
    retrieve_chunks. Fetch the chunks ourselves and inject them into the
    prompt instead. Returns chunk dicts (same shape retrieve() produces) or
    None on any failure/no-results -- the caller then falls back to the
    advisory flag. Embedding spend is metered like every other call (F-19).

    B-08: cost_holder, if given, collects the metered Decimal cost so a
    caller whose own transaction later rolls back (_prepare_turn) can
    re-record the real vendor spend on a fresh transaction.
    """
    try:
        if not documents_service.has_ready_document(db, session_id):
            return None
        resp = await litellm.aembedding(
            model=settings.embedding_model,
            input=[query],
            dimensions=settings.embedding_dim,
            timeout=settings.embedding_timeout_s,
        )
        query_vec = (
            resp.data[0]["embedding"]
            if isinstance(resp.data[0], dict)
            else resp.data[0].embedding
        )
        cost = cost_meter.meter_embedding_response(
            db, resp, user_id=user_id, session_id=session_id, texts=[query],
        )
        if cost_holder is not None:
            cost_holder.append(cost)
        hits = pgvector_store.query_chunks(
            db, session_id=session_id, query_embedding=query_vec, k=k
        )
    except Exception as e:
        log.warning("prefetch_for_prompt failed; falling back to advisory flag: %s", e)
        return None
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
    return chunks or None


async def semantic_fallback_required(
    db: Session, session_id: str, query: str, *, user_id: str | None = None,
    cost_holder: list | None = None,
) -> bool:
    """D2.2: escalate the OPTIONAL lexical gate when the query is semantically
    close to the session's uploaded material (paraphrase/acronym misses that
    the stem overlap cannot catch). Best-effort by design: any failure keeps
    the gate OPTIONAL, mirroring gap_accuracy in routes/chat.py.

    F-19: when `user_id` is supplied, the embedding call's spend is metered
    onto the cost ledger. Callers that cannot attribute the call to a user
    (or don't have one handy) may omit it and simply skip metering.

    B-08: cost_holder, if given, collects the metered Decimal cost (only
    when user_id is also given, since that's when metering runs) so a
    caller whose own transaction later rolls back (_prepare_turn) can
    re-record the real vendor spend on a fresh transaction.

    F-18: async embedding; this runs directly on the event loop in _prepare_turn.
    """
    if settings.llm_stub_enabled:
        return False
    try:
        if not documents_service.has_ready_document(db, session_id):
            return False
        centroid = _session_centroid(db, session_id)
        if centroid is None:
            return False
        resp = await litellm.aembedding(
            model=settings.embedding_model,
            input=[query],
            dimensions=settings.embedding_dim,
            timeout=settings.embedding_timeout_s,
        )
        query_vec = (
            resp.data[0]["embedding"]
            if isinstance(resp.data[0], dict)
            else resp.data[0].embedding
        )
        if user_id is not None:
            cost = cost_meter.meter_embedding_response(
                db, resp, user_id=user_id, session_id=session_id, texts=[query],
            )
            if cost_holder is not None:
                cost_holder.append(cost)
        sim = _cosine_similarity(list(query_vec), centroid)
        return sim >= settings.retrieval_fallback_threshold
    except Exception as e:
        log.warning("semantic fallback check failed; keeping OPTIONAL: %s", e)
        return False
