"""chunk_embeddings.document_id ON DELETE CASCADE (adversarial review F-28)

Revision ID: 0018_chunk_embeddings_cascade
Revises: 0017_hnsw_chunk_embeddings
Create Date: 2026-07-16

The FK was created unnamed in 0002, so Postgres assigned the default name
chunk_embeddings_document_id_fkey. The pre-upgrade live gate verifies this via
information_schema.table_constraints. Postgres-only — no-op on SQLite so
pytest fixtures keep working.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0018_chunk_embeddings_cascade"
down_revision: Union[str, None] = "0017_hnsw_chunk_embeddings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FK_NAME = "chunk_embeddings_document_id_fkey"


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_constraint(FK_NAME, "chunk_embeddings", type_="foreignkey")
    op.create_foreign_key(
        FK_NAME,
        "chunk_embeddings",
        "documents",
        ["document_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_constraint(FK_NAME, "chunk_embeddings", type_="foreignkey")
    op.create_foreign_key(
        FK_NAME,
        "chunk_embeddings",
        "documents",
        ["document_id"],
        ["id"],
    )
