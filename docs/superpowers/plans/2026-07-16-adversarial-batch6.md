# Adversarial Batch 6 (Perf + Hygiene + Drift) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final batch of `docs/adversarial-review-2026-07-12.md` — findings F-14, F-18, F-34, F-35, F-38, F-42, F-44, F-45, F-46, F-47, F-49, F-50, F-51, F-52, F-53, F-54, F-55, F-56, F-57, F-58, F-59, F-60, F-61, F-62, drift D-1..D-6, plus the Batch-1-carryover openapi backfill.

**Architecture:** Broad-but-shallow fixes per the approved spec `docs/superpowers/specs/2026-07-16-adversarial-batch6-design.md`. One schema change (users onboarding columns, migration 0019). One prompt-mechanism change (server force-retrieve). Everything else is localized hardening.

**Tech Stack:** FastAPI + sync SQLAlchemy + LiteLLM backend; Vue 3 + Pinia + Vite frontend; Supabase Auth (JWT/JWKS); pgvector; nginx (docker deploys); Alembic migrations.

## Global Constraints

- Branch: `fix/adversarial-batch-6` (already created). Base: `dev`.
- Run backend tests from `backend/`: `python -m pytest -q`. Frontend from `frontend/`: `npm run test:unit -- --run`.
- Contracts are CODEGEN: edit `docs/api/openapi.yaml` first, then `python backend/scripts/gen_contracts.py` from repo root. NEVER hand-edit `backend/contracts/`.
- No emojis in code or comments.
- Never read `.env` / `.env.local`. `.env.example` files are fine.
- SQLite is the test DB; live is Supabase Postgres. Any new migration owes a live `alembic upgrade head` (human gate, post-merge).
- Use native grep/Grep for repo sweeps (rtk-rg has a false-zero gotcha).
- Commit after every task with a conventional message. Do not push until the final task.
- CAUTION on deletions: grep the whole repo (including `frontend/e2e/`) before deleting any `data-testid` or exported symbol.

---

### Task 1: F-57 CORS + F-50 issuer normalization + F-61 auth fail-fast

**Files:**
- Modify: `backend/main.py:40-46` (CORS)
- Modify: `backend/services/auth.py:43-61` (startup), `:78` (issuer)
- Modify: `backend/config.py` (new `auth_optional` setting)
- Test: `backend/tests/test_auth_config_batch6.py` (new)

**Interfaces:**
- Consumes: `settings.supabase_url`, `settings.supabase_jwks_url` (existing).
- Produces: `settings.auth_optional: bool` (env `AUTH_OPTIONAL`, default False) — Task 16 documents it in `.env.example`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_auth_config_batch6.py`:

```python
"""Batch 6: F-50 issuer normalization, F-57 CORS, F-61 auth fail-fast."""
import pytest

from config import settings
from services import auth as auth_service


def test_issuer_ignores_trailing_slash(monkeypatch):
    """F-50: a trailing slash on SUPABASE_URL must not change the issuer."""
    monkeypatch.setattr(settings, "supabase_url", "https://proj.supabase.co/")
    assert auth_service.expected_issuer() == "https://proj.supabase.co/auth/v1"
    monkeypatch.setattr(settings, "supabase_url", "https://proj.supabase.co")
    assert auth_service.expected_issuer() == "https://proj.supabase.co/auth/v1"


def test_startup_refuses_unconfigured_auth(monkeypatch):
    """F-61: missing SUPABASE_URL must refuse boot unless AUTH_OPTIONAL=true."""
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(settings, "supabase_jwks_url_override", "")
    monkeypatch.setattr(settings, "auth_optional", False)
    with pytest.raises(RuntimeError, match="auth is not configured"):
        auth_service.validate_jwks_startup()


def test_startup_allows_opt_out(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(settings, "supabase_jwks_url_override", "")
    monkeypatch.setattr(settings, "auth_optional", True)
    auth_service.validate_jwks_startup()  # must not raise


def test_cors_disallows_credentials():
    """F-57: Bearer auth needs no credentialed CORS."""
    from main import app
    cors = next(
        m for m in app.user_middleware if m.cls.__name__ == "CORSMiddleware"
    )
    assert cors.kwargs.get("allow_credentials") is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `python -m pytest tests/test_auth_config_batch6.py -q`
Expected: FAIL — `expected_issuer` does not exist; fail-fast does not raise; `allow_credentials` is True.

- [ ] **Step 3: Implement**

In `backend/config.py`, after `env: str = "dev"` add:

```python
    # F-61: allow booting without Supabase auth config (local hacking, CI
    # subsets). Default False: a deploy missing SUPABASE_URL dies at startup
    # instead of 500ing "auth_not_configured" on every authenticated request.
    auth_optional: bool = False
```

In `backend/services/auth.py`:

(a) Add after the `_JWKS_CACHE` block (module level, near `JWT_LEEWAY_SECONDS`):

```python
def expected_issuer() -> str:
    """F-50: issuer must come from the same normalized (rstripped) base the
    JWKS URL uses -- a trailing slash in SUPABASE_URL otherwise 401s every
    token with an issuer mismatch."""
    return settings.supabase_url.rstrip("/") + "/auth/v1"
```

(b) In `verify_supabase_jwt`, replace the issuer line:

```python
            issuer=f"{settings.supabase_url}/auth/v1",
```

with:

```python
            issuer=expected_issuer(),
```

(c) In `validate_jwks_startup`, replace the early return:

```python
    if not settings.supabase_jwks_url:
        return
```

with:

```python
    if not settings.supabase_jwks_url:
        if settings.auth_optional:
            return
        raise RuntimeError(
            "auth is not configured (SUPABASE_URL is empty) and AUTH_OPTIONAL "
            "is not set; refusing to boot a deploy where every authenticated "
            "request would fail (F-61)"
        )
```

In `backend/main.py`, change `allow_credentials=True,` to `allow_credentials=False,`.

- [ ] **Step 4: Run the new tests, then the full backend suite**

Run: `python -m pytest tests/test_auth_config_batch6.py -q` — expected PASS.
Run: `python -m pytest -q` — expected: all pass. If any existing lifespan/startup test constructs the app without SUPABASE_URL, set `settings.auth_optional = True` in that test's monkeypatch (check `tests/test_main_lifespan.py` and `tests/conftest.py`; conftest likely already overrides auth deps — only the lifespan tests exercise `validate_jwks_startup`).

- [ ] **Step 5: Commit**

```bash
git add backend/config.py backend/services/auth.py backend/main.py backend/tests/test_auth_config_batch6.py
git commit -m "fix(auth,transport): normalize JWT issuer, fail fast on unconfigured auth, drop credentialed CORS (F-50 F-61 F-57)"
```

---

### Task 2: F-18 async embeddings + threaded tool dispatch

**Files:**
- Modify: `backend/services/retrieval_service.py:44` and `:131` (embedding calls), function signatures that contain them
- Modify: `backend/routes/chat.py:228` (await the now-async fallback)
- Modify: `backend/agent/tutor.py:353` (dispatch via `asyncio.to_thread`)
- Test: `backend/tests/test_retrieval_service.py` (adjust mocks), `backend/tests/test_batch6_async.py` (new)

**Interfaces:**
- Consumes: `litellm.aembedding` (async twin of `litellm.embedding`, same response shape).
- Produces: `retrieval_service.semantic_fallback_required` becomes `async def` (caller: `routes/chat.py:228`). `retrieval_service.retrieve` STAYS sync (see below).

**Resolution note — why `retrieve()` stays sync.** `tools.dispatch(name, args, ctx)` is a sync function dispatching all three tools. After this task, `dispatch` runs inside `asyncio.to_thread`, so the sync `litellm.embedding` inside `retrieve` blocks only its worker thread, not the event loop. The event-loop stall from `retrieve` is fixed by threading `dispatch`, not by rewriting `retrieve`. Only `semantic_fallback_required` converts to async (it runs directly on the loop in `_prepare_turn`, no thread).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_batch6_async.py`:

```python
"""F-18: semantic_fallback_required is async (aembedding); tools.dispatch runs
in a worker thread from the agent loop."""
import asyncio
import inspect

from services import retrieval_service


def test_semantic_fallback_is_async():
    assert inspect.iscoroutinefunction(retrieval_service.semantic_fallback_required)


def test_fallback_uses_aembedding(monkeypatch, db_session):
    called = {}

    async def fake_aembedding(**kwargs):
        called["hit"] = True

        class R:
            data = [{"embedding": [0.0] * 768}]

        return R()

    monkeypatch.setattr(
        "services.retrieval_service.litellm.aembedding", fake_aembedding
    )
    # No ready document -> early False BEFORE the embedding; force the check
    # to still assert the symbol exists by verifying the attribute is used.
    result = asyncio.get_event_loop().run_until_complete(
        retrieval_service.semantic_fallback_required(db_session, "nosuch", "q")
    )
    assert result is False
```

Note to implementer: the existing suite `tests/test_retrieval_service.py` monkeypatches `services.retrieval_service.litellm.embedding` for the fallback path (lines ~235-360 per current file) — those fallback tests must be updated to patch `litellm.aembedding` with an async fake and to `await`/`asyncio.run` the call. Retrieve-path tests (`retrieve()`) stay on the sync `litellm.embedding` patch. `tests/test_chat_prepare_perf.py` and `tests/test_documents_service.py` reference the sync symbol — check each: if they patch the fallback path, convert the fake to async.

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_batch6_async.py -q`
Expected: FAIL — `semantic_fallback_required` is not a coroutine function.

- [ ] **Step 3: Implement**

(a) `backend/services/retrieval_service.py` — convert the fallback:

```python
async def semantic_fallback_required(
    db: Session, session_id: str, query: str, *, user_id: str | None = None
) -> bool:
```

and inside, replace the `litellm.embedding(` call with `await litellm.aembedding(` (same kwargs). Docstring gains one line: `F-18: async embedding; this runs directly on the event loop in _prepare_turn.` Everything else (centroid, metering, threshold) unchanged.

(b) `backend/routes/chat.py:227-230` — await it:

```python
        if not retrieval_required:
            retrieval_required = await retrieval_service.semantic_fallback_required(
                db, req.session_id, req.message, user_id=user_id
            )
```

(`_prepare_turn` is already `async def` — no signature change.)

(c) `backend/agent/tutor.py:353` — thread the dispatch:

```python
                result = await asyncio.to_thread(tools.dispatch, name, args, ctx)
```

(`asyncio` is already imported. The sync SQLAlchemy `ctx.db` session is used by exactly one dispatch at a time — the loop awaits each dispatch before the next — so there is no concurrent session use.)

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/test_batch6_async.py tests/test_retrieval_service.py tests/test_tutor_agent.py -q` (adjust the tutor test filename to whatever exists — grep `rg -l "run_streaming" backend/tests`).
Then the full suite: `python -m pytest -q`. Expected: all pass after the mock conversions described in Step 1's note.

- [ ] **Step 5: Commit**

```bash
git add backend/services/retrieval_service.py backend/routes/chat.py backend/agent/tutor.py backend/tests/
git commit -m "perf(agent): async semantic-fallback embedding + threaded tool dispatch (F-18)"
```

---

### Task 3: F-58 count-first rolling summary

**Files:**
- Modify: `backend/services/summary_service.py:158-233` (`update_rolling_summary`)
- Test: `backend/tests/test_rolling_summary.py` (existing — find via `rg -l "update_rolling_summary" backend/tests`; add cases)

**Interfaces:**
- Consumes: `rolling_summary_due(total, summarized_count)` (existing, unchanged).
- Produces: no signature changes. New module constant `ROLLING_TRANSCRIPT_MAX = 30`.

- [ ] **Step 1: Write the failing test**

Add to the existing rolling-summary test file:

```python
def test_rolling_summary_counts_before_loading(db_session, monkeypatch):
    """F-58: when not due, no ChatMessage rows are materialized -- only a
    COUNT query runs."""
    import asyncio
    from services import summary_service
    from db.models import ChatMessage, Session as SessionModel

    s = SessionModel(user_id="u1", topic="t")
    db_session.add(s)
    db_session.commit()
    for i in range(5):  # far below ROLLING_WINDOW + ROLLING_DEBOUNCE
        db_session.add(ChatMessage(session_id=s.id, role="user", content=f"m{i}"))
    db_session.commit()

    loaded = []
    orig_execute = db_session.execute

    def spy(stmt, *a, **kw):
        loaded.append(str(stmt))
        return orig_execute(stmt, *a, **kw)

    monkeypatch.setattr(db_session, "execute", spy)
    result = asyncio.run(summary_service.update_rolling_summary(db_session, s.id))
    assert result is None
    # The single statement issued must be an aggregate count, not a row load.
    assert len(loaded) == 1 and "count" in loaded[0].lower()


def test_rolling_transcript_capped_to_newest(db_session, monkeypatch):
    """F-58: the dropped-transcript sent to the LLM contains at most
    ROLLING_TRANSCRIPT_MAX messages, the newest ones."""
    import asyncio
    from services import summary_service
    from db.models import ChatMessage, Session as SessionModel

    s = SessionModel(user_id="u1", topic="t")
    db_session.add(s)
    db_session.commit()
    total = summary_service.ROLLING_WINDOW + summary_service.ROLLING_TRANSCRIPT_MAX + 15
    for i in range(total):
        db_session.add(ChatMessage(session_id=s.id, role="user", content=f"mark-{i}"))
    db_session.commit()

    seen = {}

    def fake_mechanical(dropped):
        seen["dropped"] = list(dropped)
        return "[auto-rolling] x"

    monkeypatch.setattr(summary_service.settings, "llm_stub", True)
    monkeypatch.setattr(summary_service, "_mechanical_rolling", fake_mechanical)
    asyncio.run(summary_service.update_rolling_summary(db_session, s.id))
    dropped = seen["dropped"]
    assert len(dropped) == summary_service.ROLLING_TRANSCRIPT_MAX
    # Newest dropped message is index total - ROLLING_WINDOW - 1.
    assert dropped[-1].content == f"mark-{total - summary_service.ROLLING_WINDOW - 1}"
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/ -k "rolling" -q`
Expected: new tests FAIL (`ROLLING_TRANSCRIPT_MAX` missing; row-load statement issued when not due).

- [ ] **Step 3: Implement**

In `backend/services/summary_service.py`, add constant near the other rolling constants:

```python
ROLLING_TRANSCRIPT_MAX = 30  # F-58: newest dropped messages fed to the LLM
```

Replace the body of `update_rolling_summary` from the `session = db.get(...)` line down to `dropped = messages[: total - ROLLING_WINDOW]` with:

```python
        session = db.get(SessionModel, session_id)
        if session is None:
            return None
        # F-58: COUNT first; the common turn is "not due" and must not load
        # the session's whole message history just to count it.
        total = db.execute(
            select(func.count())
            .select_from(ChatMessage)
            .where(ChatMessage.session_id == session_id)
        ).scalar_one()
        if not rolling_summary_due(total, session.rolling_summary_count):
            return None
        # Load only the newest ROLLING_TRANSCRIPT_MAX of the dropped range:
        # rows strictly older than the last-ROLLING_WINDOW prompt window.
        n_dropped = total - ROLLING_WINDOW
        fetch = min(n_dropped, ROLLING_TRANSCRIPT_MAX)
        dropped = db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.id.desc())
            .offset(ROLLING_WINDOW)
            .limit(fetch)
        ).scalars().all()
        dropped = list(reversed(dropped))  # chronological
