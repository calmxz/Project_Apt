# Adversarial Review Batch 2 — Cost Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five cost-integrity findings from `docs/adversarial-review-2026-07-12.md` — F-03 (summary spend bypasses the cap), F-17 (ledger lost-update race), F-19 (embeddings unmetered / $0 on pricing failure), F-43 (mid-turn cap check reads the ORM identity map), F-06 (no LLM/fetch timeouts) — plus the Batch-1-deferred item "tutor error arm records no cost for the failed iteration."

**Architecture:** All spend flows through `cost_meter.record_cost` (now an atomic `INSERT .. ON CONFLICT DO UPDATE`) and is gated by `cost_meter.check_cap` (now a fresh SQL read). Summary paths gate-then-meter; embedding paths meter via a new shared `meter_embedding_response` helper; the tutor loop estimates cost for interrupted iterations via a shared partial-cost helper. Every LiteLLM call gets an explicit `timeout=`; the frontend gets a 30s request timeout plus a header+idle timeout on SSE streams.

**Tech Stack:** FastAPI + SQLAlchemy 2 (Postgres prod / SQLite tests), LiteLLM, Vue 3 + vitest.

## Global Constraints

- Branch: `fix/adversarial-batch-2`, PR targets `dev`.
- Run pytest from `backend/`, never repo root. Baseline: 642 backend + 600 frontend tests green.
- No emojis in code or comments. No hand-edits to `backend/contracts/` (no API-shape change in this batch, so no codegen needed).
- No DB migration: `daily_cost_ledger` already has composite PK `(user_id, date_utc)`, which `ON CONFLICT` targets.
- Decision Q3 (owner, 2026-07-13): meter + gate, atomic increment, fresh reads, NO reservations. Cap may overshoot by one in-flight turn per tab — accepted.
- Design-doc deviation (surface, do not hide): the design doc mandates "LiteLLM timeout → retry once shorter context → 503". Per the review's accepted proposed fix, we implement timeout → mechanical fallback (summary) / error SSE (chat) with NO retry. Task 12 documents this in the review doc.
- New settings (added in Task 4, used by Tasks 4-9): `llm_timeout_s: float = 30.0`, `summary_timeout_s: float = 20.0`, `embedding_timeout_s: float = 15.0`.
- `DailyCostLedger.user_id` has an FK to `users.id`: every test that writes the ledger must create a `User` row first (see existing `backend/tests/test_cost_meter.py` fixtures).

---

### Task 1: Extract shared dialect-insert helper

**Files:**
- Create: `backend/services/sql_dialect.py`
- Modify: `backend/services/rate_limit.py` (remove local `_dialect_insert`, import shared one)

**Interfaces:**
- Produces: `services.sql_dialect.dialect_insert(db: Session)` — returns the dialect-specific `insert` construct supporting `on_conflict_*`. Task 2 consumes it.

- [ ] **Step 1: Create the module**

```python
"""Dialect-specific INSERT support (Postgres prod, SQLite tests).

Leaf module: services needing ON CONFLICT upserts import from here so
rate_limit and cost_meter stay decoupled.
"""

from sqlalchemy.orm import Session


def dialect_insert(db: Session):
    """Return the dialect-specific INSERT that supports ON CONFLICT.

    Both Postgres (prod) and SQLite (tests) implement the on_conflict_*
    methods; the dialect-agnostic sqlalchemy.insert() does not.
    """
    name = db.get_bind().dialect.name
    if name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as _insert
    else:
        from sqlalchemy.dialects.sqlite import insert as _insert
    return _insert
```

- [ ] **Step 2: Point rate_limit at it**

In `backend/services/rate_limit.py`: delete the `_dialect_insert` function (lines 22-33), add `from services.sql_dialect import dialect_insert` to the imports, and change the single call site `insert = _dialect_insert(db)` to `insert = dialect_insert(db)`.

- [ ] **Step 3: Run the full backend suite (import-touching refactor rule)**

Run from `backend/`: `pytest`
Expected: 642 passed (existing `test_rate_limit.py` covers the behavior; no new tests needed).

- [ ] **Step 4: Commit**

```bash
git add backend/services/sql_dialect.py backend/services/rate_limit.py
git commit -m "refactor: extract shared dialect_insert helper for ON CONFLICT upserts"
```

---

### Task 2: Atomic ledger increment + fresh spend read (F-17, F-43)

**Files:**
- Modify: `backend/services/cost_meter.py:62-84` (`current_spend`, `record_cost`)
- Test: `backend/tests/test_cost_meter.py`

**Interfaces:**
- Consumes: `services.sql_dialect.dialect_insert` (Task 1).
- Produces: `record_cost(db, user_id, cost_usd) -> Decimal` (same signature, still returns new total); `current_spend(db, user_id) -> Decimal` (same signature, now always emits SQL). All existing callers unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_cost_meter.py` (follow the file's existing user-row fixture pattern):

```python
def test_current_spend_reads_through_identity_map(db_session):
    # F-43: db.get returns the identity-map cache without SQL, hiding other
    # sessions' concurrent spend. current_spend must emit a fresh SELECT.
    _mk_user(db_session, "u43")
    cost_meter.record_cost(db_session, "u43", Decimal("0.5"))
    db_session.commit()
    # Prime the identity map the way a long turn does.
    assert cost_meter.current_spend(db_session, "u43") == Decimal("0.5000")
    # Mutate the row behind the ORM's back (simulates another session's commit).
    db_session.execute(
        text("UPDATE daily_cost_ledger SET cost_usd = 2.0 WHERE user_id = 'u43'")
    )
    assert cost_meter.current_spend(db_session, "u43") == Decimal("2.0000")


def test_record_cost_is_an_atomic_increment(db_session):
    # F-17: record_cost must not read-modify-write. After the ORM has a stale
    # cached instance, a subsequent record_cost must still add to the DB
    # value, not to the cached one.
    _mk_user(db_session, "u17")
    cost_meter.record_cost(db_session, "u17", Decimal("0.5"))
    db_session.commit()
    row = db_session.get(DailyCostLedger, ("u17", cost_meter._today_utc()))
    assert row is not None  # instance now cached with 0.5
    db_session.execute(
        text("UPDATE daily_cost_ledger SET cost_usd = 1.0 WHERE user_id = 'u17'")
    )
    total = cost_meter.record_cost(db_session, "u17", Decimal("0.25"))
    # Read-modify-write on the cached 0.5 would yield 0.75; atomic SQL yields 1.25.
    assert total == Decimal("1.2500")


def test_record_cost_returns_running_total_and_quantizes(db_session):
    _mk_user(db_session, "uq")
    assert cost_meter.record_cost(db_session, "uq", 0.00006) == Decimal("0.0001")
    assert cost_meter.record_cost(db_session, "uq", Decimal("0.1")) == Decimal("0.1001")
    # Sub-precision cost quantizes to zero and is a no-op.
    assert cost_meter.record_cost(db_session, "uq", 0.00001) == Decimal("0.1001")
