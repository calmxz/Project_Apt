# Deploy Runbook — WS-C (Render + Vercel)

Manual, dashboard-side steps. Config-as-code lives in `render.yaml`,
`frontend/vercel.json`, and `backend/Dockerfile` + `backend/entrypoint.sh`.
Never commit a secret; enter secrets only in host dashboards.

## Step 0 — Pre-migration safety (do this first)

Migrations otherwise auto-run on the first container boot against live Supabase.
Run them deliberately and observed instead:

1. Confirm a Supabase restore point / backup exists (Supabase dashboard →
   Database → Backups). Do not proceed without one.
2. From `backend/` with prod `DATABASE_URL` exported locally, run
   `alembic upgrade head` and confirm it reaches the latest revision with no
   error. This also satisfies owed gate G1 (live migration 0011/0012).

## Step 1 — Prereqs

- Render account (free).
- Vercel account (Hobby) with **NO payment card on file**.

## Render Services

### Ingestion worker: deferred (2026-08-12)

There is deliberately NO `crux-worker` service. The web service drains the
ingestion queue itself in a background thread (`INGEST_IN_PROCESS`, default
on) per `docs/superpowers/specs/2026-08-12-defer-render-worker-design.md`.
This accepts the B-02 isolation revert for beta (ingestion CPU and memory
share the web instance).

Scale-out restore (real users / ingestion latency complaints / chat stutter
correlated with uploads):
1. Restore the `crux-worker` block in `render.yaml` and the `worker` service
   in both compose files from git history.
2. Set `INGEST_IN_PROCESS=false` on the crux-api web service.
3. Re-invert the two worker tests in `backend/tests/test_deploy_config.py`.

## Step 2 — Backend on Render

1. Render dashboard → New → Blueprint → connect this repo.
2. Render detects `render.yaml`. Confirm the service `crux-api`.
3. Confirm/adjust `region` to match your Supabase region.
4. When prompted for the `sync: false` env vars, paste:
   `GEMINI_API_KEY`, `DATABASE_URL` (Supabase Postgres connection string —
   the single most important value, NOT sqlite), `SUPABASE_URL`,
   `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.
   Leave `CORS_ORIGINS` blank for now (set in step 6).
5. Deploy. Wait for the build + first boot (entrypoint runs `alembic upgrade
   head`, then uvicorn on `$PORT`).
6. Verify: open `https://<api>.onrender.com/health` → expect an ok response.

## Step 3 — Record the Render URL

Copy the service URL, e.g. `https://crux-api.onrender.com`.

## Step 4 — Frontend on Vercel

1. Vercel → Add New → Project → import this repo.
2. Set **Root Directory** to `frontend/`.
3. Framework preset: Vite (auto). Build/output come from `vercel.json`.
4. Add build env vars:
   - `VITE_API_BASE_URL` = the Render URL from step 3 **with `/api` appended**,
     e.g. `https://crux-api.onrender.com/api` (the frontend does not add the
     prefix itself; without it every API call 404s)
   - `VITE_SUPABASE_URL` = your Supabase URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = your Supabase publishable key
5. Deploy.

## Step 5 — Record the Vercel URL

Copy the deployment URL, e.g. `https://crux.vercel.app`.

## Step 6 — Resolve CORS + CSP (chicken-egg)

1. Render → `crux-api` → Environment → set `CORS_ORIGINS` = the Vercel URL
   from step 5 → save (triggers a redeploy).
2. CSP is injected at build time from `VITE_API_BASE_URL` — no commit needed.
   The Vercel build reads `VITE_API_BASE_URL` (set in step 4) and derives the
   `connect-src` origin via `frontend/cspPlugin.js`, emitting a
   `<meta http-equiv="Content-Security-Policy">` tag into `dist/index.html`.
   Just verify the meta tag in the deployed page source (view-source on the
   Vercel URL) shows the correct Render host in `connect-src` after the step-4
   build completes.

## Step 7 — Live smoke (owed gate)

Against the live Vercel URL: register, confirm email, log in, send a chat
message (tutor responds), upload a PDF. Open browser devtools and confirm no
CSP violations block the app (watch for blocked `wss://` Supabase connections
too — `connect-src` currently allows `https://*.supabase.co` only, fine for
auth-only usage but would need `wss://*.supabase.co` if realtime is ever added).
If the CSP blocks a needed origin, widen the relevant directive in
`frontend/cspPlugin.js` and rebuild/redeploy (the policy is generated at
build time into `dist/index.html`, not read from `vercel.json`).

## Step 8 — Uploads caveat

Render free tier disk is ephemeral: uploaded PDFs are lost on restart / cold
start (~15 min idle). DB data on Supabase is safe. WS-D (R2) is the real fix.

## Step 9 — Rollback

- Render: Deploys tab → pick a previous successful deploy → Rollback.
- Vercel: Deployments → previous deployment → Promote to Production.

## Local development — docker compose with nginx

Rate limiting: nginx throttles `/api/` at 10 requests/second per IP (burst 20,
HTTP 429 beyond). This applies to nginx-fronted deploys only; the Render
backend has no per-request throttle -- its spend guard is the daily LLM
cost cap and rate counter.

On Render there is no nginx tier. The equivalent guard is the in-process
per-user burst limiter (`BURST_LIMIT_PER_MINUTE`, default 20 on Render, 0 =
off locally). It is process-local: keep the API at one instance and one
uvicorn worker, or move the window to Postgres before scaling out. The same
single-process assumption already applies to the in-process ingest loop and
to `alembic upgrade head` running from `entrypoint.sh` on every start.
