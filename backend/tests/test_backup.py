from unittest import mock

from scripts.backup import BackupObject, R2Store, backup_key, main, prune


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


def test_main_upload_puts_dated_key(tmp_path, monkeypatch):
    store = FakeStore([])
    monkeypatch.setattr("scripts.backup.make_store", lambda: store)
    dump = tmp_path / "dump.pgc"
    dump.write_bytes(b"data")

    rc = main(["upload", str(dump)])

    assert rc == 0
    assert len(store.objects) == 1
    only_key = next(iter(store.objects))
    assert only_key.startswith("crux/pg/") and only_key.endswith("/dump.pgc")


def test_main_prune_deletes_old(monkeypatch):
    keys = [f"crux/pg/2026-07-0{d}/dump.pgc" for d in range(1, 10)]
    store = FakeStore(keys)
    monkeypatch.setattr("scripts.backup.make_store", lambda: store)

    rc = main(["prune", "--keep", "7"])

    assert rc == 0
    assert len(store.objects) == 7


def _r2(client):
    with mock.patch("scripts.backup.boto3.client", return_value=client):
        return R2Store(
            endpoint_url="https://acct.r2.cloudflarestorage.com",
            access_key_id="ak",
            secret_access_key="sk",
            bucket="crux-backups",
        )


def test_r2store_put_uploads_to_bucket(tmp_path):
    client = mock.Mock()
    store = _r2(client)
    dump = tmp_path / "dump.pgc"
    dump.write_bytes(b"data")

    store.put("crux/pg/2026-07-04/dump.pgc", dump)

    client.upload_file.assert_called_once_with(
        str(dump), "crux-backups", "crux/pg/2026-07-04/dump.pgc"
    )


def test_r2store_list_returns_backup_objects():
    client = mock.Mock()
    client.get_paginator.return_value.paginate.return_value = [
        {"Contents": [{"Key": "crux/pg/2026-07-04/dump.pgc"}]},
        {"Contents": [{"Key": "crux/pg/2026-07-03/dump.pgc"}]},
    ]
    store = _r2(client)

    objs = store.list("crux/pg/")

    assert [o.key for o in objs] == [
        "crux/pg/2026-07-04/dump.pgc",
        "crux/pg/2026-07-03/dump.pgc",
    ]


def test_r2store_list_handles_empty_bucket():
    client = mock.Mock()
    client.get_paginator.return_value.paginate.return_value = [{}]  # no Contents key
    store = _r2(client)

    assert store.list("crux/pg/") == []


def test_r2store_delete_removes_key():
    client = mock.Mock()
    store = _r2(client)

    store.delete("crux/pg/2026-07-01/dump.pgc")

    client.delete_object.assert_called_once_with(
        Bucket="crux-backups", Key="crux/pg/2026-07-01/dump.pgc"
    )