```

Use the file's existing helper for creating users (or add `_mk_user(db, uid)` inserting a `User(id=uid)` and flushing, matching existing style). Import `text` from sqlalchemy and `DailyCostLedger` from `db.models` if not present.

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_cost_meter.py -v`
Expected: the two new F-43/F-17 tests FAIL (stale reads / 0.75 total); quantize test may partially pass.

- [ ] **Step 3: Implement**

Replace `current_spend` and `record_cost` in `backend/services/cost_meter.py`:

```python
def current_spend(db: Session, user_id: str) -> Decimal:
    """Today's spend, read with a fresh SELECT every call (F-43).

    db.get returns the identity-map cache without emitting SQL after the
    first read, which hides other sessions' concurrent spend from the
    mid-turn cap checks in the tutor loop.
    """
    total = db.execute(
        select(func.coalesce(func.sum(DailyCostLedger.cost_usd), 0)).where(
            DailyCostLedger.user_id == user_id,
            DailyCostLedger.date_utc == _today_utc(),
        )
    ).scalar_one()
    return _to_decimal(total)


def record_cost(db: Session, user_id: str, cost_usd) -> Decimal:
    """Atomically add `cost_usd` to today's ledger row for `user_id` and
    return the new total (F-17: INSERT .. ON CONFLICT DO UPDATE, so two
    concurrent writers serialize on the row instead of read-modify-writing
    a stale total). Safe to call with 0 (no-op write avoided). Flushes into
    the caller's transaction; the caller's commit publishes it.
    """
    cost = _quantize(_to_decimal(cost_usd))
    if cost <= _ZERO:
        return current_spend(db, user_id)

    ins = dialect_insert(db)(DailyCostLedger).values(
        user_id=user_id, date_utc=_today_utc(), cost_usd=cost
    )
    stmt = ins.on_conflict_do_update(
        index_elements=["user_id", "date_utc"],
        set_={
            "cost_usd": DailyCostLedger.cost_usd + ins.excluded.cost_usd,
            # onupdate defaults do not fire for ON CONFLICT set_; stamp explicitly.
            "updated_at": datetime.now(timezone.utc),
        },
    ).returning(DailyCostLedger.cost_usd)
    new_total = db.execute(stmt).scalar_one()
    return _to_decimal(new_total)
```

Add `from services.sql_dialect import dialect_insert` to the imports. `datetime`/`timezone` are already imported. Quantization note: values are stored quantized (Numeric(10,4)), so quantized + quantized stays exact in SQL — semantics match the old `quantize(old + cost)` for all representable costs.

- [ ] **Step 4: Run the FULL backend suite**

Run from `backend/`: `pytest`
Expected: all pass (callers in tutor.py/chat.py use the same signatures; `test_cost_cap.py` exercises the cap path end-to-end).

- [ ] **Step 5: Commit**

```bash
git add backend/services/cost_meter.py backend/tests/test_cost_meter.py
git commit -m "fix: atomic cost-ledger increment and fresh cap reads (F-17, F-43)"
```

---

### Task 3: Embedding cost accounting helpers (F-19 groundwork)

**Files:**
- Modify: `backend/services/cost_meter.py` (add `MODEL_RATES` entry, `embedding_cost`, `meter_embedding_response`)
- Test: `backend/tests/test_cost_meter_estimate.py`

**Interfaces:**
- Produces: `cost_meter.embedding_cost(model: str, resp, texts: list[str]) -> Decimal`; `cost_meter.meter_embedding_response(db, resp, *, user_id: str, session_id, texts: list[str], purpose: str = "embedding") -> None` (never raises). Tasks 7 and 8 consume `meter_embedding_response`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_cost_meter_estimate.py`:

```python
class _FakeUsage:
    prompt_tokens = 1000
    completion_tokens = None
    prompt_tokens_details = None


class _FakeEmbedResp:
    usage = _FakeUsage()


def test_embedding_cost_token_math_fallback(monkeypatch):
    # completion_cost blows up on the fake object -> token-math fallback via
    # usage.prompt_tokens against the MODEL_RATES embedding entry.
    monkeypatch.setattr(
        cost_meter.litellm, "completion_cost",
        lambda **kw: (_ for _ in ()).throw(ValueError("unknown model")),
    )
    cost = cost_meter.embedding_cost(
        "gemini/gemini-embedding-2", _FakeEmbedResp(), ["some query"]
    )
    # 1000 tokens * 0.000150 / 1000 = 0.00015
    assert cost == Decimal("0.00015")


def test_embedding_cost_unknown_model_returns_zero(monkeypatch):
    monkeypatch.setattr(
        cost_meter.litellm, "completion_cost",
        lambda **kw: (_ for _ in ()).throw(ValueError("unknown model")),
    )
    assert cost_meter.embedding_cost("nope/nope", _FakeEmbedResp(), ["q"]) == Decimal("0")


def test_meter_embedding_response_writes_ledger_and_log(db_session, monkeypatch):
    _mk_user(db_session, "uemb")
    monkeypatch.setattr(
        cost_meter.litellm, "completion_cost", lambda **kw: 0.002
    )
    cost_meter.meter_embedding_response(
        db_session, _FakeEmbedResp(), user_id="uemb", session_id="s1", texts=["q"]
    )
    assert cost_meter.current_spend(db_session, "uemb") == Decimal("0.0020")
    row = db_session.execute(
        select(LlmCallLog).where(LlmCallLog.user_id == "uemb")
    ).scalar_one()
    assert row.purpose == "embedding"
```

Reuse/borrow the user-creation helper from `test_cost_meter.py` (import or duplicate `_mk_user`); import `LlmCallLog`, `select` as needed.

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_cost_meter_estimate.py -v`
Expected: FAIL with "has no attribute 'embedding_cost'".

- [ ] **Step 3: Implement in cost_meter.py**

Add to `MODEL_RATES`:

```python
    # Google Gemini embedding model — placeholder; verify at ai.google.dev/pricing
    "gemini/gemini-embedding-2": {
        "input_per_1k": Decimal("0.000150"),  # $0.15 / 1M tokens
        "output_per_1k": Decimal("0"),
    },
```

Add below `estimate_cancelled_cost`:

