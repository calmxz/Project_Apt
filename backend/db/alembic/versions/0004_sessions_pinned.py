# backend/db/alembic/versions/0004_sessions_pinned.py
"""sessions: add pinned flag for sidebar favorites

Revision ID: 0004_sessions_pinned
Revises: 0003_msg_status_cancelled_at
Create Date: 2026-05-30

Adds a boolean `pinned` column to sessions (NOT NULL DEFAULT false).
Targets Postgres/Supabase.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_sessions_pinned"
down_revision: Union[str, None] = "0003_msg_status_cancelled_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("sessions", "pinned")
