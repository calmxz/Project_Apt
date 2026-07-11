# Roadmap Slice 7 Implementation Plan — S3 + P4 + D2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship S3 (JWKS fail-fast + security doc sync), P4 (HNSW vector index, wider keyword gate, incremental stream render), and D2 (explicit temperatures, semantic retrieval fallback) as one PR to dev.

**Architecture:** Backend changes are small point fixes across config, auth startup, keyword index, one Alembic migration, and a new deterministic fallback function in retrieval_service wired into the chat route's gate. Frontend adds an incremental variant of `splitSafePrefix` plus a rAF delta batcher feeding the existing store append.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic + pgvector (backend, sqlite CI parity), litellm (LLM + embeddings), Vue 3 + Pinia + vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-07-11-roadmap-slice7-design.md` (read it first; the spec records the live EXPLAIN evidence and all locked decisions).

## Global Constraints

- Branch `feat/roadmap-slice7` (exists, off dev `85fa736`). Commit per task, conventional commits, no emojis anywhere.
- NO OpenAPI/contract changes in this slice. `python backend/scripts/gen_contracts.py` must produce zero diff; any contract drift is a defect.
- Backend tests run on sqlite CI parity: every Postgres-only surface (migration 0017, centroid AVG) must be dialect-guarded and the full suite green on sqlite.
- Baselines before this slice: backend 588 pass / 5 skip; frontend 586 pass / 66 files. Only additions allowed; zero regressions.
- Never edit `backend/contracts/*` by hand (codegen output). Never Read `.env`.
- Known gotcha: `npm run lint` (oxlint --fix) sometimes auto-edits `frontend/src/lib/apiClient.js` — revert any stray edit before committing.
- Known gotcha: use the native Grep tool for repo sweeps (rtk-rg can false-zero).
- Backend commands run from `backend/`, frontend from `frontend/`.
- Temperatures locked by spec: tutor 0.3, summary 0.0. Fallback threshold default locked: 0.75.

---

### Task 1: Explicit LLM temperatures (D2.1)

**Files:**
- Modify: `backend/config.py` (Settings class, after `llm_hard_cap_usd`)
- Modify: `backend/agent/tutor.py:136` (the single `litellm.acompletion` call)
- Modify: `backend/services/summary_service.py:58` and `:142` (both `litellm.acompletion` calls)
- Create: `backend/tests/test_llm_temperature.py`

**Interfaces:**
- Produces: `settings.llm_temperature: float = 0.3`, `settings.summary_temperature: float = 0.0` — Task 5 relies on the same Settings-extension pattern.

- [ ] **Step 1: Read the existing test scaffolding**