```python
def embedding_cost(model: str, resp, texts: list[str]) -> Decimal:
    """USD cost of a litellm.embedding response.

    Tries litellm's own accounting first; on failure (pricing-table gap for
    the model id) falls back to token math against MODEL_RATES so real spend
    never silently registers as 0 (F-19). Unknown models return 0 with a
    warning.
    """
    try:
        cost = litellm.completion_cost(completion_response=resp)
        if cost and cost > 0:
            return _to_decimal(cost)
    except Exception as e:  # noqa: BLE001 - metering must not raise
        log.warning("embedding completion_cost failed: %s", e)
    rates = MODEL_RATES.get(model)
    if rates is None:
        log.warning("no MODEL_RATES entry for embedding model %s; cost=0", model)
        return Decimal("0")
    try:
        tokens = extract_usage(resp)["prompt_tokens"]
        if tokens is None:
            tokens = sum(
                litellm.token_counter(model=model, text=t or "") for t in texts
            )
        return Decimal(tokens) * rates["input_per_1k"] / Decimal(1000)
    except Exception as e:  # noqa: BLE001
        log.warning("embedding token-math fallback failed: %s", e)
        return Decimal("0")


def meter_embedding_response(
    db: Session, resp, *, user_id: str, session_id, texts: list[str],
    purpose: str = "embedding",
) -> None:
    """Record an embedding call on the capped ledger and the analytics log
    (F-19). Never raises: metering must not fail the calling feature."""
    try:
        cost = embedding_cost(settings.embedding_model, resp, texts)
        record_cost(db, user_id, cost)
        log_call(
            db, user_id=user_id, session_id=session_id, purpose=purpose,
            model=settings.embedding_model, cost_usd=cost,
            **extract_usage(resp),
        )
    except Exception as e:  # noqa: BLE001
        log.warning("embedding metering failed: %s", e)
```

- [ ] **Step 4: Run tests to verify they pass**

Run from `backend/`: `pytest tests/test_cost_meter_estimate.py tests/test_cost_meter.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/cost_meter.py backend/tests/test_cost_meter_estimate.py
git commit -m "feat: embedding cost accounting with token-math fallback (F-19)"
```

---

### Task 4: Gate + meter the end-of-session summary; add timeout settings (F-03, F-06)

**Files:**
- Modify: `backend/config.py` (three timeout settings)
- Modify: `backend/services/summary_service.py:36-93` (`generate_and_persist`)
- Test: `backend/tests/test_summary_service.py`

**Interfaces:**
- Produces: `generate_and_persist(db, session, *, allow_llm: bool = True) -> str` (new keyword-only param; both existing call sites keep working via the default). Task 6 passes `allow_llm`. Settings `llm_timeout_s` / `summary_timeout_s` / `embedding_timeout_s` (floats) for Tasks 5, 7, 8, 9.

- [ ] **Step 1: Add settings**

In `backend/config.py`, after `retrieval_fallback_threshold: float = 0.75`:

```python
    # F-06: explicit LiteLLM timeouts. Chat streams get the longest budget;
    # summaries and embeddings are shorter single-shot calls.
    llm_timeout_s: float = 30.0
    summary_timeout_s: float = 20.0
    embedding_timeout_s: float = 15.0
```

- [ ] **Step 2: Write the failing tests**

