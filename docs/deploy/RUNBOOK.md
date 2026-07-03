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
   - `VITE_API_BASE_URL` = the Render URL from step 3
   - `VITE_SUPABASE_URL` = your Supabase URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = your Supabase publishable key
   - `VITE_CHAT_STREAM` = `true`
5. Deploy.

## Step 5 — Record the Vercel URL

Copy the deployment URL, e.g. `https://crux.vercel.app`.

## Step 6 — Resolve CORS + CSP (chicken-egg)

1. Render → `crux-api` → Environment → set `CORS_ORIGINS` = the Vercel URL
   from step 5 → save (triggers a redeploy).
2. In `frontend/vercel.json`, replace the `CRUX_API_HOST` placeholder in the
   CSP `connect-src` with the Render host (no scheme), commit, and let Vercel
   redeploy.

## Step 7 — Live smoke (owed gate)

Against the live Vercel URL: register, confirm email, log in, send a chat
message (tutor responds), upload a PDF. Open browser devtools and confirm no
CSP violations block the app. If the CSP blocks a needed origin, widen the
relevant directive in `vercel.json` and redeploy.

## Step 8 — Uploads caveat

Render free tier disk is ephemeral: uploaded PDFs are lost on restart / cold
start (~15 min idle). DB data on Supabase is safe. WS-D (R2) is the real fix.

## Step 9 — Rollback

- Render: Deploys tab → pick a previous successful deploy → Rollback.
- Vercel: Deployments → previous deployment → Promote to Production.
