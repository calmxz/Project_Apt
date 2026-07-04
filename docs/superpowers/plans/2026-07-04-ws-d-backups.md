# WS-D Postgres Backups to R2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automated daily `pg_dump` of Supabase Postgres to Cloudflare R2 via an S3 client behind an interface, with count-based retention and a proven restore procedure.

**Architecture:** A standalone, testable Python module (`backend/scripts/backup.py`) defines a `BackupStore` interface and an `R2Store` boto3 implementation. Pure prune logic keeps the newest N dumps. A GitHub Actions cron workflow runs `pg_dump` daily and drives the module's `upload`/`prune` CLI. Restore is a documented manual drill. Backup runs entirely outside Render; app code is untouched.

**Tech Stack:** Python 3.12, boto3 (S3 client, R2 endpoint), `pg_dump`/`pg_restore` (postgresql-client-17), GitHub Actions, pytest.

## Global Constraints

- No emojis in code or comments.
- Backup module reads config from its **own env vars**, never app `Settings`. App boot must stay decoupled from backup creds.
- R2 accessed only through the `BackupStore` interface. Swap to AWS S3 later = change `endpoint_url` + keys, same code.
- `boto3` is a **dev/backup-only** dependency — do NOT add it to `[project] dependencies` (keeps the app image lean).
- Object key scheme is exactly `crux/pg/YYYY-MM-DD/dump.pgc`.
- Retention: keep newest 7, prune older. Schedule: daily 03:00 UTC.
- No live R2 or secrets in CI. All R2 calls in tests use mocks/fakes.
- Backend suite must stay green run with `DATABASE_URL=sqlite:///./data/app.db` (CI parity, per WS-C lesson).
- Tests run from `backend/`; import as `from scripts.backup import ...`.

---

## File Structure

- Create: `backend/scripts/backup.py` — `BackupStore` Protocol, `BackupObject`, `backup_key()`, `prune()`, `R2Store`, CLI `main()`.
- Create: `backend/tests/test_backup.py` — unit tests (key scheme, prune, R2Store w/ mocked boto3, CLI dispatch).
- Modify: `backend/pyproject.toml:30-38` — add `boto3` to the `dev` extra.
- Create: `.github/workflows/backup.yml` — daily cron + manual dispatch.
- Create: `backend/tests/test_backup_workflow.py` — asserts the workflow YAML shape (schedule, steps, secrets).
- Create: `docs/deploy/RESTORE.md` — restore drill + owed human gates.

---

### Task 1: Backup interface + key scheme

**Files:**
- Create: `backend/scripts/backup.py`
- Modify: `backend/pyproject.toml:30-38`
- Test: `backend/tests/test_backup.py`

**Interfaces:**
- Produces: `BackupObject` (dataclass, field `key: str`); `BackupStore` Protocol with `put(self, key: str, path: Path) -> None`, `list(self, prefix: str) -> list[BackupObject]`, `delete(self, key: str) -> None`; `backup_key(date_str: str) -> str`.

- [ ] **Step 1: Add boto3 to the dev extra**

In `backend/pyproject.toml`, add `boto3` to the `dev` list:

```toml
dev = [
    "pytest>=8.3",
    "pytest-asyncio>=0.24",
    "httpx>=0.28.1",
    "pytest-cov>=5.0",
    "datamodel-code-generator>=0.26,<0.30",
    "openapi-spec-validator>=0.7",
    "pyyaml>=6.0",
    "boto3>=1.35,<2.0",
]
```

- [ ] **Step 2: Install the new dep**

Run: `cd backend && pip install -e .[dev]`
Expected: installs boto3 without error.

- [ ] **Step 3: Write the failing test**

Create `backend/tests/test_backup.py`:

```python
from pathlib import Path

from scripts.backup import BackupObject, backup_key


def test_backup_key_scheme():
    assert backup_key("2026-07-04") == "crux/pg/2026-07-04/dump.pgc"


def test_backup_object_holds_key():
    obj = BackupObject(key="crux/pg/2026-07-04/dump.pgc")
    assert obj.key == "crux/pg/2026-07-04/dump.pgc"
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && pytest tests/test_backup.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.backup'`.

- [ ] **Step 5: Write minimal implementation**

Create `backend/scripts/backup.py`:

```python
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && pytest tests/test_backup.py -v`
Expected: PASS (2 passed).

- [ ] **Step 7: Commit**

```bash
git add backend/scripts/backup.py backend/tests/test_backup.py backend/pyproject.toml
git commit -m "feat(backup): BackupStore interface + key scheme"
```

---