Append to `backend/tests/test_summary_service.py` (mirror the file's existing async-test and monkeypatch style; it already fakes `litellm.acompletion`):

```python
@pytest.mark.anyio
async def test_summary_capped_user_gets_mechanical_no_llm_no_ledger(db_session, monkeypatch):
    # F-03: at the hard cap the summary path must not spend.
    session = _mk_session_with_messages(db_session, n=3)
    monkeypatch.setattr(settings, "llm_stub", False)
    monkeypatch.setattr(settings, "gemini_api_key", "real")
    cost_meter.record_cost(db_session, session.user_id, Decimal(str(settings.llm_hard_cap_usd)))
    db_session.commit()
    called = []
    async def _boom(**kw):
        called.append(1)
    monkeypatch.setattr(summary_service.litellm, "acompletion", _boom)
    summary = await summary_service.generate_and_persist(db_session, session)
    assert summary.startswith("[auto] ")
    assert called == []


@pytest.mark.anyio
async def test_summary_allow_llm_false_gets_mechanical(db_session, monkeypatch):
    session = _mk_session_with_messages(db_session, n=3)
    monkeypatch.setattr(settings, "llm_stub", False)
    monkeypatch.setattr(settings, "gemini_api_key", "real")
    called = []
    async def _boom(**kw):
        called.append(1)
    monkeypatch.setattr(summary_service.litellm, "acompletion", _boom)
    summary = await summary_service.generate_and_persist(db_session, session, allow_llm=False)
    assert summary.startswith("[auto] ")
    assert called == []


@pytest.mark.anyio
async def test_summary_success_records_ledger_and_passes_timeout(db_session, monkeypatch):
    # F-03 meter + F-06 timeout kwarg.
    session = _mk_session_with_messages(db_session, n=3)
    monkeypatch.setattr(settings, "llm_stub", False)
    monkeypatch.setattr(settings, "gemini_api_key", "real")
    captured = {}
    async def _fake(**kw):
        captured.update(kw)
        return _fake_llm_response("A real summary.")
    monkeypatch.setattr(summary_service.litellm, "acompletion", _fake)
    monkeypatch.setattr(summary_service.litellm, "completion_cost", lambda **kw: 0.003)
    await summary_service.generate_and_persist(db_session, session)
    assert captured["timeout"] == settings.summary_timeout_s
    assert cost_meter.current_spend(db_session, session.user_id) == Decimal("0.0030")
```

Adapt helper names (`_mk_session_with_messages`, `_fake_llm_response`) to whatever the file already provides — reuse its existing fixtures/fakes rather than inventing parallel ones. If the file forces stub mode globally, override per-test as shown.

- [ ] **Step 3: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_summary_service.py -v`
Expected: new tests FAIL (no gate, no record_cost, no timeout kwarg, unknown `allow_llm`).

- [ ] **Step 4: Implement**

In `generate_and_persist`:

1. Change the signature to `async def generate_and_persist(db: Session, session: SessionModel, *, allow_llm: bool = True) -> str:` and extend the docstring: "allow_llm=False (rate-limited caller) or a breached hard cost cap short-circuits to the mechanical summary — an end must always succeed, but must not spend (F-03)."
2. Replace the branch head:

```python
    summary: str
    if settings.llm_stub_enabled:
        summary = _mechanical_fallback(messages)
    elif not allow_llm or not cost_meter.check_cap(db, session.user_id).allowed:
        # F-03: the summary LLM call is real spend and must respect the same
        # daily ledger and rate limit the chat path is gated on.
        summary = _mechanical_fallback(messages)
    else:
        try:
```

3. Add `timeout=settings.summary_timeout_s` to the `litellm.acompletion(...)` kwargs.
4. In the `completion_cost` failure arm, replace `cost = 0` with a token-math estimate (F-19 class of bug), and record the cost on the ledger after computing it:

```python
            try:
                cost = litellm.completion_cost(completion_response=resp)
            except Exception as e:
                log.warning("summary completion_cost failed: %s", e)
                try:
                    pt = litellm.token_counter(
                        model=settings.model,
                        messages=[
                            {"role": "system", "content": SUMMARY_SYSTEM},
                            {"role": "user", "content": user_prompt},
                        ],
                    )
                    cost = cost_meter.estimate_cancelled_cost(settings.model, content, pt)
                except Exception as e2:  # noqa: BLE001
                    log.warning("summary cost fallback failed: %s", e2)
                    cost = 0
            cost_meter.record_cost(db, session.user_id, cost)
            cost_meter.log_call(
```

(`log_call` keeps its existing arguments.)

- [ ] **Step 5: Run tests to verify they pass, then the full suite**

Run from `backend/`: `pytest tests/test_summary_service.py -v && pytest`
Expected: PASS; full suite green (both call sites use the default `allow_llm=True`).

- [ ] **Step 6: Commit**

```bash
git add backend/config.py backend/services/summary_service.py backend/tests/test_summary_service.py
git commit -m "fix: gate and meter end-of-session summary spend, add LLM timeouts (F-03, F-06)"
```

---

### Task 5: Gate + meter the rolling summary (F-03, F-06)

**Files:**
- Modify: `backend/services/summary_service.py:117-178` (`update_rolling_summary`)
- Test: `backend/tests/test_rolling_summary.py`

**Interfaces:**
- Consumes: `cost_meter.check_cap`, `cost_meter.record_cost`, `settings.summary_timeout_s` (Task 4).
- Produces: no signature change; capped users now get `None` (skip) instead of an LLM call.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_rolling_summary.py` (reuse its existing session/message factories and fake-LLM pattern):

```python
@pytest.mark.anyio
async def test_rolling_summary_capped_user_skips_llm(db_session, monkeypatch):
    # F-03: at the hard cap, skip (return None, debounce untouched) instead of spending.
    session = _mk_session_with_messages(db_session, n=31)  # due: 31-20=11 dropped >= 10
    monkeypatch.setattr(settings, "llm_stub", False)
    monkeypatch.setattr(settings, "gemini_api_key", "real")
    cost_meter.record_cost(db_session, session.user_id, Decimal(str(settings.llm_hard_cap_usd)))
    db_session.commit()
    called = []
    async def _boom(**kw):
        called.append(1)
    monkeypatch.setattr(summary_service.litellm, "acompletion", _boom)
    out = await summary_service.update_rolling_summary(db_session, session.id)
    assert out is None
    assert called == []
    db_session.refresh(session)
    assert session.rolling_summary is None


@pytest.mark.anyio
async def test_rolling_summary_success_records_ledger_and_timeout(db_session, monkeypatch):
    session = _mk_session_with_messages(db_session, n=31)
    monkeypatch.setattr(settings, "llm_stub", False)
    monkeypatch.setattr(settings, "gemini_api_key", "real")
    captured = {}
    async def _fake(**kw):
        captured.update(kw)
        return _fake_llm_response("Earlier the learner studied X.")
    monkeypatch.setattr(summary_service.litellm, "acompletion", _fake)
    monkeypatch.setattr(summary_service.litellm, "completion_cost", lambda **kw: 0.001)
    out = await summary_service.update_rolling_summary(db_session, session.id)
    assert out == "Earlier the learner studied X."
    assert captured["timeout"] == settings.summary_timeout_s
    assert cost_meter.current_spend(db_session, session.user_id) == Decimal("0.0010")
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_rolling_summary.py -v`
Expected: new tests FAIL.

- [ ] **Step 3: Implement**

In `update_rolling_summary`, inside the `else:` (non-stub) branch, first line:

```python
        else:
            if not cost_meter.check_cap(db, session.user_id).allowed:
                # F-03: capped users skip the rolling summary entirely; count
                # stays untouched so the next uncapped trigger retries.
                return None
            transcript = ...
```

Add `timeout=settings.summary_timeout_s` to the `acompletion` kwargs. In the `completion_cost` failure arm, same token-math fallback shape as Task 4 (prompt = the two rolling messages, completion = `content`), then add `cost_meter.record_cost(db, session.user_id, cost)` immediately before the existing `cost_meter.log_call(...)`.

- [ ] **Step 4: Run tests, then the full suite**

Run from `backend/`: `pytest tests/test_rolling_summary.py -v && pytest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/summary_service.py backend/tests/test_rolling_summary.py
git commit -m "fix: gate and meter rolling summary spend (F-03)"
```

---

### Task 6: Rate-limit the end/resume summary trigger (F-03)

**Files:**
- Modify: `backend/routes/sessions.py:120-127` (create_session resume branch), `backend/routes/sessions.py:298-308` (end_session)
- Test: `backend/tests/test_sessions_route.py`

**Interfaces:**
- Consumes: `generate_and_persist(..., allow_llm=...)` (Task 4); `rate_limit.check_and_increment(db, user_id) -> tuple[bool, int]` (existing).
- Produces: end/resume consume one daily rate-limit slot; at the rate cap the end still succeeds with a mechanical summary (never a 429).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_sessions_route.py` (reuse its client/auth fixtures; note `settings.daily_cap` patch):

```python
def test_end_session_at_rate_cap_returns_mechanical_summary(client, db_session, monkeypatch):
    # F-03: end must never 429, but a rate-capped user must not trigger LLM spend.
    session_id = _create_active_session_with_messages(client, db_session)
    monkeypatch.setattr(settings, "daily_cap", 0)
    resp = client.post(f"/api/sessions/{session_id}/end")
    assert resp.status_code == 200
    assert resp.json()["summary"]["summary"].startswith("[auto] ")


def test_end_session_consumes_rate_limit_slot(client, db_session):
    session_id = _create_active_session_with_messages(client, db_session)
    before = _usage_count(db_session)
    resp = client.post(f"/api/sessions/{session_id}/end")
    assert resp.status_code == 200
    assert _usage_count(db_session) == before + 1
```

Adapt helper names to the file's existing factories; `_usage_count` reads `UsageCounter.count` for the test user + today (add a small local helper if none exists). Check the actual `SessionEndResponse` summary shape in the file's existing end tests and match it (the `["summary"]["summary"]` path above is indicative — mirror what existing tests assert). Stub mode already yields `[auto] ` summaries, so the first test proves the rate gate only if the suite runs non-stub for that test OR by asserting `acompletion` is not called — prefer patching `summary_service.litellm.acompletion` with a fail-if-called fake and running with `llm_stub=False`, mirroring Task 4's tests.

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_sessions_route.py -v -k "rate_cap or rate_limit_slot"`
Expected: FAIL (no increment happens today).

- [ ] **Step 3: Implement**

In `end_session` (sessions.py:306-307), before `abandon_open_batch`:

```python
        # F-03: an end fires a full-transcript LLM call; count it like a chat
        # turn. At the cap the end still succeeds with a mechanical summary.
        allow_llm, _ = rate_limit.check_and_increment(db, user_id)
        check_question_service.abandon_open_batch(db, session_id)
        summary_text = await summary_service.generate_and_persist(db, row, allow_llm=allow_llm)
```

In `create_session` resume branch (sessions.py:124-126):

```python
        if prior.ended_at is None:
            allow_llm, _ = rate_limit.check_and_increment(db, user_id)
            await summary_service.generate_and_persist(db, prior, allow_llm=allow_llm)
            db.refresh(prior)
```

Note: `check_and_increment` commits internally; at these call sites the only pending work is `ensure_user`'s flushed row (create_session) or reads (end_session), so the early commit is safe.

- [ ] **Step 4: Run tests, then the full suite**

Run from `backend/`: `pytest tests/test_sessions_route.py -v && pytest`
Expected: PASS. If existing end/resume tests count usage rows or assert exact SQL statement counts (see `test_sessions_perf.py`), update those expectations — the new increment adds 2-3 statements to end/resume paths only.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/sessions.py backend/tests/test_sessions_route.py
git commit -m "fix: end/resume summary trigger consumes a rate-limit slot (F-03)"
```

---

### Task 7: Meter retrieval embeddings + timeout (F-19, F-06)

**Files:**
- Modify: `backend/services/retrieval_service.py:44-48` (retrieve), `:106-134` (semantic_fallback_required)
- Modify: `backend/routes/chat.py:211` (pass user_id)
- Test: `backend/tests/test_retrieval_service.py`

**Interfaces:**
- Consumes: `cost_meter.meter_embedding_response` (Task 3), `settings.embedding_timeout_s` (Task 4).
- Produces: `semantic_fallback_required(db, session_id, query, *, user_id: str | None = None) -> bool` — metering happens only when `user_id` is provided; existing positional callers keep working.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_retrieval_service.py` (reuse its fake-embedding fixtures — the file already patches `litellm.embedding`):

```python
def test_retrieve_meters_embedding_spend(db_session, monkeypatch):
    # F-19: every retrieval turn embeds the query; that spend must hit the ledger.
    ctx = _mk_ready_ctx(db_session)  # reuse the file's ready-document setup
    _patch_fake_embedding(monkeypatch)
    monkeypatch.setattr(
        retrieval_service.cost_meter.litellm, "completion_cost", lambda **kw: 0.0005
    )
    retrieval_service.retrieve(db_session, ctx, _args(ctx.session_id, "query"))
    assert cost_meter.current_spend(db_session, ctx.user_id) == Decimal("0.0005")
    row = db_session.execute(
        select(LlmCallLog).where(LlmCallLog.user_id == ctx.user_id)
    ).scalar_one()
    assert row.purpose == "embedding"


def test_semantic_fallback_meters_when_user_id_given(db_session, monkeypatch):
    _setup_centroid_case(db_session)  # reuse existing centroid fixture path
    _patch_fake_embedding(monkeypatch)
    monkeypatch.setattr(
        retrieval_service.cost_meter.litellm, "completion_cost", lambda **kw: 0.0005
    )
    retrieval_service.semantic_fallback_required(
        db_session, "s1", "q", user_id="u1"
    )
    assert cost_meter.current_spend(db_session, "u1") == Decimal("0.0005")


def test_embedding_calls_pass_timeout(db_session, monkeypatch):
    ctx = _mk_ready_ctx(db_session)
    captured = {}
    def _fake_embedding(**kw):
        captured.update(kw)
        return _fake_embed_resp()
    monkeypatch.setattr(retrieval_service.litellm, "embedding", _fake_embedding)
    retrieval_service.retrieve(db_session, ctx, _args(ctx.session_id, "query"))
    assert captured["timeout"] == settings.embedding_timeout_s
```

Adapt all helper names to the file's real fixtures. Note the pgvector centroid path is Postgres-only — the existing tests already handle the sqlite skip/mock; follow their pattern (if the centroid case cannot run on sqlite, meter-test `semantic_fallback_required` by patching `_session_centroid` to return a vector, which the file already does at lines ~236-294). Ledger writes need `User` rows — create them as in `test_cost_meter.py`.

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_retrieval_service.py -v`
Expected: new tests FAIL (no metering, no timeout kwarg, unknown `user_id` kwarg).

- [ ] **Step 3: Implement**

In `retrieve()`: add `timeout=settings.embedding_timeout_s` to the `litellm.embedding(...)` call, and after `query_vec` is extracted add:

```python
        cost_meter.meter_embedding_response(
            db, resp, user_id=ctx.user_id, session_id=ctx.session_id,
            texts=[args.query],
        )
```

In `semantic_fallback_required()`: change the signature to

```python
def semantic_fallback_required(
    db: Session, session_id: str, query: str, *, user_id: str | None = None
) -> bool:
```

add `timeout=settings.embedding_timeout_s` to its `litellm.embedding(...)` call, and after `query_vec` extraction:

```python
        if user_id is not None:
            cost_meter.meter_embedding_response(
                db, resp, user_id=user_id, session_id=session_id, texts=[query],
            )
```

Add `from services import cost_meter` to the module imports (extend the existing `from services import ...` line). In `backend/routes/chat.py:211`, pass `user_id=user_id` to the `semantic_fallback_required(...)` call.

- [ ] **Step 4: Run tests, then the full suite**

Run from `backend/`: `pytest tests/test_retrieval_service.py -v && pytest`
Expected: PASS. `test_chat_prepare_perf.py` pins statement counts around `semantic_fallback_required` — if its counts shift because of the two metering statements, update the pinned budget with a comment referencing F-19.

- [ ] **Step 5: Commit**

```bash
git add backend/services/retrieval_service.py backend/routes/chat.py backend/tests/test_retrieval_service.py
git commit -m "fix: meter retrieval embeddings on the cost ledger, add timeout (F-19, F-06)"
```

---

### Task 8: Meter ingestion embeddings + timeout (F-19, F-06)

**Files:**
- Modify: `backend/services/ingestion_service.py:87-101` (`_embed_all`), `:104-136` (`run`)
- Test: `backend/tests/test_ingestion_service.py`

**Interfaces:**
- Consumes: `cost_meter.meter_embedding_response` (Task 3), `settings.embedding_timeout_s`.
- Produces: `_embed_all(db, texts, *, user_id, session_id)` (module-private; `run` is the only caller). Metering only — NO cap gate: ingestion is already rate-limited at upload time, and failing a document mid-pipeline for a cap breach would strand it (F-26 territory, Batch 5).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_ingestion_service.py` (reuse its document/session factories and the existing `litellm.embedding` patch):

```python
def test_ingestion_meters_embedding_spend(db_session, monkeypatch, tmp_path):
    doc = _mk_pending_doc(db_session, tmp_path)  # reuse the file's txt-doc factory
    _patch_fake_embedding(monkeypatch)
    monkeypatch.setattr(
        ingestion_service.cost_meter.litellm, "completion_cost", lambda **kw: 0.004
    )
    ingestion_service.run(doc.id)
    user_id = db_session.execute(
        select(SessionModel.user_id).where(SessionModel.id == doc.session_id)
    ).scalar_one()
    assert cost_meter.current_spend(db_session, user_id) == Decimal("0.0040")
```

Note `run()` opens its own `SessionLocal()` — assertions must read committed state (the existing tests in this file already do; follow them). The doc's session's user must exist as a `User` row.

- [ ] **Step 2: Run test to verify it fails**

Run from `backend/`: `pytest tests/test_ingestion_service.py -v -k meters`
Expected: FAIL (spend is 0).

- [ ] **Step 3: Implement**

Change `_embed_all`:

```python
def _embed_all(db, texts: list[str], *, user_id: str | None, session_id: str) -> list[list[float]]:
    out: list[list[float]] = []
    for i in range(0, len(texts), EMBED_BATCH):
        batch = texts[i : i + EMBED_BATCH]
        try:
            resp = litellm.embedding(
                model=settings.embedding_model,
                input=batch,
                dimensions=settings.embedding_dim,
                timeout=settings.embedding_timeout_s,
            )
        except Exception as e:
            raise RuntimeError(f"embedding api failed: {e}") from e
        if user_id is not None:
            # F-19: ingestion is the largest embedding spender; meter it.
            cost_meter.meter_embedding_response(
                db, resp, user_id=user_id, session_id=session_id, texts=batch,
            )
        for item in resp.data:
            out.append(item["embedding"] if isinstance(item, dict) else item.embedding)
    return out
```

In `run()`, before the `_embed_all` call, resolve the owner and thread it through:

```python
            owner_id = db.execute(
                select(SessionModel.user_id).where(SessionModel.id == doc.session_id)
            ).scalar_one_or_none()
            embeddings = _embed_all(
                db, [c.text for c in chunks], user_id=owner_id, session_id=doc.session_id
            )
```

Add `from services import cost_meter` and the `SessionModel` import (`from db.models import Session as SessionModel` — check the file's existing model imports and extend them). Add `select` to the sqlalchemy imports if missing.

- [ ] **Step 4: Run tests, then the full suite**

Run from `backend/`: `pytest tests/test_ingestion_service.py -v && pytest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/ingestion_service.py backend/tests/test_ingestion_service.py
git commit -m "fix: meter ingestion embeddings on the cost ledger, add timeout (F-19, F-06)"
```

---

### Task 9: Tutor loop — timeout, non-zero cost fallback, partial-cost on error arm (F-06, F-19, deferred F-03 item)

**Files:**
- Modify: `backend/agent/tutor.py` (acompletion kwargs; per-iteration cost block; cancel arm ~370-418; error arm ~420-446; new module helper)
- Test: `backend/tests/test_tutor_stream.py`

**Interfaces:**
- Consumes: `cost_meter.estimate_cancelled_cost`, `settings.llm_timeout_s`.
- Produces: module-private `_record_partial_cost(ctx, snapshots, text, purpose) -> Decimal`. Billing invariants: every iteration is marked billed after its metering block; the cancel arm bills only UNBILLED iterations (fixes a latent double-count); the error arm bills ALL iterations after its rollback (the rollback discards this turn's uncommitted ledger flushes, so re-estimating everything is the conservative direction).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_tutor_stream.py` (reuse its fake-stream machinery — the file has established patterns for patching `litellm.acompletion` with async generators and for the F-01 error arm):

```python
@pytest.mark.anyio
async def test_error_arm_records_estimated_cost(db_session, monkeypatch):
    # Batch-1 deferred item: a mid-stream provider crash must still bill the
    # started iteration (the cancel arm already does).
    ctx = _mk_ctx(db_session)
    _patch_acompletion_raising_midstream(monkeypatch)  # reuse/adapt the F-01 test's fake
    monkeypatch.setattr(
        tutor.litellm, "token_counter", lambda **kw: 100
    )
    events = [e async for e in tutor.run_streaming(_msgs(), "sys", ctx)]
    assert any(e.type == "error" for e in events)
    assert cost_meter.current_spend(db_session, ctx.user_id) > Decimal("0")


@pytest.mark.anyio
async def test_builder_failure_falls_back_to_token_math(db_session, monkeypatch):
    # F-19: a pricing-table gap must not register the turn as $0.
    ctx = _mk_ctx(db_session)
    _patch_acompletion_happy_text(monkeypatch)  # normal single-iteration stream
    monkeypatch.setattr(
        tutor.litellm, "stream_chunk_builder",
        lambda *a, **kw: (_ for _ in ()).throw(ValueError("unknown model")),
    )
    monkeypatch.setattr(tutor.litellm, "token_counter", lambda **kw: 100)
    events = [e async for e in tutor.run_streaming(_msgs(), "sys", ctx)]
    assert any(e.type == "done" for e in events)
    assert cost_meter.current_spend(db_session, ctx.user_id) > Decimal("0")


@pytest.mark.anyio
async def test_acompletion_receives_timeout(db_session, monkeypatch):
    ctx = _mk_ctx(db_session)
    captured = {}
    _patch_acompletion_happy_text(monkeypatch, captured)
    events = [e async for e in tutor.run_streaming(_msgs(), "sys", ctx)]
    assert captured["timeout"] == settings.llm_timeout_s
```

Adapt helper names to the file's real fakes; do not duplicate machinery it already has. Ledger writes need a `User` row for `ctx.user_id`.

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_tutor_stream.py -v -k "error_arm_records or builder_failure or receives_timeout"`
Expected: FAIL.

- [ ] **Step 3: Implement**

1. Add `timeout=settings.llm_timeout_s` to the `litellm.acompletion(...)` kwargs at tutor.py:136.

2. Add the module helper (below `_summarize`):

```python
def _record_partial_cost(ctx, snapshots: list[list[dict]], text: str, purpose: str) -> Decimal:
    """Estimate and record spend for iterations whose acompletion started but
    was never metered (cancelled or crashed mid-stream). Token-math estimate,
    same shape as the cancellation arm always used. Never raises."""
    prompt_tokens_total = 0
    for snapshot in snapshots:
        try:
            prompt_tokens_total += litellm.token_counter(
                model=settings.model, messages=snapshot
            )
        except Exception as e:
            # Local tokenization only; no credential in the exception.
            log.warning("token_counter failed: %s", e)  # nosemgrep: python.lang.security.audit.logging.logger-credential-leak.python-logger-credential-disclosure
    try:
        cost = cost_meter.estimate_cancelled_cost(
            settings.model, text, prompt_tokens_total
        )
    except Exception as e:
        log.warning("estimate_cancelled_cost failed: %s", e)
        cost = Decimal("0")
    try:
        cost_meter.record_cost(ctx.db, ctx.user_id, cost)
    except Exception as e:
        log.warning("cost_meter.record_cost (partial) failed: %s", e)
    cost_meter.log_call(
        ctx.db, user_id=ctx.user_id, session_id=ctx.session_id,
        purpose=purpose, model=settings.model, cost_usd=cost,
    )
    return cost
```

3. Track billed work. Next to `accumulated_text = ""` initialization add:

```python
    billed_iters = 0  # iterations whose cost was metered (real or fallback)
    billed_chars = 0  # accumulated_text length at the last metering point
```

Immediately AFTER the per-iteration metering block (after the `if cost > 0:` block closes, before the `if not tool_frags:` check) add:

```python
            billed_iters = len(iter_prompt_snapshots)
            billed_chars = len(accumulated_text)
```

4. F-19 builder-failure fallback — replace the `except` in the per-iteration cost block:

```python
            built = None
            try:
                built = litellm.stream_chunk_builder(chunks, messages=full)
                cost = litellm.completion_cost(completion_response=built) or 0.0
            except Exception as e:
                log.warning("stream completion_cost failed: %s", e)
                # F-19: a pricing-table gap must not register the turn as $0 --
                # fall back to token math so the cap still sees real spend.
                try:
                    pt = litellm.token_counter(model=settings.model, messages=full)
                    cost = cost_meter.estimate_cancelled_cost(
                        settings.model, content_buf, pt
                    )
                except Exception as e2:  # noqa: BLE001
                    log.warning("stream cost token-math fallback failed: %s", e2)
                    cost = 0.0
```

(`cost` may now be a Decimal; `if cost > 0:` and `record_cost`/`log_call` both handle Decimal.)

5. Rewrite the cancel arm's metering (replace everything from `prompt_tokens_total = 0` through the `cost_meter.log_call(...)` call in `except asyncio.CancelledError:`) with:

```python
    except asyncio.CancelledError:
        # Bill only iterations not yet metered: completed iterations already
        # recorded real cost above (previously this arm re-billed all of them).
        cost = _record_partial_cost(
            ctx,
            iter_prompt_snapshots[billed_iters:],
            accumulated_text[billed_chars:],
            "followup" if getattr(ctx, "suppress_check", False) else "chat",
        )
```

(The persist + `cancelled` event code below stays; it already reads `cost` for `estimated_cost_usd`.)

6. In the `except Exception:` error arm, after the `ctx.db.rollback()` try/except and BEFORE `_persist_assistant_message`, add:

```python
        # Deferred F-03 item: the rollback above discards this turn's
        # uncommitted ledger flushes, so re-estimate the WHOLE turn (all
        # snapshots), not just the unbilled tail. Overcounts if a mid-turn
        # tool commit already published earlier increments -- conservative
        # in the cap's favor.
        _record_partial_cost(
            ctx,
            iter_prompt_snapshots,
            accumulated_text,
            "followup" if getattr(ctx, "suppress_check", False) else "chat",
        )
```

(The following `_persist_assistant_message` commit publishes the ledger row.)

- [ ] **Step 4: Run tests, then the full suite**

Run from `backend/`: `pytest tests/test_tutor_stream.py tests/test_tutor_loop.py tests/test_message_cancelled_columns.py tests/test_cost_cap.py -v && pytest`
Expected: PASS. Existing cancellation tests that pinned the old all-snapshots billing may need updating to the unbilled-slice semantics (single-iteration cancels are unchanged: `billed_iters == 0` at cancel time).

- [ ] **Step 5: Commit**

```bash
git add backend/agent/tutor.py backend/tests/test_tutor_stream.py
git commit -m "fix: tutor loop bills failed iterations, token-math cost fallback, LLM timeout (F-06, F-19)"
```

---

### Task 10: Frontend request timeout in apiClient (F-06)

**Files:**
- Modify: `frontend/src/services/apiClient.js:41-57`
- Test: `frontend/src/__tests__/apiClient.test.js`

**Interfaces:**
- Produces: `REQUEST_TIMEOUT_MS = 30000` export; every apiClient request carries `AbortSignal.timeout(...)` when the platform supports it; a timeout surfaces as `ApiError(0, { detail: 'request timed out' }, path)`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/__tests__/apiClient.test.js` (reuse its fetch-mock setup):

```js
it('sends an abort signal with each request', async () => {
  fetch.mockResolvedValueOnce(okJsonResponse({}))
  await apiGet('/ping')
  const init = fetch.mock.calls[0][1]
  expect(init.signal).toBeInstanceOf(AbortSignal)
})

it('maps a timeout abort to a friendly ApiError', async () => {
  fetch.mockRejectedValueOnce(new DOMException('signal timed out', 'TimeoutError'))
  await expect(apiGet('/slow', undefined, { silent: true })).rejects.toMatchObject({
    status: 0,
    body: { detail: 'request timed out' },
  })
})
```

Adapt to the file's actual mock helpers (`okJsonResponse` is indicative).

- [ ] **Step 2: Run tests to verify they fail**

Run from `frontend/`: `npm run test:unit -- --run src/__tests__/apiClient.test.js`
Expected: FAIL (no signal; detail is the raw exception message).

- [ ] **Step 3: Implement**

In `apiClient.js`, add near `BASE_URL`:

```js
// F-06: a hung backend must not spin the UI forever. 30s covers the slowest
// legitimate JSON call (end-session runs a 20s-capped summary LLM call).
export const REQUEST_TIMEOUT_MS = 30000
```

In `request()`, after building `init`:

```js
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    init.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }
```

And in the fetch catch:

```js
  } catch (e) {
    const detail = e?.name === 'TimeoutError' ? 'request timed out' : e.message
    const err = new ApiError(0, { detail }, path)
    if (!silent) reportApiError(err)
    throw err
  }
```

- [ ] **Step 4: Run the frontend suite**

Run from `frontend/`: `npm run test:unit -- --run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/apiClient.js frontend/src/__tests__/apiClient.test.js
git commit -m "fix: 30s request timeout on all apiClient calls (F-06)"
```

---

### Task 11: Frontend SSE header + idle timeouts (F-06)

**Files:**
- Modify: `frontend/src/services/chatStreamService.js` (extract shared `_fetchSse`, add header/idle timeouts)
- Test: `frontend/src/__tests__/chatStreamService.test.js`

**Interfaces:**
- Consumes: `parseSSEStream(body, onEvent, { signal })` (existing), `ApiError` (existing).
- Produces: same public API (`streamChat`, `streamCheckComplete` signatures unchanged). New behavior: 30s cap on time-to-headers; 60s cap on silence between SSE events; either surfaces as `ApiError(0, { detail: ... }, path)`. A caller-initiated abort (user cancel) still propagates as the original AbortError, NOT an ApiError. Total stream duration stays UNCAPPED — multi-tool turns legitimately exceed 30s; the server-side per-iteration `llm_timeout_s` (Task 4) bounds each silent gap, so a 60s idle cap is the correct client-side guard.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/__tests__/chatStreamService.test.js` (reuse its fetch/stream mocks; it already builds ReadableStreams for SSE):

```js
it('rejects with a timeout ApiError when headers never arrive', async () => {
  vi.useFakeTimers()
  fetch.mockImplementationOnce(() => new Promise(() => {}))  // never resolves
  const p = streamChat({ sessionId: 's1', message: 'hi', onEvent: vi.fn() })
  const assertion = expect(p).rejects.toMatchObject({
    status: 0,
    body: { detail: 'request timed out' },
  })
  await vi.advanceTimersByTimeAsync(30000)
  await assertion
  vi.useRealTimers()
})

it('rejects with a timeout ApiError when the stream goes idle', async () => {
  vi.useFakeTimers()
  // A stream that emits one event then hangs forever.
  fetch.mockResolvedValueOnce(sseResponseThatHangsAfterOneEvent())
  const onEvent = vi.fn()
  const p = streamChat({ sessionId: 's1', message: 'hi', onEvent })
  const assertion = expect(p).rejects.toMatchObject({
    status: 0,
    body: { detail: 'stream timed out' },
  })
  await vi.advanceTimersByTimeAsync(61000)
  await assertion
  vi.useRealTimers()
})

it('a caller abort propagates as an abort, not an ApiError', async () => {
  const ctrl = new AbortController()
  fetch.mockImplementationOnce((url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new DOMException('aborted', 'AbortError')))
  }))
  const p = streamChat({ sessionId: 's1', message: 'hi', onEvent: vi.fn(), signal: ctrl.signal })
  ctrl.abort()
  await expect(p).rejects.toMatchObject({ name: 'AbortError' })
})
```

Build `sseResponseThatHangsAfterOneEvent()` with the file's existing ReadableStream helpers: enqueue one `data: {...}\n\n` chunk, never close.

- [ ] **Step 2: Run tests to verify they fail**

Run from `frontend/`: `npm run test:unit -- --run src/__tests__/chatStreamService.test.js`
Expected: new tests FAIL.

- [ ] **Step 3: Implement**

Rewrite `chatStreamService.js` around one shared helper (both exported functions currently duplicate it anyway):

```js
import { parseSSEStream } from '@/lib/sseParser.js'
import { useAuthStore } from '@/stores/auth.js'
import { ApiError } from './apiClient.js'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'

// F-06: bound time-to-headers and inter-event silence, NOT total stream
// duration -- multi-tool turns legitimately run long, and the backend's
// per-iteration llm_timeout_s bounds each silent gap well under 60s.
export const SSE_HEADER_TIMEOUT_MS = 30000
export const SSE_IDLE_TIMEOUT_MS = 60000

function _authToken() {
  try { return useAuthStore().accessToken ?? null } catch { return null }
}

function _timeoutError() {
  return new DOMException('timed out', 'TimeoutError')
}

async function _fetchSse(url, payload, { onEvent, signal, path }) {
  const headers = { 'content-type': 'application/json' }
  const token = _authToken()
  if (token) headers['authorization'] = `Bearer ${token}`

  const ctrl = new AbortController()
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason)
    else signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true })
  }
  const timedOut = () => ctrl.signal.aborted && ctrl.signal.reason?.name === 'TimeoutError'

  const headerTimer = setTimeout(() => ctrl.abort(_timeoutError()), SSE_HEADER_TIMEOUT_MS)
  let resp
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
  } catch (e) {
    if (timedOut()) throw new ApiError(0, { detail: 'request timed out' }, path)
    throw e instanceof TypeError ? new ApiError(0, { detail: e.message }, path) : e
  } finally {
    clearTimeout(headerTimer)
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    let body
    try { body = text ? JSON.parse(text) : null } catch { body = text }
    throw new ApiError(resp.status, body, path)
  }

  let idleTimer = setTimeout(() => ctrl.abort(_timeoutError()), SSE_IDLE_TIMEOUT_MS)
  const wrappedOnEvent = (evt) => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => ctrl.abort(_timeoutError()), SSE_IDLE_TIMEOUT_MS)
    onEvent(evt)
  }
  try {
    await parseSSEStream(resp.body, wrappedOnEvent, { signal: ctrl.signal })
  } catch (e) {
    if (timedOut()) throw new ApiError(0, { detail: 'stream timed out' }, path)
    throw e
  } finally {
    clearTimeout(idleTimer)
  }
}

