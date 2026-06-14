# backend/db/alembic/versions/0009_usage_counter_unique.py
"""usage_counter unique per (user, day)

Revision ID: 0009_usage_counter_unique
Revises: 0008_session_perf_indexes
Create Date: 2026-06-14

Adds a UNIQUE constraint on usage_counters(user_id, date_utc). Without it, the
non-atomic get-or-create in rate_limit.check_and_increment could insert duplicate
rows when uploads ran concurrently (exposed by PR #83's parallel reference-file
uploads), after which every later read raised MultipleResultsFound and all
uploads failed for that user that day.

Existing duplicates must be collapsed before the constraint can be created, so
the upgrade first folds each duplicate group into its lowest-id row (summing the
counts) and deletes the rest. Postgres-only SQL: Alembic targets the Supabase
Postgres DB; SQLite dev DBs get the constraint via Base.metadata.create_all.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0009_usage_counter_unique"
down_revision: Union[str, None] = "0008_session_perf_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) Fold duplicate counts into the surviving (lowest-id) row per group.
    op.execute(
        """
        UPDATE usage_counters u
        SET count = agg.total
        FROM (
            SELECT user_id, date_utc, MIN(id) AS keep_id, SUM(count) AS total
            FROM usage_counters
            GROUP BY user_id, date_utc
            HAVING COUNT(*) > 1
        ) agg
        WHERE u.id = agg.keep_id
        """
    )
    # 2) Delete the now-redundant duplicate rows.
    op.execute(
        """
        DELETE FROM usage_counters u
        USING (
            SELECT user_id, date_utc, MIN(id) AS keep_id
            FROM usage_counters
            GROUP BY user_id, date_utc
            HAVING COUNT(*) > 1
        ) agg
        WHERE u.user_id = agg.user_id
          AND u.date_utc = agg.date_utc
          AND u.id <> agg.keep_id
        """
    )
    # 3) Enforce one row per (user, day) going forward.
    op.create_unique_constraint(
        "uq_usage_counters_user_date",
        "usage_counters",
        ["user_id", "date_utc"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_usage_counters_user_date", "usage_counters", type_="unique"
    )