### Task 2: Count-based prune

**Files:**
- Modify: `backend/scripts/backup.py`
- Test: `backend/tests/test_backup.py`

**Interfaces:**
- Consumes: `BackupObject`, `BackupStore` (Task 1).
- Produces: `prune(store: BackupStore, prefix: str = "crux/pg/", keep: int = 7) -> list[str]` — deletes all but the newest `keep` objects (lexical sort of keys, descending, works because keys are date-prefixed); returns the list of deleted keys.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_backup.py`:

```python
from scripts.backup import prune


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_backup.py -k prune -v`
Expected: FAIL with `ImportError: cannot import name 'prune'`.

- [ ] **Step 3: Write minimal implementation**

Add to `backend/scripts/backup.py`:

```python
def prune(store: BackupStore, prefix: str = "crux/pg/", keep: int = 7) -> list[str]:
    keys = sorted((obj.key for obj in store.list(prefix)), reverse=True)
    to_delete = keys[keep:]
    for key in to_delete:
        store.delete(key)
    return to_delete
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_backup.py -k prune -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/backup.py backend/tests/test_backup.py
git commit -m "feat(backup): count-based prune keeps newest N"
```

---

### Task 3: R2Store (boto3 S3 client)

**Files:**
- Modify: `backend/scripts/backup.py`
- Test: `backend/tests/test_backup.py`

**Interfaces:**
- Consumes: `BackupObject`, `BackupStore` (Task 1).
- Produces: `R2Store(*, endpoint_url: str, access_key_id: str, secret_access_key: str, bucket: str)` implementing `put`/`list`/`delete` against boto3; `R2Store.from_env() -> R2Store` reading `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_backup.py`:

```python
from unittest import mock

from scripts.backup import R2Store


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_backup.py -k r2store -v`
Expected: FAIL with `ImportError: cannot import name 'R2Store'`.

- [ ] **Step 3: Write minimal implementation**

Add near the top of `backend/scripts/backup.py` (imports) and body:

```python
import os

import boto3
```

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_backup.py -k r2store -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/backup.py backend/tests/test_backup.py
git commit -m "feat(backup): R2Store boto3 S3 client behind interface"
```

---

### Task 4: CLI (`upload`, `prune`)

**Files:**
- Modify: `backend/scripts/backup.py`
- Test: `backend/tests/test_backup.py`

**Interfaces:**
- Consumes: `R2Store.from_env`, `prune`, `backup_key` (Tasks 1-3).
- Produces: `main(argv: list[str] | None = None) -> int` — subcommands `upload <path>` (uploads to `backup_key(today)`) and `prune [--keep N]` (default 7); builds the store via `make_store()` (default `R2Store.from_env`) so tests can inject a fake.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_backup.py`:

```python
from scripts.backup import main


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_backup.py -k main -v`
Expected: FAIL with `ImportError: cannot import name 'main'`.

- [ ] **Step 3: Write minimal implementation**

Add to `backend/scripts/backup.py` (add `import argparse` and `from datetime import date, timezone` at top; use `datetime.now(timezone.utc).date()` for the stamp):

```python
import argparse
from datetime import datetime, timezone


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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_backup.py -k main -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Run the full backup test file**

Run: `cd backend && pytest tests/test_backup.py -v`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/backup.py backend/tests/test_backup.py
git commit -m "feat(backup): upload/prune CLI entry point"
```

---

### Task 5: GitHub Actions cron workflow

**Files:**
- Create: `.github/workflows/backup.yml`
- Test: `backend/tests/test_backup_workflow.py`

**Interfaces:**
- Consumes: `scripts.backup` CLI (`upload`, `prune`).
- Produces: a scheduled workflow; no code interface.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_backup_workflow.py`:

```python
from pathlib import Path

import yaml

_WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "backup.yml"


def _load():
    return yaml.safe_load(_WORKFLOW.read_text(encoding="utf-8"))


def test_workflow_exists():
    assert _WORKFLOW.exists()


def test_workflow_runs_daily_and_manual():
    wf = _load()
    # PyYAML parses the bare `on:` key as boolean True.
    triggers = wf[True]
    assert triggers["schedule"][0]["cron"] == "0 3 * * *"
    assert "workflow_dispatch" in triggers


def test_workflow_dumps_uploads_and_prunes():
    text = _WORKFLOW.read_text(encoding="utf-8")
    assert "pg_dump" in text
    assert "postgresql-client-17" in text
    assert "scripts.backup upload" in text
    assert "scripts.backup prune" in text


def test_workflow_reads_secrets():
    text = _WORKFLOW.read_text(encoding="utf-8")
    for secret in (
        "DATABASE_URL",
        "R2_ENDPOINT",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET",
    ):
        assert f"secrets.{secret}" in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_backup_workflow.py -v`
