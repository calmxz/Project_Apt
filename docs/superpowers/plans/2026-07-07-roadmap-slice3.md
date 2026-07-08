# Roadmap Slice 3 Implementation Plan — R1 Cross-Session Memory + Carry-Overs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship R1.1 (Continue-topic UI over the existing `seed_mode=resume` backend), R1.2 (gap selector replacing hard-coded `confirmed_gaps[0]`), P2 AC3 (debounced rolling summary of turns dropped from the 20-message window), and the slice-2 prune-by-round follow-up.

**Architecture:** Backend adds one optional ChatRequest field (`review_gap`), one additive migration (0016: `sessions.rolling_summary` + `rolling_summary_count`), one service function (`summary_service.update_rolling_summary`, fired post-stream via starlette `BackgroundTask`), one dynamic-context line (`ROLLING_SUMMARY:`), and a round-aware rewrite of `prune_superseded_excerpts`. Frontend threads `reviewGap` through store/service, adds a `GapPickerDialog`, a `continueTopic` store action (createSession with `seedMode:'resume'`), and rewires the three continuation surfaces.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic + LiteLLM (backend), Vue 3 + Pinia + PrimeVue + Vitest + Playwright (frontend).

**Spec:** `docs/superpowers/specs/2026-07-07-slice3-r1-memory-design.md`

## Global Constraints

- Branch: `feat/roadmap-slice3` (already created off dev `9bdab95`). PR target: `dev`.
- Never hand-edit `backend/contracts/` — edit `docs/api/openapi.yaml`, then run `python backend/scripts/gen_contracts.py` from repo root. CI enforces zero drift.
- No emojis in code or comments.
- Alembic: single head at all times; migration 0016 is additive and nullable only.
- Prompt-cache safety: `IMMUTABLE_RULES` in `agent/prompts.py` must not change; all new prompt content goes in `build_dynamic_context` only. The slice-2 prefix-stability guard test must stay green.
- A failed rolling summary must never break a chat turn.
- Exact review seed message format everywhere: `Review my gap: <G>`.
- Backend tests: from `backend/`: `pytest`. Frontend: from `frontend/`: `npm run test:unit -- --run`. Lint: `npm run lint`.
- Full suites green before the final task ends: backend approx 480 pass, frontend approx 546 pass, plus this slice's new tests.
- Live-code adaptation of roadmap AC wording (flag in PR body): the roadmap says Continue-topic lives on "Home + Sessions library" cards. HomeView has no session cards in live code (sessions surface = sidebar rows + library cards), so the two surfaces are the SessionsLibraryView ended card and the sidebar row menu for ended sessions. Reopen (`POST /sessions/{id}/reopen`) remains available and unchanged.

---

### Task 1: Contract — `review_gap` field on ChatRequest

**Files:**
- Modify: `docs/api/openapi.yaml` (ChatRequest schema, around line 690)
- Generated: `backend/contracts/models.py` (via codegen, do not hand-edit)
- Test: `backend/tests/test_contracts_chat.py` (or the existing contract test file that covers ChatRequest; find with `grep -rn "review_gaps" backend/tests/`)

**Interfaces:**
- Produces: `ChatRequest.review_gap: str | None = None` (Pydantic, from codegen). Tasks 2, 8 rely on this exact field name.

- [ ] **Step 1: Write the failing test**

Locate the test file asserting ChatRequest fields (`grep -rn "review_gaps" backend/tests/ | grep -i contract` — if none exists, add to the test file where ChatRequest validation is tested). Add:

```python
def test_chat_request_accepts_review_gap():
    req = ChatRequest(session_id="s1", message="hi", review_gaps=True, review_gap="derivatives")
    assert req.review_gap == "derivatives"


def test_chat_request_review_gap_defaults_none():
    req = ChatRequest(session_id="s1", message="hi")
    assert req.review_gap is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/ -k review_gap -v`
Expected: FAIL (unexpected keyword / attribute error).

- [ ] **Step 3: Edit the YAML and regenerate**

In `docs/api/openapi.yaml`, ChatRequest properties block becomes:

```yaml
    ChatRequest:
      type: object
      additionalProperties: false
      required: [session_id, message]
      properties:
        session_id:  { type: string, maxLength: 64 }
        message:     { type: string, maxLength: 4000 }
        review_gaps: { type: boolean, default: false }
        review_gap:  { type: [string, "null"], default: null, maxLength: 200 }
```

Then from repo root: `python backend/scripts/gen_contracts.py`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/ -k review_gap -v` — PASS. Also run the codegen-drift check the CI uses (regenerate and `git diff --exit-code backend/contracts/`).

- [ ] **Step 5: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts/ backend/tests/
git commit -m "feat(contract): optional review_gap on ChatRequest (R1.2)"
```

---

### Task 2: Backend gap targeting in `_build_prompt_state`

**Files:**
- Modify: `backend/routes/chat.py:26-54` (`_build_prompt_state`), `backend/routes/chat.py:128-136` (`_prepare_turn` call site)
- Test: `backend/tests/test_chat_prompt_state.py` (find the existing file testing `_build_prompt_state` with `grep -rn "_build_prompt_state" backend/tests/`; extend it)

**Interfaces:**
- Consumes: `ChatRequest.review_gap` (Task 1).
- Produces: `_build_prompt_state(..., review_gaps: bool, review_gap: str | None, ...)` — keyword-only param `review_gap`. `prompt_state["review_gaps_target"]` now honors a valid `review_gap`.

- [ ] **Step 1: Write the failing tests**

