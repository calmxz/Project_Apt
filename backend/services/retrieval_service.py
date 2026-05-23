"""Vector retrieval over a session's ChromaDB collection (Spec §3.3, §4.2).

retrieve() looks up the most-recent Document for the session. If ingestion is
not ready, returns status="no_results". Otherwise embeds the query and
queries Chroma collection session_{session_id}.
"""

import logging

import litellm
from sqlalchemy import select
from sqlalchemy.orm import Session

from agent.types import ToolContext
from config import settings
from contracts import RetrieveChunksArgs, ToolResult
from db.models import Document
from services import chroma_client


log = logging.getLogger(__name__)


def _latest_doc(db: Session, session_id: str) -> Document | None:
    return db.execute(
        select(Document)
        .where(Document.session_id == session_id)
        .order_by(Document.created_at.desc())
        .limit(1)
    ).scalars().first()


def retrieve(db: Session, ctx: ToolContext, args: RetrieveChunksArgs) -> ToolResult:
    if args.session_id != ctx.session_id:
        return ToolResult(
            ok=False,
            status="failed",
            error=f"session_id mismatch: args={args.session_id} ctx={ctx.session_id}",
        )

    doc = _latest_doc(db, ctx.session_id)
    if doc is None or doc.status != "ready":
        return ToolResult(
            ok=True,
            status="no_results",
            error="ingestion_not_ready" if doc is None else f"ingestion_status={doc.status}",
            data={"chunks": []},
        )

    try:
        resp = litellm.embedding(model=settings.embedding_model, input=[args.query])
        query_vec = (
            resp.data[0]["embedding"]
            if isinstance(resp.data[0], dict)
            else resp.data[0].embedding
        )
        collection = chroma_client.get_chroma().get_or_create_collection(
            name=chroma_client.collection_name(ctx.session_id)
        )
        result = collection.query(query_embeddings=[query_vec], n_results=args.k or 5)
    except Exception as e:
        log.error(
            "retrieval failed",
            extra={"err_type": type(e).__name__, "session_id": ctx.session_id},
            exc_info=settings.env != "prod",
        )
        return ToolResult(ok=False, status="failed", error="retrieval_failed")

    docs = (result.get("documents") or [[]])[0]
    metas = (result.get("metadatas") or [[]])[0]
    distances = (result.get("distances") or [[None] * len(docs)])[0]

    chunks = []
    for text, meta, dist in zip(docs, metas, distances):
        chunks.append(
            {
                "doc_id": (meta or {}).get("doc_id", ""),
                "text": text,
                "page": (meta or {}).get("page"),
                "score": dist,
            }
        )

    if not chunks:
        return ToolResult(
            ok=True, status="no_results", error=None, data={"chunks": []}
        )
    return ToolResult(ok=True, status="ok", data={"chunks": chunks})