Read `backend/tests/test_tutor_stream.py` lines 1-140 (module docstring, chunk builders `_content_chunk` / `_make_stream` / `_ctx`, and the first plain-content test) and `backend/tests/test_summary_service.py` in full. The new tests reuse those exact patterns; if a helper signature differs from the sketches below, follow the repo file.

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_llm_temperature.py`:

```python
"""D2.1: explicit temperature on every LLM call, config-driven."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from config import settings


def test_temperature_defaults():
    assert settings.llm_temperature == 0.3
    assert settings.summary_temperature == 0.0


def _content_chunk(token):
    delta = SimpleNamespace(content=token, tool_calls=None)
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta)])


def _make_stream(*chunks):
    async def _gen():
        for c in chunks:
            yield c
    return _gen()


@pytest.mark.anyio
async def test_tutor_acompletion_gets_llm_temperature(db_session, monkeypatch):
    # Mirror the setup of the first plain-content test in
    # backend/tests/test_tutor_stream.py (ToolContext construction, session
    # seeding, event draining) — only the assertion below is new.
    from agent import tutor

    mock = AsyncMock(side_effect=[_make_stream(_content_chunk("hi"))])
    monkeypatch.setattr("agent.tutor.litellm.acompletion", mock)
    # ... drive tutor.run_streaming exactly as test_tutor_stream.py does ...
    assert mock.call_args.kwargs["temperature"] == settings.llm_temperature


@pytest.mark.anyio
async def test_summary_acompletion_gets_summary_temperature(db_session, monkeypatch):
    # Mirror backend/tests/test_summary_service.py's fake_acompletion test
    # (session + messages seeding, generate_and_persist call), capturing
    # kwargs on the fake.
    captured = {}

    async def fake_acompletion(**kwargs):
        captured.update(kwargs)
        msg = SimpleNamespace(content="a summary")
        return SimpleNamespace(choices=[SimpleNamespace(message=msg)])

    monkeypatch.setattr(
        "services.summary_service.litellm.acompletion", fake_acompletion
    )
    # ... invoke the summary path exactly as test_summary_service.py does ...
    assert captured["temperature"] == settings.summary_temperature
```

The `# ... drive ... exactly as <file> does ...` lines mean: copy the minimal working invocation from the named existing test into this file (imports included). Both existing files already construct everything needed (db fixtures, ToolContext, session rows). Cover the rolling-summary call site (`summary_service.py:142`) with a third test reusing the pattern in `backend/tests/test_rolling_summary.py` if that file drives the rolling path more directly.

- [ ] **Step 3: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_llm_temperature.py -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'llm_temperature'`, then after config exists, `KeyError: 'temperature'` on the call assertions.

- [ ] **Step 4: Implement**

`backend/config.py`, inside `Settings`, after `llm_hard_cap_usd: float = 3.00`:

```python
    llm_temperature: float = 0.3
    summary_temperature: float = 0.0
```

`backend/agent/tutor.py:136` — add one kwarg:

```python
            resp = await litellm.acompletion(
                model=settings.model,
                temperature=settings.llm_temperature,
                messages=full,
                tools=tools.TOOLS,
                tool_choice="auto",
                stream=True,
            )
```

`backend/services/summary_service.py:58` and `:142` — add `temperature=settings.summary_temperature,` immediately after `model=settings.model,` in both calls.

- [ ] **Step 5: Run tests to verify they pass**

Run from `backend/`: `pytest tests/test_llm_temperature.py -v`
Expected: PASS (all tests).

- [ ] **Step 6: Run the neighboring suites (temperature kwarg must not break existing mocks)**

Run from `backend/`: `pytest tests/test_tutor_stream.py tests/test_tutor_loop.py tests/test_summary_service.py tests/test_rolling_summary.py -q`
Expected: PASS. (Existing fakes accept `**kwargs` or are AsyncMocks; if one uses a positional-only signature, extend that fake's signature — do not remove the new kwarg.)

- [ ] **Step 7: Commit**

```bash
git add backend/config.py backend/agent/tutor.py backend/services/summary_service.py backend/tests/test_llm_temperature.py
git commit -m "feat: explicit config-driven temperature on all LLM calls (D2.1)"
```

---

### Task 2: JWKS fail-fast at startup (S3.2)

**Files:**
- Modify: `backend/services/auth.py` (new function after `_get_jwks_client`)
- Modify: `backend/main.py` (lifespan)
- Create: `backend/tests/test_startup_jwks.py`

**Interfaces:**
- Produces: `services.auth.validate_jwks_startup() -> None` — raises `RuntimeError` on failure; no-op when auth disabled. Task 9 cites this change's commit SHA in the security doc.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_startup_jwks.py`:

```python
"""S3.2: empty/unresolvable JWKS must kill startup, not 500 per request."""

import pytest
from fastapi.testclient import TestClient

import main
from config import settings
from services import auth


@pytest.fixture(autouse=True)
def _reset_jwks_cache():
    auth._JWKS_CACHE["client"] = None
    auth._JWKS_CACHE["fetched_at"] = 0.0
    yield
    auth._JWKS_CACHE["client"] = None
    auth._JWKS_CACHE["fetched_at"] = 0.0


def test_startup_boots_when_auth_disabled():
    # Default test env: no supabase_url, no override -> auth disabled.
    assert settings.supabase_jwks_url == ""
    with TestClient(main.app) as client:
        assert client.get("/health").status_code == 200


def test_startup_fails_on_unreachable_jwks(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "https://proj.supabase.co")

    def boom(self):
        raise Exception("dns failure")

    monkeypatch.setattr(auth.PyJWKClient, "get_jwk_set", boom)
    with pytest.raises(RuntimeError, match="JWKS"):
        with TestClient(main.app):
            pass


def test_startup_warms_jwks_cache(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "https://proj.supabase.co")
    monkeypatch.setattr(auth.PyJWKClient, "get_jwk_set", lambda self: object())
    with TestClient(main.app):
        assert auth._JWKS_CACHE["client"] is not None
        assert auth._JWKS_CACHE["fetched_at"] > 0.0
```

Note: if `/health` is mounted at a different path, check `backend/routes/health.py` and use that path; the assertion only needs any 200.

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_startup_jwks.py -v`
Expected: `test_startup_boots_when_auth_disabled` PASSES already; the other two FAIL (`AttributeError: module 'services.auth' has no attribute 'validate_jwks_startup'` is fine at import-time of main once wired, or the RuntimeError never raised).

- [ ] **Step 3: Implement**

`backend/services/auth.py` — add after `_get_jwks_client`:

```python
def validate_jwks_startup() -> None:
    """Fail fast at boot when auth is configured but JWKS is unusable (S3.2).

    Auth is enabled iff `settings.supabase_jwks_url` is non-empty. A fetch
    failure here means every authenticated request would 500; dying at
    startup surfaces the misconfiguration immediately. On success the
    fetched client warms the per-process cache.
    """
    if not settings.supabase_jwks_url:
        return
    client = PyJWKClient(settings.supabase_jwks_url)
    try:
        client.get_jwk_set()
    except Exception as e:
        raise RuntimeError(
            f"JWKS fetch failed at startup ({settings.supabase_jwks_url}): {e}"
        ) from e
    _JWKS_CACHE["client"] = client
    _JWKS_CACHE["fetched_at"] = time.time()
```

`backend/main.py` — in `lifespan`, after the existing prod supabase_url check and before `create_tables()`:

```python
    validate_jwks_startup()
```

with the import added to the existing import block:

```python
from services.auth import validate_jwks_startup
```

- [ ] **Step 4: Run tests to verify they pass**

Run from `backend/`: `pytest tests/test_startup_jwks.py tests/test_auth_dependency.py -v`
Expected: PASS. (test_auth_dependency must stay green — per-request behavior is unchanged.)

- [ ] **Step 5: Commit**

```bash
git add backend/services/auth.py backend/main.py backend/tests/test_startup_jwks.py
git commit -m "feat: JWKS fail-fast at startup when auth is enabled (S3.2)"
```

---

### Task 3: Keyword gate false-negative softening (P4.2)

**Files:**
- Modify: `backend/lib/keyword_index.py` (`_TOKEN_RE`, `STOPWORDS`, `build_from_text`)
- Modify: `backend/tests/test_keyword_index.py` (append tests)

**Interfaces:**
- Produces: `build_from_text` / `match_required` signatures unchanged; only token admission widens.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_keyword_index.py`:

```python
def test_acronym_and_digit_tokens_indexed():
    stems = keyword_index.build_from_text(
        "DNA replication, IPv4 subnetting, and 3NF normalization"
    )
    assert "dna" in stems
    assert "ipv4" in stems
    assert "3nf" in stems


def test_two_char_letter_tokens_indexed():
    stems = keyword_index.build_from_text("ML pipelines")
    assert "ml" in stems


def test_pure_digit_tokens_dropped():
    stems = keyword_index.build_from_text("chapter 42 written in 2026")
    assert "42" not in stems
    assert "2026" not in stems


def test_short_stopwords_not_indexed():
    stems = keyword_index.build_from_text("of it to in on at be we by no")
    assert stems == set()


def test_short_stopword_query_does_not_flip_gate():
    index = keyword_index.build_from_text("Database indexes accelerate queries")
    assert keyword_index.match_required("tell me about it", index) is False


def test_digit_query_flips_gate():
    index = keyword_index.build_from_text("IPv4 addressing and subnets")
    assert keyword_index.match_required("explain ipv4 to me", index) is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_keyword_index.py -v`
Expected: the new acronym/digit/2-char tests FAIL (tokens dropped by the old regex); existing tests PASS.

- [ ] **Step 3: Implement**

`backend/lib/keyword_index.py`:

Replace the `_TOKEN_RE` line with:

```python
# P4.2: admit digit-bearing and 2-char tokens (ipv4, 3nf, ai, ml); pure-digit
# tokens carry no topical signal and are dropped in build_from_text.
_TOKEN_RE = re.compile(r"[a-z0-9]{2,}")
_HAS_LETTER_RE = re.compile(r"[a-z]")
```

Extend `STOPWORDS` — inside the existing triple-quoted split string, add one line before the closing quotes:

```
    of to in is it on at be as or an do if my up so no we he by am us me
```

Update `build_from_text`:

```python
def build_from_text(text: str) -> set[str]:
    if not text:
        return set()
    tokens = [
        t
        for t in _TOKEN_RE.findall(text.lower())
        if _HAS_LETTER_RE.search(t) and t not in STOPWORDS
    ]
    return set(STEMMER.stemWords(tokens))
```

Update the module docstring's first paragraph to match: "token boundary on non-alphanumerics -> drop pure-digit tokens, stopwords, and tokens shorter than 2".

- [ ] **Step 4: Run tests to verify they pass**

Run from `backend/`: `pytest tests/test_keyword_index.py -v`
Expected: PASS, including all pre-existing tests. If a stemmer output surprises (e.g. `stemWords(["ipv4"])` altering the token), adjust the ASSERTION to the actual stem only if the gate still matches the same query — the behavior under test is gate-flipping, not stem spelling.

- [ ] **Step 5: Run the gate's consumers**

Run from `backend/`: `pytest tests/test_chat.py tests/test_chat_stream_route.py -q`
Expected: PASS (chat routes consume `match_required`; wider admission must not break fixtures).

- [ ] **Step 6: Commit**

```bash
git add backend/lib/keyword_index.py backend/tests/test_keyword_index.py
git commit -m "feat: keyword gate admits acronym/digit tokens, extends stopwords (P4.2)"
```

---

### Task 4: Migration 0017 — ivfflat to HNSW (P4.1)

**Files:**
- Create: `backend/db/alembic/versions/0017_hnsw_chunk_embeddings.py`

**Interfaces:**
- Produces: alembic head `0017_hnsw_chunk_embeddings`. No model or query changes — `pgvector_store.query_chunks` is index-agnostic.

- [ ] **Step 1: Write the migration**

Create `backend/db/alembic/versions/0017_hnsw_chunk_embeddings.py`:

```python
"""hnsw index for chunk_embeddings

