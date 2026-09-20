"""TDD: migration 0010 chains onto the current head (0009)."""

import importlib.util
from pathlib import Path

from db.models import Session as SessionModel
from db.models import User


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "db" / "alembic" / "versions" / "0010_subjects_lessons.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0010", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_0010_chains_onto_0009():
    mod = _load_migration()
    assert mod.revision == "0010_subjects_lessons"
    assert mod.down_revision == "0009_usage_counter_unique"


def test_session_rolling_summary_columns(db_session):
    """TDD: Session model has rolling_summary and rolling_summary_count columns."""
    user = User(id="test-user")
    db_session.add(user)
    db_session.flush()

    s = SessionModel(id="s-roll", user_id=user.id)
    db_session.add(s)
    db_session.commit()

    assert s.rolling_summary is None
    assert s.rolling_summary_count is None

    s.rolling_summary = "earlier we covered X"
    s.rolling_summary_count = 12
    db_session.commit()

    assert s.rolling_summary == "earlier we covered X"
    assert s.rolling_summary_count == 12


def _load_versions_module(filename: str, modname: str):
    path = (
        Path(__file__).resolve().parents[1]
        / "db" / "alembic" / "versions" / filename
    )
    spec = importlib.util.spec_from_file_location(modname, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_learning_events_created_at_index_declared_on_model():
    """F-07: the windowed review-queue scan filters on created_at, so the
    column needs its own index (ix_learning_events_session covers session_id
    only)."""
    from db.models import LearningEvent

    names = {ix.name for ix in LearningEvent.__table__.indexes}
    assert "ix_learning_events_created_at" in names


def test_documents_content_sha_index_declared_on_model():
    """C-08: the partial unique index that makes an identical re-upload a
    no-op must exist on the model, not only in the migration."""
    from db.models import Document

    names = {ix.name for ix in Document.__table__.indexes}
    assert "uq_documents_session_sha" in names
    assert "content_sha256" in Document.__table__.c


def test_chat_messages_sid_id_desc_index_declared_on_model():
    """F-09: session history is ordered by id DESC, which the existing
    (session_id, created_at) index cannot serve without a sort."""
    from db.models import ChatMessage

    names = {ix.name for ix in ChatMessage.__table__.indexes}
    assert "ix_chat_messages_sid_id_desc" in names


def test_0027_chains_onto_0026():
    mod = _load_versions_module(
        "0027_chat_messages_sid_id_desc.py", "migration_0027"
    )
    assert mod.revision == "0027_chat_messages_sid_id_desc"
    assert mod.down_revision == "0026_documents_content_sha256"


def test_0026_chains_onto_0025():
    mod = _load_versions_module(
        "0026_documents_content_sha256.py", "migration_0026"
    )
    assert mod.revision == "0026_documents_content_sha256"
    assert mod.down_revision == "0025_learning_events_created_at"


def test_0025_chains_onto_0024():
    mod = _load_versions_module(
        "0025_learning_events_created_at.py", "migration_0025"
    )
    assert mod.revision == "0025_learning_events_created_at"
    assert mod.down_revision == "0024_sessions_chunk_centroid"


def test_0024_chains_onto_0023():
    mod = _load_versions_module(
        "0024_sessions_chunk_centroid.py", "migration_0024"
    )
    assert mod.revision == "0024_sessions_chunk_centroid"
    assert mod.down_revision == "0023_worker_queue"


def test_revision_ids_fit_alembic_version_column():
    """alembic_version.version_num is varchar(32) on Postgres. A longer
    revision id passes every sqlite test and then fails `alembic upgrade
    head` live with "value too long for type character varying(32)"
    (caught by CI on PR #327 for a 35-char id)."""
    versions = Path(__file__).resolve().parents[1] / "db" / "alembic" / "versions"
    for path in sorted(versions.glob("0*.py")):
        spec = importlib.util.spec_from_file_location(f"chk_{path.stem}", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        assert len(mod.revision) <= 32, f"{path.name}: revision id {mod.revision!r} exceeds 32 chars"