Expected: FAIL on `test_workflow_exists` (file missing).

- [ ] **Step 3: Write the workflow**

Create `.github/workflows/backup.yml`:

```yaml
name: db-backup

on:
  schedule:
    - cron: "0 3 * * *"
  workflow_dispatch: {}

jobs:
  backup:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4

      - name: Install postgresql-client-17
        run: |
          sudo sh -c 'echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
          wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
          sudo apt-get update
          sudo apt-get install -y postgresql-client-17

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install boto3
        run: pip install "boto3>=1.35,<2.0"

      - name: Dump database
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: pg_dump "$DATABASE_URL" -Fc -f dump.pgc

      - name: Upload and prune
        env:
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
        run: |
          python -m scripts.backup upload dump.pgc
          python -m scripts.backup prune --keep 7
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_backup_workflow.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/backup.yml backend/tests/test_backup_workflow.py
git commit -m "feat(backup): daily GitHub Actions cron workflow"
```

---

### Task 6: Restore procedure doc

**Files:**
- Create: `docs/deploy/RESTORE.md`
- Test: `backend/tests/test_backup_workflow.py`

**Interfaces:**
- Consumes: nothing (documentation).
- Produces: the restore drill doc + owed human gates.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_backup_workflow.py`:

```python
_RESTORE = Path(__file__).resolve().parents[2] / "docs" / "deploy" / "RESTORE.md"


def test_restore_doc_documents_pg_restore():
    text = _RESTORE.read_text(encoding="utf-8")
    assert "pg_restore" in text
    assert "--clean" in text
    assert "scratch" in text.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_backup_workflow.py -k restore -v`
Expected: FAIL with `FileNotFoundError` (RESTORE.md missing).

- [ ] **Step 3: Write the doc**

Create `docs/deploy/RESTORE.md`:

```markdown
# Restore drill — Postgres from R2

Backups are daily `pg_dump -Fc` snapshots at `crux/pg/YYYY-MM-DD/dump.pgc` in the
R2 bucket, produced by `.github/workflows/backup.yml`. Retention: newest 7.

**Never restore straight over production. Always restore into a scratch DB first.**

## Steps

1. List available dumps (or use the R2 dashboard):
   - Set `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
   - `python -c "from scripts.backup import R2Store; [print(o.key) for o in R2Store.from_env().list('crux/pg/')]"`
2. Download the chosen dump (R2 dashboard or `aws s3 cp --endpoint-url $R2_ENDPOINT`).
3. Restore into a scratch DB (a local Postgres 17 or a throwaway Supabase project):
   - `pg_restore --clean --if-exists -d "$TARGET_DATABASE_URL" dump.pgc`
4. Verify:
   - Row counts on key tables (users, sessions, chunk_embeddings, daily_cost_ledger).
   - A sample query returns expected data.
5. Paste the actual command output below.

## Proven restore log

<!-- Owed: run the drill once and paste real output here. WS-D is not complete until this is filled. -->

## Owed human gates

1. Create the R2 bucket + scoped API token; add the 5 secrets to GitHub Actions
   (`DATABASE_URL`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
   `R2_BUCKET`).
2. Trigger the workflow via `workflow_dispatch` and confirm one green run.
3. Run the restore drill above once and paste its output.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_backup_workflow.py -k restore -v`
Expected: PASS.

- [ ] **Step 5: Run the full backend suite (CI parity)**

Run: `cd backend && DATABASE_URL=sqlite:///./data/app.db pytest`
Expected: PASS (all green, including the new backup tests).

- [ ] **Step 6: Commit**

```bash
git add docs/deploy/RESTORE.md backend/tests/test_backup_workflow.py
git commit -m "docs(backup): restore drill + owed gates"
```

---

## Self-Review notes

- **Spec coverage:** interface (T1/T3) · prune/retention (T2) · schedule+dump+upload (T5) · restore doc + gate (T6) · testing w/o live R2 (all tasks mock/fake) · boto3 as non-app dep (T1). All spec sections mapped.
- **Type consistency:** `BackupObject.key`, `BackupStore.{put,list,delete}`, `prune(store, prefix, keep)`, `R2Store.from_env`, `make_store`, `main(argv)` used consistently across tasks.
- **Owed human gates** (bucket + secrets + proven restore + first green run) captured in `RESTORE.md`, matching the design's "not done until restore run once" rule.
