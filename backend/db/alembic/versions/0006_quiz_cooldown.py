# backend/db/alembic/versions/0006_quiz_cooldown.py
"""add sessions.quiz_cooldown_json

Revision ID: 0006_quiz_cooldown
Revises: 0005_pending_check
Create Date: 2026-06-05

Adds a nullable Text column `quiz_cooldown_json` to sessions. Records the last
resolved check batch that had a miss/skip, so the tutor sees a QUIZ_READINESS
hint across re-teaching turns (the pending_check is cleared on completion).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_quiz_cooldown"
down_revision: Union[str, None] = "0005_pending_check"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("quiz_cooldown_json", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sessions", "quiz_cooldown_json")
