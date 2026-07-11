"""hnsw index for chunk_embeddings

Revision ID: 0017_hnsw_chunk_embeddings
Revises: 0016_session_rolling_summary
Create Date: 2026-07-11

P4.1: replaces the ivfflat cosine index with HNSW. Measured live 2026-07-11
(spec 2026-07-11-roadmap-slice7-design.md): ivfflat with lists=100 and
default probes=1 returned 3 of a session's 5 chunks — silent recall loss at
small N because most lists are empty. HNSW (m=16, ef_construction=64,
default ef_search=40) gives exact-equivalent recall at this scale and has no
lists-training problem. Postgres-only — no-op on SQLite so pytest fixtures
keep working.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0017_hnsw_chunk_embeddings"
down_revision: Union[str, None] = "0016_session_rolling_summary"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("DROP INDEX IF EXISTS ix_chunk_embeddings_embedding")
    op.execute(
        "CREATE INDEX ix_chunk_embeddings_embedding "
        "ON chunk_embeddings USING hnsw (embedding vector_cosine_ops) "
        "WITH (m = 16, ef_construction = 64)"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("DROP INDEX IF EXISTS ix_chunk_embeddings_embedding")
    op.execute(
        "CREATE INDEX ix_chunk_embeddings_embedding "
        "ON chunk_embeddings USING ivfflat (embedding vector_cosine_ops) "
        "WITH (lists = 100)"
    )
