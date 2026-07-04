"""Postgres backup to R2 via an S3 client behind a BackupStore interface.

Runs standalone in GitHub Actions, not inside the app. Config comes from this
module's own environment variables, never the app Settings.
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

import boto3


@dataclass
class BackupObject:
    key: str


class BackupStore(Protocol):
    def put(self, key: str, path: Path) -> None:
        """Upload the file at path to the store under key."""

    def list(self, prefix: str) -> list[BackupObject]:
        """Return all objects whose key starts with prefix."""

    def delete(self, key: str) -> None:
        """Remove the object stored under key."""


class R2Store:
    def __init__(
        self,
        *,
        endpoint_url: str,
        access_key_id: str,
        secret_access_key: str,
        bucket: str,
    ) -> None:
        self._bucket = bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
        )

    @classmethod
    def from_env(cls) -> "R2Store":
        return cls(
            endpoint_url=os.environ["R2_ENDPOINT"],
            access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            bucket=os.environ["R2_BUCKET"],
        )

    def put(self, key: str, path: Path) -> None:
        self._client.upload_file(str(path), self._bucket, key)

    def list(self, prefix: str) -> list[BackupObject]:
        objects: list[BackupObject] = []
        paginator = self._client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
            for item in page.get("Contents", []):
                objects.append(BackupObject(key=item["Key"]))
        return objects

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)


def backup_key(date_str: str) -> str:
    return f"crux/pg/{date_str}/dump.pgc"


def prune(store: BackupStore, prefix: str = "crux/pg/", keep: int = 7) -> list[str]:
    keys = sorted((obj.key for obj in store.list(prefix)), reverse=True)
    to_delete = keys[keep:]
    for key in to_delete:
        store.delete(key)
    return to_delete


def make_store() -> BackupStore:
    return R2Store.from_env()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="backup")
    sub = parser.add_subparsers(dest="cmd", required=True)

    up = sub.add_parser("upload")
    up.add_argument("path")

    pr = sub.add_parser("prune")
    pr.add_argument("--keep", type=int, default=7)

    args = parser.parse_args(argv)
    store = make_store()

    if args.cmd == "upload":
        today = datetime.now(timezone.utc).date().isoformat()
        store.put(backup_key(today), Path(args.path))
        return 0
    if args.cmd == "prune":
        prune(store, keep=args.keep)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