```python
def test_review_gap_targets_named_gap(profile_with_gaps):
    # profile_with_gaps.confirmed_gaps == ["gap-a", "gap-b", "gap-c"] (build via existing fixture pattern)
    state = _build_prompt_state(
        session=fake_session, profile=profile_with_gaps, ingestion_status="none",
        retrieval_required=False, review_gaps=True, review_gap="gap-b",
        pending_check=None, quiz_cooldown=None,
    )
    assert state["review_gaps_target"] == "gap-b"


def test_review_gap_invalid_falls_back_to_first(profile_with_gaps):
    state = _build_prompt_state(
        session=fake_session, profile=profile_with_gaps, ingestion_status="none",
        retrieval_required=False, review_gaps=True, review_gap="not-a-gap",
        pending_check=None, quiz_cooldown=None,
    )
    assert state["review_gaps_target"] == "gap-a"


def test_review_gap_none_falls_back_to_first(profile_with_gaps):
    state = _build_prompt_state(
        session=fake_session, profile=profile_with_gaps, ingestion_status="none",
        retrieval_required=False, review_gaps=True, review_gap=None,
        pending_check=None, quiz_cooldown=None,
    )
    assert state["review_gaps_target"] == "gap-a"


def test_resumed_profile_skips_diagnostic(profile_with_gaps):
    # R1.1 AC2: a resume-seeded profile carries a non-null knowledge_level,
    # so the 3Q diagnostic branch must not be taken.
    profile_with_gaps.knowledge_level = "intermediate"
    state = _build_prompt_state(
        session=fake_session, profile=profile_with_gaps, ingestion_status="none",
        retrieval_required=False, review_gaps=False,
        pending_check=None, quiz_cooldown=None,
    )
    assert state["diagnostic_required"] is False
```

Mirror the file's existing fixture/`fake_session` idioms exactly (read the file first).

- [ ] **Step 2: Run to verify failure** — `pytest tests/ -k review_gap -v` → FAIL (unexpected kwarg `review_gap`).

- [ ] **Step 3: Implement**

In `_build_prompt_state`, add keyword param and replace the hard-coded index:

```python
def _build_prompt_state(
    *,
    session: SessionModel,
    profile,
    ingestion_status,
    retrieval_required: bool,
    review_gaps: bool,
    review_gap: str | None = None,
    pending_check,
    quiz_cooldown,
) -> dict:
```

and:

```python
    if review_gaps and profile.confirmed_gaps:
        target = review_gap if review_gap in profile.confirmed_gaps else profile.confirmed_gaps[0]
        prompt_state["review_gaps_target"] = target
        prompt_state["diagnostic_required"] = False
```

In `_prepare_turn`, thread it through:

```python
        review_gaps=getattr(req, "review_gaps", False),
        review_gap=getattr(req, "review_gap", None),
```

- [ ] **Step 4: Run tests** — new tests PASS; whole file's tests PASS (`pytest tests/<that file> -v`).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/chat.py backend/tests/
git commit -m "feat(backend): review_gap targets named gap with silent fallback (R1.2)"
```

---

### Task 3: Migration 0016 + Session model columns

**Files:**
- Create: `backend/db/alembic/versions/0016_session_rolling_summary.py`
- Modify: `backend/db/models.py:31-50` (Session model)
- Test: `backend/tests/test_migrations.py` (extend the existing single-head/upgrade test file; find with `grep -rln "single head\|alembic" backend/tests/`)

**Interfaces:**
- Produces: `SessionModel.rolling_summary: str | None`, `SessionModel.rolling_summary_count: int | None`. Tasks 4, 6 rely on these exact attribute names.

- [ ] **Step 1: Write the failing test**

```python
def test_session_rolling_summary_columns():
    s = SessionModel(id="s-roll", user_id=user.id)
    db.add(s); db.commit()
    assert s.rolling_summary is None
    assert s.rolling_summary_count is None
    s.rolling_summary = "earlier we covered X"
    s.rolling_summary_count = 12
    db.commit()
```

(Adapt to the existing DB-fixture idiom in that test file.)

- [ ] **Step 2: Run to verify failure** — attribute error / unknown column.

- [ ] **Step 3: Implement**

New migration file:

```python
"""sessions: nullable rolling summary columns (roadmap P2 AC3)

Revision ID: 0016_session_rolling_summary
Revises: 0015_llm_call_log_tokens
"""
from alembic import op
import sqlalchemy as sa


