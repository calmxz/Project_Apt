# WS-D · Postgres Backups → Cloudflare R2 — Design

Phase 8, launch trio (P0). Child of the Phase 8 launch umbrella
(`docs/superpowers/specs/2026-07-02-phase-8-launch-design.md`). Sibling of
WS-B (legal, merged #100) and WS-C (deploy, merged #101).

## Goal

Automated daily backup of the Supabase Postgres database to Cloudflare R2, with
a proven, documented restore procedure. **Not done until one restore has been
run end-to-end** (locked umbrella rule: untested restore = false safety).

## Locked decisions (from umbrella + brainstorm 2026-07-04)

| Decision | Choice | Why |
|---|---|---|
| Scope | **Postgres only** | Uploaded PDFs excluded. Their `chunk_embeddings` live in Postgres (backed up), so RAG survives; only the source PDF is lost and users can re-upload. Render free disk is ephemeral anyway. |
| Job runtime | **GitHub Actions cron** (daily 03:00 UTC) | Free, decoupled from Render (independent failure domain — backup runs even if the app is down). |
| Store | **Cloudflare R2 free (10 GB)** via boto3 S3 client behind an interface | R2 speaks the S3 API. Migrate to AWS S3 later = drop `endpoint_url` + swap keys, same code. |
| Schedule | **Daily** | RPO <= 24h. Fine for a launching app; 10GB holds months of small dumps. |
| Retention | **Keep newest 7, prune older** | Rolling 7-day recovery window. Count-based prune. Storage stays flat. |
| Dump format | **Custom, compressed** (`pg_dump -Fc`) | Compressed, restored with `pg_restore`, selective if needed. |
| Encryption | **R2 server-side-at-rest only for v1** | gpg client-side encryption deferred (see Out of scope). Dump holds PII — hardening follow-up noted. |

## Architecture / data flow

```
GitHub Actions cron (.github/workflows/backup.yml, daily 03:00 UTC)
  job: backup
    1. checkout + setup Python
    2. apt install postgresql-client-17         # version-match Supabase pg17
    3. pip install boto3 (backup dep)
    4. pg_dump "$DATABASE_URL" -Fc -f dump.pgc   # read-only copy, custom fmt
    5. python -m scripts.backup upload dump.pgc  # BackupStore.put()
    6. python -m scripts.backup prune --keep 7   # BackupStore.list() + delete()
  secrets (GH Actions): DATABASE_URL, R2_ENDPOINT, R2_ACCESS_KEY_ID,
                        R2_SECRET_ACCESS_KEY, R2_BUCKET
```

The backup runs **entirely outside Render**. App code never touches R2; app boot
is unaffected. `pg_dump` only reads the live DB — never writes or deletes it.
Live user data is never at risk from the backup job; prune only deletes old
**copies** in R2.

## Components

### `backend/scripts/backup.py` — the interface + CLI

- `class BackupStore(Protocol)` — `put(key: str, path: Path) -> None`,
  `list(prefix: str) -> list[BackupObject]`, `delete(key: str) -> None`.
- `class R2Store(BackupStore)` — wraps
  `boto3.client("s3", endpoint_url=..., aws_access_key_id=..., ...)`. Because R2
  speaks S3, swapping to AWS S3 later = drop `endpoint_url` + swap keys, **same
  client code**.
- CLI entry points: `upload <path>`, `prune --keep N`.
- Config read from **the script's own env vars**, NOT app `Settings` — keeps the
  app decoupled from backup creds (the web service never uploads backups).
- Object key scheme: `crux/pg/YYYY-MM-DD/dump.pgc`. Date-prefixed so a lexical
  sort of `list()` orders by age — prune keeps the newest N keys.
- `boto3` added to `pyproject.toml` (backup use only).

### Prune logic

Given `list("crux/pg/")` → sort keys descending → keep the first `N` → `delete()`
the rest. Pure function over the store; testable against a fake in-memory store.

### `.github/workflows/backup.yml`

Scheduled workflow (`on.schedule.cron: "0 3 * * *"` + `workflow_dispatch` for
manual trigger). Steps mirror the data-flow block above. Secrets pulled from
repo Actions secrets — never printed.

### `docs/deploy/RESTORE.md` — the safety gate

1. Pick a dump (`python -m scripts.backup list` or R2 dashboard).
2. Download it.
3. `pg_restore --clean --if-exists -d "$TARGET_DATABASE_URL" dump.pgc` into a
   **scratch DB** (local or a throwaway Supabase project) — never straight over
   prod.
4. Verify: row counts on key tables + a sample query.
5. Paste the actual command output into the doc. **WS-D is not complete until
   this drill has been run once for real.**

## Testing

- **Unit** (`backend/tests/test_backup.py`):
  - prune keeps newest N, deletes older, no-op when <= N exist.
  - key-scheme builder produces `crux/pg/<date>/dump.pgc`.
  - `R2Store` calls boto3 with the right endpoint/bucket/key (boto3 mocked).
  - prune logic exercised against a fake in-memory `BackupStore`.
- **No live R2 in CI** — no secrets exposed to PRs. Live `put`/`list`/`delete`
  verified once manually, plus the restore drill.
- Full backend suite stays green (run with `DATABASE_URL=sqlite:///./data/app.db`
  for CI parity per WS-C lesson).

## Out of scope (YAGNI)

- Uploaded PDFs (Postgres-only decided).
- Client-side gpg encryption — R2 encrypts at rest; revisit if compliance
  demands. Hardening follow-up.
- Point-in-time / WAL archiving.
- GFS tiered retention (7 daily is enough for v1 launch).
- Backup monitoring/alerting beyond GH Actions' built-in failed-run email.

## Owed (human gates, not automatable by SDD)

1. Create the R2 bucket + API token; add the 5 secrets to GH Actions.
2. Run the restore drill once, paste output into `RESTORE.md`.
3. Confirm the first scheduled run succeeds (or trigger via `workflow_dispatch`).
