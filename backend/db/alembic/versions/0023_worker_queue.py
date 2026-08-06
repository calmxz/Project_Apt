"""Worker queue: documents.claimed_at + status index + chunk idempotency.

Revision ID: 0023_worker_queue
Revises: 0022_documents_session_idx

The unique index backing uq_chunk_embeddings_doc_idx is built with
CREATE UNIQUE INDEX CONCURRENTLY, outside the migration's transaction
(migration-reviewer finding: a plain ADD CONSTRAINT ... UNIQUE builds its
index under ACCESS EXCLUSIVE, which would block every live retrieval read
and ingestion insert on chunk_embeddings for the build duration).

downgrade() cannot restore the duplicate rows removed by the dedup DELETE
below -- those rows are, by construction, exact (document_id, chunk_index)
duplicates, so this is an intentional, acceptable irreversibility.
"""

from alembic import op

revision = "0023_worker_queue"
down_revision = "0022_documents_session_idx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS on both: a failed run after this point (e.g. the
    # CONCURRENTLY build below) commits everything before it, since
    # autocommit_block() COMMITs the enclosing transaction. A retry of
    # `alembic upgrade head` must not fail on "column already exists" /
    # "index already exists" when re-running this migration.
    op.execute(
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS "
        "claimed_at timestamptz"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_documents_status_id "
        "ON documents (status, id)"
    )
    # Dedup before the unique constraint: keep one row per (document_id,
    # chunk_index). chunk_embeddings.id is a NOT NULL UUID string (0002),
    # so "a.id > b.id" is a safe, total, non-NULL-propagating ordering --
    # unlike created_at (nullable=True per 0002), which would make this a
    # NULL-propagating row comparison and silently skip dedup for rows
    # with a NULL created_at. The survivor is therefore arbitrary rather
    # than "earliest," which is fine: only exact (document_id, chunk_index)
    # duplicates are removed. No-op on healthy data.
    op.execute(
        """
        DELETE FROM chunk_embeddings a
        USING chunk_embeddings b
        WHERE a.document_id = b.document_id
          AND a.chunk_index = b.chunk_index
          AND a.id > b.id
        """
    )
    # Non-concurrent CREATE UNIQUE INDEX / ADD CONSTRAINT would hold
    # ACCESS EXCLUSIVE on chunk_embeddings for the full index build.
    # Build concurrently outside the transaction, then attach as a
    # constraint by adopting the finished index (no second build).
    op.execute("DROP INDEX IF EXISTS uq_chunk_embeddings_doc_idx")
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE UNIQUE INDEX CONCURRENTLY uq_chunk_embeddings_doc_idx "
            "ON chunk_embeddings (document_id, chunk_index)"
        )
    op.execute(
        "ALTER TABLE chunk_embeddings "
        "ADD CONSTRAINT uq_chunk_embeddings_doc_idx "
        "UNIQUE USING INDEX uq_chunk_embeddings_doc_idx"
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_chunk_embeddings_doc_idx", "chunk_embeddings", type_="unique"
    )
    op.drop_index("ix_documents_status_id", table_name="documents")
    op.drop_column("documents", "claimed_at")
