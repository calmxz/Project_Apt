"""users onboarding columns (F-46)

Revision ID: 0020_users_onboarding
Revises: 0019_chat_messages_partial_status
Create Date: 2026-07-16

Onboarding state (display name, feedback preference, completion flag) moves
from per-browser localStorage onto the users row so a new device does not
force-route an existing user through onboarding again. NULLs on
display_name/feedback_pref mean "never set on the server" (pre-migration
rows); the FE hydrates its own defaults in that case.

Renumbered from the originally-planned 0019 (see Batch 6 Task 13 brief):
0019 was claimed first on this branch by 0019_chat_messages_partial_status
(F-14), so this migration lands as 0020 and chains off it.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0020_users_onboarding"
down_revision: Union[str, None] = "0019_chat_messages_partial_status"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("display_name", sa.String(), nullable=True))
    op.add_column("users", sa.Column("feedback_pref", sa.String(), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "onboarding_complete",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "onboarding_complete")
    op.drop_column("users", "feedback_pref")
    op.drop_column("users", "display_name")
