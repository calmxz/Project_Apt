# AdaptLearn Backend

FastAPI + SQLite + ChromaDB. Python 3.12+.

## Setup

From `backend/`:

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS/Linux
pip install -e .[dev]
```

## Environment

Create `.env` at the **repo root** (not `backend/`):

```
GEMINI_API_KEY=your-key-here
MODEL=gemini/gemini-2.5-pro
DAILY_CAP=50
```

Optional overrides: `EMBEDDING_MODEL`, `DATABASE_URL`, `CHROMA_PATH`, `UPLOADS_PATH`.

Paths in `config.py` are anchored to the repo root, so the server runs correctly from any working directory. `data/app.db`, `data/chroma/`, `data/uploads/` are auto-created on first boot.

## Run

From `backend/`:

```bash
uvicorn main:app --reload
```

From repo root:

```bash
uvicorn main:app --reload --app-dir backend
```

Server: `http://127.0.0.1:8000`. Health check: `GET /health`.

## Tests

From `backend/`:

```bash
pytest -v
pytest tests/test_foo.py::test_bar   # single test
```

Tests use in-memory SQLite — no filesystem dependency.

## Docker

Run the full stack (frontend + backend + chromadb) from repo root.

### Prerequisites

- Docker Desktop running (Windows/macOS) or Docker Engine + compose plugin (Linux).
- `.env` at repo root with `GEMINI_API_KEY` populated. Compose reads it via `env_file: .env`.

### Start

From repo root:

```bash
docker compose up              # foreground, logs in terminal
docker compose up -d           # detached
docker compose up backend      # backend + chromadb only (skip frontend)
docker compose up --build      # rebuild images after Dockerfile or deps change
```

Services:

| Service  | Host port | Container port | Notes |
|----------|-----------|----------------|-------|
| frontend | 5173      | 5173           | Vite dev server |
| backend  | 8000      | 8000           | FastAPI / Uvicorn |
| chromadb | 8001      | 8000           | Mapped off 8000 to avoid backend collision |

Verify backend:

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

### Volumes

`./data` (repo root) is bind-mounted to `/data` in the backend container. SQLite DB, uploaded PDFs, and Chroma persistence all live there — survives container restarts.

| Host                 | Container        | Contents |
|----------------------|------------------|----------|
| `./data/app.db`      | `/data/app.db`   | SQLite database |
| `./data/uploads/`    | `/data/uploads/` | Uploaded PDFs |
| `./data/chroma/`     | `/chroma/chroma` | Chroma persistence (mounted into chromadb container) |

### Env overrides in compose

`docker-compose.yml` sets two backend env vars that override `config.py` defaults:

- `DATABASE_URL=sqlite:////data/app.db` — absolute path inside container.
- `CHROMA_HOST=chromadb`, `CHROMA_PORT=8000` — point backend at the chromadb service over the internal network.

Add more via `env_file: .env` or an `environment:` block.

### Logs

```bash
docker compose logs -f backend
docker compose logs -f --tail=100 backend chromadb
```

### Shell into backend

```bash
docker compose exec backend bash
docker compose exec backend pytest -v        # run tests inside container
```

### Rebuild after dependency change

```bash
docker compose build backend
docker compose up -d backend
```

Or force a fresh build ignoring cache:

```bash
docker compose build --no-cache backend
```

### Stop / reset

```bash
docker compose down              # stop + remove containers (keeps volumes/data)
docker compose down -v           # also wipe named volumes (won't touch bind mount ./data)
rm -rf data/                     # nuke local data (PowerShell: Remove-Item -Recurse -Force data)
```

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Backend exits with `unable to open database file` | `./data` missing or not writable | `mkdir data` at repo root before `docker compose up` |
| `GEMINI_API_KEY` empty in container | `.env` missing at repo root | create `.env` next to `docker-compose.yml` |
| `chromadb` connection refused | backend started before chromadb healthy | re-run; `depends_on` doesn't wait for readiness, only start |
| Port 8000/5173/8001 already in use | host port collision | stop the local process or remap in compose (e.g. `"8002:8000"`) |

## Contracts

Pydantic models in `contracts/` are generated from `docs/api/openapi.yaml`. Edit the YAML, then regenerate:

```bash
python backend/scripts/gen_contracts.py
```

CI fails on drift.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ModuleNotFoundError: fastapi` | venv not active | activate `.venv` or call `.venv\Scripts\python.exe -m uvicorn ...` directly |
| `sqlite3.OperationalError: unable to open database file` | stale `config.py` with cwd-relative paths | pull latest; paths now anchored to repo root |
| `GEMINI_API_KEY` empty at runtime | `.env` missing or in `backend/` | move `.env` to repo root |
