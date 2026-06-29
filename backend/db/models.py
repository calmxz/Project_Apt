from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
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
    __table_args__ = (
        Index("ix_sessions_subject_id", "subject_id"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    topic: Mapped[str] = mapped_column(String, default="")
    topic_profile_json: Mapped[str] = mapped_column(Text, default="{}")
    kw_index_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    pending_check_json: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    quiz_cooldown_json: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pinned: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )
    subject_id: Mapped[str | None] = mapped_column(
        ForeignKey("subjects.id"), nullable=True
    )

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
        Index("ix_chat_messages_session_created", "session_id", "created_at"),
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
    check_batch_json: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)

    session: Mapped["Session"] = relationship("Session", back_populates="messages")


class UsageCounter(Base):
    __tablename__ = "usage_counters"
    __table_args__ = (
        UniqueConstraint("user_id", "date_utc", name="uq_usage_counters_user_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    date_utc: Mapped[str] = mapped_column(String, nullable=False)  # YYYY-MM-DD
    count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="usage_counters")


class LearningEvent(Base):
    __tablename__ = "learning_events"
    __table_args__ = (
        Index("ix_learning_events_session", "session_id"),
    )

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


class Subject(Base):
    __tablename__ = "subjects"
    __table_args__ = (
        CheckConstraint(
            "duration_mode IN ('deadline', 'pace')",
            name="subjects_duration_mode_check",
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid4().hex)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    per_session_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    # Duration is a user-toggled pair: duration_mode records which knob is pinned;
    # exactly one of timeline_days / pace_per_week is set, the other is derived on read.
    duration_mode: Mapped[str] = mapped_column(String, nullable=False)
    timeline_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pace_per_week: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    lessons: Mapped[list["Lesson"]] = relationship("Lesson", back_populates="subject")


class Lesson(Base):
    __tablename__ = "lessons"
    __table_args__ = (
        CheckConstraint(
            "status IN ('not_started', 'in_progress', 'done')",
            name="lessons_status_check",
        ),
        Index("ix_lessons_subject_id", "subject_id"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid4().hex)
    subject_id: Mapped[str] = mapped_column(ForeignKey("subjects.id"), nullable=False)
    order_idx: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    title: Mapped[str] = mapped_column(String, nullable=False)
    goal: Mapped[str] = mapped_column(String, nullable=False, default="")
    status: Mapped[str] = mapped_column(
        String, nullable=False, server_default="not_started", default="not_started"
    )
    session_id: Mapped[str | None] = mapped_column(ForeignKey("sessions.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    subject: Mapped["Subject"] = relationship("Subject", back_populates="lessons")