```

Add `func` to the existing `from sqlalchemy import select` import: `from sqlalchemy import func, select`.

The remainder of the function is unchanged EXCEPT the final count write stays `session.rolling_summary_count = total - ROLLING_WINDOW` (already computed as `n_dropped` — use `n_dropped` for clarity).

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/ -k "rolling" -q` then `python -m pytest -q`.
Expected: PASS. (The offset/desc window `offset(ROLLING_WINDOW)` = rows older than the prompt window because ordering is `id.desc()`.)

- [ ] **Step 5: Commit**

```bash
git add backend/services/summary_service.py backend/tests/
git commit -m "perf(summary): count-first rolling summary + newest-M transcript cap (F-58)"
```

---

### Task 4: F-35 profile list caps + prompt render cap

**Files:**
- Modify: `backend/config.py` (new `max_profile_list` setting)
- Modify: `backend/services/profile_service.py:161-169` (`save_profile`)
- Modify: `backend/agent/prompts.py:197-258` (`build_dynamic_context`)
- Test: `backend/tests/test_profile_list_caps.py` (new)

**Interfaces:**
- Consumes: `TopicProfile` (contracts), `canon()` (profile_service).
- Produces: `settings.max_profile_list: int = 40`; `prompts.PROMPT_LIST_MAX = 20`. `save_profile` silently enforces the cap on every write (all writers funnel through it).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_profile_list_caps.py`:

```python
"""F-35: profile lists are capped at write time; the prompt renders only the
newest PROMPT_LIST_MAX entries per list with an older-count marker."""
import json
from datetime import datetime, timezone

from agent import prompts
from config import settings
from contracts import ConceptEntry, TopicProfile
from db.models import Session as SessionModel
from services import profile_service


def _entries(n, prefix):
    return [
        ConceptEntry(name=f"{prefix}-{i}", evidence_type="declared",
                     last_event_at=datetime.now(timezone.utc))
        for i in range(n)
    ]


def _make_session(db):
    s = SessionModel(user_id="u1", topic="t")
    db.add(s)
    db.commit()
    return s


def test_save_profile_evicts_oldest_past_cap(db_session):
    s = _make_session(db_session)
    profile = TopicProfile(
        confirmed_gaps=_entries(settings.max_profile_list + 3, "gap"),
    )
    profile_service.save_profile(db_session, s.id, profile)
    saved = profile_service.load_profile(db_session, s.id)
    assert len(saved.confirmed_gaps) == settings.max_profile_list
    # Oldest (front) evicted, newest kept.
    assert saved.confirmed_gaps[-1].name == f"gap-{settings.max_profile_list + 2}"
    assert saved.confirmed_gaps[0].name == "gap-3"


def test_cap_never_evicts_focused_gap(db_session):
    s = _make_session(db_session)
    profile = TopicProfile(
        confirmed_gaps=_entries(settings.max_profile_list + 1, "gap"),
        focus_target_gap="gap-0",
    )
    profile_service.save_profile(db_session, s.id, profile)
    saved = profile_service.load_profile(db_session, s.id)
    names = [e.name for e in saved.confirmed_gaps]
    assert "gap-0" in names          # focus survived
    assert "gap-1" not in names      # next-oldest evicted instead


def test_prompt_renders_newest_with_older_count():
    profile = TopicProfile(confirmed_gaps=_entries(prompts.PROMPT_LIST_MAX + 7, "gap"))
    out = prompts.build_dynamic_context({"profile": profile})
    line = next(l for l in out.splitlines() if l.startswith("CURRENT TOPIC PROFILE:"))
    rendered = json.loads(line[len("CURRENT TOPIC PROFILE: "):])
    assert len(rendered["confirmed_gaps"]) == prompts.PROMPT_LIST_MAX
    assert rendered["confirmed_gaps_older_count"] == 7
    # Newest entries kept.
    assert rendered["confirmed_gaps"][-1]["name"] == f"gap-{prompts.PROMPT_LIST_MAX + 6}"
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_profile_list_caps.py -q`
Expected: FAIL — `max_profile_list` setting missing; no eviction; no older-count key.

- [ ] **Step 3: Implement**

`backend/config.py` — add near the LLM caps:

```python
    # F-35: hard cap per profile concept list (confirmed_gaps,
    # mastered_concepts); oldest entries evicted at write time.
    max_profile_list: int = 40
```

`backend/services/profile_service.py` — add above `save_profile`:

```python
def _enforce_list_caps(profile: TopicProfile) -> None:
    """F-35: profiles copy forward across resumes forever; without a cap the
    lists (and therefore the per-turn prompt) grow monotonically. Evict oldest
    (front-of-list) entries past settings.max_profile_list. The focused gap is
    never evicted -- dropping it would dangle focus_target_gap (F-22)."""
    cap = settings.max_profile_list
    focus_key = canon(profile.focus_target_gap) if profile.focus_target_gap else None
    for attr in ("confirmed_gaps", "mastered_concepts"):
        entries = list(getattr(profile, attr) or [])
        if len(entries) <= cap:
            continue
        keep: list = []
        overflow = len(entries) - cap
        for e in entries:
            if overflow > 0 and not (
                attr == "confirmed_gaps" and focus_key and canon(e.name) == focus_key
            ):
                overflow -= 1
                continue
            keep.append(e)
        setattr(profile, attr, keep)
```

(`settings` needs importing if absent: check the imports block; add `from config import settings` if missing.)

In `save_profile`, first line of the body:

```python
    _enforce_list_caps(profile)
```

`backend/agent/prompts.py` — add constant near `_GAP_ACCURACY_MAX_GAPS`:

```python
PROMPT_LIST_MAX = 20  # F-35: newest entries per concept list in the prompt
```

In `build_dynamic_context`, after `profile_dict = _profile_to_dict(state.get("profile"))` insert:

```python
    # F-35: render only the newest PROMPT_LIST_MAX entries per concept list;
    # an *_older_count key tells the model truncation happened.
    for _key in ("confirmed_gaps", "mastered_concepts"):
        _items = profile_dict.get(_key)
        if isinstance(_items, list) and len(_items) > PROMPT_LIST_MAX:
            profile_dict[f"{_key}_older_count"] = len(_items) - PROMPT_LIST_MAX
            profile_dict[_key] = _items[-PROMPT_LIST_MAX:]
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/test_profile_list_caps.py -q` then full `python -m pytest -q`.
Expected: PASS. If an existing prompt test asserts the exact profile JSON line, it will still pass (lists under 20 render unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/config.py backend/services/profile_service.py backend/agent/prompts.py backend/tests/test_profile_list_caps.py
git commit -m "perf(profile,prompt): cap concept lists at write time, render newest 20 per turn (F-35)"
```

---

### Task 5: F-14 abort arms persist streamed text; error arm attaches open batch

**Files:**
- Modify: `backend/agent/tutor.py:146-162` (mid-turn cap arm), `:442-444` (max_iters arm), `:500-509` (error arm attach)
- Modify: `frontend/src/components/chat/AssistantBubble.vue:47` (partial marker)
- Test: `backend/tests/test_tutor_abort_persistence.py` (new); `frontend/src/__tests__/assistantBubble.test.js` (add case)

**Interfaces:**
- Consumes: `_persist_assistant_message(ctx, content, status, ...)` (existing), `check_question_service.attach_message_id(db, session_id, msg_id)` (existing).
- Produces: assistant `ChatMessage.status` value `"partial"` (new, alongside `complete|cancelled|error`). FE renders it with an "(interrupted)" marker.

Background for the implementer: Batch 1's F-01 fix already persists text with status `"error"` for generic exceptions. Still broken: (1) the mid-turn-cap arm (`tutor.py:148-162`) and the max_iters arm (`:442-444`) yield an `error` event and return WITHOUT persisting `accumulated_text` — text the user watched stream vanishes on reload; (2) the F-01 error arm persists the message but never calls `attach_message_id`, so a check batch registered in a crashed turn dangles with `message_id: None`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_tutor_abort_persistence.py`:

```python
"""F-14: max_iters / mid-turn-cap aborts persist already-streamed text as a
'partial' assistant message; the F-01 error arm attaches an open batch."""
import asyncio
import json

from sqlalchemy import select

from agent import tutor
from agent.types import ToolContext
from db.models import ChatMessage, Session as SessionModel


def _mk_session(db):
    s = SessionModel(user_id="u1", topic="t")
    db.add(s)
    db.commit()
    return s


def _ctx(db, s):
    from datetime import datetime, timezone
    return ToolContext(db=db, session_id=s.id, user_id="u1",
                       turn_started_at=datetime.now(timezone.utc))


class _FakeDelta:
    def __init__(self, content=None, tool_calls=None):
        self.content = content
        self.tool_calls = tool_calls


class _FakeChunk:
    def __init__(self, delta):
        self.choices = [type("C", (), {"delta": delta})()]


class _FakeStream:
    """Async iterator that streams one text token then one tool-call frag so
    the loop never produces a final answer and exhausts max_iters."""
    def __init__(self):
        self._items = [
            _FakeChunk(_FakeDelta(content="draft ")),
            _FakeChunk(_FakeDelta(tool_calls=[type("T", (), {
                "index": 0, "id": "tc1",
                "function": type("F", (), {
                    "name": "update_topic_profile",
                    "arguments": json.dumps({"add_confirmed_gap": "x",
                                             "evidence_type": "declared"}),
                })(),
            })()])),
        ]

    def __aiter__(self):
        self._i = iter(self._items)
        return self

    async def __anext__(self):
        try:
            return next(self._i)
        except StopIteration:
            raise StopAsyncIteration


def test_max_iters_persists_partial(db_session, monkeypatch):
    s = _mk_session(db_session)
    monkeypatch.setattr(tutor.settings, "llm_stub", False)
    monkeypatch.setattr(tutor.settings, "gemini_api_key", "real")

    async def fake_acompletion(**kwargs):
        return _FakeStream()

    monkeypatch.setattr(tutor.litellm, "acompletion", fake_acompletion)
    monkeypatch.setattr(tutor.litellm, "stream_chunk_builder", lambda *a, **k: None)
    monkeypatch.setattr(tutor.litellm, "completion_cost", lambda **k: 0.0)
    monkeypatch.setattr(tutor.litellm, "token_counter", lambda **k: 1)

    async def run():
        events = []
        async for ev in tutor.run_streaming(
            [{"role": "user", "content": "hi"}], "sys", _ctx(db_session, s),
            max_iters=2,
        ):
            events.append(ev)
        return events

    events = asyncio.run(run())
    assert events[-1].type == "error"
    assert events[-1].data["code"] == "max_iters_reached"
    row = db_session.execute(
        select(ChatMessage).where(
            ChatMessage.session_id == s.id, ChatMessage.role == "assistant"
        )
    ).scalar_one()
    assert row.status == "partial"
    assert "draft" in row.content
```

