from pathlib import Path

from scripts.backup import BackupObject, backup_key, prune


def test_backup_key_scheme():
    assert backup_key("2026-07-04") == "crux/pg/2026-07-04/dump.pgc"


def test_backup_object_holds_key():
    obj = BackupObject(key="crux/pg/2026-07-04/dump.pgc")
    assert obj.key == "crux/pg/2026-07-04/dump.pgc"


class FakeStore:
    def __init__(self, keys):
        self.objects = {k: b"x" for k in keys}
        self.deleted = []

    def put(self, key, path):
        self.objects[key] = b"x"

    def list(self, prefix):
        return [BackupObject(key=k) for k in self.objects if k.startswith(prefix)]

    def delete(self, key):
        del self.objects[key]
        self.deleted.append(key)


def test_prune_keeps_newest_n():
    keys = [f"crux/pg/2026-07-0{d}/dump.pgc" for d in range(1, 10)]  # 9 dumps
    store = FakeStore(keys)

    deleted = prune(store, keep=7)

    assert len(store.objects) == 7
    assert set(deleted) == {
        "crux/pg/2026-07-01/dump.pgc",
        "crux/pg/2026-07-02/dump.pgc",
    }
    assert "crux/pg/2026-07-09/dump.pgc" in store.objects


def test_prune_noop_when_at_or_under_keep():
    keys = [f"crux/pg/2026-07-0{d}/dump.pgc" for d in range(1, 5)]  # 4 dumps
    store = FakeStore(keys)

    deleted = prune(store, keep=7)

    assert deleted == []
    assert len(store.objects) == 4
