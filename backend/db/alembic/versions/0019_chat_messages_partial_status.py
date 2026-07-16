"""chat_messages: allow 'partial' status for aborted-turn text persistence (F-14)

Revision ID: 0019_chat_messages_partial_status
Revises: 0018_chunk_embeddings_cascade
Create Date: 2026-07-16

The max_iters and mid-turn cost-cap abort arms in agent/tutor.py now persist
already-streamed text instead of discarding it, tagged with a new status
value 'partial' (alongside the existing complete/cancelled/error). Widens
the chat_messages_status_check CHECK constraint added in 0003 to allow it.

Postgres-only, matching 0003's precedent -- SQLite test fixtures build the
schema directly from db/models.py via Base.metadata.create_all, not via
alembic, so no dialect branch is needed here.

NOTE: at authoring time, Batch 6 Task 13 (F-46) is separately planned to
create a migration also numbered 0019 (0019_users_onboarding). Whichever of
the two lands second on the shared branch must renumber to 0020 and update
its down_revision to point at this file's revision id.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0019_chat_messages_partial_status"
down_revision: Union[str, None] = "0018_chunk_embeddings_cascade"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("chat_messages_status_check", "chat_messages", type_="check")
    op.create_check_constraint(
        "chat_messages_status_check",
        "chat_messages",
        "status IN ('complete', 'cancelled', 'error', 'partial')",
    )


def downgrade() -> None:
    op.drop_constraint("chat_messages_status_check", "chat_messages", type_="check")
    op.create_check_constraint(
        "chat_messages_status_check",
        "chat_messages",
        "status IN ('complete', 'cancelled', 'error')",
    )
