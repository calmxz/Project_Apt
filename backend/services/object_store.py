"""Uploaded-blob storage behind an ObjectStore protocol (F-15, owner decision Q4).

Uploads previously lived only on local disk at settings.uploads_path, which is
ephemeral on Render: any deploy or restart wiped un-ingested files and made
re-ingestion of prior files impossible. Blobs now go through this protocol:

  LocalDiskStore : dev / docker-compose / tests (default). Same on-disk layout
                   as before ({uploads_path}/{doc_id}_{filename}), so files
                   uploaded before this change remain readable.
  R2ObjectStore  : prod. Cloudflare R2 via boto3's S3 client, keys prefixed
                   "uploads/". Durable across restarts and replicas.

Selected by settings.uploads_store ("local" | "r2"). get_store() constructs per
call; do not cache a store across requests.
"""

from pathlib import Path
from typing import Protocol

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


def get_store() -> ObjectStore:
    if settings.uploads_store == "r2":
        raise RuntimeError("R2ObjectStore lands in the next task")
    return LocalDiskStore(settings.uploads_path)
