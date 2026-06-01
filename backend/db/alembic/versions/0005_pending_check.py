# backend/db/alembic/versions/0005_pending_check.py
"""add sessions.pending_check_json

Revision ID: 0005_pending_check
Revises: 0004_sessions_pinned
Create Date: 2026-06-01

Adds a nullable Text column `pending_check_json` to sessions.
Stores the in-flight check-question state between agent turns.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005_pending_check"
down_revision: Union[str, None] = "0004_sessions_pinned"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("pending_check_json", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sessions", "pending_check_json")
