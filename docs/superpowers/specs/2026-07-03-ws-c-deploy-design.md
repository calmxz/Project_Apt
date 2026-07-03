# WS-C · Deploy Stack (Render + Vercel) — Design

Status: draft (brainstormed 2026-07-03)
Parent: [Phase 8 Launch umbrella](2026-07-02-phase-8-launch-design.md) §7 item C (P0, ranked #1)
Sibling workstreams: WS-B legal (done), WS-D backups/R2 (next P0)

## Goal

Make AdaptLearn publicly reachable for v1: FastAPI backend live on Render, Vue
frontend live on Vercel, both reaching the existing Supabase-managed Postgres +
Auth. Ship on default host URLs. This workstream is deploy-only.

Success = a first-time visitor can register, log in, chat with the tutor, and
upload a PDF against the live URLs, with no secret committed to git and no
surprise bill.

## Locked decisions (from umbrella + this brainstorm)

| Decision | Choice | Rationale |
|---|---|---|
| Backend host | Render web service, **free** tier | Locked by umbrella. Cold start ~30-50s after ~15 min idle — accepted for v1. |
| Frontend host | Vercel Hobby, **no payment card on file** | Locked by umbrella. No card = hard cap, no surprise bill. Hobby ToS non-commercial — revisit if monetizing. |
| DB + Auth | Supabase-managed (unchanged) | Not deployed by us. |
| Labor split | **IaC + runbook** | All config-as-code + code hardening in-repo and reviewable; user executes dashboard/account/secret steps from a runbook. Claude never touches accounts/billing and never reads `.env`. |
| Domain | **Default host URLs** (`*.onrender.com`, `*.vercel.app`) | Zero cost, zero DNS. Custom domain = trivial later follow-up. |
| Scope | **Deploy-only** — F3 persistent rate limit deferred to WS-F | Free tier = single instance, so today's in-memory rate limit is still correct. |
| Uploaded PDFs | **Accept ephemeral for v1** | Render free disk is wiped on restart. DB is safe (Supabase). PDF files are session-ephemeral until WS-D moves them to R2. Documented, not fixed here. |

## Existing baseline (verified 2026-07-03)

- `backend/Dockerfile` exists; `EXPOSE 8000`; `HEALTHCHECK` curls `/health`;
  `CMD ["uvicorn","main:app","--host","0.0.0.0","--port","8000"]` (port hardcoded).
- `backend/routes/health.py` serves `GET /health` and `GET /healthz`.
- CORS middleware active in `main.py`, origins from `settings.cors_origin_list`
  (env `cors_origins`, default `http://localhost:5173`).
- `backend/config.py` `database_url` **defaults to sqlite** — must be overridden
  in prod (models require pgvector on Postgres).
- `frontend/Dockerfile` exists but is unused by Vercel (Vercel builds via npm).
- Frontend reads exactly: `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_CHAT_STREAM`.
- `docker-compose.yml` is now a no-op anchor.

## Architecture

```
Browser
  |
  |-- https://<app>.vercel.app        Vercel Hobby: static Vue build (dist/)
  |        |                          SPA rewrite -> /index.html
  |        |  VITE_API_BASE_URL
  |        v
  |-- https://<api>.onrender.com      Render free web service: Docker (uvicorn)
  |        |                          entrypoint: alembic upgrade head -> exec uvicorn
  |        v
  +--> Supabase (Postgres 17 + pgvector, Auth)   external, unchanged
```

Frontend talks to backend over CORS; both talk to Supabase. No nginx in this
topology — uvicorn is served directly; Vercel serves static assets.

## Component 1 — Backend on Render (Docker)

### 1a. `render.yaml` Blueprint (repo root)

Infrastructure-as-code so the service is reproducible and reviewable in git.

- `services:` one `type: web`, `runtime: docker`.
- `dockerfilePath: backend/Dockerfile`, `dockerContext: backend`.
- `healthCheckPath: /health`, `plan: free`.
- `region:` **chosen to match the Supabase project region** (cross-region adds
  per-query latency on every request, not just cold start).
- `envVars:` non-secret values inline (`env=prod`, `llm_stub=false`,
  `embedding_dim=768`, model names); every secret listed with `sync: false`
  (declared here so the dashboard prompts for them, values never in git).

### 1b. Dockerfile / entrypoint hardening

Three defects block a working Render deploy today. New `backend/entrypoint.sh`:

```sh
#!/bin/sh
set -e
alembic upgrade head
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
```

- **`$PORT` bind** — Render injects `$PORT` and routes to it; the hardcoded 8000
  means the health check never passes and the service never goes live. Fixed by
  `${PORT:-8000}` (also update the Dockerfile `HEALTHCHECK` line to use `$PORT`).
- **Migrate on boot** — `alembic upgrade head` runs before the server starts.
  This is deliberately **migrate-on-every-boot** (every cold start re-runs a
  no-op `upgrade head`; idempotent, single-instance, one small DB round-trip).
  Consequence to accept: on a deploy the port stays closed until migrations
  finish, so a large migration set could trip Render's health-check window. Our
  migration set is small; acceptable. The first real migration run is handled as
  a deliberate runbook step (see Component 4), not discovered mid-deploy.
- **SIGTERM** — `exec` replaces the shell so uvicorn becomes PID 1 and receives
  Render's SIGTERM on deploy/idle, giving a graceful shutdown. Without `exec`,
  the shell holds PID 1 and swallows the signal.

Dockerfile `CMD` becomes `["./entrypoint.sh"]` (script copied in, made
executable). `alembic` must be on PATH in the image (it is a backend dep).

### 1c. Fail-fast wrong-DB guard (small, in-scope hardening)

`config.py` defaults `database_url` to sqlite. If prod env is misconfigured the
app would boot on ephemeral sqlite and could pass the shallow `/health` check
while silently running on the wrong database. Add a startup guard: when
`env == "prod"` and `database_url` starts with `sqlite`, refuse to boot with a
clear error. A few lines; prevents a silent wrong-DB launch. This is the one
runtime code change beyond the entrypoint, justified as deploy safety.

## Component 2 — Frontend on Vercel (Hobby, no card)

### 2a. `vercel.json` (in `frontend/`)

- Framework `vite`, build `npm run build`, output `dist`.
- **SPA rewrite**: `{ "source": "/(.*)", "destination": "/index.html" }` so Vue
  Router deep links / refresh don't 404.
- **Security `headers`** (in-scope, not optional): a Content-Security-Policy plus
  the standard hardening headers. This is the only home for the served HTML's CSP
  now that there is no nginx — dropping it ships the Medium finding from
  `SECURITY_REVIEW_2026-06-22`. CSP must allow Supabase + the Render API origins
  (`connect-src`) and be smoke-checked so it does not break the app.

### 2b. Project settings (dashboard, per runbook)

- Root directory = `frontend/` (monorepo).
- Build env vars (verbatim, from the frontend grep):
  `VITE_API_BASE_URL` (= Render backend URL), `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_CHAT_STREAM`.

## Component 3 — Env / secrets

Enumerated exactly in the runbook. Entered only in host dashboards; never
committed, never Read from `.env`.

**Render (backend):** `gemini_api_key` (secret), `database_url` (secret →
Supabase Postgres connection string, **the single most important value — not the
sqlite default**), `supabase_url`, `supabase_publishable_key`,
`supabase_secret_key` (secret), `cors_origins` (= Vercel URL),
`env=prod`, `llm_stub=false`, `daily_cap`, `llm_soft_cap_usd`,
`llm_hard_cap_usd`, `embedding_dim=768`, model names (defaults acceptable).

**Vercel (frontend):** the four `VITE_*` above.

## Component 4 — Runbook (`docs/deploy/RUNBOOK.md`)

Ordered steps resolving the **CORS chicken-egg** (the frontend URL is unknown
until it is deployed) and the **first-migration** risk deliberately:

0. **Pre-migration safety** — confirm a Supabase restore point / backup exists,
   then run `alembic upgrade head` against Supabase **as a deliberate, observed
   step** (verifying gate G1's live 0011/0012 migrations succeed) before any
   auto-boot depends on it. Do not let the first migration be a surprise side
   effect of the first deploy.
1. Prereqs — Render + Vercel accounts; **no card on Vercel**.
2. Render — connect repo → Blueprint auto-detected → set secret env vars →
   deploy → verify `GET /health` returns ok.
3. Record the Render URL.
4. Vercel — import repo → root directory `frontend/` → set the four `VITE_*`
   (incl. `VITE_API_BASE_URL` = Render URL) → deploy.
5. Record the Vercel URL.
6. Back to Render — set `cors_origins` = Vercel URL → redeploy (resolves the
   chicken-egg).
7. **Live smoke** — register, confirm email, log in, chat, upload a PDF against
   the live URLs. (This is owed-gate territory; the runbook is the checklist.)
8. **Uploads caveat** — note that PDFs are session-ephemeral on free tier until
   WS-D.
9. **Rollback** — how to redeploy a previous commit / roll back a bad deploy on
   each host.

## Testing strategy

Deploy is infrastructure — the real verification is the live smoke (step 7),
an owed manual gate. What is CI-testable and in-scope:

- `entrypoint.sh` sanity (migrate-then-`exec`; `$PORT` honored) — a shell check.
- `render.yaml` / `vercel.json` are valid and parse.
- The fail-fast wrong-DB guard has a unit test (`env=prod` + sqlite → raises).
- Existing `pytest` + `vitest` stay green after the Dockerfile/entrypoint/config
  changes.

## Risks

- **First-deploy migration against prod** — mitigated by runbook step 0
  (restore point + deliberate observed `upgrade head`), not left to auto-boot.
- **Silent wrong-DB** — mitigated by the fail-fast guard (Component 1c).
- **Cold start ~30-50s** — accepted, locked.
- **CORS chicken-egg** — resolved by runbook ordering (steps 4-6).
- **Ephemeral uploads** — accepted for v1; documented; WS-D is the real fix.
- **CSP regression** — avoided by putting the header block in `vercel.json`.

## Out of scope (explicit)

Custom domain; keep-alive/cold-start mitigation; F3 persistent rate limit
(→ WS-F); R2 upload/backup storage (→ WS-D); Render paid persistent disk.

## Owed gates after this workstream

- Live smoke (runbook step 7).
- G1 live migration 0011/0012 + diagnostic smoke (folded into runbook step 0).
