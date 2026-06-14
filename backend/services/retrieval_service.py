"""Vector retrieval via pgvector (Spec §3.3, §4.2; Phase 7 T4).

retrieve() checks whether any document for the session is ready. If none is
ready, returns status="no_results". Otherwise embeds the query and runs a
cosine-distance search over `chunk_embeddings` scoped to the session.
"""

import logging

import litellm
from sqlalchemy.orm import Session

from agent.types import ToolContext
from config import settings
from contracts import RetrieveChunksArgs, ToolResult
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
        resp = litellm.embedding(model=settings.embedding_model, input=[args.query])
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
