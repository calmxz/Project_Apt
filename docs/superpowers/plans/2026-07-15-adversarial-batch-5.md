# Adversarial Review Batch 5 — Ingestion + Storage Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 6 ingestion/storage findings from `docs/adversarial-review-2026-07-12.md` (F-15, F-26, F-27, F-28, F-29, F-40) so uploaded blobs survive restarts (R2 object storage per owner decision Q4), ingestion and delete are atomic, stuck `pending` documents are reaped at startup, a failed storage write cannot orphan a permanent `pending` row, and a spoofed/absent Content-Length cannot make the server materialize an unbounded body.

**Architecture:** Backend-only plus deploy config. Three clusters: (1) a new `services/object_store.py` protocol with `LocalDiskStore` (dev/tests/docker, same on-disk layout as today) and `R2ObjectStore` (prod, boto3 S3 client against Cloudflare R2 — WS-D already proved this client shape in `scripts/backup.py`); upload/ingestion/delete all go through it. (2) Transaction hygiene: `insert_chunks` and `merge_into_session` stop committing so `ingestion_service.run` owns one atomic commit (chunks + keyword index + `status="ready"`); `delete_document_chunks` stops committing so `delete_document` owns one atomic commit (chunks + row), backed by a new `ON DELETE CASCADE` migration; `query_chunks` additionally filters `Document.status == "ready"` so failed-doc chunks can never feed retrieval. (3) Upload-path hardening: bounded incremental body read before any row exists (F-40), guarded storage write that marks the row `failed` and returns 507 instead of stranding `pending` (F-29), and a startup reaper that fails stale `pending` rows left behind by a restart (F-26).

**Tech Stack:** FastAPI + SQLAlchemy 2.x (sync ORM), Alembic, boto3 (new backend runtime dep), pypdf / python-pptx (now fed from `io.BytesIO`), pytest (SQLite in CI), Cloudflare R2.

## Global Constraints

