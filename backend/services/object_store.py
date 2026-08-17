"""Uploaded-blob storage behind an ObjectStore protocol (F-15, owner decision Q4).

Local disk (settings.uploads_path) is ephemeral on Render: any deploy or
restart wipes un-ingested files and blocks re-ingestion of prior files.
Blobs go through this protocol instead:

  LocalDiskStore : dev / docker-compose / tests (default). On-disk layout
                   is {uploads_path}/{doc_id}_{filename}.
  R2ObjectStore  : prod. Cloudflare R2 via boto3's S3 client, keys prefixed
                   "uploads/". Durable across restarts and replicas.

Selected by settings.uploads_store ("local" | "r2"). get_store() constructs per
call; do not cache a store across requests.
"""

from pathlib import Path
from typing import Protocol

import boto3
import botocore.exceptions

from config import settings


class ObjectNotFound(Exception):
    """Raised by ObjectStore.get() when the key does not exist."""


class ObjectStore(Protocol):
    def put(self, key: str, data: bytes) -> None:
        """Store data under key, overwriting any existing object."""

    def get(self, key: str) -> bytes:
        """Return the object's bytes. Raises ObjectNotFound if absent."""

    def delete(self, key: str) -> None:
        """Remove the object. Idempotent; best-effort (must not raise on absence)."""


def key_for(doc_id: int, filename: str) -> str:
    return f"{doc_id}_{filename}"


class LocalDiskStore:
    def __init__(self, root: str) -> None:
        self._root = Path(root).resolve()

    def _path(self, key: str) -> Path:
        candidate = (self._root / key).resolve()
        if candidate.parent != self._root:
            raise ValueError(f"unsafe object key: {key!r}")
        return candidate

    def put(self, key: str, data: bytes) -> None:
        path = self._path(key)
        self._root.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get(self, key: str) -> bytes:
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError:
            raise ObjectNotFound(key) from None

    def delete(self, key: str) -> None:
        try:
            self._path(key).unlink(missing_ok=True)
        except OSError:
            # Best-effort: e.g. Windows file lock while ingestion still holds
            # the file. Callers treat delete as advisory cleanup.
            pass


class R2ObjectStore:
    """Cloudflare R2 via boto3's S3-compatible API. Keys live under uploads/."""

    PREFIX = "uploads/"

    def __init__(
        self,
        *,
        endpoint_url: str,
        access_key_id: str,
        secret_access_key: str,
        bucket: str,
        client=None,
    ) -> None:
        self._bucket = bucket
        self._client = client or boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
        )

    def _key(self, key: str) -> str:
        return f"{self.PREFIX}{key}"

    def put(self, key: str, data: bytes) -> None:
        self._client.put_object(Bucket=self._bucket, Key=self._key(key), Body=data)

    def get(self, key: str) -> bytes:
        try:
            resp = self._client.get_object(Bucket=self._bucket, Key=self._key(key))
        except botocore.exceptions.ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code in ("NoSuchKey", "404"):
                raise ObjectNotFound(key) from None
            raise
        return resp["Body"].read()

    def delete(self, key: str) -> None:
        # S3 DeleteObject is idempotent: deleting an absent key succeeds.
        self._client.delete_object(Bucket=self._bucket, Key=self._key(key))


def get_store() -> ObjectStore:
    if settings.uploads_store == "r2":
        return R2ObjectStore(
            endpoint_url=settings.r2_endpoint,
            access_key_id=settings.r2_access_key_id,
            secret_access_key=settings.r2_secret_access_key,
            bucket=settings.r2_bucket,
        )
    return LocalDiskStore(settings.uploads_path)
