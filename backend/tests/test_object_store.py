"""TDD: services/object_store.py (adversarial review F-15, owner decision Q4)."""

import pytest

from services import object_store
from services.object_store import LocalDiskStore, ObjectNotFound


def test_key_for():
    assert object_store.key_for(7, "notes.pdf") == "7_notes.pdf"


def test_local_put_get_roundtrip(tmp_path):
    store = LocalDiskStore(str(tmp_path))
    store.put("1_a.pdf", b"hello")
    assert store.get("1_a.pdf") == b"hello"
    assert (tmp_path / "1_a.pdf").read_bytes() == b"hello"


def test_local_put_creates_root(tmp_path):
    store = LocalDiskStore(str(tmp_path / "uploads"))
    store.put("1_a.pdf", b"x")
    assert store.get("1_a.pdf") == b"x"


def test_local_get_missing_raises(tmp_path):
    store = LocalDiskStore(str(tmp_path))
    with pytest.raises(ObjectNotFound):
        store.get("9_missing.pdf")


def test_local_delete_is_idempotent(tmp_path):
    store = LocalDiskStore(str(tmp_path))
    store.put("1_a.pdf", b"x")
    store.delete("1_a.pdf")
    store.delete("1_a.pdf")  # second call must not raise
    with pytest.raises(ObjectNotFound):
        store.get("1_a.pdf")


def test_local_rejects_traversal_keys(tmp_path):
    store = LocalDiskStore(str(tmp_path))
    with pytest.raises(ValueError):
        store.put("../evil.pdf", b"x")
    with pytest.raises(ValueError):
        store.get("../../etc/passwd")


def test_get_store_defaults_to_local_disk(monkeypatch, tmp_path):
    monkeypatch.setattr("services.object_store.settings.uploads_store", "local")
    monkeypatch.setattr("services.object_store.settings.uploads_path", str(tmp_path))
    store = object_store.get_store()
    assert isinstance(store, LocalDiskStore)
