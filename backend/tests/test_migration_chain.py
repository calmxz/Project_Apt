"""TDD: migration 0010 chains onto the current head (0009)."""

import importlib.util
from pathlib import Path


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
