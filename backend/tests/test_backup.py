from pathlib import Path

from scripts.backup import BackupObject, backup_key


def test_backup_key_scheme():
    assert backup_key("2026-07-04") == "crux/pg/2026-07-04/dump.pgc"


def test_backup_object_holds_key():
    obj = BackupObject(key="crux/pg/2026-07-04/dump.pgc")
    assert obj.key == "crux/pg/2026-07-04/dump.pgc"
