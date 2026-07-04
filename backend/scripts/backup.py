"""Postgres backup to R2 via an S3 client behind a BackupStore interface.

Runs standalone in GitHub Actions, not inside the app. Config comes from this
module's own environment variables, never the app Settings.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass
class BackupObject:
    key: str


class BackupStore(Protocol):
    def put(self, key: str, path: Path) -> None: ...

    def list(self, prefix: str) -> list[BackupObject]: ...

    def delete(self, key: str) -> None: ...


def backup_key(date_str: str) -> str:
    return f"crux/pg/{date_str}/dump.pgc"


def prune(store: BackupStore, prefix: str = "crux/pg/", keep: int = 7) -> list[str]:
    keys = sorted((obj.key for obj in store.list(prefix)), reverse=True)
    to_delete = keys[keep:]
    for key in to_delete:
        store.delete(key)
    return to_delete