Revision ID: 0017_hnsw_chunk_embeddings
Revises: 0016_session_rolling_summary
Create Date: 2026-07-11

P4.1: replaces the ivfflat cosine index with HNSW. Measured live 2026-07-11
(spec 2026-07-11-roadmap-slice7-design.md): ivfflat with lists=100 and
default probes=1 returned 3 of a session's 5 chunks — silent recall loss at
small N because most lists are empty. HNSW (m=16, ef_construction=64,
default ef_search=40) gives exact-equivalent recall at this scale and has no
lists-training problem. Postgres-only — no-op on SQLite so pytest fixtures
keep working.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0017_hnsw_chunk_embeddings"
down_revision: Union[str, None] = "0016_session_rolling_summary"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("DROP INDEX IF EXISTS ix_chunk_embeddings_embedding")
    op.execute(
        "CREATE INDEX ix_chunk_embeddings_embedding "
        "ON chunk_embeddings USING hnsw (embedding vector_cosine_ops) "
        "WITH (m = 16, ef_construction = 64)"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("DROP INDEX IF EXISTS ix_chunk_embeddings_embedding")
    op.execute(
        "CREATE INDEX ix_chunk_embeddings_embedding "
        "ON chunk_embeddings USING ivfflat (embedding vector_cosine_ops) "
        "WITH (lists = 100)"
    )
```

Before committing, open `backend/db/alembic/versions/0016_session_rolling_summary.py` and confirm its `revision` string is exactly `"0016_session_rolling_summary"` (verified 2026-07-11); if it differs, match `down_revision` to the actual value.

- [ ] **Step 2: Verify the chain resolves and sqlite path is a no-op**

Run from `backend/`: `alembic heads`
Expected: single head `0017_hnsw_chunk_embeddings`.

Run from `backend/`: `pytest tests/test_pgvector_retrieval.py -q`
Expected: PASS (sqlite parity untouched).

- [ ] **Step 3: Commit**

```bash
git add backend/db/alembic/versions/0017_hnsw_chunk_embeddings.py
git commit -m "feat: migrate chunk_embeddings index ivfflat -> hnsw (P4.1)"
```

**Controller note (SDD):** dispatch the `migration-reviewer` agent on this file after the task's review passes; its verdict gates the PR.

---

### Task 5: Semantic fallback function (D2.2, backend service)

**Files:**
- Modify: `backend/config.py` (one new setting)
- Modify: `backend/services/retrieval_service.py` (two private helpers + one public function)
- Modify: `backend/tests/test_retrieval_service.py` (append tests)

**Interfaces:**
- Consumes: `settings.embedding_model`, `settings.embedding_dim`, `settings.llm_stub_enabled` (existing); `documents_service.has_ready_document(db, session_id) -> bool` (existing).
- Produces: `retrieval_service.semantic_fallback_required(db: Session, session_id: str, query: str) -> bool` — Task 6 wires this into the chat route. `settings.retrieval_fallback_threshold: float = 0.75`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_retrieval_service.py` (reuse that file's existing fixtures for db/session/document seeding — read the file first):

```python
# --- D2.2 semantic fallback ---------------------------------------------


@pytest.fixture(autouse=True)
def _stub_off(monkeypatch):
    # settings loads .env; a developer's gemini_api_key=test would flip
    # llm_stub_enabled and short-circuit the fallback. Pin it off for this
    # module (the stub-mode test re-enables it explicitly).
    from config import settings

    monkeypatch.setattr(settings, "llm_stub", False)
    monkeypatch.setattr(settings, "gemini_api_key", "")


def _fake_embedding_resp(vec):
    from types import SimpleNamespace

    return SimpleNamespace(data=[{"embedding": vec}])


def test_semantic_fallback_true_above_threshold(db_session, monkeypatch):
    monkeypatch.setattr(
        "services.retrieval_service.documents_service.has_ready_document",
        lambda db, sid: True,
    )
    monkeypatch.setattr(
        "services.retrieval_service._session_centroid",
        lambda db, sid: [1.0, 0.0, 0.0],
    )
    monkeypatch.setattr(
        "services.retrieval_service.litellm.embedding",
        lambda **kw: _fake_embedding_resp([1.0, 0.0, 0.0]),  # sim = 1.0
    )
    assert retrieval_service.semantic_fallback_required(db_session, "s1", "q") is True


def test_semantic_fallback_false_below_threshold(db_session, monkeypatch):
    monkeypatch.setattr(
        "services.retrieval_service.documents_service.has_ready_document",
        lambda db, sid: True,
    )
    monkeypatch.setattr(
        "services.retrieval_service._session_centroid",
        lambda db, sid: [1.0, 0.0, 0.0],
    )
    monkeypatch.setattr(
        "services.retrieval_service.litellm.embedding",
        lambda **kw: _fake_embedding_resp([0.0, 1.0, 0.0]),  # sim = 0.0
    )
    assert retrieval_service.semantic_fallback_required(db_session, "s1", "q") is False


def test_semantic_fallback_false_without_ready_docs(db_session, monkeypatch):
    monkeypatch.setattr(
        "services.retrieval_service.documents_service.has_ready_document",
        lambda db, sid: False,
    )
    assert retrieval_service.semantic_fallback_required(db_session, "s1", "q") is False


def test_semantic_fallback_false_on_sqlite_centroid_guard(db_session, monkeypatch):
    # Real _session_centroid on the sqlite test db must return None.
    monkeypatch.setattr(
        "services.retrieval_service.documents_service.has_ready_document",
        lambda db, sid: True,
    )
    assert retrieval_service._session_centroid(db_session, "s1") is None
    assert retrieval_service.semantic_fallback_required(db_session, "s1", "q") is False


def test_semantic_fallback_false_on_embedding_error(db_session, monkeypatch):
    monkeypatch.setattr(
        "services.retrieval_service.documents_service.has_ready_document",
        lambda db, sid: True,
    )
    monkeypatch.setattr(
        "services.retrieval_service._session_centroid",
        lambda db, sid: [1.0, 0.0, 0.0],
    )

    def boom(**kw):
        raise RuntimeError("embedding down")

    monkeypatch.setattr("services.retrieval_service.litellm.embedding", boom)
    assert retrieval_service.semantic_fallback_required(db_session, "s1", "q") is False


def test_semantic_fallback_false_in_stub_mode(db_session, monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "llm_stub", True)
    assert retrieval_service.semantic_fallback_required(db_session, "s1", "q") is False


def test_cosine_similarity_basics():
    assert retrieval_service._cosine_similarity([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)
    assert retrieval_service._cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)
    assert retrieval_service._cosine_similarity([0.0, 0.0], [1.0, 0.0]) == 0.0
```

Add `import pytest` and `from services import retrieval_service` to the file's imports if not present.

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_retrieval_service.py -v -k "semantic or cosine"`
Expected: FAIL — `AttributeError: module ... has no attribute 'semantic_fallback_required'`.

- [ ] **Step 3: Implement**

`backend/config.py`, inside `Settings`, after `summary_temperature` (Task 1):

```python
    retrieval_fallback_threshold: float = 0.75
```

(0.75 rationale: measured live 2026-07-11 — in-domain chunk-to-centroid cosine similarity spans 0.87-0.95 on the real corpus, so 0.75 sits comfortably below in-domain material while above unrelated-text similarity for this embedding model; env-overridable, validated by the owed paid eval.)

`backend/services/retrieval_service.py` — add imports:

```python
import math

from sqlalchemy import func, select
from pgvector.sqlalchemy import Vector

from db.models import ChunkEmbedding
```

and after `retrieve()`:

```python
def _session_centroid(db: Session, session_id: str) -> list[float] | None:
    """Mean embedding over the session's chunks; None off-Postgres or empty."""
    if db.get_bind().dialect.name != "postgresql":
        return None
    centroid = db.execute(
        select(
            func.avg(ChunkEmbedding.embedding, type_=Vector(settings.embedding_dim))
        ).where(ChunkEmbedding.session_id == session_id)
    ).scalar()
    if centroid is None:
        return None
    return list(centroid)


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def semantic_fallback_required(db: Session, session_id: str, query: str) -> bool:
    """D2.2: escalate the OPTIONAL lexical gate when the query is semantically
    close to the session's uploaded material (paraphrase/acronym misses that
    the stem overlap cannot catch). Best-effort by design: any failure keeps
    the gate OPTIONAL, mirroring gap_accuracy in routes/chat.py.
    """
    if settings.llm_stub_enabled:
        return False
    try:
        if not documents_service.has_ready_document(db, session_id):
            return False
        centroid = _session_centroid(db, session_id)
        if centroid is None:
            return False
        resp = litellm.embedding(
            model=settings.embedding_model,
            input=[query],
            dimensions=settings.embedding_dim,
        )
        query_vec = (
            resp.data[0]["embedding"]
            if isinstance(resp.data[0], dict)
            else resp.data[0].embedding
        )
        sim = _cosine_similarity(list(query_vec), centroid)
        return sim >= settings.retrieval_fallback_threshold
    except Exception as e:
        log.warning("semantic fallback check failed; keeping OPTIONAL: %s", e)
        return False
```

- [ ] **Step 4: Run tests to verify they pass**

Run from `backend/`: `pytest tests/test_retrieval_service.py -v`
Expected: PASS (new and pre-existing).

- [ ] **Step 5: Commit**

```bash
git add backend/config.py backend/services/retrieval_service.py backend/tests/test_retrieval_service.py
git commit -m "feat: deterministic semantic fallback for retrieval gate (D2.2)"
```

---

### Task 6: Wire semantic fallback into the chat gate (D2.2, route)

**Files:**
- Modify: `backend/routes/chat.py` (single `match_required` site, line ~202; `services` import block line ~22)
- Modify: `backend/tests/test_chat_stream_route.py` (append test)

**Interfaces:**
- Consumes: `retrieval_service.semantic_fallback_required(db, session_id, query) -> bool` (Task 5).

- [ ] **Step 1: Write the failing test**

Read `backend/tests/test_chat_stream_route.py` first (fixtures, how a chat POST is driven with the stubbed LLM). Append:

```python
def test_semantic_fallback_escalates_gate(client, monkeypatch, ...):
    # Adapt the fixture list to this file's existing chat-POST test. Seed a
    # session whose kw_index_json does NOT overlap the message (lexical gate
    # False), then:
    calls = {}

    def fake_fallback(db, session_id, query):
        calls["args"] = (session_id, query)
        return True

    monkeypatch.setattr(
        "routes.chat.retrieval_service.semantic_fallback_required", fake_fallback
    )

    captured = {}
    import routes.chat as chat_module

    real_build = chat_module._build_prompt_state

    def spy_build(**kwargs):
        captured["retrieval_required"] = kwargs.get("retrieval_required")
        return real_build(**kwargs)

    monkeypatch.setattr(chat_module, "_build_prompt_state", spy_build)

    # ... POST the chat message exactly as the file's existing test does ...

    assert calls["args"][1] == "<the posted message>"
    assert captured["retrieval_required"] is True


def test_semantic_fallback_not_called_when_lexical_gate_true(client, monkeypatch, ...):
    # Seed kw_index_json overlapping the message (lexical gate True); assert
    # the fallback is never invoked.
    def fail_if_called(db, session_id, query):
        raise AssertionError("fallback must not run when lexical gate is True")

    monkeypatch.setattr(
        "routes.chat.retrieval_service.semantic_fallback_required", fail_if_called
    )
    # ... POST as above; expect a normal 200 stream ...
```

If `_build_prompt_state` takes positional args, capture via `*args, **kwargs` and read the `retrieval_required` keyword from whichever form the call site uses (the call site passes it by keyword — see `routes/chat.py:206-212`).

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_chat_stream_route.py -v -k semantic`
Expected: FAIL — `AttributeError` (routes.chat has no `retrieval_service` attribute yet).

- [ ] **Step 3: Implement**

`backend/routes/chat.py` — add `retrieval_service` to the existing `from services import (...)` block (line ~22, alphabetical order), then change the gate site (line ~202):

```python
        retrieval_required = keyword_index.match_required(
            req.message, json.loads(session.kw_index_json or "[]")
        )
        if not retrieval_required:
            retrieval_required = retrieval_service.semantic_fallback_required(
                db, req.session_id, req.message
            )
```

- [ ] **Step 4: Run tests to verify they pass**

Run from `backend/`: `pytest tests/test_chat_stream_route.py tests/test_chat.py tests/test_chat_prepare_perf.py -q`
Expected: PASS. Note: existing chat tests run with the LLM stub (`llm_stub_enabled` True), so the real `semantic_fallback_required` short-circuits to False and cannot slow or break them; if any fixture runs unstubbed, monkeypatch the fallback to `lambda *a: False` in that fixture.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/chat.py backend/tests/test_chat_stream_route.py
git commit -m "feat: chat gate escalates via semantic fallback when lexical gate is OPTIONAL (D2.2)"
```

---

### Task 7: Incremental splitSafePrefix (P4.3, frontend lib)

**Files:**
- Modify: `frontend/src/lib/markdownStreamBuffer.js` (two new exports; `splitSafePrefix` unchanged)
- Modify: `frontend/src/components/chat/MarkdownContent.vue` (use incremental variant)
- Modify: `frontend/src/__tests__/markdownStreamBuffer.test.js` (append equivalence suite)

**Interfaces:**
- Produces: `createSplitState() -> {lastText, anchor}` and `splitSafePrefixIncremental(text, state) -> {safe, deferred}` with output identical to `splitSafePrefix(text)` for any append-only sequence.

**Why the design below is subtle (read before coding):** "resume from the last safe end" is WRONG. Two real counterexamples: (1) `"x ``"` commits as a closed empty inline-code pair, but one more backtick makes `"x ```"` — a fence opener, so the full scan defers from index 2 while the naive incremental scan has already committed past it; (2) `"a ```x```"` ends in a closed fence whose closing backticks sit at text end — resume points inside or just after that closer misread it on the next delta. The only positions stable under append are scanner cursors (between-region positions) that are at or before `lastNonDelimiterIndex(text) + 1`, because appended characters can only extend the trailing run of delimiter characters (`` ` `` or `$`). The equivalence test in Step 1 encodes both counterexamples; do not weaken it.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/__tests__/markdownStreamBuffer.test.js`:

```js
import {
  splitSafePrefix,
  splitSafePrefixIncremental,
  createSplitState,
} from '@/lib/markdownStreamBuffer.js'

describe('splitSafePrefixIncremental', () => {
  const FIXTURES = [
    'plain text with no delimiters at all',
    'before ```js\nconst x = 1\n``` after',
    'a `b` c `d` e',
    'inline $x^2$ math and $$\\sum_i x_i$$ display',
    'x ```\nfence built char by char\n``` y',
    'unclosed fence ```python\nnever closes',
    'tricky `` double backtick then ``` fence\ncode\n```',
    'mixed $a$ `b` ```\nc\n``` $$d$$ tail',
    'dollar then more $$ then close $$ then ` open',
    'x ```\nfence grown from what looked like a closed `` pair\n```',
    'a ```x``` ```` trailing backtick run after closed fence',
    '```x y``` z',
    'ends in dollars $$',
  ]

  it('matches full scan at every prefix of every fixture (char-by-char)', () => {
    for (const fixture of FIXTURES) {
      const state = createSplitState()
      for (let i = 1; i <= fixture.length; i++) {
        const text = fixture.slice(0, i)
        const inc = splitSafePrefixIncremental(text, state)
        const full = splitSafePrefix(text)
        expect(inc, `fixture=${JSON.stringify(fixture)} len=${i}`).toEqual(full)
      }
    }
  })

  it('matches full scan under chunked appends (3-char deltas)', () => {
    for (const fixture of FIXTURES) {
      const state = createSplitState()
      for (let i = 3; i <= fixture.length + 2; i += 3) {
        const text = fixture.slice(0, Math.min(i, fixture.length))
        expect(splitSafePrefixIncremental(text, state)).toEqual(splitSafePrefix(text))
      }
    }
  })

  it('resets on non-append change', () => {
    const state = createSplitState()
    splitSafePrefixIncremental('abc `unclosed', state)
    const out = splitSafePrefixIncremental('completely different', state)
    expect(out).toEqual(splitSafePrefix('completely different'))
  })

  it('handles empty text by resetting state', () => {
    const state = createSplitState()
    splitSafePrefixIncremental('abc', state)
    expect(splitSafePrefixIncremental('', state)).toEqual({ safe: '', deferred: '' })
    expect(splitSafePrefixIncremental('new', state)).toEqual(splitSafePrefix('new'))
  })
})
```

Match the file's existing import style (it may already import `splitSafePrefix`; extend that line instead of duplicating).

- [ ] **Step 2: Run tests to verify they fail**

Run from `frontend/`: `npm run test:unit -- --run src/__tests__/markdownStreamBuffer.test.js`
Expected: FAIL — `splitSafePrefixIncremental is not a function`.

- [ ] **Step 3: Implement**

Refactor `frontend/src/lib/markdownStreamBuffer.js` in three moves.

**(a) Extract the scanner core.** Rename the existing `splitSafePrefix` loop into an internal `scanSafePrefix(text, cut)` — copy the current loop VERBATIM (every branch, including the `localCloser < opener.index + opener.len` advance and the final fallthrough), then make exactly these additions:

- Declare `let stableCursor = 0` before the `while` loop.
- As the FIRST statement inside the `while` loop body (the loop-top position, where `cursor` always sits between regions): `if (cursor <= cut) stableCursor = cursor`.
- Every `return` inside the function returns `{ safe: ..., deferred: ..., stableCursor }` — same `safe`/`deferred` expressions as today, plus the cursor.
- The implicit/explicit return after the loop (text fully consumed) returns `{ safe: text, deferred: '', stableCursor }`.

**(b) Reimplement the public function on top of it** (public behavior byte-identical):

```js
export function splitSafePrefix(text) {
  if (!text) return { safe: '', deferred: '' }
  const { safe, deferred } = scanSafePrefix(text, Infinity)
  return { safe, deferred }
}
```

**(c) Add the incremental API:**

```js
// P4.3: incremental variant. A streamed buffer only grows at the end, so we
// resume scanning from a saved anchor instead of offset 0. An anchor is only
// valid if appended text can never change the interpretation of anything
// before it. Appended characters can only extend the text's TRAILING run of
// delimiter characters ('`' or '$') — e.g. a committed closed pair "x ``"
// turns into fence opener "x ```" one backtick later. So a stable anchor is
// the largest between-region scanner cursor that is <= the position right
// after the last non-delimiter character. scanSafePrefix's `cut` parameter
// enforces exactly that bound.

function lastNonDelimiterIndex(text) {
  let i = text.length - 1
  while (i >= 0 && (text[i] === '`' || text[i] === '$')) i--
  return i
}

export function createSplitState() {
  return { lastText: '', anchor: 0 }
}

export function splitSafePrefixIncremental(text, state) {
  if (!text) {
    state.lastText = ''
    state.anchor = 0
    return { safe: '', deferred: '' }
  }
  let base = 0
  if (state.lastText && text.startsWith(state.lastText)) {
    base = state.anchor
  }
  const cut = Math.max(0, lastNonDelimiterIndex(text) + 1 - base)
  const { safe: tailSafe, deferred, stableCursor } = scanSafePrefix(
    text.slice(base),
    cut,
  )
  state.lastText = text
  state.anchor = base + stableCursor
  return { safe: text.slice(0, base) + tailSafe, deferred }
}
```

`frontend/src/components/chat/MarkdownContent.vue` — replace the script block's computed:

```js
import { computed } from 'vue'
import { renderMarkdown } from '@/lib/markdownRenderer.js'
import {
  splitSafePrefixIncremental,
  createSplitState,
} from '@/lib/markdownStreamBuffer.js'

const props = defineProps({
  text: { type: String, required: true },
  streaming: { type: Boolean, default: false },
})

// Per-instance scan state; plain object on purpose (mutated by the split,
// never read by the template).
const splitState = createSplitState()

const parts = computed(() => {
  if (!props.streaming) {
    return { safeHtml: renderMarkdown(props.text), deferred: '' }
  }
  const { safe, deferred } = splitSafePrefixIncremental(props.text, splitState)
  return { safeHtml: renderMarkdown(safe), deferred }
})
```

Template and styles unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run from `frontend/`: `npm run test:unit -- --run src/__tests__/markdownStreamBuffer.test.js`
Expected: PASS — the char-by-char equivalence suite is the correctness proof; if any fixture diverges, the incremental implementation is wrong (fix it, do not weaken the fixture).

Then the full FE suite: `npm run test:unit -- --run`
Expected: PASS (MarkdownContent consumers unchanged).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/markdownStreamBuffer.js frontend/src/components/chat/MarkdownContent.vue frontend/src/__tests__/markdownStreamBuffer.test.js
git commit -m "feat: incremental splitSafePrefix for streaming render (P4.3)"
```

---

### Task 8: rAF delta batching (P4.3, store)

**Files:**
- Create: `frontend/src/lib/deltaBatcher.js`
- Create: `frontend/src/__tests__/deltaBatcher.test.js`
- Modify: `frontend/src/stores/session.js` (both SSE onEvent handlers, lines ~398-420 and ~509-530)

**Interfaces:**
- Produces: `createDeltaBatcher(apply, raf?) -> { push(text), flush() }`. `apply` receives the concatenated pending text at most once per animation frame; `flush()` applies synchronously.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/__tests__/deltaBatcher.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { createDeltaBatcher } from '@/lib/deltaBatcher.js'

describe('createDeltaBatcher', () => {
  it('coalesces pushes into one apply per frame', () => {
    const frames = []
    const raf = (cb) => frames.push(cb)
    const apply = vi.fn()
    const b = createDeltaBatcher(apply, raf)

    b.push('a')
    b.push('b')
    b.push('c')
    expect(apply).not.toHaveBeenCalled()
    expect(frames).toHaveLength(1)

    frames[0]()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith('abc')
  })

  it('schedules a new frame after a flush cycle', () => {
    const frames = []
    const b = createDeltaBatcher(vi.fn(), (cb) => frames.push(cb))
    b.push('a')
    frames[0]()
    b.push('b')
    expect(frames).toHaveLength(2)
  })

  it('flush applies pending text immediately and is idempotent', () => {
    const frames = []
    const apply = vi.fn()
    const b = createDeltaBatcher(apply, (cb) => frames.push(cb))
    b.push('a')
    b.flush()
    expect(apply).toHaveBeenCalledWith('a')
    b.flush()
    frames.forEach((cb) => cb())
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('falls back to immediate apply when rAF is unavailable', () => {
    const apply = vi.fn()
    const b = createDeltaBatcher(apply, undefined)
    b.push('x')
    expect(apply).toHaveBeenCalledWith('x')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `frontend/`: `npm run test:unit -- --run src/__tests__/deltaBatcher.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the batcher**

Create `frontend/src/lib/deltaBatcher.js`:

```js
// P4.3: coalesce per-token SSE deltas into one reactive mutation per
// animation frame. Vue re-renders (and the markdown re-parse behind
// MarkdownContent) then run per frame instead of per token. Falls back to
// immediate apply when requestAnimationFrame is unavailable (tests, SSR).

export function createDeltaBatcher(apply, raf = globalThis.requestAnimationFrame) {
  let pending = ''
  let scheduled = false

  function flush() {
    scheduled = false
    if (!pending) return
    const text = pending
    pending = ''
    apply(text)
  }

  return {
    push(text) {
      if (typeof raf !== 'function') {
        apply(text)
        return
      }
      pending += text
      if (!scheduled) {
        scheduled = true
        raf(flush)
      }
    },
    flush,
  }
}
```

Note `raf(flush)` — pass the function itself, so `flush` runs with no args regardless of rAF's timestamp argument.

- [ ] **Step 4: Run batcher tests**

Run from `frontend/`: `npm run test:unit -- --run src/__tests__/deltaBatcher.test.js`
Expected: PASS.

- [ ] **Step 5: Integrate into the store**

`frontend/src/stores/session.js`. Add the import near the other lib imports:

```js
import { createDeltaBatcher } from '@/lib/deltaBatcher.js'
```

There are two SSE consumers (the check-complete stream at ~line 395 and the chat stream at ~line 505), each with an identical `onEvent` switch. In EACH:

1. Immediately before the `await streamCheckComplete({...})` / `await streamChat({...})` call, create a batcher:

```js
    const deltaBatcher = createDeltaBatcher(appendAssistantDelta)
```

2. Change the delta case:

```js
            case 'assistant_delta': deltaBatcher.push(data.text); break
```

3. At the TOP of the `onEvent` handler body (before the switch), flush on any non-delta event so ordering with tool calls, citations, check questions, done, and error stays exact:

```js
        onEvent: ({ event, data }) => {
          if (event !== 'assistant_delta') deltaBatcher.flush()
          switch (event) {
```

4. In each surrounding `catch` block, flush before any code that reads `streamingMessage.value.content` (the AbortError branch calls `handleCancelled('pending', streamingMessage.value.content.length, '0')` — the flush must precede it):

```js
    } catch (e) {
      deltaBatcher.flush()
      if (e?.name === 'AbortError') {
```

Apply the same flush at the start of the check-complete stream's catch block.

- [ ] **Step 6: Run the store + component suites**

Run from `frontend/`: `npm run test:unit -- --run`
Expected: PASS. Existing session-store tests run in a non-browser env where `globalThis.requestAnimationFrame` is undefined, so the batcher applies immediately and observable behavior is byte-identical. If the vitest environment (jsdom/happy-dom) DOES define rAF and a store test asserts content mid-stream, adapt that test by stubbing `globalThis.requestAnimationFrame = (cb) => cb()` in its setup — do not change the batcher.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/deltaBatcher.js frontend/src/__tests__/deltaBatcher.test.js frontend/src/stores/session.js
git commit -m "feat: batch streaming deltas per animation frame (P4.3)"
```

---

### Task 9: Security doc sync + RUNBOOK audit (S3.1, S3.3)

**Files:**
- Modify: `docs/security/SECURITY_REVIEW_2026-06-22.md` (Finding 1 and Finding 3 sections + summary table rows 1 and 3)
- Verify only (no expected change): `docs/deploy/RUNBOOK.md` line ~60

**Interfaces:**
- Consumes: commit SHA of Task 2 (run `git log --oneline` and use the short SHA of the "JWKS fail-fast" commit).

- [ ] **Step 1: Verify the RUNBOOK placeholder step (S3.1 audit)**

Read `docs/deploy/RUNBOOK.md` around line 60. It already documents replacing the `CRUX_API_HOST` placeholder in `frontend/vercel.json` (verified 2026-07-11). Confirm the path it names matches the real file `frontend/vercel.json` (it does — the repo has no root vercel.json). If, and only if, the step is missing or the path is wrong, fix it; otherwise no RUNBOOK change.

- [ ] **Step 2: Update the security review doc (S3.3)**

In `docs/security/SECURITY_REVIEW_2026-06-22.md`, follow the exact precedent of Finding 2's status paragraph (line ~77, "**Status update (2026-07-06): Fixed.** ..."):

Finding 1 (CSP) — append after its Fix section:

```markdown
**Status update (2026-07-11): Fixed.** The remedy moved from `frontend/nginx.conf`
(stale — WS-C moved the deploy to Vercel + Render) to `frontend/vercel.json`
`headers`: Content-Security-Policy (default-src 'self', frame-ancestors 'none',
object-src 'none', base-uri 'self'), X-Content-Type-Options, X-Frame-Options,
and Referrer-Policy, shipped in WS-C. The `CRUX_API_HOST` placeholder in
`connect-src` is substituted at deploy time per `docs/deploy/RUNBOOK.md` step 2
of the frontend section. Live curl verification of the deployed headers remains
an open human gate (slice 7 PR body).
```

Finding 3 (JWKS 500) — append after its section:

```markdown
**Status update (2026-07-11): Fixed.** `services/auth.py` now exposes
`validate_jwks_startup()`, called from the `main.py` lifespan: when
`supabase_jwks_url` is configured, the JWK set is fetched at startup and any
failure raises `RuntimeError`, so misconfiguration kills boot instead of
returning per-request 500s. Commit `<SHORT_SHA_OF_TASK_2>`.
```

Summary table — change row 1 to:

```markdown
| 1 | No CSP / security headers on the frontend | Medium | **Fixed (2026-07-11) — `frontend/vercel.json` headers; live curl verify owed** |
```

and row 3 to:

```markdown
| 3 | JWKS misconfig → 500 instead of fail-fast | Info | **Fixed (2026-07-11) — `validate_jwks_startup()` in `services/auth.py`** |
```

Replace `<SHORT_SHA_OF_TASK_2>` with the real short SHA from `git log --oneline`.

- [ ] **Step 3: Verify doc consistency**

Grep the security doc for remaining `Open` statuses — after this task, findings 1 and 3 must not read Open anywhere (prose or table). Findings other than 1/2/3 are out of scope; leave them.

- [ ] **Step 4: Commit**

```bash
git add docs/security/SECURITY_REVIEW_2026-06-22.md
git commit -m "docs: security review status sync for CSP + JWKS fixes (S3.1, S3.3)"
```

---

### Task 10: Gates

**Files:** none created; full verification pass.

- [ ] **Step 1: Full backend suite**

Run from `backend/`: `pytest -q`
Expected: >= 588 pass (baseline) plus this slice's additions, 5 skip, zero failures.

- [ ] **Step 2: Full frontend suite**

Run from `frontend/`: `npm run test:unit -- --run`
Expected: >= 586 pass plus additions, zero failures.

- [ ] **Step 3: Lint**

Run from `frontend/`: `npm run lint`
Expected: clean. Then `git status` — if oxlint --fix auto-edited `src/lib/apiClient.js` (recurring gotcha), revert that file: `git checkout -- src/lib/apiClient.js`.

- [ ] **Step 4: Contract drift**

Run from repo root: `python backend/scripts/gen_contracts.py`
Then: `git diff --exit-code backend/contracts docs/api/openapi.yaml`
Expected: zero diff (this slice touches no contracts; any diff is a defect — stop and report).

- [ ] **Step 5: Alembic head check**

Run from `backend/`: `alembic heads`
Expected: single head `0017_hnsw_chunk_embeddings`.

- [ ] **Step 6: Commit (only if gates surfaced fixes)**

```bash
git add -A
git commit -m "chore: slice 7 gate fixes"
```

Skip the commit if the tree is clean.

---

## Post-execution (controller, not a task)

- Dispatch `migration-reviewer` on `backend/db/alembic/versions/0017_hnsw_chunk_embeddings.py` (if not already done after Task 4).
- Opus final review over the whole branch diff (dev..HEAD), then PR to dev with the owed list from the spec §6: live curl headers, live alembic 0017 + re-EXPLAIN, paid D2 eval scenario, plus carried-forward slice 5/6 smokes.
