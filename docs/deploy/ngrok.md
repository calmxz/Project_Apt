# Deploying AdaptLearn locally + exposing via ngrok

The Phase 5 deploy story is intentionally tiny: a production-style Docker stack
on your laptop, optionally exposed to the public internet through ngrok. No
cloud bills, no DNS, no Kubernetes.

## 1. Prerequisites

- Docker Desktop (or any Docker engine with Compose v2)
- An ngrok account + auth token (free tier is fine)
- A Google AI Studio API key (set as `GEMINI_API_KEY`)
- A Supabase project: a Postgres (with pgvector) `DATABASE_URL` plus Supabase
  Auth keys (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`). See
  `docs/db/postgres-pgvector-setup.md` and `docs/auth/supabase-setup.md`.

## 2. Configure secrets

```bash
cp .env.example .env
# edit .env: GEMINI_API_KEY, plus the Supabase DATABASE_URL / SUPABASE_URL /
# SUPABASE_SECRET_KEY (pgvector RAG and auth need a real Supabase Postgres —
# the SQLite default is local/test only).
```

`docker-compose.prod.yml` reads secrets from `.env` (repo root) via `--env-file`.

## 3. Bring the stack up

```bash
docker compose -f docker-compose.prod.yml --env-file .env up --build -d
docker compose -f docker-compose.prod.yml ps
```

Two containers should be `running` / `healthy`:

- `frontend` — nginx serving the Vite bundle on `:80` (container `:8080`), reverse-proxying `/api/*`
- `backend` — uvicorn on `:8000` (not published; only nginx talks to it)

Postgres + pgvector and Supabase Auth are Supabase-managed (external/cloud) —
there is no DB or vector-store container.

Smoke test in the browser: <http://localhost> -> onboarding kicks in.

## 4. Tunnel with ngrok

```bash
ngrok config add-authtoken <YOUR_TOKEN>
ngrok http 80
```

Copy the `https://*.ngrok-free.app` URL it prints. That's your public URL.

> Because nginx reverse-proxies `/api/*` to the backend, the SPA already uses
> a same-origin relative URL (`/api/...`) — no CORS gymnastics, no extra env
> updates required.

For a stable URL across restarts, pay-as-you-go or reserved domains:

```bash
ngrok http --domain=your-reserved.ngrok.app 80
```

## 5. Reset / teardown

```bash
docker compose -f docker-compose.prod.yml down
# keep uploaded PDFs (DB + vectors live in Supabase, not on disk):
ls data/uploads/
# nuke everything:
rm -rf data/*
```

## 6. Common gotchas

- **Healthcheck fails on backend** — check `docker compose logs backend`.
  Most often a missing or invalid `GEMINI_API_KEY`.
- **Uploads volume permissions on Linux** — `chown -R 1000:1000 data/uploads`
  before first `up` if you see write errors.
- **Daily cap demo** — set `DAILY_CAP=2` in `.env` (repo root) and restart the
  `backend` service to exercise the cap banner during the screencast.
- **ngrok rate limits on free tier** — fine for a 2-3 min walkthrough, not
  for a live demo to a class. Use a reserved domain or pay-as-you-go if it
  matters.
