# Adversarial Review Batch 3 — Auth + Session Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 10 auth/session findings of Batch 3 from `docs/adversarial-review-2026-07-12.md` — F-07 (JWKS exception mapping), F-41 (JWT leeway), F-37 (ensure_user upsert), F-36 (ensure_user before FK-bearing rate-limit insert) plus the Batch-1-deferred rate-limit-slot-before-409 ordering, F-32 (zero-message summary short-circuit), F-33 (single-commit end), F-30 (atomic end claim), F-31 (abandon check batch on resume-create), F-08 (per-uid frontend user store), F-09 (frontend 401 refresh-retry).

**Architecture:** Backend: exception-map JWKS failures to 401/503 with 30s leeway; make `ensure_user` an ON CONFLICT upsert and run it before the usage-counter insert; reorder `_prepare_turn` so session 404/409 guards precede rate-limit slot consumption; restructure session end into claim-first (conditional UPDATE) + LLM + one final commit that also abandons any open check batch. Frontend: namespace the user-preferences localStorage key by Supabase uid and drive it from auth state changes; add a one-shot 401 refresh-retry to `apiClient` and `chatStreamService`, falling back to sign-out + login redirect.

**Tech Stack:** FastAPI + sync SQLAlchemy (sqlite tests / Postgres live), PyJWT 2.13 (`PyJWKClientError` / `PyJWKClientConnectionError` verified importable from top-level `jwt`), Vue 3 + Pinia + supabase-js v2, vitest, pytest.

## Global Constraints

- No emojis in code or comments. No secrets committed. (CLAUDE.md ground rules.)
- Branch: `fix/adversarial-batch-3` (already created off dev at `65f8446`).
- `settings.llm_stub_enabled` is a computed property — in tests monkeypatch `settings.llm_stub`, never the property.
- oxlint auto-edits `frontend/src/services/apiClient.js` (`{...(headers || {})}` -> `{...headers}`) on every `npm run lint` — revert that hunk before committing unless the task intentionally touches that line.
- Use the native Grep tool for repo sweeps (rtk-rg returns false zero-match).
- No new Alembic migration is needed in this batch (no schema change anywhere).
- Contracts are codegen: no `docs/api/openapi.yaml` change is planned; do NOT hand-edit `backend/contracts/`.
- Backend tests from `backend/`: `pytest`. Frontend from `frontend/`: `npm run test:unit -- --run`. Baselines at branch start: BE 665 passed / 5 skipped, FE 606 passed.
- PR bodies must stay minimal (no enumerations of unfixed security gaps) — the permission classifier blocks them on this public repo. Details live in `.superpowers/sdd/progress.md` and the plan.

---

### Task 1: auth.py hardening — F-07 exception mapping + F-41 leeway

