# Deploying AdaptLearn locally + exposing via ngrok

The Phase 5 deploy story is intentionally tiny: a production-style Docker stack
on your laptop, optionally exposed to the public internet through ngrok. No
cloud bills, no DNS, no Kubernetes.

## 1. Prerequisites

- Docker Desktop (or any Docker engine with Compose v2)
- An ngrok account + auth token (free tier is fine)
- A Google AI Studio API key (set as `GEMINI_API_KEY`)

## 2. Configure secrets

```bash
cp backend/.env.example backend/.env
# edit backend/.env, fill in GEMINI_API_KEY at minimum.
```

`docker-compose.prod.yml` reads secrets from `backend/.env` via `--env-file`.

## 3. Bring the stack up

```bash
docker compose -f docker-compose.prod.yml --env-file backend/.env up --build -d
docker compose -f docker-compose.prod.yml ps
```

Three containers should be `running` / `healthy`:

- `frontend` — nginx serving the Vite bundle on `:80`, reverse-proxying `/api/*`
- `backend` — uvicorn on `:8000` (not published; only nginx talks to it)
- `chromadb` — vector store on `:8000` internally

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
# keep persisted SQLite + Chroma + uploaded PDFs:
ls data/
# nuke everything:
rm -rf data/*
```

## 6. Common gotchas

- **Healthcheck fails on backend** — check `docker compose logs backend`.
  Most often a missing or invalid `GEMINI_API_KEY`.
- **ChromaDB volume permissions on Linux** — `chown -R 1000:1000 data/chroma`
  before first `up` if you see write errors.
- **Daily cap demo** — set `DAILY_CAP=2` in `backend/.env` and restart the
  `backend` service to exercise the cap banner during the screencast.
- **ngrok rate limits on free tier** — fine for a 2-3 min walkthrough, not
  for a live demo to a class. Use a reserved domain or pay-as-you-go if it
  matters.
