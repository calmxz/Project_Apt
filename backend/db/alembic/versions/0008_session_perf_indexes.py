# backend/db/alembic/versions/0008_session_perf_indexes.py
"""session perf indexes

Revision ID: 0008_session_perf_indexes
Revises: 0007_check_batch
Create Date: 2026-06-08

Adds btree indexes that back the session-detail and list queries:
- chat_messages(session_id, created_at): message load + last-activity aggregate.
- learning_events(session_id): single per-session event load (replaces the
  per-item N+1 in reconstruct_check_batch).
Plain CREATE INDEX works on both Postgres and SQLite; no dialect branch needed.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0008_session_perf_indexes"
down_revision: Union[str, None] = "0007_check_batch"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_chat_messages_session_created",
        "chat_messages",
        ["session_id", "created_at"],
    )
    op.create_index(
        "ix_learning_events_session",
        "learning_events",
        ["session_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_learning_events_session", table_name="learning_events")
    op.drop_index("ix_chat_messages_session_created", table_name="chat_messages")