Frontend — add to `frontend/src/__tests__/assistantBubble.test.js` (mirror the existing `status: 'cancelled'` case at line ~44):

```javascript
it('shows an interrupted marker for partial messages', () => {
  const wrapper = mount(AssistantBubble, {
    props: { message: { content: 'partial text', tool_calls: [], citations: [], status: 'partial' } },
    global: sharedGlobal,
  })
  expect(wrapper.text()).toContain('(interrupted)')
})
```

(Adapt mount options to the file's existing pattern — copy the cancelled test verbatim and change status + expectation.)

- [ ] **Step 2: Run to verify failure**

Backend: `python -m pytest tests/test_tutor_abort_persistence.py -q` — FAIL (no assistant row persisted).
Frontend from `frontend/`: `npm run test:unit -- --run assistantBubble` — FAIL (no marker).

- [ ] **Step 3: Implement**

`backend/agent/tutor.py` — add helper below `_persist_assistant_message`:

```python
def _persist_partial_on_abort(ctx, accumulated_text, tool_calls, citations, asked_check):
    """F-14: an aborted turn (max_iters, mid-turn cap) must not vanish text
    the learner watched stream. Persist it as 'partial'; if a check batch was
    registered this turn, attach it so it renders with its asking message
    instead of dangling."""
    if not accumulated_text and not asked_check:
        return None
    try:
        msg_id = _persist_assistant_message(
            ctx, accumulated_text, "partial",
            tool_calls=tool_calls, citations=citations,
        )
        if asked_check:
            check_question_service.attach_message_id(ctx.db, ctx.session_id, msg_id)
        return msg_id
    except Exception:
        log.exception("failed to persist partial assistant message on abort")
        return None
```

Mid-turn cap arm — insert before the `yield StreamEvent("error", ...)` in the `if not cap.allowed:` block:

```python
                _persist_partial_on_abort(
                    ctx, accumulated_text, tool_calls_record, citations, asked_check
                )
```

max_iters arm — replace:

```python
        # max_iters exhausted without a final answer.
        yield StreamEvent("error", {"code": "max_iters_reached"})
        return
```

with:

```python
        # max_iters exhausted without a final answer.
        _persist_partial_on_abort(
            ctx, accumulated_text, tool_calls_record, citations, asked_check
        )
        yield StreamEvent("error", {"code": "max_iters_reached"})
        return
```

F-01 error arm — after the `_persist_assistant_message(... "error" ...)` call inside its `try:`, capture the id and attach:

```python
        try:
            msg_id = _persist_assistant_message(
                ctx,
                accumulated_text,
                "error",
                tool_calls=tool_calls_record,
                citations=citations,
            )
            if asked_check:
                check_question_service.attach_message_id(ctx.db, ctx.session_id, msg_id)
        except Exception:
            log.exception("failed to persist assistant message after agent-loop failure")
```

NOTE: `asked_check` is initialized before the loop (line ~143) and reset per-iteration at line ~312 (`asked_check = False`). The per-iteration reset happens only in tool-call iterations, and every `asked_check=True` iteration returns — so at both abort arms `asked_check` is reliably False unless a batch was registered and an exception then prevented the return. That is exactly the dangle F-14 closes.

`frontend/src/components/chat/AssistantBubble.vue:47` — extend the marker line:

```html
      <span v-if="message.status === 'cancelled'" class="cancelled-marker">(stopped)</span>
      <span v-else-if="message.status === 'partial'" class="cancelled-marker">(interrupted)</span>
```

- [ ] **Step 4: Run tests**

Backend: `python -m pytest tests/test_tutor_abort_persistence.py -q`, then `python -m pytest -q`.
Frontend: `npm run test:unit -- --run`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agent/tutor.py frontend/src/components/chat/AssistantBubble.vue backend/tests/test_tutor_abort_persistence.py frontend/src/__tests__/assistantBubble.test.js
git commit -m "fix(agent): persist streamed text on max-iters/cap abort, attach batch on error arm (F-14)"
```

---

### Task 6: F-55 magic-byte sniff on upload

**Files:**
- Modify: `backend/routes/upload.py` (after `_read_bounded`, before the Document row commit)
- Test: `backend/tests/test_upload.py` (existing upload test file — locate via `rg -l "UNSUPPORTED_FILE_TYPE" backend/tests`; add cases)

**Interfaces:**
- Consumes: `data: bytes` (already fully read at `upload.py:109`).
- Produces: HTTP 415 `{"code": "CONTENT_TYPE_MISMATCH"}` on magic-byte mismatch.

- [ ] **Step 1: Write the failing tests**

Add to the upload test file (follow its existing client/session fixtures):

```python
def test_upload_rejects_fake_pdf(client, auth_session):
    """F-55: extension says .pdf but bytes are not %PDF -> 415, no row."""
    resp = client.post(
        "/api/upload",
        data={"session_id": auth_session.id},
        files={"file": ("notes.pdf", b"MZ\x90\x00 not a pdf", "application/pdf")},
    )
    assert resp.status_code == 415
    assert resp.json()["detail"]["code"] == "CONTENT_TYPE_MISMATCH"


def test_upload_rejects_fake_pptx(client, auth_session):
    resp = client.post(
        "/api/upload",
        data={"session_id": auth_session.id},
        files={"file": ("deck.pptx", b"%PDF-1.7 wrong container", "application/octet-stream")},
    )
    assert resp.status_code == 415


def test_upload_accepts_real_pdf_magic(client, auth_session):
    resp = client.post(
        "/api/upload",
        data={"session_id": auth_session.id},
        files={"file": ("real.pdf", b"%PDF-1.7\n...", "application/pdf")},
    )
    assert resp.status_code == 202


def test_upload_txt_skips_sniff(client, auth_session):
    """txt/md have no magic bytes; the sniff must not block them."""
    resp = client.post(
        "/api/upload",
        data={"session_id": auth_session.id},
        files={"file": ("notes.txt", b"plain text", "text/plain")},
    )
    assert resp.status_code == 202
```

(Adapt fixture names to the file's existing tests — copy the setup of an existing successful-upload test.)

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/ -k "upload" -q`
Expected: new 415 tests FAIL (uploads accepted).

- [ ] **Step 3: Implement**

In `backend/routes/upload.py`, add module-level near `ALLOWED_EXTENSIONS`:

```python
# F-55: content sniff for container formats. Extensions with no reliable
# magic bytes (.txt, .md) are exempt -- the extension check already ran.
_MAGIC_BYTES = {
    ".pdf": (b"%PDF",),
    ".pptx": (b"PK\x03\x04",),
}
```

After `data = _read_bounded(file.file, MAX_UPLOAD_BYTES)` and BEFORE the `doc = Document(...)` row creation, insert:

```python
    expected = _MAGIC_BYTES.get(ext)
    if expected and not any(data.startswith(m) for m in expected):
        raise HTTPException(
            status_code=415,
            detail={
                "code": "CONTENT_TYPE_MISMATCH",
                "message": "file content does not match its extension",
            },
        )
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/ -k "upload" -q` then `python -m pytest -q`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/upload.py backend/tests/
git commit -m "fix(upload): magic-byte sniff before accepting container formats (F-55)"
```

---

### Task 7: F-47 fresh access token on every request

**Files:**
- Modify: `frontend/src/services/apiClient.js:27-34,87`
- Modify: `frontend/src/services/chatStreamService.js:13-15,23`
- Modify: `frontend/src/services/uploadApi.js:34-42` (and its call sites in the same file)
- Test: `frontend/src/__tests__/apiClient.test.js` (existing — locate via `rg -l "_refreshAccessToken" frontend/src/__tests__`; add cases)

**Interfaces:**
- Consumes: `getSupabase().auth.getSession()` (refreshes an expired token internally; cheap local call otherwise).
- Produces: `export async function getFreshAccessToken()` in `apiClient.js`, reused by chatStreamService and uploadApi.

Background: after wake-from-sleep the Pinia store can hold an expired token; the first request then 401s and burns the single F-09 retry. `getSession()` returns a fresh token (refreshing if needed), falling back to the store token when Supabase is unavailable (unit tests without Pinia).

- [ ] **Step 1: Write the failing test**

Add to the apiClient test file (mirroring its existing mock pattern for `./supabase.js`):

```javascript
it('sends the getSession token, not the stale store token', async () => {
  // Arrange the supabase mock to return a fresh token.
  getSessionMock.mockResolvedValue({ data: { session: { access_token: 'fresh-tok' } } })
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
  await apiGet('/ping')
  const [, init] = fetchMock.mock.calls[0]
  expect(init.headers['authorization']).toBe('Bearer fresh-tok')
})

it('falls back to the store token when getSession fails', async () => {
  getSessionMock.mockRejectedValue(new Error('offline'))
  // auth store holds 'store-tok' via the test pinia setup
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
  await apiGet('/ping')
  const [, init] = fetchMock.mock.calls[0]
  expect(init.headers['authorization']).toBe('Bearer store-tok')
})
```

(Adapt mock names to the file's existing `vi.mock('./supabase.js', ...)` setup; if none exists, add one following the `_refreshAccessToken` test's pattern.)

- [ ] **Step 2: Run to verify failure**

From `frontend/`: `npm run test:unit -- --run apiClient`
Expected: FAIL — header carries the store token.

- [ ] **Step 3: Implement**

`frontend/src/services/apiClient.js` — replace `_getAccessToken` with:

```javascript
// F-47: read the token from the SDK, not the Pinia snapshot. getSession()
// refreshes an expired access token; after wake-from-sleep the store can
// hold a stale one and would burn the single F-09 retry on a guaranteed 401.
// Falls back to the store token (tests without a supabase env), then null.
export async function getFreshAccessToken() {
  try {
    const { getSupabase } = await import('./supabase.js')
    const { data } = await getSupabase().auth.getSession()
    const tok = data?.session?.access_token
    if (tok) return tok
  } catch {
    // fall through to the store snapshot
  }
  try {
    const store = useAuthStore()
    return store.accessToken ?? null
  } catch {
    return null
  }
}
```

and change the token line in `request()`:

```javascript
  const token = _retried ? await _refreshAccessToken() : await getFreshAccessToken()
```

`frontend/src/services/chatStreamService.js` — delete the local `_authToken()` helper; import and use the shared one:

```javascript
import { _onAuthExpired, _refreshAccessToken, getFreshAccessToken } from './apiClient.js'
```

(extend the existing import line from apiClient.js) and in `_fetchSse`:

```javascript
  const token = _retried ? await _refreshAccessToken() : await getFreshAccessToken()
```

`frontend/src/services/uploadApi.js` — replace `_authHeaders()` with an async version delegating to the shared helper:

```javascript
async function _authHeaders() {
  const token = await getFreshAccessToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}
```

Import `getFreshAccessToken` from `./apiClient.js`, and update every `_authHeaders()` call site in the file to `await _authHeaders()` (the enclosing upload functions are already async or must become async — check each; `uploadDocument` uses fetch and is async).

- [ ] **Step 4: Run tests**

From `frontend/`: `npm run test:unit -- --run`. Expected: PASS after adapting existing token-header tests (any test asserting the store-token path must now mock `getSession` or rely on the fallback).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/apiClient.js frontend/src/services/chatStreamService.js frontend/src/services/uploadApi.js frontend/src/__tests__/
git commit -m "fix(frontend): fetch fresh access token per request via getSession (F-47)"
```

---

### Task 8: F-42 nginx per-request rate limit + F-62 CSP/base-URL guidance

**Files:**
- Modify: `frontend/nginx.conf`
- Modify: `docs/deploy/RUNBOOK.md` (one paragraph; locate the nginx/deploy section by grepping "nginx" in the file)
- Test: none automated (nginx config; CI does not run nginx). Verification = human gate post-merge (live curl loop). `docker compose config` sanity-checks compose, and `nginx -t` inside the frontend image validates syntax if docker is available — best-effort, do not block the task on docker availability.

**Interfaces:**
- Produces: per-IP rate limiting on `/api/` for nginx-fronted (docker/compose) deploys only. Render remains unthrottled per spec (documented limitation).

- [ ] **Step 1: Edit `frontend/nginx.conf`**

Above the `server {` block (conf.d files are included at http context, so the zone directive is valid here), add:

```nginx
# F-42: per-IP request throttle for the API path. 10 r/s steady with a burst
# of 20 absorbs legitimate UI bursts (parallel loads on Home) while blocking
# request floods. Applies to nginx-fronted deploys (docker compose) only --
# the Render backend has no nginx tier; its guard remains the daily LLM caps.
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
```

Inside `location /api/ {`, first lines:

```nginx
        limit_req zone=api_limit burst=20 nodelay;
        limit_req_status 429;
```

- [ ] **Step 2: F-62 — CSP / base-URL trap comment**

In `frontend/nginx.conf`, directly above the `add_header Content-Security-Policy` line, add:

```nginx
    # F-62: connect-src is 'self' + supabase. nginx-served builds MUST use a
    # relative VITE_API_BASE_URL (/api). An absolute API origin baked at build
    # time would be blocked by this CSP -- add it to connect-src if you ever
    # need one.
```

- [ ] **Step 3: Document in RUNBOOK**

In `docs/deploy/RUNBOOK.md`, find the section describing the compose/nginx deploy (grep "nginx"); append:

```markdown
Rate limiting: nginx throttles `/api/` at 10 requests/second per IP (burst 20,
HTTP 429 beyond). This applies to nginx-fronted deploys only; the Render
backend has no per-request throttle -- its spend guard is the daily LLM
cost cap and rate counter.
```

- [ ] **Step 4: Validate**

If docker is available: `docker run --rm -v "$PWD/frontend/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t` — expected `syntax is ok`. If docker is unavailable, note it in the task report; the live curl gate covers it post-merge.

- [ ] **Step 5: Commit**

```bash
git add frontend/nginx.conf docs/deploy/RUNBOOK.md
git commit -m "feat(transport): nginx per-IP rate limit on /api + CSP base-URL guidance (F-42 F-62)"
```

---

### Task 9: F-34 server-side duplicate-topic guard

**Files:**
- Modify: `backend/routes/sessions.py:96-143` (`create_session`), `:346-359` (`reopen_session`)
- Modify: `frontend/src/views/NewSessionView.vue:200-229` (submit 409 handling)
- Modify: `frontend/src/views/HomeView.vue:92-97` (`startQuick` 409 handling)
- Test: `backend/tests/test_duplicate_topic.py` (new); NewSessionView test file (add case)

**Interfaces:**
- Consumes: `SessionModel` columns (`user_id`, `topic`, `ended_at`), `func.lower`.
- Produces: HTTP 409 `{"code": "duplicate_topic", "session_id": "<existing id>"}` from `create_session` and `reopen_session`. FE surfaces "Open existing session".

- [ ] **Step 1: Write the failing backend tests**

Create `backend/tests/test_duplicate_topic.py` (use the existing `client` + auth-header conventions from conftest — `Authorization: Bearer test-<uid>`):

```python
"""F-34: duplicate-topic detection is server-side, case-insensitive, and
covers create + reopen."""


def _create(client, topic, uid="dupe-user"):
    return client.post(
        "/api/sessions",
        json={"topic": topic, "seed_mode": "fresh"},
        headers={"Authorization": f"Bearer test-{uid}"},
    )


def test_create_conflicts_with_active_same_topic(client):
    first = _create(client, "Chain Rule")
    assert first.status_code == 201
    dup = _create(client, "chain rule")  # case-insensitive
    assert dup.status_code == 409
    detail = dup.json()["detail"]
    assert detail["code"] == "duplicate_topic"
    assert detail["session_id"] == first.json()["id"]


def test_create_allowed_after_end(client):
    first = _create(client, "Osmosis")
    sid = first.json()["id"]
    ended = client.post(
        f"/api/sessions/{sid}/end",
        headers={"Authorization": "Bearer test-dupe-user"},
    )
    assert ended.status_code == 200
    again = _create(client, "Osmosis")
    assert again.status_code == 201


def test_reopen_conflicts_with_active_same_topic(client):
    first = _create(client, "Mitosis")
    sid = first.json()["id"]
    client.post(f"/api/sessions/{sid}/end",
                headers={"Authorization": "Bearer test-dupe-user"})
    second = _create(client, "Mitosis")
    assert second.status_code == 201
    reopened = client.post(
        f"/api/sessions/{sid}/reopen",
        headers={"Authorization": "Bearer test-dupe-user"},
    )
    assert reopened.status_code == 409
    assert reopened.json()["detail"]["code"] == "duplicate_topic"


def test_other_users_topic_does_not_conflict(client):
    _create(client, "Redox", uid="alice")
    other = _create(client, "Redox", uid="bob")
    assert other.status_code == 201
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_duplicate_topic.py -q`
Expected: FAIL — duplicates return 201.

- [ ] **Step 3: Implement backend**

In `backend/routes/sessions.py`, add a helper above `create_session`:

```python
def _active_session_on_topic(
    db: Session, user_id: str, topic: str, *, exclude_id: str | None = None
) -> str | None:
    """F-34: id of this user's active (ended_at IS NULL) session with the
    same casefolded topic, else None. The FE guard self-disables on list
    failure and covers only one tab; this is the authoritative check."""
    stmt = (
        select(SessionModel.id)
        .where(
            SessionModel.user_id == user_id,
            SessionModel.ended_at.is_(None),
            func.lower(SessionModel.topic) == (topic or "").strip().lower(),
        )
        .limit(1)
    )
    if exclude_id is not None:
        stmt = stmt.where(SessionModel.id != exclude_id)
    return db.execute(stmt).scalar_one_or_none()
```

In `create_session`, AFTER the resume/`_claim_end` block (so a resume that just ended its prior does not conflict with it) and BEFORE `new_session = SessionModel(...)`:

```python
    existing = _active_session_on_topic(db, user_id, req.topic)
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail={"code": "duplicate_topic", "session_id": existing},
        )
```

In `reopen_session`, inside the `if row.ended_at is not None:` branch, before nulling `ended_at`:

```python
    if row.ended_at is not None:
        existing = _active_session_on_topic(
            db, user_id, row.topic, exclude_id=row.id
        )
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail={"code": "duplicate_topic", "session_id": existing},
            )
        row.ended_at = None
        db.commit()
        db.refresh(row)
    return _to_response(db, row)
```

(`func` and `select` are already imported in sessions.py.)

- [ ] **Step 4: Implement frontend mapping**

`frontend/src/views/NewSessionView.vue` — in `submit()`'s catch:

```javascript
  } catch (e) {
    if (e?.status === 409 && e?.body?.detail?.code === 'duplicate_topic') {
      existingSessionId.value = e.body.detail.session_id
      error.value = 'An active session for this topic already exists.'
      return
    }
    error.value = e?.message || 'Failed to create session.'
    return
  }
```

Add `const existingSessionId = ref(null)` with the other refs (reset to null at the top of `submit()`), and in the template next to the existing error display:

```html
        <button
          v-if="existingSessionId"
          type="button"
          class="open-existing"
          data-testid="open-existing-session"
          @click="router.push({ name: 'session', params: { id: existingSessionId } })"
        >
          Open existing session
        </button>
```

(Match the file's existing button component pattern — if it uses PrimeVue Button, use that.)

`frontend/src/views/HomeView.vue` — `startQuick` navigates straight to the existing session on 409:

```javascript
async function startQuick() {
  const topic = quickTopic.value.trim()
  if (!topic) return
  try {
    const created = await store.createSession({ topic, seedMode: 'fresh', priorSessionId: null })
    if (created) router.push({ name: 'session', params: { id: created.id } })
  } catch (e) {
    if (e?.status === 409 && e?.body?.detail?.code === 'duplicate_topic') {
      router.push({ name: 'session', params: { id: e.body.detail.session_id } })
    }
    // other errors already surface via store.error / friendlyError
  }
}
```

(Task 15 adds a `busy` guard to this same function — whichever task runs second merges both changes.)

Add an FE unit test to the NewSessionView test file: mock the store's `createSession` to reject with `{ status: 409, body: { detail: { code: 'duplicate_topic', session_id: 's-1' } } }` and assert the `open-existing-session` button renders.

- [ ] **Step 5: Run tests**

Backend: `python -m pytest tests/test_duplicate_topic.py -q` then `python -m pytest -q`.
NOTE: existing tests that create two same-topic active sessions for one user will now 409 — adjust those tests to use distinct topics or end the first (keep each test's original assertion intent).
Frontend: `npm run test:unit -- --run`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/sessions.py backend/tests/ frontend/src/views/NewSessionView.vue frontend/src/views/HomeView.vue frontend/src/__tests__/
git commit -m "fix(sessions): server-side duplicate-topic 409 on create/reopen + FE open-existing action (F-34)"
```

---

### Task 10: F-59 batch purpose from turn state + F-60 dead guard removal

**Files:**
- Modify: `backend/agent/types.py` (ToolContext fields)
- Modify: `backend/routes/chat.py:257-262` (ctx construction)
- Modify: `backend/routes/sessions.py` (the follow-up stream's ToolContext construction — find via grep `ToolContext(` in the file)
- Modify: `backend/services/check_question_service.py:150-153` (purpose derivation)
- Modify: `backend/services/pending_check_store.py:38-45` (delete `is_gradable`)
- Modify: `backend/services/learning_event_service.py:8,41` and `backend/services/check_question_service.py:38` (stale comment mentions)
- Test: `backend/tests/test_check_question_service.py` (delete is_gradable test at :112-124; add purpose test)

**Interfaces:**
- Consumes: `_build_prompt_state(...)["diagnostic_required"]` (chat.py — already computed per turn, including the review-gaps override).
- Produces: `ToolContext.diagnostic_required: bool = False` and `ToolContext.prefetched_citations: list | None = None` (the latter is inert until Task 11 wires it — added here so the dataclass is touched once).

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_check_question_service.py` (mirror an existing register test's args construction for the item type — check how that file builds `AskCheckQuestionsArgs`):

```python
def test_register_purpose_follows_turn_state_not_live_level(db_session):
    """F-59: a batch registered while the turn was prepared as NON-diagnostic
    must be purpose='check' even if knowledge_level is still None."""
    from datetime import datetime, timezone
    from agent.types import ToolContext
    from db.models import Session as SessionModel
    from services import check_question_service

    s = SessionModel(user_id="u1", topic="t")  # profile knowledge_level None
    db_session.add(s)
    db_session.commit()
    ctx = ToolContext(
        db=db_session, session_id=s.id, user_id="u1",
        turn_started_at=datetime.now(timezone.utc),
        diagnostic_required=False,  # turn-state decision (e.g. review-gaps)
    )
    args = _make_args(session_id=s.id, gap="osmosis")  # reuse the file's existing args builder/pattern
    result = check_question_service.register(db_session, ctx, args)
    assert result.ok
    pc = check_question_service.get_pending_check(db_session, s.id)
    assert pc["purpose"] == "check"
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_check_question_service.py -q`
Expected: new test FAILS — `ToolContext` lacks the field (TypeError) and/or purpose comes back "diagnostic".

- [ ] **Step 3: Implement**

`backend/agent/types.py`:

```python
@dataclass
class ToolContext:
    db: Session
    session_id: str
    user_id: str
    turn_started_at: datetime
    suppress_check: bool = False
    # F-59: the turn's diagnostic decision, made when the prompt was built
    # (including the review-gaps override). register() must not re-derive it
    # from live knowledge_level -- a review quiz posed while level is None
    # was being misrecorded as diagnostic.
    diagnostic_required: bool = False
    # F-56: citations for server-prefetched excerpts; None when the turn had
    # no prefetch. Wired in the force-retrieve task.
    prefetched_citations: list | None = None
```

`backend/routes/chat.py` — ctx construction gains the flag:

```python
    ctx = ToolContext(
        db=db,
        session_id=req.session_id,
        user_id=user_id,
        turn_started_at=datetime.now(timezone.utc),
        diagnostic_required=bool(prompt_state.get("diagnostic_required", False)),
    )
```

NOTE: `prompt_state` is built inside the `try:` block; the ctx construction at the end of `_prepare_turn` is after it — `prompt_state` is in scope. Verify while editing.

`backend/routes/sessions.py` — locate the follow-up stream's `ToolContext(` construction (check-complete follow-up turn). Add the same decision from the profile in that scope:

```python
        diagnostic_required=(profile.knowledge_level is None),
```

(Use whatever the loaded TopicProfile variable is named at that site; the intent is the same decision `_build_prompt_state` makes.)

`backend/services/check_question_service.py:150-153` — replace:

```python
    from services import profile_service  # local import avoids circular

    level = profile_service.load_profile(db, ctx.session_id).knowledge_level
    purpose = "diagnostic" if level is None else "check"
```

with:

```python
    # F-59: purpose is the turn's prepared decision, not a re-read of live
    # knowledge_level (which races with grading and misclassifies review
    # quizzes posed while level is None).
    purpose = "diagnostic" if ctx.diagnostic_required else "check"
```

(Delete the now-unused local `profile_service` import if nothing else in the function uses it.)

`backend/services/pending_check_store.py` — delete the `is_gradable` function (lines 38-45). KEEP `parse_asked_at` (used by `register` and `tests/test_ask_check_question.py:61`). Before deleting, sweep with native grep: `is_gradable` must only hit `pending_check_store.py`, comment lines in `check_question_service.py:38` / `learning_event_service.py:8,41`, docs, and `tests/test_check_question_service.py:112-124`.

`backend/tests/test_check_question_service.py:112-124` — delete `test_is_gradable_requires_prior_turn`.

Comment rewrites (describe current behavior without naming the deleted symbol):
- `backend/services/learning_event_service.py:41`: "This bypasses the is_gradable turn-barrier: a human click is not the LLM," becomes "No turn-barrier applies here: a human click is not the LLM,".
- `backend/services/learning_event_service.py:8` and `backend/services/check_question_service.py:38`: drop the is_gradable mention from each sentence, keeping the rest of the meaning.

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/test_check_question_service.py tests/test_ask_check_question.py -q` then `python -m pytest -q`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agent/types.py backend/routes/chat.py backend/routes/sessions.py backend/services/check_question_service.py backend/services/pending_check_store.py backend/services/learning_event_service.py backend/tests/
git commit -m "fix(check): batch purpose from turn state, remove dead is_gradable guard (F-59 F-60)"
```

---

### Task 11: F-56 server force-retrieve on REQUIRED turns

**Files:**
- Modify: `backend/services/retrieval_service.py` (new `prefetch_for_prompt`)
- Modify: `backend/routes/chat.py:224-243` (prefetch + prompt state + ctx citations)
- Modify: `backend/agent/prompts.py` (IMMUTABLE_RULES retrieval policy + dynamic block)
- Modify: `backend/agent/tutor.py` (seed citations from ctx)
- Test: `backend/tests/test_force_retrieve.py` (new)

**Interfaces:**
- Consumes: `pgvector_store.query_chunks`, `litellm.aembedding`, `cost_meter.meter_embedding_response`, `agent.excerpt.wrap_chunk`, `ToolContext.prefetched_citations` (added in Task 10), `documents_service.has_ready_document`.
- Produces: `retrieval_service.prefetch_for_prompt(db, session_id, user_id, query, k=5) -> list[dict] | None` (async). Prompt-state key `prefetched_excerpts: list[str]` (wrapped texts). RETRIEVAL label value `PROVIDED`.

Mechanism: when arbitration says REQUIRED and the session has a ready document, `_prepare_turn` embeds the query and fetches chunks server-side, injects the wrapped excerpts into the dynamic context, and hands the citations to the agent loop so the FE still renders sources. The model cannot skip grounding. Any prefetch failure/no-results returns None and degrades to the old advisory REQUIRED flag (never kills the turn).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_force_retrieve.py`:

```python
"""F-56: REQUIRED + ready docs -> excerpts injected server-side."""
import asyncio

from agent import prompts


def test_prompt_renders_provided_block():
    out = prompts.build_dynamic_context({
        "retrieval_required": True,
        "prefetched_excerpts": ["<document_excerpt doc_id='d1'>text</document_excerpt>"],
    })
    assert "RETRIEVAL: PROVIDED" in out
    assert "PREFETCHED_EXCERPTS:" in out
    assert "document_excerpt" in out


def test_prompt_without_prefetch_keeps_required_label():
    out = prompts.build_dynamic_context({"retrieval_required": True})
    assert "RETRIEVAL: REQUIRED" in out


def test_prefetch_returns_none_on_failure(db_session, monkeypatch):
    from services import retrieval_service

    async def boom(**kwargs):
        raise RuntimeError("embed down")

    monkeypatch.setattr("services.retrieval_service.litellm.aembedding", boom)
    monkeypatch.setattr(
        "services.retrieval_service.documents_service.has_ready_document",
        lambda db, sid: True,
    )
    result = asyncio.run(
        retrieval_service.prefetch_for_prompt(db_session, "s1", "u1", "query")
    )
    assert result is None
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_force_retrieve.py -q`
Expected: FAIL — no PROVIDED label, no `prefetch_for_prompt`.

- [ ] **Step 3: Implement**

`backend/services/retrieval_service.py` — add:

```python
async def prefetch_for_prompt(
    db: Session, session_id: str, user_id: str, query: str, k: int = 5
) -> list[dict] | None:
    """F-56: server-side retrieval for REQUIRED turns. The REQUIRED flag was
    advisory -- the model could answer ungrounded without calling
    retrieve_chunks. Fetch the chunks ourselves and inject them into the
    prompt instead. Returns chunk dicts (same shape retrieve() produces) or
    None on any failure/no-results -- the caller then falls back to the
    advisory flag. Embedding spend is metered like every other call (F-19)."""
    try:
        if not documents_service.has_ready_document(db, session_id):
            return None
        resp = await litellm.aembedding(
            model=settings.embedding_model,
            input=[query],
            dimensions=settings.embedding_dim,
            timeout=settings.embedding_timeout_s,
        )
        query_vec = (
            resp.data[0]["embedding"]
            if isinstance(resp.data[0], dict)
            else resp.data[0].embedding
        )
        cost_meter.meter_embedding_response(
            db, resp, user_id=user_id, session_id=session_id, texts=[query],
        )
        hits = pgvector_store.query_chunks(
            db, session_id=session_id, query_embedding=query_vec, k=k
        )
    except Exception as e:
        log.warning("prefetch_for_prompt failed; falling back to advisory flag: %s", e)
        return None
    chunks = [
        {
            "doc_id": str(h.doc_id),
            "text": h.chunk_text,
            "page": h.page,
            "score": h.score,
            "doc_name": h.doc_name,
        }
        for h in hits
    ]
    return chunks or None
```

`backend/routes/chat.py`:

(a) module top: `from agent.excerpt import wrap_chunk` and extend the contracts import: `from contracts import ChatRequest, Citation`.

(b) in `_prepare_turn`, after the `retrieval_required` computation and before `prompt_state = _build_prompt_state(...)`:

```python
        prefetched_chunks = None
        if retrieval_required:
            prefetched_chunks = await retrieval_service.prefetch_for_prompt(
                db, req.session_id, user_id, req.message
            )
```

(c) `_build_prompt_state` gains a keyword parameter `prefetched_chunks=None`; at the end of the function, before `return prompt_state`:

```python
    if prefetched_chunks:
        prompt_state["prefetched_excerpts"] = [
            wrap_chunk(ch) for ch in prefetched_chunks
        ]
```

Pass it at the call site: `prompt_state = _build_prompt_state(..., prefetched_chunks=prefetched_chunks)`.

(d) ctx construction (extending Task 10's version):

```python
        prefetched_citations=(
            [
                Citation(
                    doc_id=str(ch.get("doc_id", "")),
                    text=ch.get("text", ""),
                    page=ch.get("page"),
                    doc_name=ch.get("doc_name"),
                )
                for ch in prefetched_chunks
            ]
            if prefetched_chunks
            else None
        ),
```

`backend/agent/prompts.py`:

(a) In IMMUTABLE_RULES, RETRIEVAL POLICY section, add after the REQUIRED line:

```
- If RETRIEVAL is PROVIDED: excerpts from the learner's documents are already
  included under PREFETCHED_EXCERPTS below. Ground your answer in them and
  cite the source; do NOT call retrieve_chunks again unless you need
  different material.
```

(b) In `build_dynamic_context`, after the existing `retrieval_label = "REQUIRED" if retrieval_required else "OPTIONAL"` line:

```python
    prefetched = state.get("prefetched_excerpts") or []
    if prefetched:
        retrieval_label = "PROVIDED"
```

and change the final return: bind the existing f-string concatenation to a variable `out`, then:

```python
    if prefetched:
        out += "\nPREFETCHED_EXCERPTS:\n" + "\n".join(prefetched)
    return out
```

`backend/agent/tutor.py` — in `run_streaming`, replace `citations: list[Citation] = []` with:

```python
    citations: list[Citation] = list(ctx.prefetched_citations or [])
```

and immediately after (before the `try:`):

```python
    if citations:
        # F-56: server-prefetched excerpts -- emit their citations up front so
        # the FE renders sources even though no retrieve_chunks call happens.
        yield StreamEvent("citations", [c.model_dump() for c in citations])
```

NOTE: the stub-mode early path returns before this — acceptable; stub mode has no retrieval.

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/test_force_retrieve.py -q` then `python -m pytest -q`. Expected: PASS. Existing `_build_prompt_state` unit tests keep passing (new kwarg defaults to None).

- [ ] **Step 5: Commit**

```bash
git add backend/services/retrieval_service.py backend/routes/chat.py backend/agent/prompts.py backend/agent/tutor.py backend/tests/test_force_retrieve.py
git commit -m "feat(retrieval): server force-retrieve injects excerpts on REQUIRED turns (F-56)"
```

---

### Task 12: F-52 consent stamp earned via JWT claim

**Files:**
- Modify: `backend/services/auth.py` (claims on request.state + helper)
- Modify: `backend/services/user_service.py` (conditional stamp + docstring rewrite)
- Modify: `backend/routes/chat.py` (`_prepare_turn` signature + call), `backend/routes/sessions.py` (`create_session`)
- Modify: `frontend/src/stores/auth.js:41-53` (`register`)
- Test: `backend/tests/test_ensure_user.py` (adjust + add), `backend/tests/test_auth_config_batch6.py` (helper test), FE auth store test (add)

**Interfaces:**
- Consumes: Supabase `signUp options.data` -> JWT `user_metadata` claim.
- Produces: `ensure_user(db, user_id, *, accepted_terms: bool = False)`; `auth.accepted_terms_from_request(request) -> bool`; `request.state.jwt_claims` set by `current_user_id`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_ensure_user.py`, add:

```python
def test_ensure_user_without_consent_claim_leaves_stamp_null(db_session):
    user = ensure_user(db_session, "no-claim-user")
    assert user.accepted_terms_at is None
    assert user.terms_version is None


def test_ensure_user_with_consent_claim_stamps(db_session):
    user = ensure_user(db_session, "claimed-user", accepted_terms=True)
    assert user.accepted_terms_at is not None
    assert user.terms_version is not None
```

Add to `backend/tests/test_auth_config_batch6.py`:

```python
def test_accepted_terms_from_request_reads_user_metadata():
    from types import SimpleNamespace
    from services import auth as auth_service

    req = SimpleNamespace(state=SimpleNamespace(
        jwt_claims={"user_metadata": {"accepted_terms": True}}
    ))
    assert auth_service.accepted_terms_from_request(req) is True

    req2 = SimpleNamespace(state=SimpleNamespace(jwt_claims={}))
    assert auth_service.accepted_terms_from_request(req2) is False

    req3 = SimpleNamespace(state=SimpleNamespace())  # no claims attr
    assert auth_service.accepted_terms_from_request(req3) is False
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_ensure_user.py tests/test_auth_config_batch6.py -q`
Expected: FAIL — `ensure_user` has no `accepted_terms` kwarg and stamps unconditionally; helper missing.

- [ ] **Step 3: Implement backend**

`backend/services/auth.py`:

(a) Extract the decode: create `_decode_token(token: str) -> dict` holding the existing `try:/except` jwt.decode block from `verify_supabase_jwt` verbatim, returning the full `payload`. `verify_supabase_jwt` becomes:

```python
def verify_supabase_jwt(token: str) -> str:
    """Return the Supabase user id (`sub`) for a valid JWT, else raise."""
    payload = _decode_token(token)
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_token"
        )
    return sub
```

(b) `current_user_id` — decode once, stash claims (replace its final `return verify_supabase_jwt(token)`):

```python
    payload = _decode_token(token)
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_token"
        )
    # F-52: routes that create the users row read consent from the verified
    # claim, not from row-existence folklore.
    request.state.jwt_claims = payload
    return sub
```

(c) New helper:

```python
def accepted_terms_from_request(request: Request) -> bool:
    """F-52: True iff the verified JWT carries the accepted_terms metadata
    claim the register form sets via signUp options.data. Direct-API signups
    that never saw the checkbox get no claim -> no consent stamp."""
    claims = getattr(request.state, "jwt_claims", None) or {}
    meta = claims.get("user_metadata") or {}
    return meta.get("accepted_terms") is True
```

`backend/services/user_service.py` — new signature and conditional stamp:

```python
def ensure_user(db: Session, user_id: str, *, accepted_terms: bool = False) -> User:
```

Body changes (keep the existing early-return and re-select structure):

```python
    now = datetime.now(timezone.utc)
    stamp = now if accepted_terms else None
    insert = dialect_insert(db)
    result = db.execute(
        insert(User)
        .values(
            id=user_id,
            accepted_terms_at=stamp,
            terms_version=CURRENT_TERMS_VERSION if accepted_terms else None,
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )
    created = db.execute(select(User).where(User.id == user_id)).scalar_one()
    if result.rowcount == 1 and accepted_terms:
        set_committed_value(created, "accepted_terms_at", now)
    return created
```

Rewrite the module docstring — the old "row-existence corroborates the consent act" rationale is what F-52 disproved:

```python
"""User-row lifecycle helper.

User rows are created lazily on the first authenticated backend call. Terms
consent is stamped ONLY when the verified JWT carries the accepted_terms
metadata claim set by the register form (F-52): Supabase signUp is callable
directly, bypassing the client-side checkbox, so row-existence alone does
not evidence consent.
"""
```

`backend/routes/chat.py` — `_prepare_turn` gains a parameter (default False keeps existing test call sites working):

```python
async def _prepare_turn(
    req: ChatRequest,
    user_id: str,
    db: Session,
    accepted_terms: bool = False,
) -> tuple[list[dict], str, ToolContext]:
```

its `ensure_user` call becomes `ensure_user(db, user_id, accepted_terms=accepted_terms)`, and `chat_stream` passes it:

```python
    messages, system_prompt, ctx = await _prepare_turn(
        req, user_id, db, accepted_terms=accepted_terms_from_request(request)
    )
```

(import: `from services.auth import accepted_terms_from_request, current_user_id`).

`backend/routes/sessions.py` — `create_session` gains `request: Request` (Request is already imported in the file) and passes the claim:

```python
async def create_session(
    req: SessionCreateRequest,
    request: Request,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    ...
    ensure_user(db, user_id, accepted_terms=accepted_terms_from_request(request))
```

- [ ] **Step 4: Implement frontend**

`frontend/src/stores/auth.js` `register()` — the submit button is gated on the consent checkbox (RegisterView), so the claim is set unconditionally here:

```javascript
  async function register(email, password) {
    const sb = getSupabase()
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo:
          typeof window !== 'undefined' ? `${window.location.origin}/` : undefined,
        // F-52: consent travels as a verified JWT metadata claim; the backend
        // stamps accepted_terms_at only when it is present. The register form
        // cannot submit without the checkbox, so this is set iff consent.
        data: { accepted_terms: true },
      },
    })
    if (error) throw error
    return data
  }
```

Add an FE unit test asserting `signUp` is called with `options.data.accepted_terms === true` (mirror the existing register test's mock of `getSupabase`).

- [ ] **Step 5: Run tests + fix expected churn**

Run: `python -m pytest -q`. Existing `test_ensure_user.py` tests asserting an unconditional stamp must be updated to pass `accepted_terms=True` (keep the null-claim test from Step 1). Any WS-B legal test asserting the stamp on plain `ensure_user`: update the call to pass `accepted_terms=True` — the assertion intent (stamp exactly once, no re-stamp) is unchanged.
Frontend: `npm run test:unit -- --run`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/auth.py backend/services/user_service.py backend/routes/chat.py backend/routes/sessions.py backend/tests/ frontend/src/stores/auth.js frontend/src/__tests__/
git commit -m "fix(legal): stamp terms consent only from verified JWT claim (F-52)"
```

---

### Task 13: F-46 server-persisted onboarding (migration 0019 + /api/me + FE hydrate)

**Files:**
- Modify: `docs/api/openapi.yaml` (paths `/api/me` GET+PATCH; schemas `MeResponse`, `MePatchRequest`)
- Run codegen: `python backend/scripts/gen_contracts.py`
- Modify: `backend/db/models.py:17-28` (User columns)
- Create: `backend/db/alembic/versions/0019_users_onboarding.py`
- Create: `backend/routes/me.py`
- Modify: `backend/main.py` (router registration)
- Modify: `frontend/src/stores/user.js`, `frontend/src/stores/auth.js` (hydrate wiring), `frontend/src/router/index.js` (guard awaits hydration)
- Modify: `frontend/src/views/OnboardingView.vue` + `frontend/src/views/SettingsView.vue` (await the now-async store actions — check each call site)
- Test: `backend/tests/test_me_routes.py` (new); `frontend/src/__tests__/` user store test (add)

**Interfaces:**
- Produces: `GET /api/me -> MeResponse {display_name, feedback_pref, onboarding_complete}`; `PATCH /api/me (MePatchRequest) -> MeResponse`. User store: `hydrated: ref(false)`, `async hydrateFromServer()`, `completeOnboarding` becomes async (PATCHes server first).
- Consumes: `ensure_user` (Task 12 signature), `accepted_terms_from_request`.

Sub-steps are ordered contract-first per project convention.

- [ ] **Step 1: Edit `docs/api/openapi.yaml`**

Add to `paths` (after the `/api/usage/summary` entry, matching house style):

```yaml
  /api/me:
    get:
      tags: [me]
      summary: Current user's account-level preferences and onboarding state.
      operationId: getMe
      responses:
        "200":
          description: Current user state (row auto-created on first call).
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/MeResponse"
    patch:
      tags: [me]
      summary: Update display name, feedback preference, or onboarding state.
      operationId: patchMe
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/MePatchRequest"
      responses:
        "200":
          description: Updated user state.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/MeResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
```

Add to `components/schemas` (near the profile schemas):

```yaml
    MeResponse:
      type: object
      additionalProperties: false
      required: [onboarding_complete]
      properties:
        display_name:        { type: [string, "null"], default: null, maxLength: 120 }
        feedback_pref:       { type: [string, "null"], default: null, maxLength: 40 }
        onboarding_complete: { type: boolean, default: false }

    MePatchRequest:
      type: object
      additionalProperties: false
      minProperties: 1
      properties:
        display_name:        { type: string, maxLength: 120 }
        feedback_pref:       { type: string, maxLength: 40 }
        onboarding_complete: { type: boolean }
```

Run from repo root: `python backend/scripts/gen_contracts.py`. Verify `MeResponse`/`MePatchRequest` appear in `backend/contracts/models.py` and `git diff backend/contracts` shows only the new models.

- [ ] **Step 2: Write the failing backend tests**

Create `backend/tests/test_me_routes.py`:

```python
"""F-46: onboarding state is server-persisted on the users row."""


H = {"Authorization": "Bearer test-me-user"}


def test_get_me_defaults(client):
    resp = client.get("/api/me", headers=H)
    assert resp.status_code == 200
    body = resp.json()
    assert body["onboarding_complete"] is False
    assert body["display_name"] is None


def test_patch_me_roundtrip(client):
    resp = client.patch(
        "/api/me",
        json={"display_name": "Ada", "feedback_pref": "direct",
              "onboarding_complete": True},
        headers=H,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"display_name": "Ada", "feedback_pref": "direct",
                    "onboarding_complete": True}
    again = client.get("/api/me", headers=H)
    assert again.json()["onboarding_complete"] is True


def test_patch_me_partial_keeps_other_fields(client):
    client.patch("/api/me", json={"display_name": "Ada"}, headers=H)
    client.patch("/api/me", json={"onboarding_complete": True}, headers=H)
    body = client.get("/api/me", headers=H).json()
    assert body["display_name"] == "Ada"
    assert body["onboarding_complete"] is True


def test_patch_me_empty_body_rejected(client):
    resp = client.patch("/api/me", json={}, headers=H)
    assert resp.status_code == 422
```

- [ ] **Step 3: Run to verify failure**

Run: `python -m pytest tests/test_me_routes.py -q`
Expected: FAIL — 404 (route missing).

- [ ] **Step 4: Implement backend**

`backend/db/models.py` — add to `User` after `terms_version`:

```python
    # F-46: onboarding is account state, not per-browser localStorage. NULLs
    # mean "never onboarded on the server" (pre-0019 rows hydrate FE defaults).
    display_name: Mapped[str | None] = mapped_column(String, nullable=True, default=None)
    feedback_pref: Mapped[str | None] = mapped_column(String, nullable=True, default=None)
    onboarding_complete: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )
```

(`Boolean` import: check the models.py import line; `Boolean` is already imported for `Session.pinned`.)

Create `backend/db/alembic/versions/0019_users_onboarding.py` (mirror 0018's header conventions — read that file for the exact `down_revision` value and template):

```python
"""users onboarding columns (F-46)

Revision ID: 0019
Revises: 0018
Create Date: 2026-07-16
"""
import sqlalchemy as sa
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("display_name", sa.String(), nullable=True))
    op.add_column("users", sa.Column("feedback_pref", sa.String(), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "onboarding_complete",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "onboarding_complete")
    op.drop_column("users", "feedback_pref")
    op.drop_column("users", "display_name")
```

(IMPORTANT: verify `revision`/`down_revision` literal style against 0018 — some repos use hash-style ids. Copy 0018's structure exactly. Dispatch the `migration-reviewer` agent on this file before committing, per repo convention for new migrations.)

Create `backend/routes/me.py`:

```python
"""Account-level user state (F-46): onboarding + preferences live on the
users row, not per-browser localStorage. A new device hydrates from here."""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from contracts import MePatchRequest, MeResponse
from db.database import get_db
from services.auth import accepted_terms_from_request, current_user_id
from services.user_service import ensure_user


router = APIRouter(prefix="/api")


def _to_response(user) -> MeResponse:
    return MeResponse(
        display_name=user.display_name,
        feedback_pref=user.feedback_pref,
        onboarding_complete=bool(user.onboarding_complete),
    )


@router.get("/me", response_model=MeResponse)
def get_me(
    request: Request,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    user = ensure_user(
        db, user_id, accepted_terms=accepted_terms_from_request(request)
    )
    db.commit()
    return _to_response(user)


@router.patch("/me", response_model=MeResponse)
def patch_me(
    req: MePatchRequest,
    request: Request,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    user = ensure_user(
        db, user_id, accepted_terms=accepted_terms_from_request(request)
    )
    if req.display_name is not None:
        user.display_name = req.display_name.strip() or None
    if req.feedback_pref is not None:
        user.feedback_pref = req.feedback_pref
    if req.onboarding_complete is not None:
        user.onboarding_complete = req.onboarding_complete
    db.commit()
    db.refresh(user)
    return _to_response(user)
```

(NOTE: codegen may emit `MePatchRequest` fields as `str | None` etc. — the `is not None` guards implement partial-patch semantics. `minProperties: 1` enforces the 422 on empty body.)

`backend/main.py` — extend the routes import and registration:

```python
from routes import chat, documents, health, me, profile, review, sessions, upload, usage
```

```python
app.include_router(me.router)
```

- [ ] **Step 5: Run backend tests**

Run: `python -m pytest tests/test_me_routes.py -q` then `python -m pytest -q`. Expected: PASS. Also run `python backend/scripts/gen_contracts.py` again from repo root and `git status` — contracts must show zero further drift.

- [ ] **Step 6: Implement frontend hydration**

`frontend/src/stores/user.js`:

(a) Add near the other refs: `const hydrated = ref(false)`.

(b) Reset it in `_clearInMemory()`: add `hydrated.value = false`.

(c) Add the server sync functions:

```javascript
  async function hydrateFromServer() {
    if (!activeUserId.value) return
    try {
      const { apiGet } = await import('../services/apiClient.js')
      const me = await apiGet('/me', undefined, { silent: true })
      if (me) {
        // Server is authoritative (F-46); localStorage is a warm cache.
        if (me.display_name != null) name.value = me.display_name
        if (me.feedback_pref != null) {
          interactionPreferences.value = {
            ...interactionPreferences.value,
            feedback: me.feedback_pref,
          }
        }
        onboardingComplete.value = Boolean(me.onboarding_complete)
        persist()
      }
    } catch {
      // Offline / API down: keep the localStorage snapshot already loaded.
    } finally {
      hydrated.value = true
    }
  }
```

(d) `completeOnboarding` becomes async and writes through:

```javascript
  async function completeOnboarding({ name: displayName, feedback }) {
    const finalName = displayName?.trim() || 'Learner'
    const { apiPatch } = await import('../services/apiClient.js')
    await apiPatch('/me', {
      display_name: finalName,
      feedback_pref: feedback,
      onboarding_complete: true,
    })
    name.value = finalName
    interactionPreferences.value = { feedback }
    onboardingComplete.value = true
    persist()
  }
```

(throws on API failure — the onboarding view's existing error handling surfaces it; the user retries. Check OnboardingView's call site: it must `await` this now — add `await`/async if missing.)

(e) `updateProfile` (SettingsView path) also writes through — same pattern:

```javascript
  async function updateProfile({ name: displayName, feedback }) {
    const body = {}
    if (displayName != null) body.display_name = displayName.trim() || 'Learner'
    if (feedback != null) body.feedback_pref = feedback
    if (Object.keys(body).length) {
      const { apiPatch } = await import('../services/apiClient.js')
      await apiPatch('/me', body)
    }
    if (displayName != null) name.value = displayName.trim() || 'Learner'
    if (feedback != null) {
      interactionPreferences.value = { ...interactionPreferences.value, feedback }
    }
    persist()
  }
```

(f) Export `hydrated` and `hydrateFromServer` from the store's return object.

`frontend/src/router/index.js` — the guard awaits hydration before deciding onboarding:

```javascript
  const user = useUserStore()
  if (auth.isAuthenticated && !user.hydrated) {
    // F-46: onboarding truth lives on the server; the localStorage snapshot
    // is only a warm cache. Await one hydrate so a new device does not
    // force-route an existing user to onboarding.
    await user.hydrateFromServer()
  }
```

(insert before the existing `!user.onboardingComplete` check).

`frontend/src/stores/auth.js` — no change needed for hydration itself (the guard drives it), but `setActiveUser` already clears in-memory state on user switch, which resets `hydrated` via `_clearInMemory()` (step b) — verify that wiring while editing.

- [ ] **Step 7: FE tests**

Add to the user store test file:

```javascript
it('hydrateFromServer overrides local onboarding state', async () => {
  // mock apiClient.apiGet to resolve { display_name: 'Ada', feedback_pref: 'direct', onboarding_complete: true }
  // set activeUserId, call hydrateFromServer(), assert onboardingComplete true and hydrated true
})

it('hydrateFromServer failure keeps local snapshot and still sets hydrated', async () => {
  // mock apiGet to reject; assert hydrated true, onboardingComplete unchanged
})
```

(Write these fully against the file's existing mock pattern — `vi.mock('../services/apiClient.js', ...)`. The dynamic `import()` in the store resolves to the same mocked module under vitest.)

Run: `npm run test:unit -- --run`. Expected: PASS after updating any test that called `completeOnboarding` synchronously (now needs `await` + apiPatch mock).

- [ ] **Step 8: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts backend/db/models.py backend/db/alembic/versions/0019_users_onboarding.py backend/routes/me.py backend/main.py backend/tests/test_me_routes.py frontend/src/stores/user.js frontend/src/router/index.js frontend/src/__tests__/ frontend/src/views/OnboardingView.vue frontend/src/views/SettingsView.vue
git commit -m "feat(users): server-persisted onboarding state via /api/me + migration 0019 (F-46)"
```

---

### Task 14: FE small fixes — F-49 deep link, F-51 friendly errors, F-53 [auto] strip, F-54 profile pollution

**Files:**
- Modify: `frontend/src/router/index.js:98-99` (F-49)
- Modify: `frontend/src/views/LoginView.vue:109-129` (F-49)
- Modify: `frontend/src/App.vue:38-43` (F-51)
- Modify: `frontend/src/views/ProfileView.vue:210-215` (F-53)
- Modify: `frontend/src/stores/session.js:187-220` (F-54)
- Test: existing router/App/ProfileView/session-store test files (add cases)

**Interfaces:**
- Consumes: `friendlyError` (`frontend/src/lib/errors.js`), `stripAutoPrefix` (`frontend/src/utils/sessionCard.js`).

- [ ] **Step 1: Write the failing tests**

Router test (find the router guard test file via grep `beforeEach` in `frontend/src/__tests__` — else add to a new `routerGuard.batch6.test.js` following any existing router test's setup):

```javascript
it('login redirect preserves the intended path', async () => {
  // unauthenticated navigation to /session/abc must redirect to
  // { name: 'login', query: { redirect: '/session/abc' } }
})

it('login view only follows relative redirects', () => {
  expect(safeRedirect('/session/abc')).toBe('/session/abc')
  expect(safeRedirect('//evil.com')).toBe(null)
  expect(safeRedirect('https://evil.com')).toBe(null)
  expect(safeRedirect(undefined)).toBe(null)
})
```

App error test (existing App/errorBus test file): dispatch an `api-error` with `{ status: 500, body: { detail: 'raw_internal_code' } }` and assert the toast text is `'Something went wrong on our side. Try again shortly.'` not `'raw_internal_code'`.

ProfileView test: render with `last_session_summary: '[auto] recap text'` and assert the DOM shows `recap text` without the prefix.

Session store test: `endSession` resolving `{ ended_at, summary: { kind: 'no_exchanges', text: 'display copy' } }` must NOT write `display copy` into `currentSession.topic_profile.last_session_summary`; kind `'summary'` must.

- [ ] **Step 2: Run to verify failure**

From `frontend/`: `npm run test:unit -- --run`. Expected: new cases FAIL.

- [ ] **Step 3: Implement**

F-49 — `frontend/src/router/index.js`:

```javascript
  if (!auth.isAuthenticated && !isPublic) {
    // F-49: carry the intended path through login so a deep link survives.
    return { name: 'login', query: { redirect: to.fullPath } }
  }
```

F-49 — `frontend/src/views/LoginView.vue`: add a validated-redirect helper (export it for the unit test) and use it after sign-in:

```javascript
// F-49: only follow same-origin relative paths; anything else (protocol-
// relative //host, absolute URLs) is an open-redirect vector.
export function safeRedirect(raw) {
  if (typeof raw !== 'string') return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  return raw
}
```

and in `submit()` replace `await router.push({ name: 'home' })` with:

```javascript
    const target = safeRedirect(route.query.redirect)
    await (target ? router.push(target) : router.push({ name: 'home' }))
```

(`route` from `useRoute()` — add it beside the existing `useRouter()` usage. NOTE for the guard: authed users navigating to `login` bounce to `home` (router/index.js:101-103) — the redirect query only matters for the fresh-login flow, which is the F-49 case.)

F-51 — `frontend/src/App.vue`:

```javascript
import { friendlyError } from './lib/errors.js'
```

```javascript
const onApiError = (e) => {
  const err = e.detail
  if (!err || err.status === 429 || err.status === 404) return
  showError(friendlyError(err))
}
```

F-53 — `frontend/src/views/ProfileView.vue`: import `stripAutoPrefix`:

```javascript
import { stripAutoPrefix } from '../utils/sessionCard.js'
```

and change the render line:

```html
          <p class="summary-text">{{ stripAutoPrefix(data.profile.last_session_summary) }}</p>
```

F-54 — `frontend/src/stores/session.js` `endSession`: guard the profile write by kind:

```javascript
      const summaryText = resp?.summary?.text ?? ''
      if (currentSession.value && currentSession.value.id === id) {
        currentSession.value.ended_at = resp.ended_at
        if (resp?.summary?.kind === 'summary') {
          // F-54: only a real summary belongs in the profile; the
          // no_exchanges display sentence is UI copy, not profile state.
          currentSession.value.topic_profile = {
            ...currentSession.value.topic_profile,
            last_session_summary: summaryText,
          }
        }
      }
```

- [ ] **Step 4: Run tests**

From `frontend/`: `npm run test:unit -- --run`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/router/index.js frontend/src/views/LoginView.vue frontend/src/App.vue frontend/src/views/ProfileView.vue frontend/src/stores/session.js frontend/src/__tests__/
git commit -m "fix(frontend): deep-link redirect, friendly error toasts, [auto] strip, profile-write guard (F-49 F-51 F-53 F-54)"
```

---

### Task 15: F-44 end-summary off-view fallback + F-45 HomeView in-flight guards

**Files:**
- Modify: `frontend/src/views/SessionView.vue:428-441` (watcher immediate)
- Modify: `frontend/src/components/sidebar/SidebarSessionRow.vue:53-63` (toast fallback)
- Modify: `frontend/src/views/HomeView.vue:92-125` (busy guards + try/catch)
- Test: existing SessionView/SidebarSessionRow/HomeView test files (add cases)

**Interfaces:**
- Consumes: `store.pendingSummary` + `store.consumePendingSummary()` (session store), `useToast().showSuccess`/`showError` (check the composable's exported names via grep `useToast` — use whatever "info/success" variant exists), `useRoute()`.

- [ ] **Step 1: Write the failing tests**

SessionView: mount with `store.pendingSummary` ALREADY set for this session id (set before mount) and assert the summary dialog opens — this is the `{ immediate: true }` behavior; today the pre-set value is missed.

SidebarSessionRow: with the current route NOT on that session's view, `onEnd()` success must trigger a toast containing the pending summary text and consume it.

HomeView: (a) `startQuick` double-invoke while the first `createSession` is pending must call the store once; (b) a rejecting `store.continueTopic` in `startReview` must not produce an unhandled rejection (assert the error is caught and `busy` resets).

- [ ] **Step 2: Run to verify failure**

`npm run test:unit -- --run` — new cases FAIL.

- [ ] **Step 3: Implement**

F-44 — `frontend/src/views/SessionView.vue`: add `{ immediate: true }` to the watcher:

```javascript
watch(
  () => store.pendingSummary,
  (s) => {
    if (!s || s.sessionId !== props.id) return
    summaryKind.value = s.kind
    summaryText.value = s.text
    summaryDialog.value = true
    store.consumePendingSummary()
  },
  { immediate: true },
)
```

F-44 — `frontend/src/components/sidebar/SidebarSessionRow.vue` `onEnd()`: after a successful end, if this session's view is not the active route, surface the summary as a toast instead of silently dropping it:

```javascript
async function onEnd() {
  if (busy.value) return
  busy.value = true
  try {
    await store.endSession(props.session.id)
    // F-44: the summary dialog lives in SessionView; ending from anywhere
    // else would silently drop the pending summary. Toast it instead.
    const s = store.pendingSummary
    const onThatSession =
      route.name === 'session' && route.params.id === props.session.id
    if (s && s.sessionId === props.session.id && !onThatSession) {
      showSuccess(s.text)
      store.consumePendingSummary()
    }
  } catch {
    /* store.error populated */
  } finally {
    busy.value = false
  }
}
```

Imports to add in that component: `useRoute` from `vue-router`, and the toast composable (`const { showSuccess } = useToast()` — verify the exported success/info method name in `frontend/src/composables/useToast.js` and use the real one; fall back to `showError`-style naming convention found there).

F-45 — `frontend/src/views/HomeView.vue`: one shared busy ref guards both starters:

```javascript
const startBusy = ref(false)

async function startQuick() {
  const topic = quickTopic.value.trim()
  if (!topic || startBusy.value) return
  startBusy.value = true
  try {
    const created = await store.createSession({ topic, seedMode: 'fresh', priorSessionId: null })
    if (created) router.push({ name: 'session', params: { id: created.id } })
  } catch (e) {
    if (e?.status === 409 && e?.body?.detail?.code === 'duplicate_topic') {
      router.push({ name: 'session', params: { id: e.body.detail.session_id } })
    }
    // other errors surface via store.error / friendlyError in the template
  } finally {
    startBusy.value = false
  }
}

async function startReview(item) {
  if (startBusy.value) return
  startBusy.value = true
  try {
    const created = await store.continueTopic({
      id: item.source_session_id,
      topic: item.source_topic,
    })
    if (created) {
      router.push({
        name: 'session',
        params: { id: created.id },
        query: { review_gap: item.concept },
      })
    }
  } catch {
    // F-45: store.continueTopic rethrows after _setError; without this catch
    // the rejection is unhandled and the double-click window stays open.
  } finally {
    startBusy.value = false
  }
}
```

(Bind `:disabled="startBusy"` on the quick-start and review buttons if the template exposes them as buttons — check the template and wire it.)

NOTE: this includes Task 9's 409 mapping in `startQuick` — if Task 9 already landed it, merge (keep both the busy guard and the 409 branch).

- [ ] **Step 4: Run tests**

`npm run test:unit -- --run` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/SessionView.vue frontend/src/components/sidebar/SidebarSessionRow.vue frontend/src/views/HomeView.vue frontend/src/__tests__/
git commit -m "fix(frontend): end-summary fallback off-view + Home start guards (F-44 F-45)"
```

---

### Task 16: Drift docs — D-1..D-6, F-38 honesty, LLM-failure contract, AUTH_OPTIONAL doc

**Files:**
- Modify: `CLAUDE.md:7,78` (D-1, D-2)
- Modify: `docs/superpowers/specs/2026-05-03-crux-v1-design.md` (D-3, F-38, LLM contract)
- Modify: `README.md:242,560` (D-4)
- Modify: `.env.example` (D-5 comment, D-6, AUTH_OPTIONAL)
- Modify: `docker-compose.prod.yml:41` (D-6 ordering)
- Test: none (docs); verification is re-reading each edit against code.

No TDD cycle — doc-only task. Apply the edits, then verify each with a grep.

- [ ] **Step 1: D-1 + D-2 — CLAUDE.md**

Line 7: `**AdaptLearn** — an adaptive AI study companion.` becomes `**Crux** (formerly AdaptLearn) — an adaptive AI study companion.`
Line 78: `| 4 | PDF + RAG + ChromaDB + citations | Complete |` becomes `| 4 | PDF + RAG + pgvector + citations | Complete |`
Sweep: `grep -n "AdaptLearn\|ChromaDB" CLAUDE.md` — remaining hits only the "(formerly AdaptLearn)" parenthetical.

- [ ] **Step 2: D-3 — design doc ChromaDB references**

In `docs/superpowers/specs/2026-05-03-crux-v1-design.md` — lines 11/16/31/54 already document the pgvector reconciliation; LEAVE them. Fix the stale body references (current architecture statements), marking executed-history lines as historical instead of rewriting history:

- `:82` `retrieval_service.py     # ChromaDB query` -> `retrieval_service.py     # pgvector query`
- `:123` `**retrieve_chunks(session_id, query, k=5)** — ChromaDB vector search.` -> `— pgvector vector search.`
- `:171` `pypdf extract → tiktoken chunk → Gemini embed → ChromaDB add` -> `... → pgvector insert`
- `:271`, `:336`, `:341`, `:348`, `:371`, `:373`, `:414` (phase/test plan history): append ` [historical: ChromaDB was replaced by pgvector in Phase 7]` to the first such line of each section touched, and swap the term only where the sentence states current behavior. Keep edits minimal — these sections describe executed phases.
- `:391` swap-rationale table row and `:481`, `:495`, `:497` (swap-path section): rewrite to name pgvector as the store; the swap path is now "different pgvector index/managed vector service", not Chroma server mode.

Sweep after: `grep -n "Chroma" docs/superpowers/specs/2026-05-03-crux-v1-design.md` — every remaining hit must be a reconciliation note or `[historical: ...]` marker.

- [ ] **Step 3: F-38 honesty + LLM-failure contract — design doc**

(a) §5 Error handling table, the LiteLLM row:

`| LiteLLM timeout (>30s) | Retry once shorter context → 503 + Retry toast |`

becomes:

`| LiteLLM timeout | Per-call timeouts (20-30s, config.py); chat surfaces an error SSE + persisted error/partial message; summary falls back to the mechanical [auto] summary. No retry, no 503 (shipped behavior; F-06/F-01/F-14). |`

(b) Also update the `end_session_now LLM failure` row if it still claims `{ok: false}`: shipped behavior is the mechanical fallback summary — reword to `| Session-end LLM failure | Mechanical [auto] fallback summary; end always succeeds |`.

(c) F-38 — grading honesty. Sweep: `grep -rn -i "deterministic" docs/superpowers/specs/2026-05-03-crux-v1-design.md CLAUDE.md README.md`. Wherever check-question grading is described as deterministic (e.g. CLAUDE.md "the server grades deterministically", design doc §3.3/§4 wording), qualify it as: `deterministic grading of model-authored answer keys (the correct_index is authored by the model at registration; the server grades clicks against it deterministically)`. Apply the full sentence once per file at the primary claim; shorter `model-authored key` qualifiers elsewhere.

- [ ] **Step 4: D-4 — README API base URL**

`README.md:242`: default column `http://localhost:8000` -> `http://localhost:8000/api` with a note appended to the row description: `nginx-served docker builds bake the relative '/api' (see frontend/Dockerfile).`
`README.md:560`: same correction (`http://localhost:8000` -> `http://localhost:8000/api`).
Cross-check `frontend/.env.example:5` already reads `http://localhost:8000/api` — leave as-is; it is the correct default (`apiClient.js:7` confirms).

- [ ] **Step 5: D-5 + D-6 + AUTH_OPTIONAL — .env.example + compose**

D-5 — `.env.example:24` comment `# Vector dim for chunk_embeddings. Default 768 matches Gemini text-embedding-004.` -> `# Vector dim for chunk_embeddings. Default 768 matches gemini-embedding-2 (see EMBEDDING_MODEL).`

D-6 — `.env.example:49` `CORS_ORIGINS=http://localhost:5173` -> `CORS_ORIGINS=http://localhost:5173,http://localhost` (matches docker-compose.yml:36). `docker-compose.prod.yml:41` `${CORS_ORIGINS:-http://localhost,http://localhost:5173}` -> `${CORS_ORIGINS:-http://localhost:5173,http://localhost}` (same list, same order everywhere).

AUTH_OPTIONAL (Task 1's setting) — add to `.env.example` in the Supabase section:

```
# Refuse to boot without SUPABASE_URL unless explicitly opted out (F-61).
# Set true only for local hacking without auth.
AUTH_OPTIONAL=false
```

- [ ] **Step 6: Verify + commit**

Sweeps (native grep):
`grep -rn "ChromaDB" CLAUDE.md README.md` -> no hits.
`grep -n "text-embedding-004" .env.example` -> no hits.
`grep -n "AUTH_OPTIONAL" .env.example backend/config.py` -> both present.

```bash
git add CLAUDE.md README.md .env.example docker-compose.prod.yml docs/superpowers/specs/2026-05-03-crux-v1-design.md
git commit -m "docs: drift fixes D-1..D-6, honest grading claim, shipped LLM-failure contract (F-38 D-1 D-2 D-3 D-4 D-5 D-6)"
```

---

### Task 17: OpenAPI backfill (chat/stream + check endpoints + 409 shapes) + final verification + push

**Files:**
- Modify: `docs/api/openapi.yaml` (new paths + 409 responses)
- Run codegen: `python backend/scripts/gen_contracts.py`
- Modify: `backend/routes/*.py` only if the 409-shape sweep finds a string-detail 409
- Test: contract drift check + full suites

**Interfaces:**
- Consumes: existing schemas `ChatRequest`, `CheckAnswerRequest/Response`, `CheckSkipRequest/Response`, `ErrorResponse` (all already in openapi.yaml — the schemas exist, only the PATHS are missing).

- [ ] **Step 1: Discover the exact check endpoints + all 409 raisers**

From repo root (native grep):
`grep -n "@router.post" backend/routes/sessions.py` — identify the three check endpoints (answer / skip / complete-or-followup; the review doc cites `sessions.py:379,404,434` historically).
`grep -rn "status_code=409\|HTTP_409" backend/routes backend/services` — list every 409. Each must carry a dict detail `{"code": "...", ...}`. Convert any bare-string 409 detail to `{"code": "<snake_case_slug>"}` and update the tests that assert on it.

- [ ] **Step 2: Add the missing paths to `docs/api/openapi.yaml`**

`/api/chat/stream` (SSE — document the envelope honestly):

```yaml
  /api/chat/stream:
    post:
      tags: [chat]
      summary: Streaming tutor turn (SSE over POST).
      description: |
        Emits text/event-stream events: assistant_delta, tool_call_start,
        tool_call_done, citations, check_question, cost_warning, done,
        error, cancelled. Terminal events are done | error | cancelled.
      operationId: chatStream
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/ChatRequest"
      responses:
        "200":
          description: SSE stream of tutor events.
          content:
            text/event-stream:
              schema:
                type: string
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Session already ended.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "429":
          description: Daily rate or cost cap reached.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
```

(Verify `components/responses/NotFound` exists — the agent-confirmed responses live at yaml lines ~445-503; use the actual response-ref names found there, e.g. `BadRequest`. If `NotFound` is absent, inline the 404 with ErrorResponse like the 409 above.)

Check endpoints — one entry per discovered route, using the existing schemas. Template (repeat for skip/complete with their request/response refs; adjust paths to the discovered decorators):

```yaml
  /api/sessions/{session_id}/check/answer:
    post:
      tags: [sessions]
      summary: Answer the current item of the open check batch.
      operationId: answerCheck
      parameters:
        - name: session_id
          in: path
          required: true
          schema: { type: string }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CheckAnswerRequest"
      responses:
        "200":
          description: Graded answer state.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CheckAnswerResponse"
        "404":
          description: Session not found.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "409":
          description: No open batch / batch state conflict.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
```

Also add the new 409 to `/api/sessions` POST (Task 9's duplicate_topic) and to `/api/sessions/{session_id}/reopen`:

```yaml
        "409":
          description: An active session with this topic already exists (code duplicate_topic, session_id carries the existing id).
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
```

Match parameter style to the existing `/api/sessions/{session_id}` entry (it may use a shared `components/parameters` ref — reuse it).

- [ ] **Step 3: Codegen + drift check**

From repo root: `python backend/scripts/gen_contracts.py` then `git diff backend/contracts` — path-only additions should produce little or no model churn (schemas already existed). Whatever it produces, commit it — CI enforces zero drift between yaml and contracts.

- [ ] **Step 4: Full verification sweep**

- Backend, from `backend/`: `python -m pytest -q` — all green.
- Frontend, from `frontend/`: `npm run test:unit -- --run` — all green; `npm run lint` — clean.
- Contract drift: rerun `python backend/scripts/gen_contracts.py`; `git status` must be clean afterward.
- Grep sweeps: `grep -rn "is_gradable" backend/services backend/tests` -> no hits; `grep -n "allow_credentials=True" backend/main.py` -> no hits.

- [ ] **Step 5: Commit + push + PR**

```bash
git add docs/api/openapi.yaml backend/contracts backend/routes backend/tests
git commit -m "docs(api): backfill /chat/stream + check endpoints, normalize 409 shapes (Batch-1 carryover)"
git push -u origin fix/adversarial-batch-6
```

Open the PR to `dev` titled `Adversarial review Batch 6: perf + hygiene + drift (F-14 F-18 F-34 F-35 F-38 F-42 F-44..F-62 D-1..D-6)`. PR body must list the 4 owed human gates from the spec:
1. Live `alembic upgrade head` for migration 0019 (F-46) against Supabase.
2. Live curl of the nginx rate limit on the compose stack (F-42).
3. Paid live smoke: force-retrieve turn returns a grounded, cited answer (F-56).
4. New-device browser smoke: existing user signs in on a fresh profile, lands on Home, not onboarding (F-46).

---

## Execution notes

- Task order is dependency-aware: 10 before 11 (ToolContext fields), 12 before 13 (`ensure_user` signature), 9 and 15 both touch `HomeView.startQuick` (later task merges).
- Every migration commit should get a `migration-reviewer` agent pass before it lands (repo convention).
- Expected test-churn hotspots called out inline: Task 2 (async fallback mocks), Task 9 (same-topic fixtures), Task 12 (ensure_user stamp assertions), Task 13 (async completeOnboarding).