- `backend/contracts/` is CODEGEN OUTPUT. Never hand-edit. Edit `docs/api/openapi.yaml`, then run `python backend/scripts/gen_contracts.py` from repo root. A PostToolUse hook may auto-run codegen after YAML edits — verify it fired before committing. CI enforces zero drift.
- Run pytest from `backend/`, never repo root.
- After any import-touching change, run the FULL backend suite (circular-import breakage appears in unrelated modules).
- Use the native Grep tool for repo-wide sweeps (rtk rg has a false-zero gotcha).
- No emojis in code or comments.
- Branch: `fix/adversarial-batch-5` (created off `dev` at `13f1ec3`). PR targets `dev`. **Before execution starts, merge the latest `dev` into this branch** — Batch 4 (PR #119) also edits `docs/adversarial-review-2026-07-12.md` (FIXED markers) and must land first to avoid marker conflicts in the final task.
- Owner decision that gates this batch (from `docs/adversarial-review-2026-07-12.md` §6, decided 2026-07-13): **Q4 (F-15): R2 OBJECT STORAGE.** Move PDF blobs to R2 behind a storage interface (the WS-D R2 client pattern exists in `backend/scripts/backup.py`). NOT a Render disk mount — a disk mount pins to one instance; R2 also fixes the multi-replica case.
- Scope notes for the final reviewer: ingestion remains an in-process `BackgroundTask` pinned to the replica that received the upload — single-instance Render is the accepted deployment shape (review doc §"Assumptions"); the reaper (F-26) marks stale docs `failed` rather than re-enqueuing (re-enqueue risks loops and needs an attempt counter/migration; the review-sanctioned fix is mark-failed so the user is told). `scripts/backup.py` is NOT refactored to share the new store — it deliberately runs standalone in GitHub Actions with its own env config.
- SQLite CI cannot execute pgvector's `cosine_distance`. The `query_chunks` ready-filter is proven by capturing the statement and asserting its Postgres-dialect compilation (same spy + compile-assert pattern Batch 4 used for `FOR UPDATE`).
- Migration 0018 assumes the Postgres default FK name `chunk_embeddings_document_id_fkey` (FK was created inline/unnamed in 0002). The owed live gate verifies the name via `information_schema.table_constraints` before running `alembic upgrade head`; if it differs, fix the migration then.
- Owed post-merge human gates (record in memory, do not attempt in CI): create the R2 uploads bucket + set `UPLOADS_STORE=r2` and the 4 R2 secrets on Render; live `alembic upgrade head` (0018); restart-survival smoke (upload → restart backend → document still resolvable, delete removes the R2 object); failed-doc retrieval exclusion spot-check.

## File Structure

- Create: `backend/services/object_store.py` — `ObjectStore` protocol, `ObjectNotFound`, `key_for`, `LocalDiskStore`, `R2ObjectStore`, `get_store()` factory.
- Create: `backend/tests/test_object_store.py` — store unit tests.
- Create: `backend/db/alembic/versions/0018_chunk_embeddings_cascade.py` — FK recreate with `ON DELETE CASCADE`.
- Modify: `backend/config.py` — `uploads_store`, `r2_endpoint`, `r2_access_key_id`, `r2_secret_access_key`, `r2_bucket`.
- Modify: `backend/requirements.txt` — add `boto3`.
- Modify: `backend/routes/upload.py` — bounded read helper, row-then-guarded-put ordering, 507 path, store-backed write.
- Modify: `backend/services/ingestion_service.py` — store-backed blob load, `BytesIO` extractors, single-commit pipeline, rollback-then-fail error path, `reap_stale_pending`.
- Modify: `backend/services/pgvector_store.py` — `insert_chunks` no longer commits; `delete_document_chunks` no longer commits; `query_chunks` filters `Document.status == "ready"`.
- Modify: `backend/lib/keyword_index.py` — `merge_into_session` no longer commits.
- Modify: `backend/services/documents_service.py` — single-commit delete, store-backed object cleanup.
- Modify: `backend/db/models.py` — `ChunkEmbedding.document_id` gains `ondelete="CASCADE"`.
- Modify: `backend/main.py` — lifespan calls the reaper.
- Modify: `docs/api/openapi.yaml` — `/api/upload` POST gains a `507` response → regen `backend/contracts/`.
- Modify: `render.yaml`, `.env.example` — R2 env vars.
- Modify: `docs/adversarial-review-2026-07-12.md` — FIXED markers (final task).
- Test files touched: `backend/tests/test_object_store.py` (new), `test_upload_route.py`, `test_ingestion_service.py`, `test_pgvector_retrieval.py`, `test_keyword_index.py`, `test_documents_service.py`.

## Interfaces produced (cross-task contract)

- `object_store.ObjectNotFound(Exception)` (Task 1).
- `object_store.key_for(doc_id: int, filename: str) -> str` — returns `f"{doc_id}_{filename}"` (Task 1). Used by Tasks 3, 4, 6.
- `object_store.get_store() -> ObjectStore` — `LocalDiskStore(settings.uploads_path)` unless `settings.uploads_store == "r2"`, then `R2ObjectStore` from settings (Tasks 1–2). Constructed per call, never cached. Used by Tasks 3, 4, 6.
- `ObjectStore` methods: `put(key: str, data: bytes) -> None`; `get(key: str) -> bytes` raising `ObjectNotFound`; `delete(key: str) -> None` idempotent/best-effort (Task 1).
- `pgvector_store.insert_chunks(...)` — same signature, but flushes instead of committing; **caller owns the transaction** (Task 5).
- `keyword_index.merge_into_session(...)` — same signature, no commit; caller owns the transaction (Task 5).
- `pgvector_store.delete_document_chunks(...)` — same signature, no commit; caller owns the transaction (Task 7).
- `ingestion_service.reap_stale_pending(db, *, now: datetime | None = None) -> int` (Task 8). Called from `main.lifespan`.

---

### Task 1: ObjectStore protocol + LocalDiskStore + factory + config

**Files:**
- Create: `backend/services/object_store.py`
- Modify: `backend/config.py` (settings fields)
- Test: `backend/tests/test_object_store.py` (new)

**Interfaces:**
- Consumes: `config.settings`.
- Produces: `ObjectStore` protocol, `ObjectNotFound`, `key_for(doc_id, filename)`, `LocalDiskStore`, `get_store()` (R2 branch lands in Task 2; until then `get_store()` raises `RuntimeError` for `"r2"`).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_object_store.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_object_store.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'services.object_store'`

- [ ] **Step 3: Add settings fields**

In `backend/config.py`, inside `class Settings`, after `uploads_path` (line 25):

```python
    # F-15 (owner decision Q4): where uploaded blobs live. "local" writes under
    # uploads_path (dev / docker / tests); "r2" targets Cloudflare R2 (prod).
    uploads_store: str = "local"
    r2_endpoint: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = ""
```

- [ ] **Step 4: Write the module**

Create `backend/services/object_store.py`:

```python
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
```

(The `"r2"` branch is replaced with the real constructor in Task 2 — leaving the `RuntimeError` placeholder here is deliberate so this task stays independently green without boto3.)

- [ ] **Step 5: Run tests to verify they pass**

Run from `backend/`: `pytest tests/test_object_store.py -v`
Expected: 7 PASS

- [ ] **Step 6: Run the full backend suite (import-touching change)**

Run from `backend/`: `pytest`
Expected: all pass (719 + 7 new at time of writing)

- [ ] **Step 7: Commit**

```bash
git add backend/services/object_store.py backend/tests/test_object_store.py backend/config.py
git commit -m "feat: ObjectStore protocol + LocalDiskStore behind settings.uploads_store (F-15 groundwork)"
```

---

### Task 2: R2ObjectStore + boto3 dep + deploy config

**Files:**
- Modify: `backend/services/object_store.py` (add `R2ObjectStore`, wire `get_store()`)
- Modify: `backend/requirements.txt` (add `boto3`)
- Modify: `render.yaml`, `.env.example`
- Test: `backend/tests/test_object_store.py`

**Interfaces:**
- Consumes: Task 1's `ObjectNotFound`, `get_store()`.
- Produces: `R2ObjectStore(endpoint_url=..., access_key_id=..., secret_access_key=..., bucket=..., client=None)` — `client` injection point for tests; keys stored under `uploads/` prefix. `get_store()` returns it when `settings.uploads_store == "r2"`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_object_store.py`:

```python
class FakeS3Client:
    """Duck-typed stand-in for boto3's S3 client (records calls, in-memory blobs)."""

    def __init__(self):
        self.blobs = {}

    def put_object(self, Bucket, Key, Body):
        self.blobs[(Bucket, Key)] = Body

    def get_object(self, Bucket, Key):
        try:
            import io
            return {"Body": io.BytesIO(self.blobs[(Bucket, Key)])}
        except KeyError:
            import botocore.exceptions
            raise botocore.exceptions.ClientError(
                {"Error": {"Code": "NoSuchKey"}}, "GetObject"
            ) from None

    def delete_object(self, Bucket, Key):
        self.blobs.pop((Bucket, Key), None)


def _r2(client):
    from services.object_store import R2ObjectStore
    return R2ObjectStore(
        endpoint_url="https://acct.r2.cloudflarestorage.com",
        access_key_id="k",
        secret_access_key="s",
        bucket="crux",
        client=client,
    )


def test_r2_put_get_roundtrip_uses_uploads_prefix():
    fake = FakeS3Client()
    store = _r2(fake)
    store.put("7_a.pdf", b"blob")
    assert ("crux", "uploads/7_a.pdf") in fake.blobs
    assert store.get("7_a.pdf") == b"blob"


def test_r2_get_missing_raises_object_not_found():
    store = _r2(FakeS3Client())
    with pytest.raises(ObjectNotFound):
        store.get("9_missing.pdf")


def test_r2_delete_is_idempotent():
    fake = FakeS3Client()
    store = _r2(fake)
    store.put("7_a.pdf", b"blob")
    store.delete("7_a.pdf")
    store.delete("7_a.pdf")  # must not raise
    assert fake.blobs == {}


def test_get_store_returns_r2_when_configured(monkeypatch):
    monkeypatch.setattr("services.object_store.settings.uploads_store", "r2")
    monkeypatch.setattr("services.object_store.settings.r2_endpoint", "https://e")
    monkeypatch.setattr("services.object_store.settings.r2_access_key_id", "k")
    monkeypatch.setattr("services.object_store.settings.r2_secret_access_key", "s")
    monkeypatch.setattr("services.object_store.settings.r2_bucket", "b")
    from services.object_store import R2ObjectStore
    assert isinstance(object_store.get_store(), R2ObjectStore)
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_object_store.py -v`
Expected: 4 new tests FAIL — `ImportError: cannot import name 'R2ObjectStore'`

- [ ] **Step 3: Add boto3 to requirements**

In `backend/requirements.txt`, add (alphabetical placement per file's existing order):

```
boto3
```

Then from `backend/`: `pip install boto3` (it may already be present transitively from local WS-D work; the requirements entry is the deliverable).

- [ ] **Step 4: Implement R2ObjectStore**

In `backend/services/object_store.py`, add imports at top:

```python
import boto3
import botocore.exceptions
```

Add after `LocalDiskStore`:

```python
class R2ObjectStore:
    """Cloudflare R2 via boto3's S3-compatible API (same client shape WS-D's
    scripts/backup.py proved for Postgres dumps). Keys live under uploads/."""

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
```

Replace the `get_store()` `"r2"` branch:

```python
def get_store() -> ObjectStore:
    if settings.uploads_store == "r2":
        return R2ObjectStore(
            endpoint_url=settings.r2_endpoint,
            access_key_id=settings.r2_access_key_id,
            secret_access_key=settings.r2_secret_access_key,
            bucket=settings.r2_bucket,
        )
    return LocalDiskStore(settings.uploads_path)
```

- [ ] **Step 5: Deploy config**

In `render.yaml` under `envVars`, add:

```yaml
      - key: UPLOADS_STORE
        value: r2
      - key: R2_ENDPOINT
        sync: false
      - key: R2_ACCESS_KEY_ID
        sync: false
      - key: R2_SECRET_ACCESS_KEY
        sync: false
      - key: R2_BUCKET
        sync: false
```

In `.env.example`, add (matching the file's existing comment style):

```
# Uploaded-blob storage: "local" (default, dev) or "r2" (prod)
UPLOADS_STORE=local
R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
```

- [ ] **Step 6: Run tests to verify they pass, then the full suite**

Run from `backend/`: `pytest tests/test_object_store.py -v` → 11 PASS.
Then: `pytest` → all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/services/object_store.py backend/tests/test_object_store.py backend/requirements.txt render.yaml .env.example
git commit -m "feat: R2ObjectStore for prod uploads + deploy config (F-15)"
```

---

### Task 3: Upload route — bounded read (F-40), guarded write + 507 (F-29), store-backed (F-15)

**Files:**
- Modify: `backend/routes/upload.py`
- Modify: `docs/api/openapi.yaml` (add `507` response to `/api/upload` POST) → regen `backend/contracts/`
- Test: `backend/tests/test_upload_route.py`

**Interfaces:**
- Consumes: `object_store.get_store()`, `object_store.key_for(doc_id, filename)` (Tasks 1–2).
- Produces: `_read_bounded(fh, max_bytes) -> bytes` (module-private helper, unit-tested directly). Error codes: existing `FILE_TOO_LARGE` (413), new `STORAGE_WRITE_FAILED` (507).

Current defects being fixed (`backend/routes/upload.py`): the Content-Length gate (lines 58–67) is skipped when the header is absent/forged and `file.file.read()` (line 93) then materializes the whole body; the row is created *before* the size check (lines 88–91) forcing a delete-on-413 dance; the disk write (lines 102–105) is unguarded and runs after the row commit, so a write failure strands a permanent `pending` row with ingestion never scheduled.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_upload_route.py`:

```python
from fastapi import HTTPException

from routes.upload import _read_bounded


def test_read_bounded_returns_all_bytes_under_cap():
    assert _read_bounded(io.BytesIO(b"x" * 10), max_bytes=10) == b"x" * 10


def test_read_bounded_aborts_over_cap_without_full_read():
    class CountingStream:
        def __init__(self, total):
            self.remaining = total
            self.reads = 0

        def read(self, n):
            self.reads += 1
            take = min(n, self.remaining)
            self.remaining -= take
            return b"x" * take

    stream = CountingStream(total=300 * 1024 * 1024)  # pretend 300 MB body
    with pytest.raises(HTTPException) as exc:
        _read_bounded(stream, max_bytes=2 * 1024 * 1024)
    assert exc.value.status_code == 413
    # Aborted after ~3 x 1 MiB reads, not after draining 300 MB.
    assert stream.reads <= 4


def test_oversized_body_413_leaves_no_document_row(client, seeded, db_session, monkeypatch):
    monkeypatch.setattr("routes.upload.MAX_UPLOAD_BYTES", 8)
    files = {"file": ("big.pdf", io.BytesIO(b"0123456789ABCDEF"), "application/pdf")}
    r = client.post("/api/upload", data={"user_id": USER_ID, "session_id": SESSION_ID}, files=files)
    assert r.status_code == 413
    assert db_session.query(Document).count() == 0


def test_storage_write_failure_marks_failed_and_507(client, seeded, db_session, monkeypatch):
    class FailingStore:
        def put(self, key, data):
            raise OSError("disk full")

    monkeypatch.setattr("routes.upload.object_store.get_store", lambda: FailingStore())
    files = {"file": ("notes.pdf", io.BytesIO(b"%PDF-fake"), "application/pdf")}
    r = client.post("/api/upload", data={"user_id": USER_ID, "session_id": SESSION_ID}, files=files)
    assert r.status_code == 507
    assert r.json()["detail"]["code"] == "STORAGE_WRITE_FAILED"
    doc = db_session.query(Document).one()
    assert doc.status == "failed"
    assert doc.error is not None


def test_upload_writes_through_object_store(client, seeded, db_session, monkeypatch):
    class RecordingStore:
        def __init__(self):
            self.puts = []

        def put(self, key, data):
            self.puts.append((key, data))

    store = RecordingStore()
    monkeypatch.setattr("routes.upload.object_store.get_store", lambda: store)
    files = {"file": ("notes.pdf", io.BytesIO(b"%PDF-fake"), "application/pdf")}
    r = client.post("/api/upload", data={"user_id": USER_ID, "session_id": SESSION_ID}, files=files)
    assert r.status_code == 202
    doc_id = r.json()["document_id"]
    assert store.puts == [(f"{doc_id}_notes.pdf", b"%PDF-fake")]
```

Note: the existing `stub_filesystem` autouse fixture (patches `routes.upload.settings.uploads_path`) keeps working for the non-patched tests — `LocalDiskStore` reads `settings.uploads_path` lazily inside `get_store()`. It patches `routes.upload.settings` which is the same `config.settings` object `services.object_store` imports, so no fixture change is needed.

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_upload_route.py -v`
Expected: new tests FAIL — `ImportError: cannot import name '_read_bounded'`

- [ ] **Step 3: Rewrite the upload path**

In `backend/routes/upload.py`:

Replace the imports `import os` / `from config import settings` usage as follows — drop `import os` (no longer needed), and add:

```python
import logging

from services import ingestion_service, object_store, rate_limit
```

(keep the existing import line's other names; add `object_store`). Add below the router constants:

```python
log = logging.getLogger(__name__)

READ_CHUNK = 1024 * 1024  # 1 MiB


def _read_bounded(fh, max_bytes: int) -> bytes:
    """Read fh incrementally, aborting with 413 as soon as the running total
    exceeds max_bytes (F-40: the Content-Length header is client-controlled,
    so the pre-gate above is advisory only)."""
    data = bytearray()
    while True:
        chunk = fh.read(READ_CHUNK)
        if not chunk:
            return bytes(data)
        data.extend(chunk)
        if len(data) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail={"code": "FILE_TOO_LARGE", "max_bytes": max_bytes},
            )
```

Keep the rate-limit block, the advisory Content-Length gate (cheap early reject for honest clients), the extension check, the session-ownership check, and the filename sanitization exactly as they are. Then replace everything from the current `doc = Document(...)` line (88) through the `open(dest, "wb")` write (line 105) with:

```python
    data = _read_bounded(file.file, MAX_UPLOAD_BYTES)

    doc = Document(session_id=session_id, filename=safe_name, status="pending")
    db.add(doc)
    db.commit()
    db.refresh(doc)

    # F-29: a failed blob write must not strand a permanent "pending" row.
    # Mark the row failed (visible in the UI banner) and report 507.
    store = object_store.get_store()
    try:
        store.put(object_store.key_for(doc.id, doc.filename), data)
    except Exception:
        log.error(
            "upload storage write failed",
            extra={"doc_id": doc.id},
            exc_info=settings.env != "prod",
        )
        doc.status = "failed"
        doc.error = "storage write failed"
        db.commit()
        raise HTTPException(
            status_code=507,
            detail={"code": "STORAGE_WRITE_FAILED"},
        )
```

The bounded read now happens before the row is created, so the old delete-on-413 dance (`db.delete(doc)` at lines 95–96) disappears entirely.

- [ ] **Step 4: Document 507 in the API contract**

In `docs/api/openapi.yaml`, on the `/api/upload` POST operation (line ~247), alongside the existing `"413"` response add:

```yaml
        "507":
          description: Storage write failed; the document row is marked failed.
```

(Mirror the exact indentation/`$ref` style of the neighboring `"413"` entry — if `413` references a component response, add a sibling inline description; no schema change, so codegen output should be unchanged.) Then from repo root: `python backend/scripts/gen_contracts.py` and confirm `git diff backend/contracts/` is empty or trivially regenerated.

- [ ] **Step 5: Run tests to verify they pass, then the full suite**

Run from `backend/`: `pytest tests/test_upload_route.py -v` → all pass (existing 413 test now passes via the bounded read; verify no existing test asserted the deleted-row-on-413 behavior — if one did, update it to assert no row is created).
Then: `pytest` → all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/upload.py backend/tests/test_upload_route.py docs/api/openapi.yaml backend/contracts/
git commit -m "fix: bounded upload read, guarded store write with 507, store-backed blobs (F-40 F-29 F-15)"
```

---

### Task 4: Ingestion reads blobs from the store (F-15)

**Files:**
- Modify: `backend/services/ingestion_service.py`
- Test: `backend/tests/test_ingestion_service.py`

**Interfaces:**
- Consumes: `object_store.get_store()`, `key_for`, `ObjectNotFound` (Tasks 1–2).
- Produces: `_extract(blob: bytes, filename: str)` — extractors now take bytes, not a path. `_resolve_path` is deleted.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_ingestion_service.py` (reuse the file's existing document/session seeding fixtures and litellm stubs — read the file first and match its helpers):

```python
def test_missing_blob_marks_failed(db_session, monkeypatch, tmp_path, seeded_doc):
    # seeded_doc: use the file's existing fixture that creates a pending Document
    # WITHOUT writing a file to uploads_path (or point uploads_path at an empty dir).
    monkeypatch.setattr("services.ingestion_service.settings.uploads_path", str(tmp_path))
    ingestion_service.run(seeded_doc.id)
    db_session.expire_all()
    doc = db_session.get(Document, seeded_doc.id)
    assert doc.status == "failed"
    assert "not found" in (doc.error or "").lower() or doc.error


def test_extract_plaintext_from_bytes():
    assert ingestion_service._extract(b"hello world", "notes.txt") == [(None, "hello world")]


def test_legacy_bare_filename_fallback(db_session, monkeypatch, tmp_path, seeded_doc):
    # Pre-F-15 files were stored under the bare filename (no doc-id prefix).
    monkeypatch.setattr("services.ingestion_service.settings.uploads_path", str(tmp_path))
    (tmp_path / seeded_doc.filename).write_bytes(b"legacy content")
    ingestion_service.run(seeded_doc.id)
    db_session.expire_all()
    doc = db_session.get(Document, seeded_doc.id)
    assert doc.status == "ready"
```

(`test_legacy_bare_filename_fallback` needs a `.txt` filename on the seeded doc so extraction succeeds without a real PDF; adjust the fixture argument accordingly.)

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_ingestion_service.py -v`
Expected: new tests FAIL (`_extract` signature mismatch: current `_extract(path, filename)` opens a path; bytes input breaks).

- [ ] **Step 3: Rewrite blob loading and extractors**

In `backend/services/ingestion_service.py`:

Add `import io` at top; add `object_store` to the services import. Delete `_resolve_path` (lines 43–50) and replace with:

```python
def _load_blob(store: "object_store.ObjectStore", doc: Document) -> bytes:
    try:
        return store.get(object_store.key_for(doc.id, doc.filename))
    except object_store.ObjectNotFound:
        pass
    # Legacy fallback: pre-F-15 uploads were stored under the bare filename.
    # LocalDiskStore path-containment rejects traversal in doc.filename.
    try:
        return store.get(doc.filename)
    except object_store.ObjectNotFound:
        raise RuntimeError(f"uploaded file not found in object store: {doc.filename}") from None
```

Rewrite the extractors to take bytes:

```python
def _extract_pages(blob: bytes) -> list[tuple[int, str]]:
    reader = PdfReader(io.BytesIO(blob))
    return [(i + 1, (page.extract_text() or "")) for i, page in enumerate(reader.pages)]


def _extract_slides(blob: bytes) -> list[tuple[int, str]]:
    prs = Presentation(io.BytesIO(blob))
    # ... body unchanged from the current path-based version ...


def _extract_plaintext(blob: bytes) -> list[tuple[None, str]]:
    return [(None, blob.decode("utf-8", errors="replace"))]


def _extract(blob: bytes, filename: str) -> list[tuple[int | None, str]]:
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".pdf":
        return _extract_pages(blob)
    if ext == ".pptx":
        return _extract_slides(blob)
    if ext in (".txt", ".md", ".markdown"):
        return _extract_plaintext(blob)
    raise ValueError(f"unsupported file type: {ext!r}")
```

In `run()`, replace

```python
            path = _resolve_path(doc)
            pages = _extract(path, doc.filename)
```

with

```python
            blob = _load_blob(object_store.get_store(), doc)
            pages = _extract(blob, doc.filename)
```

Update the module docstring pipeline step 1 to say the blob is loaded via `services.object_store` (R2 in prod, local disk in dev), not `settings.uploads_path` directly.

- [ ] **Step 4: Run tests to verify they pass, then the full suite**

Run from `backend/`: `pytest tests/test_ingestion_service.py -v` → all pass. Existing tests that write real files to `uploads_path` keep passing because `LocalDiskStore` reads the identical `{doc_id}_{filename}` path.
Then: `pytest` → all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/services/ingestion_service.py backend/tests/test_ingestion_service.py
git commit -m "fix: ingestion loads blobs through the object store (F-15)"
```

---

### Task 5: Atomic ingest — one commit for chunks + keyword index + ready (F-27)

**Files:**
- Modify: `backend/services/pgvector_store.py:30-51` (`insert_chunks`)
- Modify: `backend/lib/keyword_index.py:51-58` (`merge_into_session`)
- Modify: `backend/services/ingestion_service.py` (`run` error path)
- Test: `backend/tests/test_ingestion_service.py`, `backend/tests/test_pgvector_retrieval.py`, `backend/tests/test_keyword_index.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `insert_chunks` and `merge_into_session` no longer commit — **the caller owns the transaction**. All existing call sites: `ingestion_service.run` (production, commits once at the end) and the tests named above (add explicit `db.commit()` after direct calls).

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_ingestion_service.py` (this test must use the REAL `insert_chunks` — do not apply the file's insert-stub fixture to it; litellm embedding stays stubbed):

```python
def test_merge_failure_leaves_no_chunks_and_marks_failed(db_session, monkeypatch, seeded_doc_with_file):
    # seeded_doc_with_file: existing fixture pattern that creates a pending doc
    # AND writes its blob under uploads_path so extraction succeeds.
    def boom(db, session_id, stems):
        raise RuntimeError("kw merge exploded")

    monkeypatch.setattr("services.ingestion_service.keyword_index.merge_into_session", boom)
    ingestion_service.run(seeded_doc_with_file.id)
    db_session.expire_all()
    doc = db_session.get(Document, seeded_doc_with_file.id)
    assert doc.status == "failed"
    assert "kw merge exploded" in doc.error
    # F-27: the chunks inserted before the failure must NOT be committed.
    from db.models import ChunkEmbedding
    assert db_session.query(ChunkEmbedding).filter_by(document_id=doc.id).count() == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run from `backend/`: `pytest tests/test_ingestion_service.py -v -k merge_failure`
Expected: FAIL — chunk count is nonzero (insert_chunks committed before the merge blew up).

- [ ] **Step 3: Remove the inner commits**

`backend/services/pgvector_store.py` — in `insert_chunks`, replace `db.commit()` with `db.flush()` and update the docstring:

```python
    """Bulk insert chunk embeddings. `rows` is `(chunk_index, page, text, embedding)`.
    Returns the number of rows inserted. Does NOT commit — the caller owns the
    transaction (F-27: ingestion commits chunks, keyword index, and status
    together, atomically)."""
```

`backend/lib/keyword_index.py` — in `merge_into_session`, delete the `db.commit()` line (the assignment to `row.kw_index_json` stays; the caller commits).

`backend/services/ingestion_service.py` — in `run()`'s `except` block, the session may hold a failed/dirty transaction, so roll back and re-fetch before writing the failure status:

```python
        except Exception as e:
            db.rollback()
            log.error(
                "ingestion failed",
                extra={"err_type": type(e).__name__, "doc_id": document_id},
                exc_info=settings.env != "prod",
            )
            doc = db.get(Document, document_id)
            if doc is not None:
                doc.status = "failed"
                doc.error = str(e)[:1000]
                db.commit()
```

(The success path already ends with exactly one `db.commit()` after `doc.status = "ready"` — that single commit now atomically covers chunks + keyword index + page_count + status. The empty-chunks early return keeps its own commit; it writes only the doc row.)

- [ ] **Step 4: Fix the direct-call tests**

- `backend/tests/test_pgvector_retrieval.py`: after each direct `pgvector_store.insert_chunks(...)` call (lines ~101, ~190), add `db.commit()` (match the local session variable name).
- `backend/tests/test_keyword_index.py::test_merge_into_session_persists_union` (line ~26): add `db_session.commit()` after the `merge_into_session` call before asserting persistence.

- [ ] **Step 5: Run tests to verify they pass, then the full suite**

Run from `backend/`: `pytest tests/test_ingestion_service.py tests/test_pgvector_retrieval.py tests/test_keyword_index.py -v` → all pass.
Then: `pytest` → all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/services/pgvector_store.py backend/lib/keyword_index.py backend/services/ingestion_service.py backend/tests/
git commit -m "fix: single-transaction ingestion; failed docs commit no chunks (F-27)"
```

---

### Task 6: Retrieval excludes non-ready documents (F-27b)

**Files:**
- Modify: `backend/services/pgvector_store.py:67-92` (`query_chunks`)
- Test: `backend/tests/test_pgvector_retrieval.py`

**Interfaces:**
- Consumes: existing `query_chunks` signature (unchanged).
- Produces: the SELECT now requires `Document.status == "ready"` on the join.

- [ ] **Step 1: Write the failing test**

SQLite cannot execute pgvector's `cosine_distance`, so prove the filter by capturing the statement and compiling it for Postgres (the same spy + dialect-compile pattern Batch 4 used for `FOR UPDATE`). Add to `backend/tests/test_pgvector_retrieval.py`:

```python
from sqlalchemy.dialects import postgresql


def test_query_chunks_filters_to_ready_documents(db, monkeypatch):
    captured = {}

    class EmptyResult:
        def all(self):
            return []

    def spy(stmt, *args, **kwargs):
        captured["stmt"] = stmt
        return EmptyResult()

    monkeypatch.setattr(db, "execute", spy)
    pgvector_store.query_chunks(db, "s1", [0.0] * 3, k=5)
    sql = str(captured["stmt"].compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": False}))
    assert "documents.status" in sql
```

(Use the file's actual db fixture name — read the file first; it may be `db` or `db_session`.)

- [ ] **Step 2: Run test to verify it fails**

Run from `backend/`: `pytest tests/test_pgvector_retrieval.py -v -k filters_to_ready`
Expected: FAIL — `"documents.status" not in sql`

- [ ] **Step 3: Add the filter**

In `query_chunks`, change the `.where(...)`:

```python
        .where(
            ChunkEmbedding.session_id == session_id,
            # F-27: never serve chunks from a doc that is not fully ingested.
            # A failed merge can leave committed chunks on a "failed" doc
            # (pre-F-27 data), and a mid-ingestion doc must not leak partials.
            Document.status == "ready",
        )
```

- [ ] **Step 4: Run tests to verify they pass, then the full suite**

Run from `backend/`: `pytest tests/test_pgvector_retrieval.py -v` → all pass.
Then: `pytest` → all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/services/pgvector_store.py backend/tests/test_pgvector_retrieval.py
git commit -m "fix: retrieval only serves chunks from ready documents (F-27)"
```

---

### Task 7: Atomic delete + ON DELETE CASCADE + store cleanup (F-28)

**Files:**
- Modify: `backend/services/pgvector_store.py:54-64` (`delete_document_chunks`)
- Modify: `backend/services/documents_service.py:89-125` (`delete_document`)
- Modify: `backend/db/models.py:132` (`ChunkEmbedding.document_id`)
- Create: `backend/db/alembic/versions/0018_chunk_embeddings_cascade.py`
- Test: `backend/tests/test_documents_service.py`

**Interfaces:**
- Consumes: `object_store.get_store()`, `key_for` (Tasks 1–2).
- Produces: `delete_document_chunks` no longer commits (caller owns the transaction). `ChunkEmbedding.document_id` FK has `ondelete="CASCADE"`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_documents_service.py` (match the file's existing seeding fixtures — it already has patterns that create a user/session/doc and patch `delete_document_chunks`; these new tests must NOT patch it):

```python
def test_delete_is_atomic_rollback_keeps_chunks(db_session, monkeypatch, seeded_doc_with_chunks):
    # seeded_doc_with_chunks: doc + real ChunkEmbedding rows (insert directly
    # via db_session.add / commit in the fixture; embedding can be [0.0]*3 on sqlite).
    from db.models import ChunkEmbedding

    original_delete = db_session.delete

    def boom(obj):
        raise RuntimeError("crash between chunk and row delete")

    monkeypatch.setattr(db_session, "delete", boom)
    with pytest.raises(RuntimeError):
        documents_service.delete_document(db_session, seeded_doc_with_chunks.id, USER_ID)
    db_session.rollback()
    # F-28: the chunk delete must not have been committed on its own.
    assert (
        db_session.query(ChunkEmbedding)
        .filter_by(document_id=seeded_doc_with_chunks.id)
        .count()
        > 0
    )


def test_delete_removes_blob_from_store(db_session, monkeypatch, seeded_doc_with_chunks):
    deleted_keys = []

    class RecordingStore:
        def delete(self, key):
            deleted_keys.append(key)

    monkeypatch.setattr(
        "services.documents_service.object_store.get_store", lambda: RecordingStore()
    )
    documents_service.delete_document(db_session, seeded_doc_with_chunks.id, USER_ID)
    assert deleted_keys == [f"{seeded_doc_with_chunks.id}_{seeded_doc_with_chunks.filename}"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_documents_service.py -v -k "atomic_rollback or removes_blob"`
Expected: FAIL — atomic test finds 0 chunks (chunk delete committed separately); store test fails on missing `object_store` attribute.

- [ ] **Step 3: Remove the inner commit and rewrite delete**

`backend/services/pgvector_store.py` — `delete_document_chunks`: delete the `db.commit()` line; docstring becomes:

```python
    """Delete all chunk embeddings for a document. Returns rows deleted.
    Does NOT commit — the caller owns the transaction (F-28: chunk delete and
    document-row delete must land atomically). The FK also carries
    ON DELETE CASCADE (migration 0018) as a schema-level backstop."""
```

`backend/services/documents_service.py` — replace the body from `pgvector_store.delete_document_chunks(db, document_id)` (line 106) to the end of the function with:

```python
    # Capture identity before the row is expired by commit.
    doc_id = doc.id
    filename = doc.filename

    # F-28: chunk delete + row delete in ONE transaction, so a crash between
    # them can no longer leave a "ready" doc with zero chunks or orphaned
    # vectors. (Migration 0018 also adds ON DELETE CASCADE as a backstop.)
    pgvector_store.delete_document_chunks(db, document_id)
    db.delete(doc)
    db.commit()

    # Best-effort blob cleanup AFTER the DB commit, so an undeletable object
    # (e.g. Windows file lock on LocalDiskStore) cannot 500 the request with
    # the DB rows already gone. Store implementations swallow absent keys;
    # guard everything else.
    try:
        object_store.get_store().delete(object_store.key_for(doc_id, Path(filename).name))
    except Exception:
        logger.warning("could not delete stored object for document %s", doc_id)
```

Add `from services import object_store, pgvector_store` to the imports (extend the existing `from services import pgvector_store` line). Keep the existing `Path` import; the old `uploads_root` containment block (lines 119–125) is deleted — `LocalDiskStore._path` now owns containment.

`backend/db/models.py` line 132:

```python
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
```

- [ ] **Step 4: Write migration 0018**

Create `backend/db/alembic/versions/0018_chunk_embeddings_cascade.py` (copy the header/`down_revision` conventions from `0017_hnsw_chunk_embeddings.py` — set `down_revision = "0017"` to match whatever identifier scheme 0017 uses):

```python
"""chunk_embeddings.document_id ON DELETE CASCADE (adversarial review F-28).

The FK was created unnamed in 0002, so Postgres assigned the default name
chunk_embeddings_document_id_fkey. The pre-upgrade live gate verifies this via
information_schema.table_constraints.
"""

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None

FK_NAME = "chunk_embeddings_document_id_fkey"


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_constraint(FK_NAME, "chunk_embeddings", type_="foreignkey")
    op.create_foreign_key(
        FK_NAME,
        "chunk_embeddings",
        "documents",
        ["document_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_constraint(FK_NAME, "chunk_embeddings", type_="foreignkey")
    op.create_foreign_key(
        FK_NAME,
        "chunk_embeddings",
        "documents",
        ["document_id"],
        ["id"],
    )
```

(Check `0017_hnsw_chunk_embeddings.py` first: mirror its dialect-guard style if it differs. If other migrations in this repo skip the dialect guard, keep it anyway — 0002 has an early-return non-Postgres path, so sqlite alembic runs must not break.)

**At execution time, dispatch the `migration-reviewer` agent on this file before the task's commit** (repo rule: proactive review for any `backend/db/alembic/versions/` change).

- [ ] **Step 5: Run tests to verify they pass, then the full suite**

Run from `backend/`: `pytest tests/test_documents_service.py tests/test_documents_route.py -v` → all pass (existing tests patch `delete_document_chunks` and are unaffected by its commit removal; any test asserting on-disk unlink behavior must be updated to the RecordingStore pattern).
Then: `pytest` → all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/services/pgvector_store.py backend/services/documents_service.py backend/db/models.py backend/db/alembic/versions/0018_chunk_embeddings_cascade.py backend/tests/test_documents_service.py
git commit -m "fix: atomic document delete + ON DELETE CASCADE + store cleanup (F-28)"
```

---

### Task 8: Startup reaper for stale pending documents (F-26)

**Files:**
- Modify: `backend/services/ingestion_service.py` (add `reap_stale_pending`)
- Modify: `backend/main.py:12-19` (lifespan)
- Test: `backend/tests/test_ingestion_service.py`

**Interfaces:**
- Consumes: `Document` model, `SessionLocal`.
- Produces: `ingestion_service.reap_stale_pending(db, *, now: datetime | None = None) -> int` — marks `pending` docs older than `REAP_PENDING_AFTER_MINUTES` as `failed`; returns the count. `main.lifespan` calls it once at startup.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_ingestion_service.py`:

```python
from datetime import datetime, timedelta, timezone


def _doc(db, session_id, status, age_minutes):
    doc = Document(
        session_id=session_id,
        filename="f.txt",
        status=status,
        created_at=datetime.now(timezone.utc) - timedelta(minutes=age_minutes),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def test_reaper_fails_stale_pending_only(db_session, seeded_session):
    stale = _doc(db_session, seeded_session.id, "pending", age_minutes=60)
    fresh = _doc(db_session, seeded_session.id, "pending", age_minutes=1)
    ready = _doc(db_session, seeded_session.id, "ready", age_minutes=60)

    count = ingestion_service.reap_stale_pending(db_session)

    assert count == 1
    db_session.expire_all()
    assert db_session.get(Document, stale.id).status == "failed"
    assert "restart" in db_session.get(Document, stale.id).error
    assert db_session.get(Document, fresh.id).status == "pending"
    assert db_session.get(Document, ready.id).status == "ready"


def test_reaper_returns_zero_when_nothing_stale(db_session, seeded_session):
    _doc(db_session, seeded_session.id, "pending", age_minutes=1)
    assert ingestion_service.reap_stale_pending(db_session) == 0
```

(Use the file's existing session-seeding fixture name; create one seeding a `SessionModel` + `User` if none is directly reusable — copy the pattern from `test_upload_route.py`'s `seeded` fixture.)

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_ingestion_service.py -v -k reaper`
Expected: FAIL — `AttributeError: module 'services.ingestion_service' has no attribute 'reap_stale_pending'`

- [ ] **Step 3: Implement the reaper**

In `backend/services/ingestion_service.py`, add imports `from datetime import datetime, timedelta, timezone` and `from sqlalchemy import select, update` (extend the existing `select` import). Add below `EMBED_BATCH`:

```python
# F-26: ingestion is an in-process BackgroundTask; a restart kills it silently
# and the Document row stays "pending" forever (the session banner spins and
# aggregate status pins to pending). At startup, fail anything still pending
# from before the restart. The age guard avoids racing a live ingestion in an
# overlapping-deploy window; genuinely fresh uploads are left alone.
REAP_PENDING_AFTER_MINUTES = 10
REAP_ERROR = "ingestion interrupted by a server restart; please re-upload"


def reap_stale_pending(db, *, now: datetime | None = None) -> int:
    """Mark stale 'pending' documents as failed. Returns how many were reaped."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=REAP_PENDING_AFTER_MINUTES)
    result = db.execute(
        update(Document)
        .where(Document.status == "pending", Document.created_at < cutoff)
        .values(status="failed", error=REAP_ERROR)
    )
    db.commit()
    count = result.rowcount or 0
    if count:
        log.warning("reaped %d stale pending document(s) at startup", count)
    return count
```

In `backend/main.py`, add `from db.database import SessionLocal, create_tables` (extend the existing import) and `from services import ingestion_service`; in `lifespan`, after `create_tables()`:

```python
    create_tables()
    db = SessionLocal()
    try:
        ingestion_service.reap_stale_pending(db)
    finally:
        db.close()
    yield
```

- [ ] **Step 4: Run tests to verify they pass, then the full suite**

Run from `backend/`: `pytest tests/test_ingestion_service.py -v` → all pass.
Then: `pytest` → all pass (watch for lifespan-sensitive route tests — the reaper on an empty test DB is a no-op, but any test asserting lifespan behavior may need the new import).

- [ ] **Step 5: Commit**

```bash
git add backend/services/ingestion_service.py backend/main.py backend/tests/test_ingestion_service.py
git commit -m "fix: startup reaper fails stale pending documents (F-26)"
```

---

### Task 9: Review-doc FIXED markers + full verification gates

**Files:**
- Modify: `docs/adversarial-review-2026-07-12.md`

**Interfaces:** none — documentation + verification only.

- [ ] **Step 1: Add FIXED markers**

In `docs/adversarial-review-2026-07-12.md`, append the marker ` — FIXED (Batch 5, fix/adversarial-batch-5, <execution date>)` to each finding heading/bold-lead, matching the exact format Batch 4 used (see the F-20..F-25 lines for the pattern):
- `### F-15 —` heading (line ~295)
- `**F-26 —` (line ~333)
- `**F-27 —` (line ~335)
- `**F-28 —` (line ~337)
- `**F-29 —` (line ~339)
- `**F-40 —` (line ~361)

For F-15, note in the marker that the fix is the R2 store (Q4) and that flipping prod to it is an owed deploy gate (`UPLOADS_STORE=r2` + bucket + secrets).

- [ ] **Step 2: Run the full verification gates**

From `backend/`: `pytest` → all green.
From `frontend/`: `npm run test:unit -- --run` → all green; `npm run lint` → clean.
From repo root: `python backend/scripts/gen_contracts.py` then `git status` → `backend/contracts/` unchanged (zero drift).
Repo-wide native Grep for leftovers: `_resolve_path` (should have zero hits outside git history), `uploads_path` (remaining hits should be only `config.py`, `object_store.py`, tests, and docs).

- [ ] **Step 3: Commit**

```bash
git add docs/adversarial-review-2026-07-12.md
git commit -m "docs: mark F-15 F-26 F-27 F-28 F-29 F-40 fixed (Batch 5)"
```

---

## Self-review notes

- **Spec coverage:** F-15 → Tasks 1–4 + 7 (store on all three touch points) + deploy config in Task 2; F-40 → Task 3; F-29 → Task 3; F-27 → Tasks 5–6 (both halves of the review's fix: atomic transaction AND ready-filter); F-28 → Task 7; F-26 → Task 8. Markers → Task 9.
- **Type consistency:** `key_for(doc_id: int, filename: str)` used identically in Tasks 3 (`routes/upload.py`), 4 (`ingestion_service`), 7 (`documents_service`). Store method set (`put`/`get`/`delete`) fixed in Task 1 and used unchanged everywhere.
- **Known execution-time checks for implementers:** exact fixture names in `test_ingestion_service.py` / `test_documents_service.py` / `test_pgvector_retrieval.py` (plan names like `seeded_doc_with_file` describe the pattern, not guaranteed existing names — read the file and reuse or add); `0017`'s `down_revision` identifier style; whether openapi.yaml's `413` upload response is inline or a `$ref` (mirror it for `507`).