export async function streamChat({ sessionId, message, reviewGaps = false, reviewGap = null, onEvent, signal }) {
  const payload = { session_id: sessionId, message, review_gaps: reviewGaps }
  if (reviewGap) payload.review_gap = reviewGap
  await _fetchSse(`${BASE_URL}/chat/stream`, payload, { onEvent, signal, path: '/chat/stream' })
}

export async function streamCheckComplete({ sessionId, onEvent, signal }) {
  await _fetchSse(`${BASE_URL}/sessions/${sessionId}/check/complete`, {}, { onEvent, signal, path: '/check/complete' })
}
```

Behavior parity notes: the old code wrapped ANY fetch rejection in `ApiError(0, ...)`; the new code must NOT convert a caller abort into ApiError (session store distinguishes user cancels by AbortError) — hence the `e instanceof TypeError` network-error check. Verify `parseSSEStream`'s `{ signal }` option aborts its read loop on abort (it receives the same controller signal that also cancels the fetch body, so the pending `read()` rejects either way). Check how `stores/session.js` catches stream errors: an `ApiError` from a timeout must land in its existing error path (F-01 Batch-1 safety net), not the cancel path — adjust the store's catch only if it special-cases something other than AbortError.

- [ ] **Step 4: Run the frontend suite + lint**

Run from `frontend/`: `npm run test:unit -- --run && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/chatStreamService.js frontend/src/__tests__/chatStreamService.test.js
git commit -m "fix: SSE header and idle timeouts in chat stream client (F-06)"
```

---

### Task 12: Documentation sweep + full verification

**Files:**
- Modify: `docs/adversarial-review-2026-07-12.md` (status annotations for F-03, F-06, F-17, F-19, F-43)

**Interfaces:** none (docs + verification only).

- [ ] **Step 1: Annotate the review doc**

Match the exact convention Batch 1 used for F-01/F-04/F-05/F-16 (grep the doc for how those were marked — e.g. a `**Status:** Fixed (Batch 2, fix/adversarial-batch-2, 2026-07-13)` line appended to each finding). Annotate:
- F-03: fixed — cap-gated + metered summaries, rate-limit slot on end/resume.
- F-06: fixed with scope note — timeouts on all 7 LLM call sites + FE request/header/idle timeouts; NO retry-once-shorter-context/503 (deviation from design doc §agent-loop, accepted per review's proposed fix); pool sizing under sustained load out of scope (review's own fix-risk note).
- F-17: fixed — atomic ON CONFLICT increment.
- F-19: fixed — embeddings metered (retrieval, semantic gate, ingestion), token-math fallback replaces $0 in tutor + summaries; note the Batch-1-deferred error-arm billing item is also closed.
- F-43: fixed — fresh SELECT in current_spend.

- [ ] **Step 2: Full verification sweep**

Run from `backend/`: `pytest`
Run from `frontend/`: `npm run test:unit -- --run && npm run lint`
Run from repo root: `python backend/scripts/gen_contracts.py && git diff --exit-code backend/contracts/`
Expected: all green, zero contract drift. Stop and report on any failure.

- [ ] **Step 3: Commit**

```bash
git add docs/adversarial-review-2026-07-12.md
git commit -m "docs: mark adversarial-review Batch 2 findings fixed"
```