revision = "0016_session_rolling_summary"
down_revision = "0015_llm_call_log_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sessions", sa.Column("rolling_summary", sa.Text(), nullable=True))
    op.add_column("sessions", sa.Column("rolling_summary_count", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("sessions", "rolling_summary_count")
    op.drop_column("sessions", "rolling_summary")
```

Model additions inside `class Session` (after `pinned`):

```python
    rolling_summary: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    rolling_summary_count: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
```

(`Integer` may need adding to the existing `sqlalchemy` import line in models.py.)

- [ ] **Step 4: Run tests** — new test PASS; single-head check PASS (`alembic heads` shows only 0016; the existing migration test asserts this).

- [ ] **Step 5: Commit**

```bash
git add backend/db/
git add backend/tests/
git commit -m "feat(db): migration 0016 — sessions rolling summary columns (P2 AC3)"
```

---

### Task 4: `summary_service.update_rolling_summary`

**Files:**
- Modify: `backend/services/summary_service.py`
- Test: `backend/tests/test_rolling_summary.py` (create)

**Interfaces:**
- Consumes: `SessionModel.rolling_summary`, `rolling_summary_count` (Task 3).
- Produces:
  - `summary_service.ROLLING_WINDOW = 20`, `ROLLING_DEBOUNCE = 10`, `ROLLING_SUMMARY_MAX_CHARS = 1200`
  - `summary_service.rolling_summary_due(total_messages: int, summarized_count: int | None) -> bool` (pure)
  - `async summary_service.update_rolling_summary(db, session_id: str) -> str | None` — returns the new summary, or None when not due / on failure.

Debounce semantics (corrects the approximate formula in the spec): `rolling_summary_count` stores how many DROPPED messages the stored summary covers (`total - 20` at the time it ran). Due when at least `ROLLING_DEBOUNCE` new messages have dropped out of the window since:

```
due = total > 20 and (total - 20) - (count or 0) >= 10
```

- [ ] **Step 1: Write the failing tests**

```python
import pytest
from services import summary_service


@pytest.mark.parametrize("total,count,expected", [
    (20, None, False),   # nothing dropped yet
    (29, None, False),   # 9 dropped, below debounce
    (30, None, True),    # 10 dropped, due
    (35, 10, False),     # 15 dropped, 10 covered, 5 new — not due
    (40, 10, True),      # 20 dropped, 10 covered, 10 new — due
])
def test_rolling_summary_due(total, count, expected):
    assert summary_service.rolling_summary_due(total, count) is expected


async def test_update_rolling_summary_not_due_returns_none(db, session_with_messages):
    # session_with_messages: helper creating a session + N ChatMessages (build via existing fixtures)
    s = session_with_messages(n=25)
    assert await summary_service.update_rolling_summary(db, s.id) is None
    assert s.rolling_summary is None


async def test_update_rolling_summary_writes_summary_and_count(db, session_with_messages, monkeypatch):
    s = session_with_messages(n=30)
    monkeypatch.setattr(summary_service.settings, "llm_stub_enabled", True)
    result = await summary_service.update_rolling_summary(db, s.id)
    assert result is not None
    db.refresh(s)
    assert s.rolling_summary == result
    assert s.rolling_summary_count == 10  # 30 - 20 dropped covered
    assert len(s.rolling_summary) <= summary_service.ROLLING_SUMMARY_MAX_CHARS


async def test_update_rolling_summary_llm_failure_skips(db, session_with_messages, monkeypatch):
    s = session_with_messages(n=30)
    monkeypatch.setattr(summary_service.settings, "llm_stub_enabled", False)

    async def boom(*a, **k):
        raise RuntimeError("llm down")

    monkeypatch.setattr(summary_service.litellm, "acompletion", boom)
    assert await summary_service.update_rolling_summary(db, s.id) is None
    db.refresh(s)
    assert s.rolling_summary is None
    assert s.rolling_summary_count is None  # unchanged -> next trigger retries
```

Async tests follow the repo's existing pytest-asyncio idiom (check how `generate_and_persist` is tested and mirror the markers/fixtures).

- [ ] **Step 2: Run to verify failure** — `pytest tests/test_rolling_summary.py -v` → FAIL (no attribute).

- [ ] **Step 3: Implement**

Append to `summary_service.py`:

```python
ROLLING_WINDOW = 20
ROLLING_DEBOUNCE = 10
ROLLING_SUMMARY_MAX_CHARS = 1200

ROLLING_SYSTEM = (
    "Summarize the earlier part of this tutoring conversation in 3-5 sentences."
    " Cover what was taught, what the learner asked, and how they performed."
    " Be specific; this context replaces messages no longer visible to the tutor."
)


def rolling_summary_due(total_messages: int, summarized_count: int | None) -> bool:
    dropped = total_messages - ROLLING_WINDOW
    return dropped > 0 and dropped - (summarized_count or 0) >= ROLLING_DEBOUNCE


def _mechanical_rolling(dropped: list[ChatMessage]) -> str:
    parts = [f"{m.role}: {m.content[:60]}" for m in dropped[-8:]]
    return ("[auto-rolling] " + "; ".join(parts))[:ROLLING_SUMMARY_MAX_CHARS]


async def update_rolling_summary(db: Session, session_id: str) -> str | None:
    """Debounced summary of messages that fell out of the last-20 prompt window.

    Writes Session.rolling_summary / rolling_summary_count. Returns the new
    summary, or None when not due or on failure (count untouched so the next
    trigger retries). Never raises: callers run this post-response.
    """
    try:
        session = db.get(SessionModel, session_id)
        if session is None:
            return None
        messages = db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.id.asc())
        ).scalars().all()
        total = len(messages)
        if not rolling_summary_due(total, session.rolling_summary_count):
            return None
        dropped = messages[: total - ROLLING_WINDOW]

        if settings.llm_stub_enabled:
            summary = _mechanical_rolling(dropped)
        else:
            transcript = "\n".join(f"{m.role}: {m.content[:500]}" for m in dropped)
            resp = await litellm.acompletion(
                model=settings.model,
                messages=[
                    {"role": "system", "content": ROLLING_SYSTEM},
                    {"role": "user", "content": f"Topic: {session.topic or '(unspecified)'}\n\n{transcript}"},
                ],
            )
            content = (resp.choices[0].message.content or "").strip()
            if not content:
                return None
            summary = content[:ROLLING_SUMMARY_MAX_CHARS]
            try:
                cost = litellm.completion_cost(completion_response=resp)
            except Exception as e:  # noqa: BLE001
                log.warning("rolling summary completion_cost failed: %s", e)
                cost = 0
            cost_meter.log_call(
                db,
                user_id=session.user_id,
                session_id=session.id,
                purpose="rolling_summary",
                model=settings.model,
                cost_usd=cost,
                **cost_meter.extract_usage(resp),
            )

        session.rolling_summary = summary
        session.rolling_summary_count = total - ROLLING_WINDOW
        db.commit()
        return summary
    except Exception as e:  # noqa: BLE001 - must never break the caller
        log.warning("rolling summary skipped: %s", e)
        db.rollback()
        return None
