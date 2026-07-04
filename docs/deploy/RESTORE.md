# Restore drill — Postgres from R2

Backups are daily `pg_dump -Fc` snapshots at `crux/pg/YYYY-MM-DD/dump.pgc` in the
R2 bucket, produced by `.github/workflows/backup.yml`. Retention: newest 7.

**Never restore straight over production. Always restore into a scratch DB first.**

## Steps

1. List available dumps (or use the R2 dashboard):
   - Set `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
   - `cd backend && python -c "from scripts.backup import R2Store; [print(o.key) for o in R2Store.from_env().list('crux/pg/')]"`
2. Download the chosen dump (R2 dashboard or `aws s3 cp --endpoint-url $R2_ENDPOINT`).
3. Restore into a scratch DB (a local Postgres 17 or a throwaway Supabase project):
   - `pg_restore --clean --if-exists -d "$TARGET_DATABASE_URL" dump.pgc`
4. Verify:
   - Row counts on key tables (users, sessions, chunk_embeddings, daily_cost_ledger).
   - A sample query returns expected data.
5. Paste the actual command output below.

## Proven restore log

_Not yet run. WS-D is not complete until the restore drill is run once and its real output is pasted here._

## Owed human gates

1. Create the R2 bucket + scoped API token; add the 5 secrets to GitHub Actions
   (`DATABASE_URL`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
   `R2_BUCKET`).
2. Trigger the workflow via `workflow_dispatch` and confirm one green run.
3. Run the restore drill above once and paste its output.
