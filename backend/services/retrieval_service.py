"""Vector retrieval over a session's ingested documents.

Phase 2: stub that always returns no_results. Phase 4 replaces with a real
ChromaDB query path.
"""

from sqlalchemy.orm import Session

from agent.types import ToolContext
from contracts import RetrieveChunksArgs, ToolResult


def retrieve(
    db: Session, ctx: ToolContext, args: RetrieveChunksArgs
) -> ToolResult:
    return ToolResult(
        ok=True,
        status="no_results",
        error="ingestion_not_ready",
        data={"chunks": []},
    )
