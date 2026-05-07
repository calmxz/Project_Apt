# AdaptLearn

Adaptive AI study companion. A web app that teaches a chosen topic and updates its model of the learner continuously, grounded in the user's own course material via RAG.

**Status:** Phase 1 scaffold landed. Phase 0 validation spike passed (profile differentiation confirmed across knowledge, guidance, and engagement axes).

## Stack

- **Frontend:** Vue 3 + Vite + Pinia + PrimeVue (port 5173)
- **Backend:** FastAPI + Uvicorn, Python 3.12 (port 8000)
- **Database:** SQLite (sessions, profiles, learning events)
- **Vector store:** ChromaDB 0.5.20 (port 8001 on host)
- **LLM:** Gemini 2.5 Pro via LiteLLM direct (no ADK, no Firebase)

## Documentation

Read in this order before non-trivial changes:

1. [`docs/superpowers/specs/2026-05-03-adaptlearn-v1-design.md`](docs/superpowers/specs/2026-05-03-adaptlearn-v1-design.md) — **primary source of truth.** Supersedes everything below.
2. [`docs/superpowers/plans/2026-05-03-phase-0-validation-spike.md`](docs/superpowers/plans/2026-05-03-phase-0-validation-spike.md) — Phase 0 plan (complete).
3. [`docs/AdaptLearn_Spec.md`](docs/AdaptLearn_Spec.md) — original spec, v2 reference only.
4. [`docs/AdaptLearn_DevPlan.md`](docs/AdaptLearn_DevPlan.md) — original dev plan, v2 reference only.
5. [`CLAUDE.md`](CLAUDE.md) — agent guardrails and repo conventions.

If docs conflict, the design doc wins. Surface the conflict — don't silently pick.

## Repo Layout

```
Project_Apt/
├── docs/
│   ├── superpowers/specs/      Design doc (source of truth)
│   ├── superpowers/plans/      Phase implementation plans
│   ├── AdaptLearn_Spec.md      Original spec (v2 reference)
│   └── AdaptLearn_DevPlan.md   Original dev plan (v2 reference)
├── spike/                      Phase 0 validation spike (preserved)
├── frontend/                   Vue 3 + Vite + PrimeVue + Pinia
├── backend/                    FastAPI + SQLite + ChromaDB
│   ├── main.py
│   ├── agent/                  tutor.py, prompts.py, tools.py
│   ├── routes/                 chat.py, sessions.py, upload.py, profile.py
│   ├── services/               profile, retrieval, ingestion, summary, rate_limit
│   ├── db/                     models.py, schemas.py, database.py
│   ├── lib/                    keyword_index.py, chunking.py
│   └── tests/
├── data/                       Persisted volumes (sqlite, uploads, chroma)
├── docker-compose.yml
└── .github/workflows/ci.yml    pytest + vitest (+ playwright from Phase 3)
```

## Quick Start

### Full stack (recommended)

```bash
cp .env.example .env          # add GEMINI_API_KEY
docker compose up
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000 (health: `/health`, chat: `/api/chat`)
- ChromaDB: http://localhost:8001

Stop: `docker compose down`. Volumes (`./data/`) persist between runs.

### Local development

**Backend** (from `backend/`):

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows; use source .venv/bin/activate elsewhere
pip install -e .[dev]
uvicorn main:app --reload
```

**Frontend** (from `frontend/`):

```bash
npm install
npm run dev
```

## Common Commands

| Task | Command |
|---|---|
| Start full stack | `docker compose up` |
| Stop stack | `docker compose down` |
| Backend tests | from `backend/`: `pytest` |
| Single backend test | from `backend/`: `pytest tests/test_foo.py::test_bar` |
| Frontend dev server | from `frontend/`: `npm run dev` |
| Frontend unit tests | from `frontend/`: `npm run test:unit -- --run` |
| Lint / format | from `frontend/`: `npm run lint` / `npm run format` |

## Environment

Backend reads `.env` at the repo root (mounted into the container via `env_file`):

| Var | Purpose |
|---|---|
| `GEMINI_API_KEY` | LiteLLM credential for Gemini 2.5 Pro |
| `MODEL` | LLM model id (default `gemini/gemini-2.5-pro`) |
| `DAILY_CAP` | Per-user daily request cap (rate limiter) |

Container-only overrides (set in `docker-compose.yml`): `DATABASE_URL`, `CHROMA_HOST`, `CHROMA_PORT`.

## Architecture (highlights)

One **TutorAgent** via LiteLLM direct. Three tools:

- `retrieve_chunks(session_id, query, k=5)` — ChromaDB vector search.
- `update_topic_profile(...)` — Pydantic-validated patch over the learner's topic profile.
- `record_learning_event(session_id, gap_tested, question, correct)` — logs check-questions; incorrect retest on a mastered concept demotes it server-side.

**Focus-clear guard rail:** when the agent clears `focus_target_gap` with `focus_clear_reason="tested_correct"`, the server verifies a correct `LearningEvent` was logged that turn. Cannot silently clear focus.

**Retrieval arbitration:** server-side keyword check injects `retrieval_required` into the prompt; the agent decides whether to call `retrieve_chunks`.

System prompt = immutable rules (`agent/prompts.py`) + dynamic context rebuilt per turn. Kept separate for prompt-cache reuse. See design doc §3.3 for full detail.

## Phase Plan

| Phase | Scope | Status |
|---|---|---|
| 0 | Validation spike — profile differentiation confirmed | Complete |
| 1 | Scaffold + docker + chat loop + CI baseline | Complete |
| 2 | 3 tools + mid-profile + tool-call reliability checkpoint | Next |
| 3 | Sessions + resume + onboarding + Playwright intro | Pending |
| 4 | PDF + RAG + ChromaDB + citations | Pending |
| 5 | ProfileView (read-only) + polish + deploy + screencast | Pending |

LLM reliability checkpoints — Phase 2: `update_topic_profile` ≥85%. Phase 3: `focus_target_gap` clearing ≥85%. Below threshold → 2-3 prompt iterations, then swap to `anthropic/claude-sonnet-4-6`.

**One phase at a time. No combining or jumping ahead.**

## Ground Rules

- No emojis in code or comments.
- Secrets in `.env` / `.env.local` (gitignored). Never commit keys.
- Stop and report on any failed verification step.
- Design doc (`docs/superpowers/specs/`) is source of truth.
