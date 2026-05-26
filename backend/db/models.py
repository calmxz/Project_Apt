import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from config import settings
from db.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    sessions: Mapped[list["Session"]] = relationship("Session", back_populates="user")
    usage_counters: Mapped[list["UsageCounter"]] = relationship("UsageCounter", back_populates="user")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    topic: Mapped[str] = mapped_column(String, default="")
    topic_profile_json: Mapped[str] = mapped_column(Text, default="{}")
    kw_index_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="sessions")
    messages: Mapped[list["ChatMessage"]] = relationship("ChatMessage", back_populates="session")
    learning_events: Mapped[list["LearningEvent"]] = relationship("LearningEvent", back_populates="session")
    documents: Mapped[list["Document"]] = relationship("Document", back_populates="session")


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        CheckConstraint(
            "status IN ('complete', 'cancelled', 'error')",
            name="chat_messages_status_check",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tool_calls_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    citations_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="complete")
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    session: Mapped["Session"] = relationship("Session", back_populates="messages")


class UsageCounter(Base):
    __tablename__ = "usage_counters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    date_utc: Mapped[str] = mapped_column(String, nullable=False)  # YYYY-MM-DD
    count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="usage_counters")


class LearningEvent(Base):
    __tablename__ = "learning_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), nullable=False)
    gap_tested: Mapped[str] = mapped_column(String, nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    correct: Mapped[bool] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    session: Mapped["Session"] = relationship("Session", back_populates="learning_events")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, default="pending")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    session: Mapped["Session"] = relationship("Session", back_populates="documents")


class ChunkEmbedding(Base):
    __tablename__ = "chunk_embeddings"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid4()))
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), nullable=False, index=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), nullable=False, index=True)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(settings.embedding_dim), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class DailyCostLedger(Base):
    __tablename__ = "daily_cost_ledger"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    date_utc: Mapped[str] = mapped_column(String, primary_key=True)  # YYYY-MM-DD
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(10, 4), default=Decimal("0.0000"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )
