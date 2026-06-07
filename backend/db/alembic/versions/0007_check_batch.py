# backend/db/alembic/versions/0007_check_batch.py
"""add chat_messages.check_batch_json

Revision ID: 0007_check_batch
Revises: 0006_quiz_cooldown
Create Date: 2026-06-07

Adds a nullable Text column `check_batch_json` to chat_messages. Persists the
resolved check-question batch (public_view JSON) onto the asking assistant
message so chat history can render a read-only recap card.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007_check_batch"
down_revision: Union[str, None] = "0006_quiz_cooldown"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "chat_messages",
        sa.Column("check_batch_json", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("chat_messages", "check_batch_json")
