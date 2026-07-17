# backend/db/alembic/versions/0011_drop_subjects_lessons.py
"""drop subjects lessons

Revision ID: 0011_drop_subjects_lessons
Revises: 0010_subjects_lessons
Create Date: 2026-07-01

Reverses 0010_subjects_lessons: the "Build a subject" workflow is removed.
Drops sessions.subject_id (+ its FK/index) then the lessons/subjects tables,
in FK-safe order. Constraint/table/index names below were confirmed against
the live schema via `alembic revision --autogenerate` (matches 0010's
inline-FK naming convention: <table>_<column>_fkey) then hand-trimmed to
only the subjects/lessons changes (autogen also picked up unrelated
pre-existing NOT NULL drift on other tables, out of scope here).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011_drop_subjects_lessons"
down_revision: Union[str, None] = "0010_subjects_lessons"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("ix_sessions_subject_id", table_name="sessions")
    op.drop_constraint("sessions_subject_id_fkey", "sessions", type_="foreignkey")
    op.drop_column("sessions", "subject_id")
    op.drop_index("ix_lessons_subject_id", table_name="lessons")
    op.drop_table("lessons")
    op.drop_table("subjects")


def downgrade() -> None:
    # Recreate empty subjects/lessons + sessions.subject_id (nullable) for reversibility.
    op.create_table(
        "subjects",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("per_session_minutes", sa.Integer(), nullable=False),
        sa.Column("duration_mode", sa.String(), nullable=False),
        sa.Column("timeline_days", sa.Integer(), nullable=True),
        sa.Column("pace_per_week", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "duration_mode IN ('deadline', 'pace')",
            name="subjects_duration_mode_check",
        ),
    )
    op.create_table(
        "lessons",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("subject_id", sa.String(), sa.ForeignKey("subjects.id"), nullable=False),
        sa.Column("order_idx", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("goal", sa.String(), nullable=False, server_default=""),
        sa.Column("status", sa.String(), nullable=False, server_default="not_started"),
        sa.Column("session_id", sa.String(), sa.ForeignKey("sessions.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('not_started', 'in_progress', 'done')",
            name="lessons_status_check",
        ),
    )
    op.create_index("ix_lessons_subject_id", "lessons", ["subject_id"])
    op.add_column(
        "sessions",
        sa.Column("subject_id", sa.String(), sa.ForeignKey("subjects.id"), nullable=True),
    )
    op.create_index("ix_sessions_subject_id", "sessions", ["subject_id"])
