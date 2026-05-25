"""chat_messages: add status + cancelled_at for stream-cancel persistence

Revision ID: 0003_messages_status_cancelled_at
Revises: 0002_chunk_embeddings
Create Date: 2026-05-25

Adds two columns to the chat_messages table:
  - status       String(16) NOT NULL DEFAULT 'complete', with a CHECK constraint
                 restricting values to ('complete', 'cancelled', 'error').
  - cancelled_at DateTime(timezone=True) nullable.

Targets Postgres/Supabase only — no dialect branching needed.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003_messages_status_cancelled_at"
down_revision: Union[str, None] = "0002_chunk_embeddings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "chat_messages",
        sa.Column(
            "status",
            sa.String(16),
            nullable=False,
            server_default="complete",
        ),
    )
    op.add_column(
        "chat_messages",
        sa.Column(
            "cancelled_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.create_check_constraint(
        "chat_messages_status_check",
        "chat_messages",
        "status IN ('complete', 'cancelled', 'error')",
    )


def downgrade() -> None:
    op.drop_constraint("chat_messages_status_check", "chat_messages", type_="check")
    op.drop_column("chat_messages", "cancelled_at")
    op.drop_column("chat_messages", "status")
