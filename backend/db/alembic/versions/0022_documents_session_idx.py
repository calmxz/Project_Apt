"""index on documents.session_id

Revision ID: 0022_documents_session_idx
Revises: 0021_sessions_indexes
Create Date: 2026-07-30

documents.session_id is filtered on every GET /sessions/{id} (and every
session create/patch response) via documents_service.session_ingestion_status,
but the FK column had no index -- a sequential scan on each session detail
load. Matches the naming of the sibling ix_chunk_embeddings_session_id.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0022_documents_session_idx"
down_revision: Union[str, None] = "0021_sessions_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_documents_session_id", "documents", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_documents_session_id", table_name="documents")
