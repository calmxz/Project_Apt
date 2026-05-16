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

Optional overrides: `EMBEDDING_MODEL`, `DATABASE_URL`, `CHROMA_HOST`, `CHROMA_PORT`, `UPLOADS_PATH`.

Backend connects to ChromaDB via HTTP (`chromadb.HttpClient`). Default `CHROMA_HOST=localhost`, `CHROMA_PORT=8001` — matches the chromadb container exposed by `docker-compose.yml`.

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

Only ChromaDB runs in Docker. Frontend (`npm run dev`) and backend (`uvicorn`) run natively against it.

### Prerequisites

- Docker Desktop running (Windows/macOS) or Docker Engine + compose plugin (Linux).
- `.env` at repo root with `GEMINI_API_KEY` populated. Read directly by `config.py`.

### Start ChromaDB

From repo root:

```bash
docker compose up              # foreground
docker compose up -d           # detached
```

| Service  | Host port | Container port | Notes |
|----------|-----------|----------------|-------|
| chromadb | 8001      | 8000           | HTTP API. Backend connects via `localhost:8001`. |

Verify:

```bash
curl http://localhost:8001/api/v2/heartbeat
```

### Run backend + frontend natively

Backend (from `backend/`):

```bash
uvicorn main:app --reload
```

Frontend (from `frontend/`):

```bash
npm run dev
```

### Volumes

`./data/chroma` is bind-mounted into the chromadb container — vector data survives restarts. SQLite (`./data/app.db`) and uploaded PDFs (`./data/uploads/`) live on the host and are read directly by the native backend.

### Stop / reset

```bash
docker compose down              # stop chromadb (keeps ./data/chroma)
rm -rf data/                     # nuke local data (PowerShell: Remove-Item -Recurse -Force data)
```

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `chromadb` connection refused from backend | container not running | `docker compose up -d chromadb` |
| Port 8001 already in use | host port collision | stop the process or remap in compose (e.g. `"8002:8000"`) |
| Backend hits `data/app.db` permission error | `./data` missing or not writable | `mkdir data` at repo root |
| `GEMINI_API_KEY` empty | `.env` missing at repo root | create `.env` next to `docker-compose.yml` |

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
