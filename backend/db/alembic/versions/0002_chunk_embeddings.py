"""chunk_embeddings (pgvector)

Revision ID: 0002_chunk_embeddings
Revises: 0001_phase7_baseline
Create Date: 2026-05-23

Enables the `vector` extension, creates `chunk_embeddings`, and adds an
ivfflat cosine-ops index. Postgres-only — on SQLite (legacy dev DBs) the
migration is a no-op so existing pytest fixtures keep working.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision: str = "0002_chunk_embeddings"
down_revision: Union[str, None] = "0001_phase7_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

EMBEDDING_DIM = 768


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "chunk_embeddings",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("session_id", sa.String(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("document_id", sa.Integer(), sa.ForeignKey("documents.id"), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("page", sa.Integer(), nullable=True),
        sa.Column("chunk_text", sa.Text(), nullable=False),
        sa.Column("embedding", Vector(EMBEDDING_DIM), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_chunk_embeddings_session_id",
        "chunk_embeddings",
        ["session_id"],
    )
    op.create_index(
        "ix_chunk_embeddings_document_id",
        "chunk_embeddings",
        ["document_id"],
    )
    op.execute(
        "CREATE INDEX ix_chunk_embeddings_embedding "
        "ON chunk_embeddings USING ivfflat (embedding vector_cosine_ops) "
        "WITH (lists = 100)"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("DROP INDEX IF EXISTS ix_chunk_embeddings_embedding")
    op.drop_index("ix_chunk_embeddings_document_id", table_name="chunk_embeddings")
    op.drop_index("ix_chunk_embeddings_session_id", table_name="chunk_embeddings")
    op.drop_table("chunk_embeddings")