```

- [ ] **Step 4: Run tests** — `pytest tests/test_rolling_summary.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/summary_service.py backend/tests/test_rolling_summary.py
git commit -m "feat(backend): debounced rolling summary service (P2 AC3)"
```

---

### Task 5: Post-stream trigger via BackgroundTask

**Files:**
- Modify: `backend/routes/chat.py:149-205` (`chat_stream`)
- Test: `backend/tests/test_rolling_summary.py` (extend) or the existing chat-stream test file (find with `grep -rln "chat/stream" backend/tests/`)

**Interfaces:**
- Consumes: `summary_service.update_rolling_summary` (Task 4).
- Produces: rolling summary task attached as `StreamingResponse(..., background=...)`; helper `_rolling_summary_task(session_id: str)` in chat.py.

- [ ] **Step 1: Write the failing test**

In the chat-stream test file (streaming tests run with the LLM stub), assert the background hook fires after the stream is fully consumed:

```python
def test_stream_schedules_rolling_summary(client, auth_headers, seeded_session, monkeypatch):
    calls = []

    async def fake_update(db, session_id):
        calls.append(session_id)
        return None

    monkeypatch.setattr(summary_service, "update_rolling_summary", fake_update)
    resp = client.post(
        "/api/chat/stream",
        json={"session_id": seeded_session.id, "message": "hello"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    _ = resp.text  # drain the SSE body; TestClient runs background tasks after the response completes
    assert calls == [seeded_session.id]
```

Mirror existing streaming-test fixtures (`client`, auth, seeded session) exactly.

- [ ] **Step 2: Run to verify failure** — `calls == []`.

- [ ] **Step 3: Implement**

In `chat.py` add imports and the task helper:

```python
import logging

from starlette.background import BackgroundTask

from db.database import SessionLocal
from services import summary_service

log = logging.getLogger(__name__)


async def _rolling_summary_task(session_id: str) -> None:
    """Post-response: refresh the rolling summary if due. Own DB session —
    the request session is closed by the time this runs."""
    db = SessionLocal()
    try:
        await summary_service.update_rolling_summary(db, session_id)
    except Exception as e:  # noqa: BLE001 - never surface to the client
        log.warning("rolling summary task failed: %s", e)
    finally:
        db.close()
```

(Confirm `SessionLocal` is the session factory name in `db/database.py`; adjust the import to whatever `get_db` uses.)

Attach to the response in `chat_stream`:

```python
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
        background=BackgroundTask(_rolling_summary_task, req.session_id),
    )
```

The due-check lives inside `update_rolling_summary`, so the task is a cheap no-op for short sessions.

- [ ] **Step 4: Run tests** — new test PASS; full chat-stream test file PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/chat.py backend/tests/
git commit -m "feat(backend): post-stream rolling summary trigger (P2 AC3)"
```

---

### Task 6: Inject ROLLING_SUMMARY into the dynamic context

**Files:**
- Modify: `backend/agent/prompts.py:126-181` (`build_dynamic_context`), `backend/routes/chat.py:40-49` (`_build_prompt_state`)
- Test: existing prompts test file (find with `grep -rln "build_dynamic_context" backend/tests/`) and the `_build_prompt_state` test file from Task 2

**Interfaces:**
- Consumes: `SessionModel.rolling_summary` (Task 3).
- Produces: `prompt_state["rolling_summary"]`; dynamic-context line `ROLLING_SUMMARY: <text|none>` rendered after `LAST_SESSION_SUMMARY`.

- [ ] **Step 1: Write the failing tests**

```python
def test_dynamic_context_renders_rolling_summary():
    out = build_dynamic_context({"rolling_summary": "earlier we derived the chain rule"})
    assert "ROLLING_SUMMARY: earlier we derived the chain rule" in out


def test_dynamic_context_rolling_summary_defaults_none():
    out = build_dynamic_context({})
    assert "ROLLING_SUMMARY: none" in out


def test_prompt_state_carries_rolling_summary(fake_session, profile):
    fake_session.rolling_summary = "covered limits and continuity"
    state = _build_prompt_state(
        session=fake_session, profile=profile, ingestion_status="none",
        retrieval_required=False, review_gaps=False,
        pending_check=None, quiz_cooldown=None,
    )
    assert state["rolling_summary"] == "covered limits and continuity"
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`build_dynamic_context` — add after the `last_session_summary` assignment:

```python
    rolling_summary = state.get("rolling_summary") or "none"
```

and in the returned f-string, after the `LAST_SESSION_SUMMARY` line:

```python
        f"LAST_SESSION_SUMMARY: {last_session_summary}\n"
        f"ROLLING_SUMMARY: {rolling_summary}\n"
```

`_build_prompt_state` — add to the dict:

```python
        "last_session_summary": profile.last_session_summary,
        "rolling_summary": getattr(session, "rolling_summary", None),
```

Do NOT touch `IMMUTABLE_RULES`. Run the prefix-stability guard test and confirm it passes unchanged.

- [ ] **Step 4: Run tests** — new tests PASS, prefix-stability guard PASS, full prompts test file PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agent/prompts.py backend/routes/chat.py backend/tests/
git commit -m "feat(agent): rolling summary injected into dynamic context (P2 AC3)"
```

---

### Task 7: Prune superseded excerpts by dispatch round

**Files:**
- Modify: `backend/agent/context_budget.py:47-61` (`prune_superseded_excerpts`)
- Test: `backend/tests/test_context_budget.py` (extend)

**Interfaces:**
- Produces: same signature `prune_superseded_excerpts(messages: list[dict]) -> None`; new behavior: carriers grouped by nearest preceding assistant message; only rounds older than the newest carrier round are stubbed.

- [ ] **Step 1: Write the failing test**

Reuse the carrier-message factory the existing pruning tests in `test_context_budget.py` already use (they build tool messages containing `<document_excerpt`); call it `make_carrier` below and adapt the name. Add:

```python
def test_sibling_retrievals_same_round_both_survive():
    messages = [
        {"role": "assistant", "content": "", "tool_calls": [{"id": "a"}, {"id": "b"}]},
        make_carrier(doc_id="d1"),   # sibling 1, round 0
        make_carrier(doc_id="d2"),   # sibling 2, same round
    ]
    context_budget.prune_superseded_excerpts(messages)
    assert "<document_excerpt" in messages[1]["content"]
    assert "<document_excerpt" in messages[2]["content"]


def test_older_round_stubbed_newer_round_kept():
    messages = [
        {"role": "assistant", "content": "", "tool_calls": [{"id": "a"}]},
        make_carrier(doc_id="d1"),   # round 0 -> stub
        {"role": "assistant", "content": "", "tool_calls": [{"id": "b"}]},
        make_carrier(doc_id="d2"),   # round 2 -> keep
    ]
    context_budget.prune_superseded_excerpts(messages)
    assert messages[1]["content"].startswith("[superseded retrieval:")
    assert "<document_excerpt" in messages[3]["content"]


def test_sibling_rounds_mixed():
    messages = [
        {"role": "assistant", "content": "", "tool_calls": [{"id": "a"}, {"id": "b"}]},
        make_carrier(doc_id="d1"),
        make_carrier(doc_id="d2"),
        {"role": "assistant", "content": "", "tool_calls": [{"id": "c"}]},
        make_carrier(doc_id="d3"),
    ]
    context_budget.prune_superseded_excerpts(messages)
    assert messages[1]["content"].startswith("[superseded retrieval:")
    assert messages[2]["content"].startswith("[superseded retrieval:")
    assert "<document_excerpt" in messages[4]["content"]
```

(`make_carrier` = the existing test factory name; adapt.)

- [ ] **Step 2: Run to verify failure** — sibling test FAILS under positional pruning (messages[1] gets stubbed).

- [ ] **Step 3: Implement**

Replace the function body:

```python
def prune_superseded_excerpts(messages: list[dict]) -> None:
    """In-place: stub retrieval payloads from earlier dispatch ROUNDS, keeping
    every carrier in the newest round. A round is all tool results answering
    one assistant tool-call message, so sibling retrievals dispatched together
    survive together (they cannot supersede each other). Transport fields are
    preserved; assistant and non-retrieval tool messages are never touched."""
    round_key = -1
    carriers_by_round: dict[int, list[int]] = {}
    for i, m in enumerate(messages):
        if m.get("role") == "assistant":
            round_key = i
        elif m.get("role") == "tool" and _EXCERPT_SENTINEL in (m.get("content") or ""):
            carriers_by_round.setdefault(round_key, []).append(i)
    if len(carriers_by_round) < 2:
        return
    newest = max(carriers_by_round)
    for rk, idxs in carriers_by_round.items():
        if rk == newest:
            continue
        for i in idxs:
            if not messages[i]["content"].startswith(_STUB_PREFIX):
                messages[i]["content"] = _excerpt_stub(messages[i]["content"])
```

- [ ] **Step 4: Run tests** — new tests PASS; every pre-existing test in `test_context_budget.py` PASS (the old superseded-case tests must still hold). Run the token-budget tripwire test; if its numbers moved, re-baseline per the tripwire file's own instructions and say so in the commit body.

- [ ] **Step 5: Commit**

```bash
git add backend/agent/context_budget.py backend/tests/test_context_budget.py
git commit -m "fix(agent): prune retrieval excerpts by dispatch round, not list position"
```

---

### Task 8: Frontend threading — `reviewGap` + `continueTopic` store action

**Files:**
- Modify: `frontend/src/services/chatStreamService.js:11-22`, `frontend/src/stores/session.js` (`sendMessageStreaming`, new `continueTopic`, exports)
- Test: `frontend/src/__tests__/chatStreamService.test.js`, `frontend/src/__tests__/sessionStore.test.js` (extend both)

**Interfaces:**
- Consumes: backend `review_gap` field (Task 1); `sessionsApi.createSession` (`frontend/src/services/sessionsApi.js:6`).
- Produces:
  - `streamChat({ sessionId, message, reviewGaps = false, reviewGap = null, onEvent, signal })` — body gains `review_gap` only when set.
  - `store.sendMessageStreaming({ text, reviewGaps = false, reviewGap = null })`.
  - `store.continueTopic(priorSession) -> created session | undefined` — Tasks 10, 11 call this.

- [ ] **Step 1: Write the failing tests**

`chatStreamService.test.js` (mirror the existing `review_gaps` body test at line 83):

```javascript
it('streamChat puts review_gap in the request body when provided', async () => {
  // same fetch-mock arrangement as the review_gaps test
  await streamChat({ sessionId: 's1', message: 'Review my gap: recursion', reviewGaps: true, reviewGap: 'recursion', onEvent: () => {} })
  const body = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(body.review_gap).toBe('recursion')
})

it('streamChat omits review_gap when not provided', async () => {
  await streamChat({ sessionId: 's1', message: 'hi', onEvent: () => {} })
  const body = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect('review_gap' in body).toBe(false)
})
```

`sessionStore.test.js`:

```javascript
it('forwards reviewGap to streamChat as review_gap', async () => {
  // mirror the existing reviewGaps forwarding test at line 301
  await s.sendMessageStreaming({ text: 'Review my gap: recursion', reviewGaps: true, reviewGap: 'recursion' })
  expect(streamChatMock).toHaveBeenCalledWith(
    expect.objectContaining({ reviewGap: 'recursion' }),
  )
})

it('continueTopic creates a resume session and marks the prior ended locally', async () => {
  createSessionApiMock.mockResolvedValue({ id: 'new-1', topic: 'Calculus' })
  s.sessions = [{ id: 'old-1', topic: 'Calculus', ended_at: null }]
  const created = await s.continueTopic({ id: 'old-1', topic: 'Calculus' })
  expect(createSessionApiMock).toHaveBeenCalledWith({
    topic: 'Calculus', seedMode: 'resume', priorSessionId: 'old-1',
  })
  expect(created.id).toBe('new-1')
  expect(s.sessions.find((x) => x.id === 'old-1').ended_at).toBeTruthy()
})
```

(Adapt mock names to the file's existing mock setup.)

- [ ] **Step 2: Run to verify failure** — `npm run test:unit -- --run` on the two files.

- [ ] **Step 3: Implement**

`chatStreamService.js`:

```javascript
export async function streamChat({ sessionId, message, reviewGaps = false, reviewGap = null, onEvent, signal }) {
  ...
  const payload = { session_id: sessionId, message, review_gaps: reviewGaps }
  if (reviewGap) payload.review_gap = reviewGap
  ...
      body: JSON.stringify(payload),
```

`stores/session.js` — `sendMessageStreaming({ text, reviewGaps = false, reviewGap = null })`, pass `reviewGap` into the `streamChat` call next to `reviewGaps`. New action (place after `reopenSession`, before `renameSession`):

```javascript
  async function continueTopic(prior) {
    loading.value = true
    error.value = null
    try {
      const created = await sessionsApi.createSession({
        topic: prior.topic,
        seedMode: 'resume',
        priorSessionId: prior.id,
      })
      // Backend auto-ends the prior session on resume-create; reflect it
      // locally so ended-state UI updates without a refetch.
      const idx = sessions.value.findIndex((x) => x.id === prior.id)
      if (idx !== -1 && !sessions.value[idx].ended_at) {
        sessions.value[idx].ended_at = new Date().toISOString()
      }
      if (currentSession.value?.id === prior.id && !currentSession.value.ended_at) {
        currentSession.value.ended_at = new Date().toISOString()
      }
      currentSession.value = created
      currentSessionId.value = created.id
      messages.value = []
      return created
    } catch (e) {
      _setError(e)
    } finally {
      loading.value = false
    }
  }
```

Add `continueTopic` to the store's return object.

- [ ] **Step 4: Run tests** — both files PASS; full frontend unit suite PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/chatStreamService.js frontend/src/stores/session.js frontend/src/__tests__/
git commit -m "feat(frontend): reviewGap threading + continueTopic store action (R1)"
```

---

### Task 9: GapPickerDialog component

**Files:**
- Create: `frontend/src/components/GapPickerDialog.vue`
- Test: `frontend/src/__tests__/gapPickerDialog.test.js` (create)

**Interfaces:**
- Produces: `<GapPickerDialog :visible :gaps @update:visible @select>` — `gaps: string[]`; `select` emits the chosen gap string. Tasks 10 consumes it.

- [ ] **Step 1: Write the failing tests**

```javascript
import { mount } from '@vue/test-utils'
import GapPickerDialog from '@/components/GapPickerDialog.vue'

const GAPS = ['recursion', 'closures', 'hoisting']

function mountPicker(props = {}) {
  return mount(GapPickerDialog, {
    props: { visible: true, gaps: GAPS, ...props },
    global: { stubs: { teleport: true, Dialog: { template: '<div v-if="$attrs.visible"><slot /></div>' } } },
  })
}

it('renders one option per gap with testids', () => {
  const w = mountPicker()
  GAPS.forEach((g, i) => {
    const btn = w.find(`[data-testid="gap-picker-option-${i}"]`)
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain(g)
  })
})

it('emits select with the clicked gap and closes', async () => {
  const w = mountPicker()
  await w.find('[data-testid="gap-picker-option-1"]').trigger('click')
  expect(w.emitted('select')[0]).toEqual(['closures'])
  expect(w.emitted('update:visible')[0]).toEqual([false])
})
```

(If the repo's existing component tests stub PrimeVue differently — check how SessionView tests handle `Dialog` — mirror that idiom instead.)

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```vue
<template>
  <Dialog
    :visible="visible"
    modal
    header="Which gap should we review?"
    :style="{ width: '24rem' }"
    data-testid="gap-picker"
    @update:visible="$emit('update:visible', $event)"
  >
    <ul class="gap-list" role="listbox" aria-label="Confirmed gaps">
      <li v-for="(g, i) in gaps" :key="g">
        <button
          type="button"
          class="gap-option"
          role="option"
          :data-testid="`gap-picker-option-${i}`"
          @click="choose(g)"
        >
          <i class="pi pi-bullseye" aria-hidden="true" />
          <span>{{ g }}</span>
        </button>
      </li>
    </ul>
  </Dialog>
</template>

<script setup>
import Dialog from 'primevue/dialog'

defineProps({
  visible: { type: Boolean, default: false },
  gaps: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:visible', 'select'])

function choose(gap) {
  emit('select', gap)
  emit('update:visible', false)
}
</script>

<style scoped>
.gap-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.gap-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  cursor: pointer;
  text-align: left;
  transition: background var(--motion-fast) ease, border-color var(--motion-fast) ease;
}

.gap-option:hover {
  background: var(--color-surface-soft);
}

.gap-option:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
</style>
```

Keyboard accessibility: PrimeVue `Dialog` provides focus trap + Esc-close; options are native buttons (Tab/Enter). No extra key handling needed.

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/GapPickerDialog.vue frontend/src/__tests__/gapPickerDialog.test.js
git commit -m "feat(frontend): GapPickerDialog component (R1.2)"
```

---

### Task 10: Review entry points — SessionView picker + ProfileView button

**Files:**
- Modify: `frontend/src/views/SessionView.vue` (imports ~line 130, `resumeReviewGaps` at 472-483, template near the SessionEndedBanner at lines 22-29), `frontend/src/views/ProfileView.vue` (header actions)
- Test: `frontend/src/__tests__/sessionView.test.js` (extend; existing resumeReviewGaps test at line 411), ProfileView test file (find with `ls frontend/src/__tests__ | grep -i profile`)

**Interfaces:**
- Consumes: `GapPickerDialog` (Task 9), `store.sendMessageStreaming({ text, reviewGaps, reviewGap })` (Task 8), `hasGaps` computed (`SessionView.vue:182-184`, source `store.currentSession?.topic_profile?.confirmed_gaps`).
- Produces: route contract — `/session/:id?review_gap=<G>` triggers the review flow for gap G then strips the query. ProfileView navigates with that query.

- [ ] **Step 1: Write the failing tests**

`sessionView.test.js`:

```javascript
it('resumeReviewGaps opens the picker when more than one confirmed gap', async () => {
  // arrange currentSession.topic_profile.confirmed_gaps = ['a', 'b'] via existing fixture pattern
  await wrapper.find('[data-testid="session-resume-gaps"]').trigger('click')
  expect(wrapper.find('[data-testid="gap-picker"]').exists()).toBe(true)
  expect(sendSpy).not.toHaveBeenCalled()
})

it('picker selection reopens then sends the targeted review seed', async () => {
  await wrapper.find('[data-testid="session-resume-gaps"]').trigger('click')
  await wrapper.find('[data-testid="gap-picker-option-1"]').trigger('click')
  expect(reopenSpy).toHaveBeenCalled()
  expect(sendSpy).toHaveBeenCalledWith({ text: 'Review my gap: b', reviewGaps: true, reviewGap: 'b' })
})

it('single confirmed gap skips the picker and sends directly', async () => {
  // confirmed_gaps = ['only-gap']
  await wrapper.find('[data-testid="session-resume-gaps"]').trigger('click')
  expect(wrapper.find('[data-testid="gap-picker"]').exists()).toBe(false)
  expect(sendSpy).toHaveBeenCalledWith({ text: 'Review my gap: only-gap', reviewGaps: true, reviewGap: 'only-gap' })
})
```

ProfileView test:

```javascript
it('review-gaps button routes to the session with review_gap query', async () => {
  // profile fixture with confirmed_gaps = ['a', 'b']; click review button, pick option 0
  await w.find('[data-testid="sprof-review-gaps"]').trigger('click')
  await w.find('[data-testid="gap-picker-option-0"]').trigger('click')
  expect(routerPushMock).toHaveBeenCalledWith({ name: 'session', params: { id }, query: { review_gap: 'a' } })
})
```

(Adapt spies/fixtures to each file's existing arrangement — read the neighboring tests first.)

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`SessionView.vue` script — import and state:

```javascript
import GapPickerDialog from '../components/GapPickerDialog.vue'

const gapPickerOpen = ref(false)
const confirmedGaps = computed(
  () => store.currentSession?.topic_profile?.confirmed_gaps ?? [],
)
```

Replace `resumeReviewGaps` and add the send helper + query handling:

```javascript
async function resumeReviewGaps() {
  if (!store.currentSession) return
  if (confirmedGaps.value.length > 1) {
    gapPickerOpen.value = true
    return
  }
  await sendReviewSeed(confirmedGaps.value[0])
}

async function onGapPicked(gap) {
  await sendReviewSeed(gap)
}

async function sendReviewSeed(gap) {
  resuming.value = true
  try {
    if (isEnded.value) await store.reopenSession(store.currentSession.id)
    await store.sendMessageStreaming({
      text: `Review my gap: ${gap}`,
      reviewGaps: true,
      reviewGap: gap,
    })
  } catch {
    // store.error already populated
  } finally {
    resuming.value = false
  }
}
```

Handle the ProfileView handoff (add to the existing onMounted/route-watch section; SessionView already watches `props.id` — mirror that idiom):

```javascript
watch(
  () => route.query.review_gap,
  async (gap) => {
    if (!gap) return
    router.replace({ query: { ...route.query, review_gap: undefined } })
    await sendReviewSeed(String(gap))
  },
  { immediate: true },
)
```

(`route`/`router` may already be imported in SessionView; reuse them. The guard `if (isEnded.value)` in `sendReviewSeed` covers both ended and active sessions — ProfileView can hand off either.)

Template — after the SessionEndedBanner block:

```vue
      <GapPickerDialog
        v-model:visible="gapPickerOpen"
        :gaps="confirmedGaps"
        @select="onGapPicked"
      />
```

`ProfileView.vue` — add a header action button (near the level-edit control) shown when gaps exist, plus picker state; `data.profile.confirmed_gaps` is already loaded:

```vue
        <button
          v-if="data?.profile?.confirmed_gaps?.length"
          type="button"
          class="review-gaps-btn"
          data-testid="sprof-review-gaps"
          @click="startReview"
        >
          <i class="pi pi-bullseye" aria-hidden="true" />
          Review gaps
        </button>

        <GapPickerDialog
          v-model:visible="gapPickerOpen"
          :gaps="data?.profile?.confirmed_gaps ?? []"
          @select="goReview"
        />
```

```javascript
import GapPickerDialog from '../components/GapPickerDialog.vue'

const gapPickerOpen = ref(false)

function startReview() {
  const gaps = data.value?.profile?.confirmed_gaps ?? []
  if (gaps.length > 1) gapPickerOpen.value = true
  else if (gaps.length === 1) goReview(gaps[0])
}

function goReview(gap) {
  router.push({ name: 'session', params: { id: props.id }, query: { review_gap: gap } })
}
```

(ProfileView already has `id` and a router import per its BackButton usage — reuse; style the button with the view's existing button tokens.)

- [ ] **Step 4: Run tests** — both view test files PASS; full frontend suite PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/SessionView.vue frontend/src/views/ProfileView.vue frontend/src/__tests__/
git commit -m "feat(frontend): gap picker at both review entry points (R1.2)"
```

---

### Task 11: Continue-topic surfaces + NewSessionView copy

**Files:**
- Modify: `frontend/src/views/SessionsLibraryView.vue:12-15,197-205`, `frontend/src/components/sidebar/SidebarRowMenu.vue` (emits + ended-state menu), `frontend/src/components/sidebar/SidebarSessionRow.vue:65-71,179-188`, `frontend/src/views/NewSessionView.vue` (copy at line 24)
- Test: library view test file, sidebar row test file (find with `ls frontend/src/__tests__ | grep -i -e library -e sidebar`), NewSessionView test if copy is asserted anywhere (`grep -rn "Ended tab" frontend/src/__tests__/`)

**Interfaces:**
- Consumes: `store.continueTopic(prior)` (Task 8).
- Produces: library `library-continue-${id}` button now continue-topic; sidebar menu item `sidebar-row-menu-continue-topic`; `SidebarRowMenu` gains `continue-topic` emit.

- [ ] **Step 1: Write the failing tests**

Library:

```javascript
it('Continue topic on an ended card creates a resume session and routes to it', async () => {
  continueTopicMock.mockResolvedValue({ id: 'new-9' })
  await w.find(`[data-testid="library-continue-${endedSession.id}"]`).trigger('click')
  expect(continueTopicMock).toHaveBeenCalledWith(expect.objectContaining({ id: endedSession.id }))
  expect(routerPushMock).toHaveBeenCalledWith({ name: 'session', params: { id: 'new-9' } })
})
```

Sidebar row:

```javascript
it('ended row menu offers Continue topic which calls store.continueTopic and routes', async () => {
  // mount with ended session; open menu
  await w.find('[data-testid="sidebar-row-menu-trigger"]').trigger('click')
  await w.find('[data-testid="sidebar-row-menu-continue-topic"]').trigger('click')
  expect(continueTopicMock).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`SessionsLibraryView.vue` — replace the handler and label:

```javascript
async function continueSession(s) {
  const created = await store.continueTopic(s)
  if (created) router.push({ name: 'session', params: { id: created.id } })
}
```

```vue
        <button
          v-if="s.ended_at"
          type="button"
          class="library-continue"
          :data-testid="`library-continue-${s.id}`"
          @click="continueSession(s)"
        >
          Continue topic
        </button>
```

(Note the click arg change from `s.id` to `s` — continueTopic needs `topic` too.)

`SidebarRowMenu.vue` — extend emits and ended-state menu:

```javascript
const emit = defineEmits(['end', 'resume', 'continue-topic', 'rename', 'pin', 'unpin'])
```

in `onAction`: `else if (kind === 'continue-topic') emit('continue-topic')`. Template, inside the `v-else-if="state === 'ended'"` group, add ABOVE the Resume item (Resume stays):

```vue
      <button
        v-if="state === 'ended'"
        type="button"
        role="menuitem"
        class="sb-row-menu-item"
        data-testid="sidebar-row-menu-continue-topic"
        :disabled="busy"
        @click="onAction('continue-topic')"
      >
        <i class="pi pi-play" aria-hidden="true" />
        <span>Continue topic</span>
      </button>
```

(Restructure the existing `v-else-if="state === 'ended'"` on the Resume button to plain `v-if="state === 'ended'"` so both render.)

`SidebarSessionRow.vue` — handler + binding (mirror `onResume` at line 65; the file already has router access for row navigation — reuse its idiom):

```javascript
async function onContinueTopic() {
  if (busy.value) return
  busy.value = true
  try {
    const created = await store.continueTopic(props.session)
    if (created) router.push({ name: 'session', params: { id: created.id } })
    closeDrawer()
  } finally {
    busy.value = false
  }
}
```

```vue
      @resume="onResume"
      @continue-topic="onContinueTopic"
```

`NewSessionView.vue` line 24 copy becomes:

```
          To continue an ended topic, use "Continue topic" on its card in the
          Sessions library — the tutor keeps your profile. Reopening from the
          sidebar picks up the same session instead.
```

- [ ] **Step 4: Run tests** — extended files PASS; full frontend suite + lint PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/SessionsLibraryView.vue frontend/src/views/NewSessionView.vue frontend/src/components/sidebar/ frontend/src/__tests__/
git commit -m "feat(frontend): Continue topic on library card + sidebar menu (R1.1)"
```

---

### Task 12: Playwright resume spec + roadmap doc update

**Files:**
- Modify: `frontend/e2e/resume-carries-profile.spec.js` (un-skip + rewrite), `docs/planning/2026-07-06-10x-roadmap.md` (R1 + P2 AC3 status lines)
- Verify: full backend + frontend suites

**Interfaces:**
- Consumes: `library-continue-${id}` testid (Task 11), LLM stub resume marker (the stub emits `[STUB:resumed:` on `seed_mode=resume` first turns — verify with `grep -rn "STUB:resumed" backend/` and adapt the assertion to what the stub actually emits today).

- [ ] **Step 1: Rewrite the spec**

Remove `.skip`. Flow (mirror the file's existing helpers for auth/session creation):

```javascript
test.describe('resume carries profile', () => {
  test('continue topic from library carries profile into a new session', async ({ page }) => {
    // 1. create session A (existing helper), exchange one stubbed turn
    // 2. end session A (existing end-session control)
    // 3. navigate to /sessions, filter Ended (library-filter-ended)
    // 4. click library-continue-<idA>
    await page.getByTestId(`library-continue-${sessionId}`).click()
    // 5. URL now /session/<idB> with idB != idA
    await expect(page).not.toHaveURL(new RegExp(sessionId))
    // 6. send a message; stubbed assistant reply marks the resumed profile
    const assistant = page.locator('[data-testid="chat-message-assistant"]').last()
    await expect(assistant).toContainText('[STUB:resumed:')
  })
})
```

Adapt testids/assertion text to what the file and stub actually use — read the old spec body and the stub implementation first; keep its auth/setup helpers.

- [ ] **Step 2: Run it**

From `frontend/`: `npx playwright test e2e/resume-carries-profile.spec.js` (requires the docker/stub stack per the repo's e2e setup — follow `e2e` README or CI job env). If e2e cannot run locally, ensure the spec at least passes lint/type and note in the commit body that CI e2e (continue-on-error) validates it.

- [ ] **Step 3: Update the roadmap doc**

In `docs/planning/2026-07-06-10x-roadmap.md`: mark R1.1/R1.2 as in PR `feat/roadmap-slice3` with AC checklists, P2 AC3 as shipped in `feat/roadmap-slice3`, and the slice-2 prune-by-position follow-up as closed.

- [ ] **Step 4: Full verification**

- From `backend/`: `pytest` — full suite green.
- From `frontend/`: `npm run test:unit -- --run` and `npm run lint` — green.
- Contracts drift: regenerate, `git diff --exit-code backend/contracts/`.
- `alembic heads` (from `backend/`): single head `0016_session_rolling_summary`.

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e/resume-carries-profile.spec.js docs/planning/2026-07-06-10x-roadmap.md
git commit -m "test(e2e): revive resume-carries-profile via Continue topic; roadmap status"
```

---

## Post-plan (not tasks): PR + human gates

- PR `feat/roadmap-slice3` -> `dev`, body lists: live alembic upgrade (0016), paid live smokes (continue-topic end-to-end, gap picker targeting, rolling summary visible in a >30-message session), and the Home-cards -> sidebar/library AC adaptation note.
