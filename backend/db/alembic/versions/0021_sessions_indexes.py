"""sessions indexes: user_id + active-topic partial unique (B-05, B-11)

Revision ID: 0021_sessions_indexes
Revises: 0020_users_onboarding
Create Date: 2026-07-19

B-11: plain index on sessions.user_id (list/library/aggregate queries scan
the whole table without it). B-05: partial unique index making the F-34
duplicate-active-topic guard DB-authoritative under concurrency.
PRE-DEPLOY CHECK (also in the PR body): the unique index build fails if live
data already violates it - run
  SELECT user_id, lower(topic), count(*) FROM sessions
  WHERE ended_at IS NULL GROUP BY 1, 2 HAVING count(*) > 1;
and resolve any rows before upgrading.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0021_sessions_indexes"
down_revision: Union[str, None] = "0020_users_onboarding"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
    op.create_index(
        "uq_sessions_active_topic",
        "sessions",
        [sa.text("user_id"), sa.text("lower(topic)")],
        unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_sessions_active_topic", table_name="sessions")
    op.drop_index("ix_sessions_user_id", table_name="sessions")
