"""llm_call_log: nullable token-count columns (roadmap P1 instrumentation)

Revision ID: 0015_llm_call_log_tokens
Revises: 0014_llm_call_log
"""
from alembic import op
import sqlalchemy as sa


revision = "0015_llm_call_log_tokens"
down_revision = "0014_llm_call_log"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("llm_call_log", sa.Column("prompt_tokens", sa.Integer(), nullable=True))
    op.add_column("llm_call_log", sa.Column("completion_tokens", sa.Integer(), nullable=True))
    op.add_column("llm_call_log", sa.Column("cached_tokens", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("llm_call_log", "cached_tokens")
    op.drop_column("llm_call_log", "completion_tokens")
    op.drop_column("llm_call_log", "prompt_tokens")