**Files:**
- Modify: `backend/services/auth.py`
- Test: `backend/tests/test_auth_dependency.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `auth.JWT_LEEWAY_SECONDS: int = 30` module constant; `verify_supabase_jwt` now raises `HTTPException(503, detail="auth_unavailable")` on JWKS connectivity failure and `HTTPException(401, detail="invalid_token")` on unknown `kid` (previously both escaped as 500).

Background: `verify_supabase_jwt` (`auth.py:64-88`) catches `(jwt.InvalidTokenError, httpx.HTTPError, KeyError)`. `PyJWKClientError` and its subclass `PyJWKClientConnectionError` are siblings of `InvalidTokenError` under `PyJWTError`, so `get_signing_key_from_jwt` failures escape as 500. `PyJWKClient` uses urllib, so the `httpx.HTTPError` arm is dead. `jwt.decode` has no `leeway`, so a few seconds of clock skew 401s fresh tokens.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_auth_dependency.py` (follow the file's existing import style; add `import jwt as pyjwt` and `from services import auth` if not present):

```python
class _RaisingJwksClient:
    def __init__(self, exc):
        self._exc = exc

    def get_signing_key_from_jwt(self, token):
        raise self._exc


def test_unknown_kid_returns_401_not_500(monkeypatch):
    """F-07: a spoofed/unknown kid is a bad token (401), not a server error."""
    monkeypatch.setattr(
        auth,
        "_get_jwks_client",
        lambda: _RaisingJwksClient(pyjwt.PyJWKClientError('Unable to find a signing key')),
    )
    with pytest.raises(HTTPException) as exc:
        auth.verify_supabase_jwt("h.p.s")
    assert exc.value.status_code == 401
    assert exc.value.detail == "invalid_token"


def test_jwks_connection_failure_returns_503(monkeypatch):
    """F-07: JWKS unreachable is an upstream outage (503), not invalid auth."""
    monkeypatch.setattr(
        auth,
        "_get_jwks_client",
        lambda: _RaisingJwksClient(pyjwt.PyJWKClientConnectionError("fetch failed")),
    )
    with pytest.raises(HTTPException) as exc:
        auth.verify_supabase_jwt("h.p.s")
    assert exc.value.status_code == 503
    assert exc.value.detail == "auth_unavailable"


def test_decode_called_with_leeway(monkeypatch):
    """F-41: 30s leeway absorbs backend-vs-Supabase clock skew at exp boundary."""

    class _Key:
        key = "test-key"

    class _Client:
        def get_signing_key_from_jwt(self, token):
            return _Key()

    captured = {}

    def _fake_decode(token, key, **kwargs):
        captured.update(kwargs)
        return {"sub": "user-1"}

    monkeypatch.setattr(auth, "_get_jwks_client", lambda: _Client())
    monkeypatch.setattr(auth.jwt, "decode", _fake_decode)
    assert auth.verify_supabase_jwt("h.p.s") == "user-1"
    assert captured["leeway"] == auth.JWT_LEEWAY_SECONDS == 30
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_auth_dependency.py -v -k "kid or jwks or leeway"`
Expected: FAIL — first two raise `PyJWKClientError`/`PyJWKClientConnectionError` uncaught (not HTTPException), third fails on missing `leeway` kwarg / missing `JWT_LEEWAY_SECONDS`.

- [ ] **Step 3: Implement**

In `backend/services/auth.py`:

1. Delete the `import httpx` line (line 15) — verify with Grep that `httpx` has no other use in this file before deleting.
2. Add below `_JWKS_TTL_SECONDS`:

```python
JWT_LEEWAY_SECONDS = 30  # F-41: absorb small backend-vs-Supabase clock skew
```

3. Replace the body of `verify_supabase_jwt` with:

```python
def verify_supabase_jwt(token: str) -> str:
    """Return the Supabase user id (`sub`) for a valid JWT, else raise 401.

    JWKS connectivity failures raise 503 (upstream outage, retryable);
    an unknown `kid` or any invalid token raises 401 (F-07).
    """
    try:
        jwks_client = _get_jwks_client()
        signing_key = jwks_client.get_signing_key_from_jwt(token).key
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256", "ES256"],
            audience="authenticated",
            issuer=f"{settings.supabase_url}/auth/v1",
            leeway=JWT_LEEWAY_SECONDS,
            options={"verify_aud": True, "verify_exp": True, "verify_iss": True},
        )
    except jwt.PyJWKClientConnectionError as e:
        # F-07: JWKS endpoint unreachable -- an upstream outage, not a bad
        # token. 503 keeps client retry semantics honest. Must precede the
        # PyJWKClientError arm (it is a subclass).
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="auth_unavailable",
        ) from e
    except (jwt.PyJWKClientError, jwt.InvalidTokenError, KeyError) as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_token",
        ) from e
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_token",
        )
    return sub
```

- [ ] **Step 4: Run the full auth test file**

Run: `pytest tests/test_auth_dependency.py tests/test_startup_jwks.py -v`
Expected: PASS (sweep for any existing test asserting the old `httpx.HTTPError` arm; update it to the new mapping if found).

- [ ] **Step 5: Commit**

```bash
git add backend/services/auth.py backend/tests/test_auth_dependency.py
git commit -m "fix: map JWKS failures to 401/503 and add 30s JWT leeway (F-07, F-41)"
```

---

### Task 2: ensure_user upsert — F-37

**Files:**
- Modify: `backend/services/user_service.py`
- Test: `backend/tests/test_ensure_user.py`

**Interfaces:**
- Consumes: `services.sql_dialect.dialect_insert(db)` (existing; returns pg/sqlite `insert` supporting `on_conflict_do_nothing`).
- Produces: `ensure_user(db, user_id) -> User` — signature unchanged; now race-safe (concurrent first-calls cannot raise IntegrityError). Existing rows still returned unchanged (no re-stamp of `accepted_terms_at`/`terms_version`).

Background: current `ensure_user` is `db.get` -> `db.add` -> `db.flush` with no IntegrityError handling; two parallel first-requests both miss the get and one flush 500s. `rate_limit.check_and_increment` already uses the ON CONFLICT pattern via `dialect_insert`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_ensure_user.py` (match its existing fixtures/imports; it already imports `ensure_user` and the `User` model):

```python
def test_ensure_user_lost_insert_race_returns_existing_row(db_session, monkeypatch):
    """F-37: simulate the get-miss/insert-exists race. A row that appears
    between the identity check and the INSERT must be returned unchanged
    (no IntegrityError, no re-stamp)."""
    existing = User(
        id="race-user",
        accepted_terms_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        terms_version="v-old",
    )
    db_session.add(existing)
    db_session.commit()

    # Force the create path even though the row exists.
    real_get = db_session.get
    monkeypatch.setattr(
        db_session,
        "get",
        lambda model, pk: None if (model is User and pk == "race-user") else real_get(model, pk),
    )

    user = ensure_user(db_session, "race-user")
    assert user.id == "race-user"
    assert user.terms_version == "v-old"  # existing stamp preserved
```

Add `from datetime import datetime, timezone` to the test file imports if missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_ensure_user.py -v`
Expected: the new test FAILS with `IntegrityError` (or a flush error) from the unconditional `db.add` path.

- [ ] **Step 3: Implement**

Replace `ensure_user` in `backend/services/user_service.py`:

```python
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import User
from lib.terms import CURRENT_TERMS_VERSION
from services.sql_dialect import dialect_insert


def ensure_user(db: Session, user_id: str) -> User:
    """Return the users row for user_id, creating it if absent.

    On create, stamp accepted_terms_at (server-owned, tz-aware) and
    terms_version. Existing rows are returned unchanged (no re-stamp).
    Race-safe (F-37): INSERT ... ON CONFLICT DO NOTHING so two concurrent
    first-requests cannot IntegrityError; the loser re-selects the winner's
    row. Writes stay pending until the caller's commit, same as the old
    flush-based version.
    """
    user = db.get(User, user_id)
    if user is not None:
        return user
    insert = dialect_insert(db)
    db.execute(
        insert(User)
        .values(
            id=user_id,
            accepted_terms_at=datetime.now(timezone.utc),
            terms_version=CURRENT_TERMS_VERSION,
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )
    return db.execute(select(User).where(User.id == user_id)).scalar_one()
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_ensure_user.py tests/test_terms_acceptance_model.py -v`
Expected: PASS (existing create/no-re-stamp tests must stay green).

- [ ] **Step 5: Commit**

```bash
git add backend/services/user_service.py backend/tests/test_ensure_user.py
git commit -m "fix: race-safe ensure_user via ON CONFLICT upsert (F-37)"
```

---

### Task 3: _prepare_turn ordering — F-36 + Batch-1 deferred rate-limit slot

**Files:**
- Modify: `backend/routes/chat.py:120-173` (`_prepare_turn`)
- Test: `backend/tests/test_chat_stream_route.py`

**Interfaces:**
- Consumes: `ensure_user` (Task 2), `rate_limit.check_and_increment` (unchanged; note it COMMITS internally — that commit now also persists the pending `ensure_user` insert, satisfying the FK atomically).
- Produces: `_prepare_turn` with guard order: cost cap -> session 404/409 -> ensure_user -> rate limit. Same statement count (perf budget tests unchanged), same HTTP payloads.

Background (two defects, one reorder):
- F-36: `check_and_increment` INSERTs `usage_counters` (FK -> users.id) at line 140, BEFORE `ensure_user` at line 154 — first-ever chat from a valid-JWT user with no users row FK-violates on Postgres (sqlite tests don't enforce FKs, so the suite misses it).
- Batch-1 deferral: the rate-limit slot is consumed before the ended-session 409 (line 169) and foreign-session 404 (line 166) — a rejected turn burns a daily slot.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_chat_stream_route.py` (reuse its existing fixtures for db/session seeding; `_prepare_turn` is directly callable — see `test_chat_prepare_perf.py:72` for the `asyncio.run(_prepare_turn(req, USER_ID, db))` pattern; imports needed: `from db.models import UsageCounter, User`, `from services import rate_limit`, `from sqlalchemy import select, func`):

```python
def _today_counter_count(db):
    return db.execute(select(func.count()).select_from(UsageCounter)).scalar_one()


def test_ended_session_409_consumes_no_rate_slot(db_session, seeded_ended_session):
    """Batch-1 deferral: a 409'd turn must not burn a daily rate-limit slot."""
    req = ChatRequest(session_id=seeded_ended_session.id, message="hi")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(_prepare_turn(req, seeded_ended_session.user_id, db_session))
    assert exc.value.status_code == 409
    assert _today_counter_count(db_session) == 0


def test_foreign_session_404_consumes_no_rate_slot(db_session, seeded_session):
    req = ChatRequest(session_id=seeded_session.id, message="hi")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(_prepare_turn(req, "someone-else", db_session))
    assert exc.value.status_code == 404
    assert _today_counter_count(db_session) == 0


def test_first_turn_creates_user_before_rate_limit_insert(db_session, seeded_session, monkeypatch):
    """F-36: the users row must exist when check_and_increment INSERTs the
    FK-bearing usage_counters row (sqlite doesn't enforce the FK; assert
    ordering explicitly)."""
    new_uid = "brand-new-user"
    # Re-home the seeded session onto the new user so the session guard passes.
    seeded_session.user_id = new_uid
    db_session.commit()
    db_session.execute(delete(User).where(User.id == new_uid))
    db_session.commit()

    real = rate_limit.check_and_increment

    def spy(db, uid):
        assert db.execute(select(User.id).where(User.id == uid)).scalar_one_or_none() is not None, (
            "usage-counter insert would FK-violate: users row missing"
        )
        return real(db, uid)

    monkeypatch.setattr(rate_limit, "check_and_increment", spy)
    asyncio.run(_prepare_turn(ChatRequest(session_id=seeded_session.id, message="hi"), new_uid, db_session))
    assert db_session.get(User, new_uid) is not None
```

Notes for the implementer: adapt fixture names to what the file actually provides (it has fixtures seeding a session; add a small `seeded_ended_session` fixture that sets `ended_at` if none exists). `delete` comes from `sqlalchemy`. The seeded session's user row exists via the fixture — deleting it after re-homing produces the "valid JWT, no users row" state. If `SessionModel.user_id` has an FK to users, instead create a fresh session row for `new_uid` inside the test before deleting the user — check `db/models.py` first; if the FK blocks the delete, create the session AFTER deleting nothing: insert session with `user_id=new_uid` only works without the users row if sessions.user_id has no FK — verify and choose the variant that runs.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_chat_stream_route.py -v -k "rate_slot or before_rate_limit"`
Expected: FAIL — 409/404 tests see counter count 1; ordering spy asserts before `ensure_user` ran.

- [ ] **Step 3: Implement the reorder**

In `_prepare_turn` (`backend/routes/chat.py`), reorder blocks to: (1) combined spend+exists read and cap check — unchanged; (2) the session + ingestion-counts statement with its 404/409 guards — moved up; (3) `ensure_user` — moved up; (4) rate limit. Resulting code between the cap check and the history load:

```python
    # 2) Session + ingestion counts in one statement. Runs BEFORE the rate
    # limiter so a rejected turn (foreign 404 / ended 409) does not consume
    # a daily slot (Batch-1 deferral), and before ensure_user so bogus
    # session ids don't create user rows.
    doc_base = select(func.count()).where(Document.session_id == req.session_id)
    row = db.execute(
        select(
            SessionModel,
            doc_base.scalar_subquery().label("doc_total"),
            doc_base.where(Document.status == "pending").scalar_subquery().label("doc_pending"),
            doc_base.where(Document.status == "ready").scalar_subquery().label("doc_ready"),
        ).where(SessionModel.id == req.session_id)
    ).first()
    if row is None or row[0].user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    session = row[0]
    if session.ended_at is not None:
        raise HTTPException(status_code=409, detail={"code": "session_ended"})
    ingestion_status = documents_service.status_from_counts(
        row.doc_total, row.doc_pending, row.doc_ready
    )

    # 3) First-turn-ever: create the user row BEFORE the usage-counter
    # insert whose FK references it (F-36). check_and_increment's internal
    # commit persists both together.
    if not user_exists:
        ensure_user(db, user_id)

    # 4-5) Rate limit: 2 statements on the allowed path (Task 3).
    allowed, used = rate_limit.check_and_increment(db, user_id)
    if not allowed:
        raise HTTPException(  # unchanged detail payload
            status_code=429,
            detail={
                "code": DAILY_CAP_REACHED,
                "cap": settings.daily_cap,
                "used": used,
                "resets_at": rate_limit.midnight_utc_iso(),
            },
        )
```

Update the docstring's ordering description and the numbered comments accordingly. Do NOT change any statement — this is a pure reorder plus comment updates.

- [ ] **Step 4: Run the chat suites**

Run: `pytest tests/test_chat_stream_route.py tests/test_chat_prepare_perf.py tests/test_chat.py -v`
Expected: PASS — perf budgets count statements, not order; if a budget test fails, the reorder accidentally added/removed a statement — fix the reorder, do not bump the budget.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/chat.py backend/tests/test_chat_stream_route.py
git commit -m "fix: guard session before consuming rate slot; ensure_user before FK insert (F-36)"
```

---

### Task 4: Zero-message summary short-circuit — F-32

**Files:**
- Modify: `backend/services/summary_service.py:59-62`
- Test: `backend/tests/test_summary_service.py`

**Interfaces:**
- Consumes: existing `_mechanical_fallback` (returns `"[auto] no exchanges recorded"` for empty input).
- Produces: `generate_and_persist` never calls the LLM when the session has zero messages.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_summary_service.py` (reuse its session/db fixtures and async test style — check whether it uses `pytest.mark.asyncio` or `asyncio.run`; match it):

```python
async def test_zero_message_end_skips_llm(db_session, fresh_session, monkeypatch):
    """F-32: ending a session with no messages must not pay for an LLM call
    nor persist hallucinated prose."""
    monkeypatch.setattr(settings, "llm_stub", False)  # llm_stub_enabled is a property

    async def _boom(*args, **kwargs):
        raise AssertionError("LLM must not be called for an empty transcript")

    monkeypatch.setattr(litellm, "acompletion", _boom)
    summary = await summary_service.generate_and_persist(db_session, fresh_session)
    assert summary == "[auto] no exchanges recorded"
```

`fresh_session` = a seeded session row with zero ChatMessages (add a tiny fixture if the file lacks one).

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_summary_service.py -v -k zero_message`
Expected: FAIL with the AssertionError from `_boom` (the LLM branch is entered).

- [ ] **Step 3: Implement**

In `generate_and_persist`, change the branch head:

```python
    summary: str
    if settings.llm_stub_enabled or not messages:
        # F-32: an empty transcript has nothing to summarize -- never pay for
        # an LLM call, never persist hallucinated prose about it.
        summary = _mechanical_fallback(messages)
    elif not allow_llm or not cost_meter.check_cap(db, session.user_id).allowed:
```

(Only the first `if` line and the comment change.)

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_summary_service.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/summary_service.py backend/tests/test_summary_service.py
git commit -m "fix: skip summary LLM call for zero-message sessions (F-32)"
```

---

### Task 5: Commit-flag plumbing for check-batch helpers — F-33 (part 1)

**Files:**
- Modify: `backend/services/check_question_service.py:94-108` (`write_check_batch`), `:250-271` (`abandon_open_batch`)
- Test: `backend/tests/test_check_question_service.py`

**Interfaces:**
- Consumes: `pending_check_store.clear_pending_check(db, session_id, commit=True)` (already has the flag).
- Produces: `write_check_batch(db, pc, commit=True)` and `abandon_open_batch(db, session_id, commit=True)` — default True preserves every existing caller's behavior; `commit=False` leaves all writes pending for the caller's single commit (consumed by Task 6).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_check_question_service.py` (reuse its open-batch seeding helpers):

```python
def test_abandon_open_batch_commit_false_leaves_writes_pending(db_session, session_with_open_batch):
    """F-33: with commit=False nothing is committed -- a rollback restores the
    open batch, proving the writes joined the caller's transaction."""
    sid = session_with_open_batch.id
    assert check_question_service.get_pending_check(db_session, sid) is not None

    cleared = check_question_service.abandon_open_batch(db_session, sid, commit=False)
    assert cleared is True

    db_session.rollback()
    assert check_question_service.get_pending_check(db_session, sid) is not None
```

`session_with_open_batch` = whatever fixture/helper the file already uses to register a batch; if it's a helper function, call it inline.

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_check_question_service.py -v -k commit_false`
Expected: FAIL — `abandon_open_batch` has no `commit` parameter (TypeError).

- [ ] **Step 3: Implement**

In `check_question_service.py`:

```python
def write_check_batch(db: Session, pc: dict | None, commit: bool = True) -> None:
    """Persist public_view(pc) JSON onto the linked ChatMessage.

    No-op when pc is falsy, carries no message_id, or the message is gone.
    commit=False leaves the write pending for the caller's transaction (F-33)."""
    if not pc:
        return
    message_id = pc.get("message_id")
    if message_id is None:
        return
    msg = db.get(ChatMessage, message_id)
    if msg is None:
        log.debug("write_check_batch: message %s not found", message_id)
        return
    msg.check_batch_json = json.dumps(public_view(pc))
    if commit:
        db.commit()
```

And in `abandon_open_batch`, change the signature to `def abandon_open_batch(db: Session, session_id: str, commit: bool = True) -> bool:` and the last three lines to:

```python
    write_check_batch(db, pc, commit=commit)
    clear_pending_check(db, session_id, commit=commit)
    return True
```

Append to the docstring: `commit=False defers both writes to the caller's single commit (F-33).`

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_check_question_service.py tests/test_end_abandons_open_batch.py tests/test_check_batch_persistence.py -v`
Expected: PASS (defaults unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/services/check_question_service.py backend/tests/test_check_question_service.py
git commit -m "refactor: commit flag on check-batch writes for single-commit end (F-33)"
```

---

### Task 6: Claim-first end + single-commit summary + resume abandon — F-30, F-31, F-33 (part 2)

**Files:**
- Modify: `backend/routes/sessions.py` (add `_claim_end`; rework `end_session:289-324` and the resume branch of `create_session:120-130`)
- Modify: `backend/services/summary_service.py:36-115` (`generate_and_persist`)
- Test: `backend/tests/test_sessions_route.py`, `backend/tests/test_summary_service.py`, `backend/tests/test_end_abandons_open_batch.py`

**Interfaces:**
- Consumes: `abandon_open_batch(db, sid, commit=False)` (Task 5), `profile_service.save_profile(db, sid, profile, commit=False)` (existing flag), `rate_limit.check_and_increment` (commits internally — called after the claim, before the LLM).
- Produces:
  - `_claim_end(db: Session, session_id: str) -> bool` (module-private in `routes/sessions.py`): conditional `UPDATE sessions SET ended_at=now() WHERE id=:id AND ended_at IS NULL`, committed immediately; True iff this caller won the claim.
  - `generate_and_persist(db, session, *, allow_llm=True) -> str`: NO LONGER sets `ended_at` (the claim owns it). New contract: caller must have claimed first. Computes the summary (LLM before any profile/batch write), then in ONE commit abandons any open check batch (F-31) and writes `last_session_summary`.

Commit topology after this task (was 4+ commits with a partial-write window around the await): commit A = the claim (atomic, pre-LLM, makes every concurrent end/turn/resume see the session as ended); cost-ledger writes inside the LLM branch (`record_cost`/`log_call`) keep their own commit semantics — spend must persist even if the summary write fails; commit B = abandon + summary, after the await. Crash between A and B leaves an ended session without a summary — honest and idempotent, versus today's active-session-with-summary states.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_sessions_route.py` (it has authed-client fixtures for these routes already):

```python
def test_double_end_pays_one_summary(client, db_session, seeded_session, monkeypatch):
    """F-30: the second end takes the idempotent path -- generate_and_persist
    runs exactly once."""
    calls = {"n": 0}
    real = summary_service.generate_and_persist

    async def counting(db, session, *, allow_llm=True):
        calls["n"] += 1
        return await real(db, session, allow_llm=allow_llm)

    monkeypatch.setattr(summary_service, "generate_and_persist", counting)
    # Route module imported the module, not the function -- patch the module attr
    # (verify: routes/sessions.py calls summary_service.generate_and_persist).

    r1 = client.post(f"/api/sessions/{seeded_session.id}/end")
    r2 = client.post(f"/api/sessions/{seeded_session.id}/end")
    assert r1.status_code == 200 and r2.status_code == 200
    assert calls["n"] == 1
    assert r2.json()["summary"] is not None


def test_claim_end_is_single_winner(db_session, seeded_session):
    from routes.sessions import _claim_end

    assert _claim_end(db_session, seeded_session.id) is True
    assert _claim_end(db_session, seeded_session.id) is False
    db_session.refresh(seeded_session)
    assert seeded_session.ended_at is not None


def test_resume_create_abandons_prior_open_batch(client, db_session, session_with_open_batch):
    """F-31: continue-topic must force-skip the prior's open quiz so reopening
    the prior doesn't render a zombie batch or deadlock new quizzes."""
    prior = session_with_open_batch
    resp = client.post(
        "/api/sessions",
        json={"topic": prior.topic, "seed_mode": "resume", "prior_session_id": prior.id},
    )
    assert resp.status_code == 201
    db_session.expire_all()
    assert check_question_service.get_pending_check(db_session, prior.id) is None
    db_session.refresh(prior)
    assert prior.ended_at is not None
```

Append to `backend/tests/test_summary_service.py`:

```python
async def test_generate_and_persist_no_longer_sets_ended_at(db_session, fresh_session):
    """F-30: ended_at is the claim's job (routes), not the summary's."""
    await summary_service.generate_and_persist(db_session, fresh_session)
    db_session.refresh(fresh_session)
    assert fresh_session.ended_at is None


async def test_summary_write_window_is_atomic(db_session, session_with_open_batch, monkeypatch):
    """F-33: if the profile write fails, the batch-abandon must roll back with
    it -- no half-committed end state."""
    def _boom(*args, **kwargs):
        raise RuntimeError("simulated write failure")

    monkeypatch.setattr(profile_service, "save_profile", _boom)
    with pytest.raises(RuntimeError):
        await summary_service.generate_and_persist(db_session, session_with_open_batch)
    db_session.rollback()
    assert check_question_service.get_pending_check(db_session, session_with_open_batch.id) is not None
```

(Patch target note: `summary_service.py` must call `profile_service.save_profile` — it already imports `profile_service` as a module, so `monkeypatch.setattr(profile_service, "save_profile", _boom)` intercepts it.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_sessions_route.py tests/test_summary_service.py -v -k "double_end or claim_end or resume_create_abandons or no_longer_sets or atomic"`
Expected: FAIL — `_claim_end` doesn't exist; `generate_and_persist` still sets `ended_at`; resume leaves the batch open.

- [ ] **Step 3: Implement `generate_and_persist` restructure**

In `backend/services/summary_service.py`:

1. Add `from services import check_question_service` to the imports (grep-verify no import cycle: `check_question_service` imports `contracts` and `db.models` only).
2. Replace the tail of `generate_and_persist` (currently lines 109-115) — everything after the summary is computed — with:

```python
    # F-33: single write window AFTER the LLM await. Abandon any open check
    # batch (F-31 -- resume-create reaches here too) and persist the summary
    # in one commit. ended_at is NOT written here: the caller's _claim_end
    # owns it (F-30) and has already committed it.
    check_question_service.abandon_open_batch(db, session.id, commit=False)
    profile.last_session_summary = summary
    profile_service.save_profile(db, session.id, profile, commit=False)
    db.commit()
    db.refresh(session)
    return summary
```

3. Update the module docstring (lines 1-7): replace "writes the result into TopicProfile.last_session_summary, and sets Session.ended_at" with "force-skips any open check batch and writes the result into TopicProfile.last_session_summary in a single commit; the caller claims Session.ended_at first (see routes/sessions.py `_claim_end`)". Update the `generate_and_persist` docstring likewise.

- [ ] **Step 4: Implement claim-first in `routes/sessions.py`**

1. Imports: ensure `from datetime import datetime, timezone` and add `update` to the existing `sqlalchemy` import line (alias not required; use `update` directly).
2. Add above `end_session`:

```python
def _claim_end(db: Session, session_id: str) -> bool:
    """Atomically claim a session's end (F-30). The conditional UPDATE lets
    exactly one caller win under concurrency (double-click End, End racing a
    continue-topic resume); losers take the idempotent path and never pay a
    second summary LLM call. Committed immediately: the claim must be visible
    to concurrent requests before the multi-second summary await."""
    result = db.execute(
        update(SessionModel)
        .where(SessionModel.id == session_id, SessionModel.ended_at.is_(None))
        .values(ended_at=datetime.now(timezone.utc))
    )
    db.commit()
    return result.rowcount == 1
```

3. Rework `end_session`'s try-body:

```python
        row = db.get(SessionModel, session_id)
        if row is None or row.user_id != user_id:
            raise HTTPException(status_code=404, detail="session not found")

        if not _claim_end(db, session_id):
            # Already ended, or lost the race to a concurrent end: replay the
            # stored summary; no second LLM call (F-30).
            db.refresh(row)
            profile = profile_service.load_profile(db, session_id)
            return SessionEndResponse(
                id=row.id,
                ended_at=_aware_utc(row.ended_at),
                summary=_build_end_summary(db, session_id, profile.last_session_summary or ""),
            )

        # F-03: an end fires a full-transcript LLM call; count it like a chat
        # turn. At the cap the end still succeeds with a mechanical summary.
        allow_llm, _ = rate_limit.check_and_increment(db, user_id)
        summary_text = await summary_service.generate_and_persist(db, row, allow_llm=allow_llm)
        db.refresh(row)
        return SessionEndResponse(
            id=row.id,
            ended_at=_aware_utc(row.ended_at),
            summary=_build_end_summary(db, session_id, summary_text),
        )
```

(The explicit `check_question_service.abandon_open_batch(db, session_id)` call is REMOVED — it now happens inside `generate_and_persist` under the single commit. Keep the `check_question_service` import only if other code in the file uses it — grep before removing.)

4. Rework the resume branch of `create_session`:

```python
    if req.seed_mode == "resume":
        prior = db.get(SessionModel, req.prior_session_id)
        if prior is None or prior.user_id != user_id:
            raise HTTPException(status_code=404, detail="prior session not found")
        if prior.ended_at is None and _claim_end(db, prior.id):
            # F-03: a resume-triggered summary fires a full-transcript LLM
            # call; count it like a chat turn. F-30: claim-first so a
            # concurrent explicit end cannot double-pay. F-31: the open check
            # batch is abandoned inside generate_and_persist.
            allow_llm, _ = rate_limit.check_and_increment(db, user_id)
            await summary_service.generate_and_persist(db, prior, allow_llm=allow_llm)
        db.refresh(prior)
        profile_json = prior.topic_profile_json
```

(`db.refresh(prior)` moves OUTSIDE the if — the claim-lost path must also read the freshest profile before copying.)

- [ ] **Step 5: Sweep and update stale assertions**

Native Grep for `generate_and_persist` across `backend/` — update every test that asserts it sets `ended_at` (it no longer does; those assertions move to route-level tests or get dropped). `tests/test_end_abandons_open_batch.py` must still pass end-to-end through the route (abandon now fires inside the summary commit). Expect edits in `test_summary_service.py`, possibly `test_sessions_route.py`.

- [ ] **Step 6: Run the affected suites**

Run: `pytest tests/test_sessions_route.py tests/test_summary_service.py tests/test_end_abandons_open_batch.py tests/test_sessions_perf.py tests/test_rolling_summary.py -v`
Expected: PASS. If `test_sessions_perf.py` statement budgets shift (the claim adds one UPDATE + commit on the end path), adjust ONLY if the test measures the end route; document the +1 in the test comment.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/sessions.py backend/services/summary_service.py backend/tests/
git commit -m "fix: claim-first atomic end, single-commit summary, abandon batch on resume (F-30 F-31 F-33)"
```

---

### Task 7: Per-uid user store + auth wiring — F-08

**Files:**
- Modify: `frontend/src/stores/user.js`, `frontend/src/stores/auth.js`, `frontend/src/main.js:26`
- Test: `frontend/src/__tests__/userStore.test.js`, `frontend/src/__tests__/authStore.test.js`

**Interfaces:**
- Consumes: `useAuthStore` session events (`init`, `onAuthStateChange`, `signOut`).
- Produces: `useUserStore().setActiveUser(uid: string | null)` — switches the localStorage namespace to `crux:user:v1:<uid>`, clears in-memory state, loads the new uid's snapshot; `null` clears in-memory state only (sign-out must NOT delete the signed-out user's persisted prefs — they reload on next sign-in). `activeUserId` ref exposed. `loadFromLocalStorage`/`persist`/`resetOnboarding` operate on the namespaced key and no-op when no uid is active.

Migration note (accepted in the review): existing single-user installs lose the old un-namespaced `crux:user:v1` blob once and re-onboard. No migration shim.

- [ ] **Step 1: Write the failing tests**

Rework `frontend/src/__tests__/userStore.test.js`: every existing test that touches localStorage first calls `u.setActiveUser('u1')` and uses key `crux:user:v1:u1`. Add:

```js
it('namespaces storage per uid — two accounts never share prefs (F-08)', () => {
  const u = useUserStore()
  u.setActiveUser('user-a')
  u.completeOnboarding({ name: 'Alice', feedback: 'direct' })

  u.setActiveUser('user-b')
  expect(u.name).toBeNull()
  expect(u.onboardingComplete).toBe(false)

  u.setActiveUser('user-a')
  expect(u.name).toBe('Alice')
  expect(u.onboardingComplete).toBe(true)
})

it('setActiveUser(null) clears memory but preserves the persisted blob', () => {
  const u = useUserStore()
  u.setActiveUser('user-a')
  u.completeOnboarding({ name: 'Alice', feedback: 'direct' })

  u.setActiveUser(null)
  expect(u.name).toBeNull()
  expect(localStorage.getItem('crux:user:v1:user-a')).not.toBeNull()
})

it('persist is a no-op with no active uid', () => {
  const u = useUserStore()
  u.completeOnboarding({ name: 'Ghost', feedback: 'direct' })
  expect(localStorage.getItem('crux:user:v1')).toBeNull()
})
```

Add to `frontend/src/__tests__/authStore.test.js` (its supabase stub exposes the `onAuthStateChange` callback — see `setup.js`):

```js
it('auth state changes re-key the user store (F-08)', async () => {
  const auth = useAuthStore()
  const user = useUserStore()
  await auth.init()
  const fire = globalThis.__supabaseAuthStub.onAuthStateChange.mock.calls[0][0]

  fire('SIGNED_IN', { user: { id: 'user-a' }, access_token: 't' })
  expect(user.activeUserId).toBe('user-a')

  fire('SIGNED_OUT', null)
  expect(user.activeUserId).toBeNull()
  expect(user.onboardingComplete).toBe(false)
})
```

(Adapt the stub-callback retrieval to how `setup.js` actually records `onAuthStateChange` — inspect it first; if it returns `{ data: { subscription } }`, the mock's `.mock.calls[0][0]` is the registered handler.)

- [ ] **Step 2: Run tests to verify they fail**

Run from `frontend/`: `npm run test:unit -- --run src/__tests__/userStore.test.js src/__tests__/authStore.test.js`
Expected: FAIL — `setActiveUser` undefined.

- [ ] **Step 3: Implement `user.js`**

```js
import { ref } from 'vue'
import { defineStore } from 'pinia'

// Phase 7+: identity comes from `useAuthStore` (Supabase JWT). This store
// only persists local UX preferences -- name + feedback style + onboarding
// completion -- in a localStorage entry namespaced by Supabase userId so two
// accounts on one browser never share prefs (F-08).

const STORAGE_PREFIX = 'crux:user:v1'

export const useUserStore = defineStore('user', () => {
  const name = ref(null)
  const interactionPreferences = ref(null)
  const onboardingComplete = ref(false)
  // Supabase uid the in-memory state belongs to; null = signed out.
  const activeUserId = ref(null)

  function _storageKey() {
    return `${STORAGE_PREFIX}:${activeUserId.value}`
  }

  function _clearInMemory() {
    name.value = null
    interactionPreferences.value = null
    onboardingComplete.value = false
  }

  function setActiveUser(uid) {
    const next = uid ?? null
    if (next === activeUserId.value) return
    activeUserId.value = next
    _clearInMemory()
    if (next) loadFromLocalStorage()
  }

  function loadFromLocalStorage() {
    if (typeof localStorage === 'undefined' || !activeUserId.value) return
    const raw = localStorage.getItem(_storageKey())
    if (!raw) return
    try {
      const data = JSON.parse(raw)
      name.value = data.name ?? null
      interactionPreferences.value = data.interactionPreferences ?? null
      onboardingComplete.value = Boolean(data.onboardingComplete)
    } catch {
      localStorage.removeItem(_storageKey())
    }
  }

  function persist() {
    if (typeof localStorage === 'undefined' || !activeUserId.value) return
    localStorage.setItem(
      _storageKey(),
      JSON.stringify({
        name: name.value,
        interactionPreferences: interactionPreferences.value,
        onboardingComplete: onboardingComplete.value,
      }),
    )
  }

  function completeOnboarding({ name: displayName, feedback }) {
    name.value = displayName?.trim() || 'Learner'
    interactionPreferences.value = { feedback }
    onboardingComplete.value = true
    persist()
  }

  function resetOnboarding() {
    _clearInMemory()
    if (typeof localStorage !== 'undefined' && activeUserId.value) {
      localStorage.removeItem(_storageKey())
    }
  }

  function updateProfile({ name: displayName, feedback }) {
    if (displayName != null) name.value = displayName.trim() || 'Learner'
    if (feedback != null) {
      interactionPreferences.value = {
        ...interactionPreferences.value,
        feedback,
      }
    }
    persist()
  }

  return {
    name,
    interactionPreferences,
    onboardingComplete,
    activeUserId,
    setActiveUser,
    loadFromLocalStorage,
    completeOnboarding,
    resetOnboarding,
    updateProfile,
  }
})
```

- [ ] **Step 4: Wire `auth.js` and `main.js`**

In `auth.js`: add `import { useUserStore } from './user.js'` (static import is cycle-safe: user.js imports nothing from auth.js). In `init()`:

```js
  async function init() {
    if (ready.value) return
    const sb = getSupabase()
    const { data } = await sb.auth.getSession()
    session.value = data?.session ?? null
    useUserStore().setActiveUser(session.value?.user?.id ?? null)
    const sub = sb.auth.onAuthStateChange((_event, sess) => {
      session.value = sess ?? null
      useUserStore().setActiveUser(sess?.user?.id ?? null)
    })
    _unsubscribe.value = sub?.data?.subscription?.unsubscribe ?? null
    ready.value = true
  }
```

In `signOut()`, after `session.value = null`, add `useUserStore().setActiveUser(null)` (belt-and-braces: the SIGNED_OUT event also fires it; both are idempotent).

In `main.js`: DELETE the `useUserStore().loadFromLocalStorage()` line (line 26) — `auth.init()` now drives loading with the correct uid. Verify `authStore.init()` is awaited in main.js before mount (it is, per the auth.js header comment); keep the `useUserStore` import only if still used.

- [ ] **Step 5: Sweep other callers**

Native Grep `loadFromLocalStorage|resetOnboarding` across `frontend/src` (excluding tests): update any onboarding/settings flow that relied on the boot-time load. Router guard reads `onboardingComplete` — unchanged API, no edit. `SettingsView.vue signOut()` needs no change (the auth event clears the store).

- [ ] **Step 6: Run the full frontend suite**

Run: `npm run test:unit -- --run`
Expected: PASS. Onboarding/settings view tests that seeded the old constant key will fail — update them to `setActiveUser(<uid>)` + namespaced key.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/stores/user.js frontend/src/stores/auth.js frontend/src/main.js frontend/src/__tests__/
git commit -m "fix: namespace user prefs per Supabase uid, re-key on auth change (F-08)"
```

---

### Task 8: apiClient 401 refresh-retry — F-09

**Files:**
- Modify: `frontend/src/services/apiClient.js`
- Test: `frontend/src/__tests__/apiClient.test.js`

**Interfaces:**
- Consumes: `getSupabase().auth.getSession()` (supabase-js refreshes an expired access token under this call), `useAuthStore().signOut()`, router route name `'login'`.
- Produces: exported `_refreshAccessToken(): Promise<string|null>` and `_onAuthExpired(): Promise<void>` (also consumed by Task 9's chatStreamService); `request()` retries exactly once on 401 with a freshly-fetched token, then signs out + redirects. The first 401 of a retried pair must NOT toast (`reportApiError` fires only on the final failure).

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/__tests__/apiClient.test.js` (inspect its existing fetch-mocking pattern and pinia setup first; mock the router module with `vi.mock`):

```js
vi.mock('../router/index.js', () => ({ default: { push: vi.fn() } }))

it('retries once with a refreshed token on 401 (F-09)', async () => {
  globalThis.__supabaseAuthStub.getSession.mockResolvedValueOnce({
    data: { session: { access_token: 'fresh-token', user: { id: 'u1' } } },
  })
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response('{"detail":"invalid_token"}', { status: 401 }))
    .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)

  const result = await apiGet('/whatever')
  expect(result).toEqual({ ok: true })
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock.mock.calls[1][1].headers.authorization).toBe('Bearer fresh-token')
})

it('signs out and redirects to login after a second 401', async () => {
  const router = (await import('../router/index.js')).default
  globalThis.__supabaseAuthStub.getSession.mockResolvedValue({
    data: { session: { access_token: 'still-dead', user: { id: 'u1' } } },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('{"detail":"invalid_token"}', { status: 401 })),
  )

  await expect(apiGet('/whatever')).rejects.toMatchObject({ status: 401 })
  expect(globalThis.__supabaseAuthStub.signOut).toHaveBeenCalled()
  expect(router.push).toHaveBeenCalledWith({ name: 'login' })
  expect(fetch).toHaveBeenCalledTimes(2) // hard cap: one retry
})
```

(Adjust stub names to `setup.js` reality — it exposes `globalThis.__supabaseAuthStub` with `getSession`/`signOut` mocks per the existing auth tests. If `Response` is unavailable in the test env, use the file's existing fake-response helper.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run src/__tests__/apiClient.test.js`
Expected: FAIL — no retry happens; one fetch call, 401 thrown immediately.

- [ ] **Step 3: Implement**

In `apiClient.js`:

1. Add after `_getAccessToken`:

```js
// F-09: one refresh-then-retry on 401. getSession() refreshes an expired
// access token via the SDK; a second 401 means the session is truly dead --
// sign out and land on login instead of stranding a signed-in-looking UI.
export async function _refreshAccessToken() {
  try {
    const { getSupabase } = await import('./supabase.js')
    const { data } = await getSupabase().auth.getSession()
    return data?.session?.access_token ?? null
  } catch {
    return null
  }
}

export async function _onAuthExpired() {
  try {
    const store = useAuthStore()
    try {
      await store.signOut()
    } catch {
      // Supabase signOut failure must not block the local redirect.
    }
  } catch {
    // No active pinia (unit tests) -- nothing to sign out.
  }
  try {
    const { default: router } = await import('../router/index.js')
    router.push({ name: 'login' })
  } catch {
    // Router unavailable outside the app shell.
  }
}
```

(Dynamic imports keep the module cycle-free: router -> views -> services -> apiClient.)

2. Change `request` to carry a retry flag and branch on 401 (full replacement of the function):

```js
async function request(method, path, { body, params, silent = false, headers } = {}, _retried = false) {
  let url = `${BASE_URL}${path}`
  if (params) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null),
    ).toString()
    if (qs) url += `?${qs}`
  }

  const init = { method, headers: { ...(headers || {}) } }
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    init.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }

  const token = _retried ? await _refreshAccessToken() : _getAccessToken()
  if (token) init.headers['authorization'] = `Bearer ${token}`

  let resp
  try {
    resp = await fetch(url, init)
  } catch (e) {
    const detail = e?.name === 'TimeoutError' ? 'request timed out' : e.message
    const err = new ApiError(0, { detail }, path)
    if (!silent) reportApiError(err)
    throw err
  }

  if (resp.status === 401 && !_retried) {
    // F-09: silent first 401 -- refresh and retry once before surfacing.
    return request(method, path, { body, params, silent, headers }, true)
  }

  const text = await resp.text()
  const parsed = text ? safeJson(text) : null

  if (!resp.ok) {
    if (resp.status === 401 && _retried) await _onAuthExpired()
    const err = new ApiError(resp.status, parsed ?? text, path)
    if (!silent) reportApiError(err)
    throw err
  }

  const warn = resp.headers?.get?.('x-cost-warning')
  if (warn) reportCostWarning({ header: warn, path })

  return parsed
}
```

WARNING: `npm run lint` (oxlint) will auto-edit `{ ...(headers || {}) }` to `{ ...headers }` in this file — revert that hunk before committing (known gotcha; the guard is intentional for undefined headers on older toolchains).

- [ ] **Step 4: Run tests**

Run: `npm run test:unit -- --run src/__tests__/apiClient.test.js src/__tests__/apiWrappers.test.js`
Expected: PASS, including all pre-existing apiClient tests (timeout, error-bus, cost-warning).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/apiClient.js frontend/src/__tests__/apiClient.test.js
git commit -m "fix: 401 refresh-retry then sign-out redirect in apiClient (F-09)"
```

---

### Task 9: chatStreamService 401 mirror — F-09

**Files:**
- Modify: `frontend/src/services/chatStreamService.js:21-76`
- Test: `frontend/src/__tests__/chatStreamService.test.js`

**Interfaces:**
- Consumes: `_refreshAccessToken` and `_onAuthExpired` from `./apiClient.js` (Task 8).
- Produces: `_fetchSse` retries exactly once on a 401 response (before any SSE parsing starts — safe, no partial stream to replay), then signs out + throws.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/__tests__/chatStreamService.test.js` (reuse its existing SSE fetch-mock helpers; it already builds Response-like objects with readable bodies):

```js
it('retries the SSE POST once with a refreshed token on 401 (F-09)', async () => {
  globalThis.__supabaseAuthStub.getSession.mockResolvedValueOnce({
    data: { session: { access_token: 'fresh-token', user: { id: 'u1' } } },
  })
  const events = []
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(make401Response())
    .mockResolvedValueOnce(makeSseResponse(['event: done\ndata: {}\n\n']))
  vi.stubGlobal('fetch', fetchMock)

  await streamChat({ sessionId: 's1', message: 'hi', onEvent: (e) => events.push(e) })
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock.mock.calls[1][1].headers.authorization).toBe('Bearer fresh-token')
})

it('signs out after a second 401 on the SSE POST', async () => {
  globalThis.__supabaseAuthStub.getSession.mockResolvedValue({
    data: { session: { access_token: 'still-dead', user: { id: 'u1' } } },
  })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(make401Response()))

  await expect(streamChat({ sessionId: 's1', message: 'hi', onEvent: () => {} }))
    .rejects.toMatchObject({ status: 401 })
  expect(globalThis.__supabaseAuthStub.signOut).toHaveBeenCalled()
  expect(fetch).toHaveBeenCalledTimes(2)
})
```

(`make401Response`/`makeSseResponse` = the file's existing response builders — adapt names. Timeout-test gotcha from Batch 2 lives in this file: attach rejection handlers before advancing fake timers; these two tests use real timers, no interaction.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run src/__tests__/chatStreamService.test.js`
Expected: FAIL — one fetch call, ApiError 401 thrown without retry.

- [ ] **Step 3: Implement**

In `chatStreamService.js`:

1. Change the apiClient import to `import { ApiError, _onAuthExpired, _refreshAccessToken } from './apiClient.js'`.
2. Change `_fetchSse`'s signature to `async function _fetchSse(url, payload, { onEvent, signal, path }, _retried = false)`.
3. Change the token line to:

```js
  const token = _retried ? await _refreshAccessToken() : _authToken()
```

4. Replace the `if (!resp.ok)` block (lines 71-76) with:

```js
  if (!resp.ok) {
    if (resp.status === 401 && !_retried) {
      // F-09: refresh-then-retry once. Safe pre-stream: no SSE bytes have
      // been consumed yet, so the whole POST can simply be re-issued.
      return _fetchSse(url, payload, { onEvent, signal, path }, true)
    }
    if (resp.status === 401) await _onAuthExpired()
    const text = await resp.text().catch(() => '')
    let body
    try { body = text ? JSON.parse(text) : null } catch { body = text }
    throw new ApiError(resp.status, body, path)
  }
```

(The header timer was already cleared in the `finally` above; the retry builds a fresh controller/timers by re-entering `_fetchSse`.)

- [ ] **Step 4: Run tests**

Run: `npm run test:unit -- --run src/__tests__/chatStreamService.test.js`
Expected: PASS, including the Batch-2 timeout tests (unchanged behavior for non-401 paths).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/chatStreamService.js frontend/src/__tests__/chatStreamService.test.js
git commit -m "fix: mirror 401 refresh-retry on the SSE chat stream (F-09)"
```

---

### Task 10: Docs annotation + full verification

**Files:**
- Modify: `docs/adversarial-review-2026-07-12.md` (status annotations only)

**Interfaces:** none — documentation + whole-branch verification gate.

- [ ] **Step 1: Annotate fixed findings**

In the findings table and the corresponding detail sections of `docs/adversarial-review-2026-07-12.md`, append to each of F-07, F-08, F-09, F-30, F-31, F-32, F-33, F-36, F-37, F-41 the marker used for F-43: `— FIXED (Batch 3, fix/adversarial-batch-3, 2026-07-14)`. Also annotate the Batch-1 deferral note satisfied here (rate-limit slot before 409) if it appears in the doc. Do not alter finding text otherwise.

- [ ] **Step 2: Full verification**

```bash
cd backend && pytest
cd frontend && npm run test:unit -- --run && npm run lint
python backend/scripts/gen_contracts.py && git diff --exit-code backend/contracts docs/api/openapi.yaml
git status --short   # verify no oxlint drive-by edit to apiClient.js beyond Task 8's intentional change
```

Expected: BE >= 665 passed (plus this batch's new tests), FE >= 606 passed, lint clean, zero contract drift, clean status. Any failure: stop and fix before committing (ground rule: stop and report on failed verification).

- [ ] **Step 3: Commit**

```bash
git add docs/adversarial-review-2026-07-12.md
git commit -m "docs: mark Batch 3 findings fixed in adversarial review doc"
```

---

## Post-plan notes for the orchestrator

- Execution flow per prior batches: subagent-driven development with two-stage review per task, then a whole-branch Opus final review, then PR to `dev` (minimal PR body — classifier gotcha).
- Owed human gates after merge (carry into memory): paid live smoke — expired-token 401 refresh-retry in a real browser session; live double-end race sanity check on Supabase Postgres; F-36 live proof (first-ever chat from a fresh Supabase user succeeds).
- Explicitly OUT of scope (later batches): F-47 async token read + uploadApi 401 (Batch 6 hygiene), F-46 server-persisted onboarding (P3), F-49 login redirect preservation (P3), F-52 consent stamp (P3), F-34 duplicate-topic server guard, F-06/F-11 profile re-load in summary (Batch 4, gated on Q1/Q2), openapi.yaml backfill of `/chat/stream` + check endpoints (Batch 6).
