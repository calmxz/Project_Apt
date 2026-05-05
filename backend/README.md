# AdaptLearn Backend

FastAPI + SQLite + ChromaDB. Python 3.12.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate  # Windows
pip install -e .[dev]
uvicorn main:app --reload
```

## Run tests

```bash
pytest -v
```

## Run via Docker

From repo root: `docker compose up`
