from sqlalchemy import inspect

from db.database import Base
import db.models  # noqa: F401  (register models on Base.metadata)


def test_perf_indexes_declared_on_models():
    cm = Base.metadata.tables["chat_messages"]
    le = Base.metadata.tables["learning_events"]
    cm_index_cols = {tuple(c.name for c in ix.columns) for ix in cm.indexes}
    le_index_cols = {tuple(c.name for c in ix.columns) for ix in le.indexes}
    assert ("session_id", "created_at") in cm_index_cols
    assert ("session_id",) in le_index_cols
