# P3 Remediation Implementation Plan (36 Deferred Findings, 5 Batches)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 36 deferred P3 findings from `docs/review/2026-07-18-final-adversarial-review.md` in five sequential batch PRs, per the approved spec `docs/superpowers/specs/2026-07-19-p3-remediation-design.md`.

**Architecture:** Five thematic batches (A backend concurrency/integrity, B backend cost/perf/pool, C FE resilience, D FE a11y/visual, E contract/integration/infra). Each batch is its own branch off `dev` and its own PR; a batch starts only after the previous batch's PR merges. Fixes are minimal per the review doc except four decided structural calls: B-10 stream-release refactor, F-07 error scoping, I-03 header implementation, I-06 build-time CSP meta injection.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (backend), Vue 3 + Pinia + Vite (frontend), pytest / vitest, OpenAPI YAML + datamodel-codegen contracts.

## Global Constraints

- No emojis in code or comments.
- Contract changes: edit `docs/api/openapi.yaml` FIRST, then regenerate with `backend/.venv/Scripts/python backend/scripts/gen_contracts.py` from repo root. Never hand-edit `backend/contracts/`. Bare `python` has stale codegen 0.29.0 and produces 12-line fake drift.
- Backend tests run from `backend/`: `python -m pytest` (venv). Frontend from `frontend/`: `npm run test:unit -- --run`. Lint: `npm run lint`.
- Every fix lands with a regression test proven to fail before the fix (stash-verify: `git stash` the impl, run test, confirm FAIL, `git stash pop`).
- Any new Alembic migration must be reviewed by the migration-reviewer agent before the batch PR opens.
- Each task = own commit. Commit messages follow existing convention: `fix(scope): summary (P3 <ID>)`.
- Batch PR gates before merge: full backend suite green, full frontend suite green, lint green, contracts drift check green, CI green on the PR.

## Batch protocol (applies to every batch)

1. Start: `git checkout dev && git pull && git checkout -b fix/p3-batch-<letter>`
2. Execute the batch's tasks in order.
3. End: run the full gates above, push, open PR to `dev` titled `fix: P3 batch <letter> - <theme> (<IDs>)` with the finding IDs listed in the body.
4. Do not start the next batch until the PR merges.

---

## Batch A — Backend concurrency + data integrity (B-03, B-04, B-05, B-06, B-11, B-12, B-13)

Branch: `fix/p3-batch-a`. PR title: `fix: P3 batch A - backend concurrency + data integrity (B-03..B-06, B-11..B-13)`.

### Task A1: Migration 0021 + duplicate-topic unique index + user_id index (B-05, B-11)

**Files:**
- Modify: `backend/db/models.py` (Session model, ~line 38)
- Create: `backend/db/alembic/versions/0021_sessions_indexes.py`
- Test: `backend/tests/test_duplicate_topic.py` (append)

**Interfaces:**
- Produces: DB-level partial unique index `uq_sessions_active_topic` on `(user_id, lower(topic)) WHERE ended_at IS NULL`; plain index `ix_sessions_user_id`. Task A2 maps the resulting IntegrityError to 409.

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_duplicate_topic.py`, reusing its existing fixtures/imports; add `from sqlalchemy.exc import IntegrityError` and `import pytest` if not present)

```python
def test_db_rejects_second_active_session_same_topic_casefold(db_session):
    db_session.add(User(id="u_ix"))
    db_session.flush()
    db_session.add(SessionModel(
        id="s_ix1", user_id="u_ix", topic="Calculus",
        topic_profile_json=TopicProfile().model_dump_json(),
    ))
    db_session.commit()
    db_session.add(SessionModel(
        id="s_ix2", user_id="u_ix", topic="calculus",
        topic_profile_json=TopicProfile().model_dump_json(),
    ))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_db_allows_duplicate_topic_when_first_is_ended(db_session):
    db_session.add(User(id="u_ix2"))
    db_session.flush()
    db_session.add(SessionModel(
        id="s_ix3", user_id="u_ix2", topic="Algebra",
        topic_profile_json=TopicProfile().model_dump_json(),
        ended_at=datetime.now(timezone.utc),
    ))
    db_session.commit()
    db_session.add(SessionModel(
        id="s_ix4", user_id="u_ix2", topic="Algebra",
        topic_profile_json=TopicProfile().model_dump_json(),
    ))
    db_session.commit()  # must not raise
```

- [ ] **Step 2: Run to verify both fail** — `cd backend && python -m pytest tests/test_duplicate_topic.py -v -k "db_"`. Expected: first test FAILS (no IntegrityError raised — index absent).

- [ ] **Step 3: Add indexes to the model.** In `backend/db/models.py`, add `Index` and `text` to the existing `sqlalchemy` import, then give `Session` a `__table_args__` (insert directly under `__tablename__ = "sessions"`):

```python
class Session(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        # B-11: every list/library/aggregate query filters on user_id.
        Index("ix_sessions_user_id", "user_id"),
        # B-05: DB-authoritative form of the F-34 duplicate-active-topic
        # guard; the route pre-check remains for the friendly 409 payload.
        Index(
            "uq_sessions_active_topic",
            "user_id",
            text("lower(topic)"),
            unique=True,
            sqlite_where=text("ended_at IS NULL"),
            postgresql_where=text("ended_at IS NULL"),
        ),
    )
```

- [ ] **Step 4: Run tests again** — same command. Expected: both PASS (SQLite `create_all` builds partial indexes).

- [ ] **Step 5: Write migration** `backend/db/alembic/versions/0021_sessions_indexes.py` (follow 0020's structure):

```python
"""sessions indexes: user_id + active-topic partial unique (B-05, B-11)

Revision ID: 0021_sessions_indexes
Revises: 0020_users_onboarding
Create Date: 2026-07-19

B-11: plain index on sessions.user_id (list/library/aggregate queries scan
the whole table without it). B-05: partial unique index making the F-34
duplicate-active-topic guard DB-authoritative under concurrency.
PRE-DEPLOY CHECK (also in the PR body): the unique index build fails if live
data already violates it - run
  SELECT user_id, lower(topic), count(*) FROM sessions
  WHERE ended_at IS NULL GROUP BY 1, 2 HAVING count(*) > 1;
and resolve any rows before upgrading.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0021_sessions_indexes"
down_revision: Union[str, None] = "0020_users_onboarding"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
    op.create_index(
        "uq_sessions_active_topic",
        "sessions",
        [sa.text("user_id"), sa.text("lower(topic)")],
        unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_sessions_active_topic", table_name="sessions")
    op.drop_index("ix_sessions_user_id", table_name="sessions")
```

- [ ] **Step 6: Full-suite sanity** — `python -m pytest tests/test_migration_chain.py tests/test_duplicate_topic.py tests/test_sessions_route.py -v`. Expected: all PASS.
- [ ] **Step 7: Dispatch the migration-reviewer agent** on the new migration file. Address any findings before committing.
- [ ] **Step 8: Commit** — `git add backend/db/models.py backend/db/alembic/versions/0021_sessions_indexes.py backend/tests/test_duplicate_topic.py && git commit -m "fix(db): sessions user_id index + active-topic partial unique index (P3 B-05, B-11)"`

### Task A2: Route-level duplicate-topic hardening (B-05 mapping, B-06 rename check)

**Files:**
- Modify: `backend/routes/sessions.py` (create ~line 190, reopen ~line 405, update ~line 445)
- Test: `backend/tests/test_duplicate_topic.py` (append)

**Interfaces:**
- Consumes: `uq_sessions_active_topic` from Task A1; existing `_active_session_on_topic(db, user_id, topic, exclude_id=...)`.
- Produces: all three write paths (create / reopen / rename) return the same 409 payload `{"code": "duplicate_topic", "session_id": <existing>}` — never a raw 500 on the race.

- [ ] **Step 1: Failing tests** (append; use the `client` fixture conventions already in this file):

```python
def test_rename_active_session_to_duplicate_topic_409(client, db_session):
    # seed two active sessions, topics A and B, same user (reuse this file's
    # seeding helpers); then:
    resp = client.patch(f"/api/sessions/{session_b_id}", json={"topic": "A"})
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "duplicate_topic"
    assert resp.json()["detail"]["session_id"] == session_a_id


def test_rename_ended_session_to_duplicate_topic_ok(client, db_session):
    # session A active topic "A"; session C ENDED; rename C to "A" -> 200
    resp = client.patch(f"/api/sessions/{session_c_id}", json={"topic": "A"})
    assert resp.status_code == 200
```

(Adapt the seeding to this file's existing fixtures — it already creates active/ended session pairs for the create-path tests.)

- [ ] **Step 2: Run to verify fail** — `python -m pytest tests/test_duplicate_topic.py -v -k rename`. Expected: first FAILS with 200 != 409.

- [ ] **Step 3: Implement.** In `backend/routes/sessions.py` add `from sqlalchemy.exc import IntegrityError` to imports.

`update_session` — replace the topic-write block:

```python
    if req.topic is not None:
        if row.ended_at is None:
            # B-06: rename must honor the same duplicate-active-topic guard
            # as create/reopen; without it a rename reproduces the duplicate
            # state through the front door.
            existing = _active_session_on_topic(
                db, user_id, req.topic, exclude_id=row.id
            )
            if existing is not None:
                raise HTTPException(
                    status_code=409,
                    detail={"code": "duplicate_topic", "session_id": existing},
                )
        row.topic = req.topic
```

`create_session` — wrap the final commit:

```python
    db.add(new_session)
    try:
        db.commit()
    except IntegrityError:
        # B-05: concurrent create raced past the pre-check; the partial
        # unique index is authoritative. Map to the same 409 payload.
        db.rollback()
        existing = _active_session_on_topic(db, user_id, req.topic)
        raise HTTPException(
            status_code=409,
            detail={"code": "duplicate_topic", "session_id": existing},
        )
    db.refresh(new_session)
```

`reopen_session` — wrap its commit identically (with `exclude_id=row.id`):

```python
        row.ended_at = None
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            existing = _active_session_on_topic(
                db, user_id, row.topic, exclude_id=row.id
            )
            raise HTTPException(
                status_code=409,
                detail={"code": "duplicate_topic", "session_id": existing},
            )
        db.refresh(row)
```

`update_session` — wrap its commit the same way (rename race), using `exclude_id=row.id`.

- [ ] **Step 4: Run tests** — `python -m pytest tests/test_duplicate_topic.py tests/test_sessions_route.py -v`. Expected: all PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(sessions): rename duplicate-topic guard + IntegrityError-to-409 mapping (P3 B-05, B-06)"`

### Task A3: Agent gap-add goes through add_exclusive (B-03)

**Files:**
- Modify: `backend/services/profile_service.py:410-415` (the `args.add_confirmed_gap` block in `apply_patch`)
- Test: `backend/tests/test_profile_service.py` (append; reuse its `ctx`, `session_row`, `_patch` fixtures)

- [ ] **Step 1: Failing test**

```python
def test_agent_gap_add_removes_concept_from_mastered(db_session, session_row, ctx):
    profile_service.apply_patch(
        db_session, ctx, _patch(add_mastered_concept="chain rule", evidence_type="tested")
    )
    profile_service.apply_patch(
        db_session, ctx, _patch(add_confirmed_gap="chain rule", evidence_type="inferred")
    )
    profile = profile_service.load_profile(db_session, session_row.id)
    gaps = [e.name for e in (profile.confirmed_gaps or [])]
    mastered = [e.name for e in (profile.mastered_concepts or [])]
    assert "chain rule" in gaps
    assert "chain rule" not in mastered
```

- [ ] **Step 2: Verify fail** — `python -m pytest tests/test_profile_service.py -v -k removes_concept_from_mastered`. Expected: FAIL ("chain rule" present in both lists).

- [ ] **Step 3: Implement.** Replace the `upsert_entry` gap-add in `apply_patch`:

```python
    if args.add_confirmed_gap:
        gap_evidence = evidence if evidence in ("declared", "tested") else None
        # B-03: route through the exclusivity choke point (F-13) like the
        # user PATCH path; upsert_entry left the concept in both lists.
        add_exclusive(
            profile, "confirmed_gaps", args.add_confirmed_gap,
            evidence_type=gap_evidence, stamp=datetime.now(timezone.utc),
        )
```

- [ ] **Step 4: Run** — `python -m pytest tests/test_profile_service.py tests/test_learning_event_service.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(profile): agent gap-add uses add_exclusive choke point (P3 B-03)"`

### Task A4: attach_message_id takes the session lock (B-04)

**Files:**
- Modify: `backend/services/check_question_service.py:81-90`
- Test: `backend/tests/test_check_question_service.py` (append; reuse its session-seeding fixtures)

- [ ] **Step 1: Failing test** (monkeypatch-spy pattern from `test_profile_service.py:542-563`):

```python
def test_attach_message_id_takes_the_lock(db_session, monkeypatch, <this file's seeded-session fixture>):
    from services import profile_service
    calls = []
    real = profile_service.lock_session_row
    monkeypatch.setattr(
        profile_service, "lock_session_row",
        lambda db, sid: calls.append(sid) or real(db, sid),
    )
    check_question_service.attach_message_id(db_session, SESSION_ID, 123)
    assert calls == [SESSION_ID]
```

- [ ] **Step 2: Verify fail** — expected: `calls == []`.

- [ ] **Step 3: Implement:**

```python
def attach_message_id(db: Session, session_id: str, message_id: int) -> None:
    """Stamp the asking assistant message id onto the open pending_check.

    No-op when there is no open batch (older flow / race). Read-time backfill
    covers messages whose batch was never linked."""
    from services import profile_service  # local import avoids circular

    # B-04: serialize with answer()/skip() (F-24 convention). Unlocked, this
    # whole-blob save could re-save pre-answer state over a concurrent grade.
    profile_service.lock_session_row(db, session_id)
    pc = get_pending_check(db, session_id)
    if pc is None:
        return
    pc["message_id"] = message_id
    _save(db, session_id, pc)
```

- [ ] **Step 4: Run** — `python -m pytest tests/test_check_question_service.py tests/test_tutor_stream.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(check): attach_message_id locks session row (P3 B-04)"`

### Task A5: register() locks before the open-batch guard (B-12)

**Files:**
- Modify: `backend/services/check_question_service.py:118-146` (`register`)
- Test: `backend/tests/test_check_question_service.py` (append)

- [ ] **Step 1: Failing test** (same spy pattern; drive through `register` with this file's existing `ctx`/args fixtures):

```python
def test_register_takes_the_lock(db_session, monkeypatch, <seeded fixture>, <ctx fixture>):
    from services import profile_service
    calls = []
    real = profile_service.lock_session_row
    monkeypatch.setattr(
        profile_service, "lock_session_row",
        lambda db, sid: calls.append(sid) or real(db, sid),
    )
    check_question_service.register(db_session, ctx, <valid AskCheckQuestionsArgs>)
    assert SESSION_ID in calls
```

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement.** In `register`, directly BEFORE the `if get_pending_check(db, ctx.session_id) is not None:` guard, insert:

```python
    from services import profile_service  # local import avoids circular

    # B-12: serialize the open-batch guard with answer()/skip() (F-24
    # convention); two concurrent streams otherwise both read None and the
    # second _save silently overwrites the first batch.
    profile_service.lock_session_row(db, ctx.session_id)
```

(Keep it AFTER the pure-args validations — no lock needed to reject malformed args.)

- [ ] **Step 4: Run** — `python -m pytest tests/test_check_question_service.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(check): register() locks session row before open-batch guard (P3 B-12)"`

### Task A6: merge_into_session locks the row (B-13)

**Files:**
- Modify: `backend/lib/keyword_index.py:51-57`
- Test: `backend/tests/test_ingestion_service.py` or the keyword-index test file (locate with `grep -l merge_into_session backend/tests`)

- [ ] **Step 1: Failing test:**

```python
def test_merge_into_session_locks_row(db_session, monkeypatch, <seeded-session fixture>):
    seen = {}
    real_get = db_session.get
    def spy(entity, ident, **kw):
        seen.update(kw)
        return real_get(entity, ident, **kw)
    monkeypatch.setattr(db_session, "get", spy)
    keyword_index.merge_into_session(db_session, SESSION_ID, {"stem"})
    assert seen.get("with_for_update") is True
```

- [ ] **Step 2: Verify fail** — `seen` has no `with_for_update`.

- [ ] **Step 3: Implement:**

```python
def merge_into_session(db: Session, session_id: str, new_stems: set[str]) -> None:
    # B-13: FOR UPDATE on the read-union-write; concurrent ingestions for one
    # session otherwise last-write-win with a stale base set. No-op on SQLite.
    # Taken at the END of the ingestion pipeline, so hold time is only the
    # final flush+commit.
    row = db.get(SessionModel, session_id, with_for_update=True)
    if row is None:
        raise ValueError(f"session not found: {session_id}")
    current = set(json.loads(row.kw_index_json or "[]"))
    merged = current | set(new_stems)
    row.kw_index_json = json.dumps(sorted(merged))
```

- [ ] **Step 4: Run** — `python -m pytest tests/test_ingestion_service.py -v` plus the keyword-index tests. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(ingestion): merge_into_session locks session row (P3 B-13)"`

### Batch A close-out

- [ ] Full backend suite: `cd backend && python -m pytest`. Expected: all PASS.
- [ ] Stash-verify at least the A1 and A3 regression tests (stash impl, confirm FAIL, pop).
- [ ] Push, open PR to `dev`. PR body lists B-03/B-04/B-05/B-06/B-11/B-12/B-13 and the live-dupe pre-check SQL from the 0021 docstring as a pre-deploy gate.
- [ ] CI green, merge before starting Batch B.

## Batch B — Backend cost/perf/pool (B-07, B-08, B-09, B-10)

Branch: `fix/p3-batch-b`. PR title: `fix: P3 batch B - backend cost/perf/pool (B-07..B-10)`.

### Task B1: Upload validates before burning a rate-limit slot (B-07)

**Files:**
- Modify: `backend/routes/upload.py:74-126` (`upload_file` — reorder only, no logic changes)
- Test: `backend/tests/test_upload_route.py` (append; it already has `seeded`, `client`, `stub_background`, `stub_filesystem` fixtures)

**Interfaces:**
- Produces: guard order extension check -> ownership 404 -> rate limit -> size/magic/write. Ownership-before-increment also removes the fresh-user FK 500 (owning a session implies the users row exists).

- [ ] **Step 1: Failing tests:**

```python
def test_bad_extension_does_not_burn_slot(client, seeded, db_session):
    resp = client.post(
        "/api/upload",
        data={"session_id": SESSION_ID},
        files={"file": ("notes.exe", io.BytesIO(b"MZ"), "application/octet-stream")},
    )
    assert resp.status_code == 400
    count = db_session.query(UsageCounter).filter_by(user_id=USER_ID).count()
    assert count == 0


def test_foreign_session_does_not_burn_slot(client, seeded, db_session):
    resp = client.post(
        "/api/upload",
        data={"session_id": "not_yours"},
        files={"file": ("notes.pdf", io.BytesIO(b"%PDF-1.4 x"), "application/pdf")},
    )
    assert resp.status_code == 404
    count = db_session.query(UsageCounter).filter_by(user_id=USER_ID).count()
    assert count == 0
```

(Add `from db.models import UsageCounter` to this file's imports. Match the auth setup the file's existing 404/400 tests use.)

- [ ] **Step 2: Verify fail** — `python -m pytest tests/test_upload_route.py -v -k slot`. Expected: both FAIL (count == 1).

- [ ] **Step 3: Implement.** In `upload_file`, MOVE the leading block

```python
    allowed, used = rate_limit.check_and_increment(db, user_id)
    if not allowed:
        raise HTTPException(status_code=429, detail={...unchanged...})
```

so the top of the function reads, in order:
1. the existing `content-length` 413 pre-check (advisory, no slot);
2. the existing extension 400 check;
3. the existing session-ownership 404 check (`sess = db.get(...)`);
4. the moved `check_and_increment` 429 block, with this comment above it:

```python
    # B-07: rate limit only after extension + ownership pass, mirroring
    # _prepare_turn's guard order - a rejected upload must not consume a
    # daily slot. Ownership-before-increment also guarantees the users row
    # exists for the usage_counters FK (owning a session implies it).
```

5. everything from filename sanitization onward, unchanged.

- [ ] **Step 4: Run** — `python -m pytest tests/test_upload_route.py -v`. Expected: all PASS (if an existing test asserted the old increment-first order, update it to the new order — that is the fix's intent).
- [ ] **Step 5: Commit** — `git commit -am "fix(upload): validate extension+ownership before rate-limit slot (P3 B-07)"`

### Task B2: _prepare_turn re-records embedding spend after rollback (B-08)

**Files:**
- Modify: `backend/services/retrieval_service.py` (`semantic_fallback_required`, `prefetch_for_prompt`)
- Modify: `backend/routes/chat.py` (`_prepare_turn` — holder + except arm)
- Test: `backend/tests/test_retrieval_service.py`, `backend/tests/test_chat.py` (append)

**Interfaces:**
- Produces: both retrieval functions accept `cost_holder: list | None = None` and append the `Decimal` cost that `meter_embedding_response` returns. Task B3 keeps these signatures.

- [ ] **Step 1: Failing tests.** In `test_retrieval_service.py` (reuse its existing litellm/aembedding stubs):

```python
async def test_prefetch_appends_metered_cost_to_holder(db_session, <stubs>):
    holder = []
    await retrieval_service.prefetch_for_prompt(
        db_session, SESSION_ID, USER_ID, "query", cost_holder=holder
    )
    assert len(holder) == 1 and holder[0] >= 0
```

In `test_chat.py` (route-level, `client` fixture):

```python
def test_prepare_turn_failure_rerecords_embedding_spend(client, <seeded session fixture>, monkeypatch, db_session):
    from decimal import Decimal
    async def fake_fallback(db, sid, msg, *, user_id=None, cost_holder=None):
        if cost_holder is not None:
            cost_holder.append(Decimal("0.5"))
        return False
    monkeypatch.setattr("routes.chat.retrieval_service.semantic_fallback_required", fake_fallback)
    monkeypatch.setattr(
        "routes.chat.prompts.build_system_prompt",
        lambda state: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    resp = client.post("/api/chat/stream", json={"session_id": SESSION_ID, "message": "hi"})
    assert resp.status_code == 500
    from services import cost_meter
    assert cost_meter.current_spend(db_session, USER_ID) == Decimal("0.5")
```

(Adapt the endpoint/status assertion to how this file's existing _prepare_turn-failure test asserts the 500; one exists for the persist-user-message-on-crash behavior.)

- [ ] **Step 2: Verify fail** — holder test FAILS with TypeError (unexpected kwarg); route test FAILS with spend == 0.

- [ ] **Step 3: Implement retrieval side.** Both functions gain a trailing kwarg `cost_holder: list | None = None`. At each `meter_embedding_response` call site, capture and append:

```python
        cost = cost_meter.meter_embedding_response(
            db, resp, user_id=user_id, session_id=session_id, texts=[query],
        )
        if cost_holder is not None:
            cost_holder.append(cost)
```

(In `semantic_fallback_required` this sits inside the existing `if user_id is not None:` guard.)

- [ ] **Step 4: Implement chat side.** In `_prepare_turn`, before the `try:` at step 6, add `embed_cost_holder: list = []`. Pass `cost_holder=embed_cost_holder` to BOTH retrieval calls. Replace the except arm:

```python
    except Exception:
        db.rollback()
        # B-08: the rollback discarded metered embedding spend flushed by the
        # retrieval calls (F-19 class - fixed in tutor error arm + ingestion,
        # missed here). Re-record real vendor cost on the fresh transaction;
        # the user-message commit below publishes both.
        total_embed = sum(embed_cost_holder, Decimal("0"))
        if total_embed > 0:
            cost_meter.record_cost(db, user_id, total_embed)
        db.add(ChatMessage(session_id=req.session_id, role="user", content=req.message))
        db.commit()
        raise
```

(`Decimal` and `cost_meter` are already imported in chat.py.)

- [ ] **Step 5: Run** — `python -m pytest tests/test_retrieval_service.py tests/test_chat.py tests/test_chat_stream_route.py -v`. Expected: PASS.
- [ ] **Step 6: Commit** — `git commit -am "fix(chat): re-record metered embedding spend after _prepare_turn rollback (P3 B-08)"`

### Task B3: Semantic fallback vector reused by prefetch (B-09)

**Files:**
- Modify: `backend/services/retrieval_service.py` (`semantic_fallback_required` returns tuple; `prefetch_for_prompt` accepts `query_vec`)
- Modify: `backend/routes/chat.py:234-243` (thread the vector)
- Test: `backend/tests/test_retrieval_service.py` (update + append)

**Interfaces:**
- Consumes: `cost_holder` kwarg from Task B2.
- Produces: `semantic_fallback_required(...) -> tuple[bool, list[float] | None]`; `prefetch_for_prompt(..., query_vec: list | None = None, cost_holder: list | None = None)`.

- [ ] **Step 1: Failing test:**

```python
async def test_fallback_vector_prevents_second_embedding(db_session, monkeypatch, <stubs/seeding>):
    embed_calls = []
    # wrap this file's existing litellm.aembedding stub to count invocations
    # (append to embed_calls inside the stub), then:
    required, vec = await retrieval_service.semantic_fallback_required(
        db_session, SESSION_ID, "query", user_id=USER_ID
    )
    assert vec is not None
    await retrieval_service.prefetch_for_prompt(
        db_session, SESSION_ID, USER_ID, "query", query_vec=vec
    )
    assert len(embed_calls) == 1
```

- [ ] **Step 2: Verify fail** — tuple unpack raises (bool is not iterable) or `embed_calls == 2`.

- [ ] **Step 3: Implement.** `semantic_fallback_required`: every `return False` becomes `return False, None`; the final comparison becomes:

```python
        sim = _cosine_similarity(list(query_vec), centroid)
        # B-09: hand the vector back so prefetch_for_prompt can skip its
        # identical embed (2x cost + one extra round-trip on every
        # fallback-required turn otherwise).
        return sim >= settings.retrieval_fallback_threshold, list(query_vec)
```

`prefetch_for_prompt`: gain `query_vec: list | None = None`; wrap the embed+meter span:

```python
        if query_vec is None:
            resp = await litellm.aembedding(...unchanged...)
            query_vec = (...unchanged extraction...)
            cost = cost_meter.meter_embedding_response(...unchanged...)
            if cost_holder is not None:
                cost_holder.append(cost)
        hits = pgvector_store.query_chunks(
            db, session_id=session_id, query_embedding=query_vec, k=k
        )
```

(When `query_vec` is supplied, its spend was already metered by the fallback call — no double-meter.)

`routes/chat.py` — replace the two-call region:

```python
        query_vec = None
        if not retrieval_required:
            retrieval_required, query_vec = await retrieval_service.semantic_fallback_required(
                db, req.session_id, req.message, user_id=user_id,
                cost_holder=embed_cost_holder,
            )

        prefetched_chunks = None
        if retrieval_required:
            prefetched_chunks = await retrieval_service.prefetch_for_prompt(
                db, req.session_id, user_id, req.message,
                query_vec=query_vec, cost_holder=embed_cost_holder,
            )
```

- [ ] **Step 4: Update existing callers/tests** that unpack the old bool return (`grep -rn "semantic_fallback_required" backend/` — expect chat.py + tests only). This includes Task B2's `fake_fallback` in `test_chat.py` — it must now return `(False, None)` instead of `False`. Run `python -m pytest tests/test_retrieval_service.py tests/test_chat.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(retrieval): reuse fallback query vector, embed once per turn (P3 B-09)"`

### Task B4: Engine pool config — pre_ping + explicit sizing (B-10 part 1)

**Files:**
- Modify: `backend/db/database.py:20-33`
- Modify: `backend/config.py` (two new settings next to the existing DB fields)
- Test: create `backend/tests/test_database_engine.py`

- [ ] **Step 1: Failing test:**

```python
"""B-10: engine kwargs - pre_ping + explicit pool sizing on Postgres."""
from db import database


def test_postgres_engine_kwargs_have_pool_config():
    kw = database._build_engine_kwargs("postgresql+psycopg://u:p@h/db")
    assert kw["pool_pre_ping"] is True
    assert kw["pool_size"] >= 1
    assert kw["max_overflow"] >= 0
    assert kw["pool_recycle"] == 1800
    assert kw["connect_args"] == {"prepare_threshold": None}


def test_sqlite_engine_kwargs_unchanged():
    kw = database._build_engine_kwargs("sqlite:///x.db")
    assert kw == {"connect_args": {"check_same_thread": False}}
```

- [ ] **Step 2: Verify fail** — AttributeError: no `_build_engine_kwargs`.

- [ ] **Step 3: Implement.** `config.py` — add to `Settings` (near `database_url`):

```python
    # B-10: pool sizing must respect Render instance + Supabase pooler client
    # limits; env-tunable so the deploy can be sized without a code change.
    db_pool_size: int = 5
    db_max_overflow: int = 5
```

`database.py` — replace the inline kwargs block:

```python
def _build_engine_kwargs(url: str) -> dict:
    kwargs: dict = {}
    if url.startswith("sqlite:"):
        kwargs["connect_args"] = {"check_same_thread": False}
    else:
        # (keep the existing prepare_threshold comment block here)
        kwargs["connect_args"] = {"prepare_threshold": None}
        # B-10: detect dead pooled connections after idle (pre_ping) and make
        # pool sizing explicit + env-tunable instead of SQLAlchemy defaults.
        kwargs["pool_pre_ping"] = True
        kwargs["pool_size"] = settings.db_pool_size
        kwargs["max_overflow"] = settings.db_max_overflow
        kwargs["pool_recycle"] = 1800
    return kwargs


_db_url = _normalized_url(settings.database_url)
_is_sqlite = _db_url.startswith("sqlite:")
_engine_kwargs = _build_engine_kwargs(_db_url)
```

- [ ] **Step 4: Run** — `python -m pytest tests/test_database_engine.py -v` then the full suite (import-time change). Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(db): pool_pre_ping + explicit env-tunable pool sizing (P3 B-10)"`

### Task B5: Tutor loop releases the DB connection before each LLM stream (B-10 part 2, structural)

**Files:**
- Modify: `backend/agent/tutor.py` (~line 203, directly before `resp = await litellm.acompletion(`)
- Test: `backend/tests/test_tutor_stream.py` (append; reuse its existing stream-stub helpers)

**Interfaces:**
- Produces: invariant "no open transaction at the acompletion await" — the connection returns to the pool for the stream duration, removing the ~15-concurrent-stream ceiling.

- [ ] **Step 1: Failing test.** Using this file's existing fake-acompletion/stub-stream helper, capture transaction state at call time:

```python
async def test_no_open_transaction_during_llm_stream(db_session, <this file's ctx/session fixtures>, monkeypatch):
    captured = {}
    # wrap the existing acompletion stub: before returning the canned stream,
    # record: captured["open_txn"] = db_session.in_transaction()
    # ... run one streamed turn via the file's existing driver helper ...
    assert captured["open_txn"] is False
```

- [ ] **Step 2: Verify fail** — `open_txn` is True (loop-top `check_cap` SELECT opened it).

- [ ] **Step 3: Implement.** In the loop, after `iter_prompt_snapshots.append([dict(m) for m in full])` and before the `resp = await litellm.acompletion(` call:

```python
            # B-10 (structural): close the transaction the loop-top check_cap
            # SELECT opened so the pooled connection (and, on the Supabase
            # transaction pooler, its pinned backend) returns to the pool for
            # the 10-60 s stream. Commit, not rollback: any flushed ledger
            # increments from earlier this turn are real spend and must
            # survive. Post-stream code reopens a transaction on first use.
            ctx.db.commit()
```

- [ ] **Step 4: Run the full agent/stream suites** — `python -m pytest tests/test_tutor_stream.py tests/test_tutor_loop.py tests/test_chat_stream_route.py tests/test_check_complete_route.py -v`. Expected: PASS. Watch specifically for tests that relied on uncommitted state being visible/rolled back across the acompletion boundary — if one fails, the fix is to commit that state explicitly in the test setup, not to remove the new commit.
- [ ] **Step 5: Commit** — `git commit -am "fix(tutor): release DB connection during LLM stream (P3 B-10 structural)"`

### Batch B close-out

- [ ] Full backend suite green; stash-verify B1 + B5 regression tests.
- [ ] Push, PR to `dev` listing B-07/B-08/B-09/B-10; note in body: live TTFT + concurrency observation owed post-deploy.
- [ ] CI green, merge before Batch C.

## Batch C — Frontend resilience + state correctness (F-07, F-11, F-12, F-13, F-14, F-15, F-16, F-17, F-20)

Branch: `fix/p3-batch-c`. PR title: `fix: P3 batch C - FE resilience + state correctness (F-07, F-11..F-17, F-20)`.
All tests: `cd frontend && npm run test:unit -- --run <file>`; suite-wide `npm run test:unit -- --run`; then `npm run lint`.

### Task C1: Background session actions stop nuking the Home screen (F-07, light structural)

**Files:**
- Modify: `frontend/src/stores/session.js` (`renameSession` ~line 292, `setPinned` catch — same pattern a few lines below)
- Modify: `frontend/src/components/sidebar/SidebarSessionRow.vue` (onPin ~113, onUnpin ~119, commitRename ~143)
- Modify: `frontend/src/views/HomeView.vue:7` (error branch guard)
- Test: `frontend/src/__tests__/sessionStore.test.js`, `frontend/src/__tests__/` home view test file (locate: `ls frontend/src/__tests__ | grep -i home`)

- [ ] **Step 1: Failing tests.** Store test:

```js
it('renameSession failure rolls back but does not write global error', async () => {
  const store = useSessionStore()
  store.sessions = [{ id: 's1', topic: 'Old' }]
  sessionsApi.renameSession.mockRejectedValue(new ApiErrorLike(500, {}))
  await expect(store.renameSession('s1', 'New')).rejects.toBeTruthy()
  expect(store.sessions[0].topic).toBe('Old')
  expect(store.error).toBeNull()
})
```

(Add `renameSession`/`setPinned` to the file's `vi.mock('@/services/sessionsApi.js')` factory if absent. Mirror a `setPinned` test.)

Home view test: mount HomeView with store state `{ error: 'boom', sessions: [{id:'s1'}] }` — assert the mode cards (`[data-testid="home-mode-quick"]`) still render; with `{ error: 'boom', sessions: [] }` — assert `[data-testid="home-error"]` renders.

- [ ] **Step 2: Verify fail** — store.error is set; cards unmount.

- [ ] **Step 3: Implement.** `session.js` — in `renameSession` and `setPinned` catches, replace `_setError(e)` with:

```js
      // F-07: background action - rollback and rethrow, but never write the
      // global error (it unmounts unrelated screens). Callers toast.
      throw e
```

`SidebarSessionRow.vue` — add the toast import SessionView.vue uses (`const { showError } = useToast()` — copy the exact `useToast` import specifier from `SessionView.vue`'s script imports) and surface failures:

```js
function onPin() {
  const id = props.session.id
  store.setPinned(id, true).catch(() => showError('Could not pin the session.'))
  refocusRowTrigger(id)
}

function onUnpin() {
  const id = props.session.id
  store.setPinned(id, false).catch(() => showError('Could not unpin the session.'))
  refocusRowTrigger(id)
}
```

and in `commitRename`:

```js
  try { await store.renameSession(props.session.id, next) }
  catch { showError('Could not rename the session.') }
```

`HomeView.vue:7` — scope the fatal branch to Home's own load:

```html
    <p
      v-else-if="store.error && !store.sessions.length"
      class="error"
      data-testid="home-error"
    >
```

- [ ] **Step 4: Run** the two test files, then suite. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(fe): background session actions toast instead of global error (P3 F-07)"`

### Task C2: Busy guards + error handling on Onboarding submit and Settings save (F-11)

**Files:**
- Modify: `frontend/src/views/OnboardingView.vue` (submit ~76, button ~40)
- Modify: `frontend/src/views/SettingsView.vue` (save ~227, button ~39)
- Test: onboarding/settings view test files (locate: `ls frontend/src/__tests__ | grep -iE "onboarding|settings"`)

- [ ] **Step 1: Failing tests** (per view):

```js
it('shows inline error and re-enables on API failure', async () => {
  userStore.completeOnboarding.mockRejectedValue(new Error('down'))
  // fill valid form, click submit
  expect(wrapper.find('[data-testid="onboarding-error"]').exists()).toBe(true)
  expect(wrapper.find('[data-testid="onboarding-submit"]').attributes('disabled')).toBeUndefined()
})

it('ignores double submit while in flight', async () => {
  // completeOnboarding returns a pending promise; click twice
  expect(userStore.completeOnboarding).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Verify fail** — unhandled rejection / called twice.

- [ ] **Step 3: Implement OnboardingView:**

```js
import { friendlyError } from '@/lib/errors.js'

const submitting = ref(false)
const submitError = ref(null)

async function submit() {
  if (!canSubmit.value || submitting.value) return
  submitting.value = true
  submitError.value = null
  try {
    await userStore.completeOnboarding({
      name: displayName.value,
      feedback: feedback.value,
    })
    router.push({ name: 'home' })
  } catch (e) {
    // F-11: inline surface (LoginView pattern); the errorBus toast alone
    // left the form frozen with no explanation and an unhandled rejection.
    submitError.value = friendlyError(e)
  } finally {
    submitting.value = false
  }
}
```

Template: button `:disabled="!canSubmit || submitting"`; below it:

```html
        <p v-if="submitError" class="error" role="alert" data-testid="onboarding-error">
          {{ submitError }}
        </p>
```

Mirror in SettingsView (`saving` ref, `saveError` ref, `data-testid="settings-error"`, button `:disabled="!dirty || saving"`, wrap `user.updateProfile` in try/catch, only `showSuccess` on success).

- [ ] **Step 4: Run + suite.** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(fe): busy guards + inline errors on onboarding submit and settings save (P3 F-11)"`

### Task C3: uploadDocument gets a timeout and one 401 refresh-retry (F-12)

**Files:**
- Modify: `frontend/src/services/uploadApi.js:38-64`
- Test: `frontend/src/__tests__/` upload api test (locate; create `uploadApi.test.js` if none)

- [ ] **Step 1: Failing tests:**

```js
it('passes an abort timeout signal to fetch', async () => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 202, text: async () => '{}' })
  await uploadDocument({ sessionId: 's1', file: new Blob(['x']) })
  expect(global.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
})

it('retries once with a refreshed token on 401', async () => {
  global.fetch = vi.fn()
    .mockResolvedValueOnce({ ok: false, status: 401, text: async () => '{}' })
    .mockResolvedValueOnce({ ok: true, status: 202, text: async () => '{}' })
  await uploadDocument({ sessionId: 's1', file: new Blob(['x']) })
  expect(global.fetch).toHaveBeenCalledTimes(2)
})
```

(Mock `./apiClient.js` exports `getFreshAccessToken` and `_refreshAccessToken` in the vi.mock factory.)

- [ ] **Step 2: Verify fail** — no signal; single call then throw.

- [ ] **Step 3: Implement:**

```js
import { ApiError, apiGet, apiDelete, getFreshAccessToken, _refreshAccessToken } from './apiClient.js'

// F-12: uploads get the same timeout discipline as request() (F-06) but a
// longer budget - multipart PDF bodies legitimately exceed 30 s.
const UPLOAD_TIMEOUT_MS = 120000

async function _postUpload(fd, headers) {
  return fetch(`${BASE_URL}/upload`, {
    method: 'POST',
    body: fd,
    headers,
    signal:
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
        : undefined,
  })
}

export async function uploadDocument({ sessionId, file }) {
  const fd = new FormData()
  fd.append('session_id', sessionId)
  fd.append('file', file)

  let resp
  try {
    resp = await _postUpload(fd, await _authHeaders())
    if (resp.status === 401) {
      // F-12: one silent refresh-retry, same policy as request() (F-09).
      const token = await _refreshAccessToken()
      resp = await _postUpload(fd, token ? { authorization: `Bearer ${token}` } : {})
    }
  } catch (e) {
    const detail = e?.name === 'TimeoutError' ? 'upload timed out' : e.message
    throw new ApiError(0, { detail }, '/upload')
  }

  const text = await resp.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    /* leave parsed null */
  }

  if (!resp.ok) throw new ApiError(resp.status, parsed ?? text, '/upload')
  return parsed
}
```

- [ ] **Step 4: Run + suite.** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(fe): upload timeout + 401 refresh-retry (P3 F-12)"`

### Task C4: loadSession finally-arm honors the discriminator (F-13)

**Files:**
- Modify: `frontend/src/stores/session.js:173-177`
- Test: `frontend/src/__tests__/sessionStore.test.js` (append)

- [ ] **Step 1: Failing test:**

```js
it('superseded load settling first does not clear loading flags', async () => {
  const store = useSessionStore()
  let resolveB, resolveC
  sessionsApi.getSession
    .mockReturnValueOnce(new Promise((r) => { resolveB = r }))
    .mockReturnValueOnce(new Promise((r) => { resolveC = r }))
  const pB = store.loadSession('B')
  const pC = store.loadSession('C')
  resolveB({ id: 'B', messages: [] })
  await pB
  expect(store.detailLoading).toBe(true)   // C still in flight
  resolveC({ id: 'C', messages: [] })
  await pC
  expect(store.detailLoading).toBe(false)
})
```

- [ ] **Step 2: Verify fail** — first assertion: `false`.

- [ ] **Step 3: Implement** — in `loadSession`'s `finally`:

```js
      } finally {
        // F-13: mirror the write discriminator - only the latest-requested
        // load may clear the shared flags, else a superseded load drops the
        // skeleton while the real target is still in flight.
        if (_latestRequestedId === id) {
          loading.value = false
          detailLoading.value = false
        }
        _inflight.delete(id)
      }
```

- [ ] **Step 4: Run + suite.** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(fe): superseded loadSession keeps skeleton until latest load settles (P3 F-13)"`

### Task C5: bootstrap survives auth.init() rejection (F-14)

**Files:**
- Modify: `frontend/src/main.js:26-31`, `frontend/src/router/index.js:95`
- Test: router test (`frontend/src/__tests__/router.test.js`, append) — main.js itself is not unit-mounted; the guard path carries the assertable behavior.

- [ ] **Step 1: Failing test** (router guard resilience):

```js
it('guard proceeds unauthenticated when auth.init rejects', async () => {
  authStore.ready = false
  authStore.init.mockRejectedValue(new Error('corrupt session'))
  authStore.isAuthenticated = false
  await router.push('/')                 // must not throw
  expect(router.currentRoute.value.name).toBe('login')
})
```

- [ ] **Step 2: Verify fail** — navigation rejects with 'corrupt session'.

- [ ] **Step 3: Implement.** `router/index.js` guard line 95:

```js
  if (!auth.ready) {
    try {
      await auth.init()
    } catch {
      // F-14: a failed init means no session - proceed unauthenticated;
      // the guard below routes to /login.
    }
  }
```

`main.js` — wrap the boot await the same way:

```js
  try {
    await useAuthStore().init()
  } catch (e) {
    // F-14: never leave a blank page - mount unauthenticated and let the
    // router guard route to /login.
    console.error('auth init failed; continuing unauthenticated', e)
  }
```

- [ ] **Step 4: Run + suite.** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(fe): boot + guard survive auth.init rejection (P3 F-14)"`

### Task C6: Library responses apply in order (F-15)

**Files:**
- Modify: `frontend/src/views/SessionsLibraryView.vue:43-63`
- Test: `frontend/src/__tests__/sessionsLibraryView.test.js` (append)

- [ ] **Step 1: Failing test:**

```js
it('drops a stale response that settles after a newer one', async () => {
  let resolveSlow, resolveFast
  store.fetchLibrary
    .mockReturnValueOnce(new Promise((r) => { resolveSlow = r }))
    .mockReturnValueOnce(new Promise((r) => { resolveFast = r }))
  // trigger load twice (e.g. two setStatus clicks)
  resolveFast({ items: [{ id: 'new' }], total: 1, limit: 20, offset: 0 })
  await flushPromises()
  resolveSlow({ items: [{ id: 'stale' }], total: 9, limit: 20, offset: 0 })
  await flushPromises()
  expect(wrapper.vm.items?.[0]?.id ?? storeItemsProbe()).toBe('new')
})
```

(Adapt the probe to how this test file already asserts rendered items — testid queries are fine.)

- [ ] **Step 2: Verify fail** — stale wins.

- [ ] **Step 3: Implement** — seq guard, `_latestRequestedId` idiom:

```js
let _loadSeq = 0
async function load() {
  // F-15: discard out-of-order settles - same discriminator idiom as the
  // session store's _latestRequestedId.
  const seq = ++_loadSeq
  loading.value = true
  error.value = null
  try {
    const page = await store.fetchLibrary({
      status: status.value,
      q: q.value || undefined,
      sort: sort.value,
      limit: limit.value,
      offset: offset.value,
    })
    if (seq !== _loadSeq) return
    items.value = page.items
    total.value = page.total
    limit.value = page.limit
    offset.value = page.offset
  } catch (e) {
    if (seq !== _loadSeq) return
    error.value = e?.message || 'Failed to load sessions'
  } finally {
    if (seq === _loadSeq) loading.value = false
  }
}
```

- [ ] **Step 4: Run + suite.** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(fe): library load seq guard drops stale responses (P3 F-15)"`

### Task C7: Auth-expiry redirect keeps the deep link (F-16)

**Files:**
- Modify: `frontend/src/services/apiClient.js:68-73` (`_onAuthExpired`)
- Test: `frontend/src/__tests__/apiClient.test.js` (append)

- [ ] **Step 1: Failing test:**

```js
it('_onAuthExpired pushes login with redirect query', async () => {
  // this file already mocks the router module; ensure the mock exposes
  // currentRoute: { value: { fullPath: '/session/abc' } }
  await _onAuthExpired()
  expect(routerMock.push).toHaveBeenCalledWith({
    name: 'login',
    query: { redirect: '/session/abc' },
  })
})
```

- [ ] **Step 2: Verify fail** — called with `{ name: 'login' }` only.

- [ ] **Step 3: Implement** (in `_onAuthExpired`):

```js
  try {
    const { default: router } = await import('../router/index.js')
    // F-16: carry the location like the router guard does (F-49), so
    // re-login returns the user to where the expiry hit them.
    router.push({
      name: 'login',
      query: { redirect: router.currentRoute.value.fullPath },
    })
  } catch {
    // Router unavailable outside the app shell.
  }
```

- [ ] **Step 4: Run + suite.** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(fe): auth expiry redirect preserves deep link (P3 F-16)"`

### Task C8: completeCheck restores the check card on pre-stream failure (F-17)

**Files:**
- Modify: `frontend/src/stores/session.js:392-468` (`completeCheck`)
- Test: `frontend/src/__tests__/sessionCheckFlow.test.js` (append)

- [ ] **Step 1: Failing test:**

```js
it('restores pendingCheck when the completion stream fails before any event', async () => {
  const store = useSessionStore()
  // seed a resolved pendingCheck via the store's normal path (loadSession
  // mapping or handleCheckQuestion + answer flow already used in this file)
  streamSvc.streamCheckComplete.mockRejectedValue(new ApiErrorLike(0, { detail: 'offline' }))
  await store.completeCheck().catch(() => {})
  expect(store.pendingCheck).not.toBeNull()
})
```

- [ ] **Step 2: Verify fail** — `pendingCheck` is null.

- [ ] **Step 3: Implement.** In `completeCheck`:

1. Replace `pendingCheck.value = null` (line 403) with:

```js
    // F-17: remember the batch until the stream is proven underway - a
    // pre-flight failure must put the card back, not strand it server-open.
    const savedCheck = pendingCheck.value
    pendingCheck.value = null
    let sawAnyEvent = false
```

2. First line inside the `onEvent` callback: `sawAnyEvent = true`.
3. In the catch, directly after the `_streamSuperseded()` early-return:

```js
      if (!sawAnyEvent && !pendingCheck.value) pendingCheck.value = savedCheck
```

(Before the AbortError arm, so an abort that never saw an event also restores.)

- [ ] **Step 4: Run + suite.** Expected: PASS (existing completeCheck tests unaffected — events set `sawAnyEvent`).
- [ ] **Step 5: Commit** — `git commit -am "fix(fe): restore check card when completion stream fails pre-flight (P3 F-17)"`

### Task C9: Check-flow API calls stop double-surfacing (F-20)

**Files:**
- Modify: `frontend/src/services/sessionsApi.js:31-38`
- Test: `frontend/src/__tests__/` sessions api or check-flow test (append where answerCheck is already exercised)

- [ ] **Step 1: Failing test:**

```js
it('answerCheck and skipCheck opt out of the errorBus toast', async () => {
  // spy on apiClient request via the module mock used in this file; assert
  // the third argument carries { silent: true }
  await answerCheck('s1', 0, 2).catch(() => {})
  expect(apiPostMock).toHaveBeenCalledWith(
    '/sessions/s1/check/answer',
    { index: 0, selected_index: 2 },
    { silent: true },
  )
})
```

- [ ] **Step 2: Verify fail** — called without options.

- [ ] **Step 3: Implement:**

```js
// F-20: SessionView banners these failures itself (lastError); silent stops
// the errorBus double-toast - same opt-out pattern as profileApi.
export const skipCheck = (sessionId, index) =>
  apiPost(`/sessions/${sessionId}/check/skip`, { index }, { silent: true })

export const answerCheck = (sessionId, index, selectedIndex) =>
  apiPost(`/sessions/${sessionId}/check/answer`, {
    index,
    selected_index: selectedIndex,
  }, { silent: true })
```

- [ ] **Step 4: Run + suite + lint.** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(fe): check-flow calls opt out of errorBus toast (P3 F-20)"`

### Batch C close-out

- [ ] Full FE suite + lint green; stash-verify C1 + C8 regression tests.
- [ ] Push, PR to `dev` listing F-07, F-11..F-17, F-20.
- [ ] CI green, merge before Batch D.

## Batch D — Frontend a11y + visual (F-08, F-09, F-10, F-18, F-19, U-04)

Branch: `fix/p3-batch-d`. PR title: `fix: P3 batch D - FE a11y + visual (F-08..F-10, F-18, F-19, U-04)`.

### Task D1: Focus management on route change (F-08)

**Files:**
- Modify: `frontend/src/router/index.js` (after the `beforeEach`, ~line 124)
- Modify: `frontend/src/App.vue:58` (`#main-content` gets `tabindex="-1"`)
- Test: `frontend/src/__tests__/router.test.js` (append)

- [ ] **Step 1: Failing test:**

```js
it('focuses #main-content after push navigation', async () => {
  const main = document.createElement('main')
  main.id = 'main-content'
  main.setAttribute('tabindex', '-1')
  document.body.appendChild(main)
  await router.push('/')          // establish an initial route first
  await router.push('/library')   // any second authenticated route in this suite
  expect(document.activeElement).toBe(main)
  main.remove()
})
```

(Pick two routes this test file already navigates successfully with its auth mocks.)

- [ ] **Step 2: Verify fail** — activeElement is body.

- [ ] **Step 3: Implement.** `App.vue` line 58: `<main id="main-content" class="page" tabindex="-1">` (both — this shell `<main>` and, if the no-shell branch renders views without it, leave that branch alone; login-flow pages manage their own focus). `router/index.js`, after the `beforeEach` block:

```js
router.afterEach((to, from, failure) => {
  // F-08: SPA route swaps leave keyboard/SR focus on a removed node. Reset
  // to the main landmark on real navigations (skip the initial load so we
  // don't steal focus from the address bar / skip-link).
  if (failure || !from.name) return
  if (typeof document === 'undefined') return
  document.getElementById('main-content')?.focus()
})
```

- [ ] **Step 4: Run + suite.** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(a11y): focus main landmark after route change (P3 F-08)"`

### Task D2: SidebarRowMenu drops false menu semantics (F-09)

**Files:**
- Modify: `frontend/src/components/sidebar/SidebarRowMenu.vue:73, 86, 91` (and every other `role="menuitem"` in the popover)
- Test: sidebar row menu test file (locate: `ls frontend/src/__tests__ | grep -i menu`)

- [ ] **Step 1: Failing test:**

```js
it('popover uses honest group semantics, not role=menu', async () => {
  // open the popover via the trigger as existing tests do
  const pop = wrapper.get('[data-testid="sidebar-row-menu-popover"]')
  expect(pop.attributes('role')).toBe('group')
  expect(pop.attributes('aria-label')).toBeTruthy()
  expect(wrapper.findAll('[role="menuitem"]')).toHaveLength(0)
  expect(wrapper.get('[data-testid="sidebar-row-menu-trigger"]').attributes('aria-haspopup')).toBeUndefined()
})
```

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement.** Trigger: remove `aria-haspopup="menu"` (keep `:aria-expanded`). Popover div: `role="menu"` -> `role="group"` plus `:aria-label="state === 'active' ? 'Session actions' : 'Ended session actions'"`. Every item button: delete `role="menuitem"`.

```html
    <div
      v-if="open"
      ref="popoverEl"
      class="sb-row-menu-popover"
      role="group"
      :aria-label="state === 'active' ? 'Session actions' : 'Ended session actions'"
      data-testid="sidebar-row-menu-popover"
    >
```

(F-09's reviewer-endorsed fix: honest semantics beat an unimplemented APG menu contract. Tab/Escape behavior already works and stays.)

- [ ] **Step 4: Run + suite (grep e2e specs for `menuitem` too: `rg menuitem frontend/e2e` — update if referenced).** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(a11y): sidebar row menu drops unimplemented menu role (P3 F-09)"`

### Task D3: Contrast + token + focus-visible sweep (F-10)

**Files:**
- Modify: `frontend/src/assets/base.css` (add info tokens ~line 127)
- Modify: `frontend/src/views/SessionView.vue:690-709` (`.error-retry`), `:797-811` (`.home-link`)
- Modify: `frontend/src/views/NewSessionView.vue:515-557` (`.warn-action`, `.open-existing`)
- Modify: `frontend/src/views/ProfileView.vue:418-422` (`.level-pill` beginner hex)
- Modify: `frontend/src/components/chat/ToolCallChip.vue:40`
- Modify: `frontend/src/components/BackButton.vue:62-67`, `frontend/src/assets/main.css:32-38` (`.profile-link`)
- Test: visual/no-unit — verification is grep + manual; add a token-presence unit test only if a base.css test file already exists (skip otherwise).

- [ ] **Step 1: Add tokens.** In `base.css`, next to the existing `--color-*-text` block (line ~125-127):

```css
  --color-info-text: #2E5DC4;
  /* Darkened info fill for white-text CTAs (same recipe as
     --color-accent-strong): raw --signal-info is ~3.0:1 with white. */
  --color-info-strong: #2E5DC4;
```

and in the dark-theme override block (where `--color-accent-text` is remapped, ~line 170):

```css
    --color-info-text: #7AA3F5;
```

- [ ] **Step 2: Swap fills.** `SessionView.vue` `.error-retry`: `background: var(--signal-error)` -> `background: var(--color-error-text)` (#B91C1C, 6.3:1 with white). `NewSessionView.vue` `.warn-action` and `.open-existing`: `background: var(--signal-info)` -> `background: var(--color-info-strong)`.

- [ ] **Step 3: Fix focus visibility.** Replace every `outline: none` in the touched rules with a visible indicator; pattern for all four sites (`.error-retry`, `.home-link`, `.back-btn`, `.profile-link`):

```css
.error-retry:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.error-retry:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
```

(Split the combined `:hover, :focus-visible` rules; hover keeps its existing effects, focus-visible gets the outline and loses `outline: none`.)

- [ ] **Step 4: Tokenize hardcoded hexes.** `ProfileView.vue` `.level-pill[data-level='beginner']`: `color: #2E5DC4` -> `color: var(--color-info-text)`. `ToolCallChip.vue`: fallback `#c44` -> `var(--color-error-text)` i.e. `color: var(--tool-pill-text, var(--color-error-text));`. Leave `base.css` `.confirm-delete-strong` (#dc2626/#b91c1c) — its comment documents the deliberate choice; alias to tokens only if identical values.

- [ ] **Step 5: Verify** — `rg "outline: none" frontend/src` returns none of the four touched rules; `npm run test:unit -- --run` + `npm run lint` PASS; manual: Tab through SessionView error banner + NewSessionView warning in light AND dark, confirm visible focus rings and readable button text.
- [ ] **Step 6: Commit** — `git commit -am "fix(a11y): AA fills, tokenized hexes, visible focus indicators (P3 F-10)"`

### Task D4: Discrete stream announcements replace the live transcript (F-18)

**Files:**
- Modify: `frontend/src/components/chat/MessageList.vue:33` (remove `aria-live`/`aria-atomic`)
- Modify: `frontend/src/views/SessionView.vue` (add status region + watcher near the messages block)
- Test: message list / session view test files (append)

- [ ] **Step 1: Failing tests:**

```js
it('message list is not a live region', () => {
  expect(wrapper.find('[aria-live]').exists()).toBe(false)  // in MessageList
})

it('announces stream start and finish discretely', async () => {
  // SessionView mounted with store; flip store.streamState 'idle'->'streaming'->'idle'
  const region = wrapper.get('[data-testid="stream-status"]')
  // streaming:
  expect(region.text()).toBe('Tutor is replying.')
  // back to idle:
  expect(region.text()).toBe('Reply finished.')
})
```

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement.** `MessageList.vue` line 33: drop the attributes — `<div class="message-list">`. `SessionView.vue` script:

```js
// F-18: a live region over the token-streaming bubble spams SRs with every
// mutation. Announce discrete transitions instead.
const streamAnnouncement = ref('')
watch(
  () => store.streamState,
  (next, prev) => {
    if (next === 'streaming') streamAnnouncement.value = 'Tutor is replying.'
    else if (prev === 'streaming' && next === 'idle') streamAnnouncement.value = 'Reply finished.'
  },
)
```

Template (adjacent to the messages container):

```html
      <div class="sr-only" role="status" aria-live="polite" data-testid="stream-status">
        {{ streamAnnouncement }}
      </div>
```

If no `.sr-only` utility exists (`rg "sr-only" frontend/src/assets`), add to `base.css`:

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 4: Run + suite.** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(a11y): discrete stream announcements, transcript no longer aria-live (P3 F-18)"`

### Task D5: Shared dialog chrome (F-19)

**Files:**
- Create: `frontend/src/assets/dialogs.css`
- Modify: `frontend/src/assets/main.css` (import it, next to the other asset imports at the top)
- Modify: `frontend/src/views/SessionView.vue:117` (Dialog class) + delete `:746-772` scoped `:global(.summary-dialog ...)` rules
- Modify: `frontend/src/components/GapPickerDialog.vue:2-9` (add class)
- Test: gap picker / session view dialog tests (append class assertions)

- [ ] **Step 1: Failing test:**

```js
it('gap picker carries the shared dialog chrome class', () => {
  expect(wrapper.get('[data-testid="gap-picker"]').classes()).toContain('crux-dialog')
})
```

(Plus the mirror assertion on the summary dialog's `crux-dialog` class in the SessionView test.)

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement.** `dialogs.css` — the extracted rules, renamed (selector structure copied exactly from the working `.summary-dialog` rules, only the class name changes):

```css
/* F-19: one dialog identity for every modal (summary, gap picker). Extracted
   from SessionView's scoped :global(.summary-dialog ...) overrides. */
.crux-dialog .p-dialog,
.p-dialog.crux-dialog {
  border-radius: var(--radius-card);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-lift);
}

.crux-dialog .p-dialog-header,
.p-dialog.crux-dialog .p-dialog-header {
  font-family: var(--font-display);
  font-weight: 700;
  letter-spacing: var(--tracking-tight);
  font-size: 1.5rem;
  padding: 1.25rem 1.5rem 0.75rem;
}

.crux-dialog .p-dialog-content,
.p-dialog.crux-dialog .p-dialog-content {
  padding: 0.5rem 1.5rem 1.25rem;
}

.crux-dialog .p-dialog-footer .p-button,
.p-dialog.crux-dialog .p-dialog-footer .p-button {
  background: var(--color-accent-strong);
  color: #FFFFFF;
  border: 0;
  border-radius: var(--radius-pill);
  padding: 0.625rem 1.5rem;
  font-weight: 600;
  box-shadow: var(--shadow-pop);
}
```

`main.css` top: `@import './dialogs.css';` (match the file's existing import syntax). `SessionView.vue:117`: `class="summary-dialog"` -> `class="crux-dialog summary-dialog"` (keep the old name — tests/e2e may select on it), then DELETE the four `:global(.summary-dialog ...)` rule blocks at 746-772. `GapPickerDialog.vue`: add `class="crux-dialog"` to the `<Dialog>`.

- [ ] **Step 4: Run + suite; manual: open both dialogs (end session with >1 gap), confirm identical chrome in light + dark.** Expected: PASS, visually consistent.
- [ ] **Step 5: Commit** — `git commit -am "fix(ui): shared crux-dialog chrome for summary + gap picker (P3 F-19)"`

### Task D6: Self-host fonts, drop Google CDN (U-04)

**Files:**
- Create: `frontend/src/assets/fonts/` (woff2 files) + `frontend/src/assets/fonts.css`
- Modify: `frontend/src/assets/main.css` (import fonts.css first), `frontend/index.html:8-10` (delete the three font `<link>`s)

- [ ] **Step 1: Download the woff2 assets.** For each family, fetch Google's css2 with a woff2-capable UA and download the referenced files (PowerShell):

```powershell
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
$css = Invoke-WebRequest -UserAgent $ua -Uri 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap'
# Save $css.Content to scratch, extract the url(...woff2) entries for the
# latin subsets, download each into frontend/src/assets/fonts/ with names:
# bricolage-grotesque-latin.woff2 (variable), inter-latin-400/500/600/700.woff2,
# ibm-plex-mono-latin-400/500.woff2
```

- [ ] **Step 2: Write `fonts.css`** — one `@font-face` per downloaded file, mirroring the css2 output's `font-family`/`font-weight`/`font-style`/`unicode-range` for the latin subset, with `font-display: swap` and `src: url('./fonts/<file>.woff2') format('woff2')`. For Bricolage Grotesque keep the variable axes: `font-weight: 400 700;` (and copy the css2 `font-stretch`/`font-optical-sizing` lines if present).

- [ ] **Step 3: Wire up.** `main.css`: add `@import './fonts.css';` as the FIRST import. `index.html`: delete lines 8-10 (the two preconnects + stylesheet link).

- [ ] **Step 4: Verify** — `rg "fonts.googleapis|fonts.gstatic" frontend/ --glob '!node_modules'` -> no hits outside git history; `npm run build` succeeds; `npm run preview`, open the app with DevTools network tab: zero requests to fonts.googleapis/gstatic, display font renders (compare a heading against `--font-display` fallback by toggling the @font-face off).
- [ ] **Step 5: Run FE suite + lint.** Expected: PASS.
- [ ] **Step 6: Commit** — `git add frontend/src/assets/fonts frontend/src/assets/fonts.css frontend/src/assets/main.css frontend/index.html && git commit -m "fix(fe): self-host fonts, remove Google Fonts CDN dependency (P3 U-04)"`

### Batch D close-out

- [ ] Full FE suite + lint green; manual light/dark keyboard sweep of the touched surfaces (D1 focus, D3 rings, D5 dialogs).
- [ ] Push, PR to `dev` listing F-08/F-09/F-10/F-18/F-19/U-04.
- [ ] CI green, merge before Batch E.

## Batch E — Contract + integration + infra (I-03..I-11, U-05)

Branch: `fix/p3-batch-e`. PR title: `fix: P3 batch E - contract + integration + infra (I-03..I-11, U-05)`.

### Task E1: Implement X-Cost-Warning header (I-03, structural)

**Files:**
- Modify: `backend/routes/sessions.py` (`end_session`), `backend/routes/upload.py` (`upload_file`), `backend/main.py:40-46` (CORS)
- Test: `backend/tests/test_cost_cap.py` (append)

**Interfaces:**
- Produces: `X-Cost-Warning: level=<soft|urgent>; used=<usd>; soft_cap=<usd>` header on `/sessions/{id}/end` and `/upload` success responses when the soft cap is breached. FE consumer (`apiClient.js:123-124` + `SessionView.resolveCostWarningLevel` parsing `level=(\w+)`) already exists and is already tested — do not change it.

- [ ] **Step 1: Failing test:**

```python
def test_end_session_sets_cost_warning_header_when_soft_breached(client, db_session, <seeded session fixture>, monkeypatch):
    from decimal import Decimal
    from services import cost_meter
    # push today's ledger above the soft cap for this user
    cost_meter.record_cost(db_session, USER_ID, Decimal(str(settings.llm_soft_cap_usd)) + Decimal("0.01"))
    db_session.commit()
    resp = client.post(f"/api/sessions/{SESSION_ID}/end")
    assert resp.status_code == 200
    assert resp.headers["x-cost-warning"].startswith("level=")


def test_end_session_no_header_under_soft_cap(client, <seeded session fixture>):
    resp = client.post(f"/api/sessions/{SESSION_ID}/end")
    assert "x-cost-warning" not in resp.headers
```

(Reuse this file's existing seeding + LLM-stub conventions for the end route.)

- [ ] **Step 2: Verify fail** — KeyError on the header.

- [ ] **Step 3: Implement.** Add a helper in `backend/services/cost_meter.py` (below `check_cap`):

```python
def cost_warning_header(db: Session, user_id: str) -> str | None:
    """I-03: header form of the soft-cap signal for non-SSE responses (the
    SSE cost_warning event covers chat). Format matches the FE parser
    (level=<soft|urgent>; ...) in SessionView.resolveCostWarningLevel."""
    cap = check_cap(db, user_id)
    if not cap.soft_breached:
        return None
    level = "urgent" if cap.urgent_breached else "soft"
    return f"level={level}; used={cap.used}; soft_cap={cap.soft_cap}"
```

`routes/sessions.py` `end_session`: add `response: Response` to the signature (`from fastapi import Response` — extend the existing fastapi import) and, immediately before EACH of its two `return SessionEndResponse(...)` statements:

```python
        warn = cost_meter.cost_warning_header(db, user_id)
        if warn:
            response.headers["X-Cost-Warning"] = warn
```

(Import `cost_meter` if sessions.py lacks it.) `routes/upload.py` `upload_file`: same pattern before the final `return UploadResponse(...)`.

`main.py` CORS — the header is unreadable cross-origin without exposure:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Accept", "Authorization", "If-Match"],
    expose_headers=["X-Cost-Warning"],
)
```

- [ ] **Step 4: Run** — `python -m pytest tests/test_cost_cap.py tests/test_sessions_route.py tests/test_upload_route.py -v`. Expected: PASS. The cost_meter.py module docstring (line 3) is now true — no edit needed.
- [ ] **Step 5: Commit** — `git commit -am "fix(cost): implement X-Cost-Warning header on end+upload, expose via CORS (P3 I-03)"`

### Task E2: Bare-429 copy distinguished from daily cap (I-04)

**Files:**
- Modify: `frontend/src/lib/errors.js:9`
- Test: `frontend/src/__tests__/` errors test (locate; create `errors.test.js` if none)

- [ ] **Step 1: Failing test:**

```js
it('distinguishes nginx throttle 429 from daily-cap 429', () => {
  const capErr = { status: 429, body: { detail: { code: 'daily_cap_reached' } } }
  const throttleErr = { status: 429, body: '<html>429</html>' }
  expect(friendlyError(capErr)).toMatch(/daily limit/i)
  expect(friendlyError(throttleErr)).toMatch(/wait a moment/i)
})
```

- [ ] **Step 2: Verify fail** — both say "daily limit".

- [ ] **Step 3: Implement** — replace line 9:

```js
  if (status === 429) {
    // I-04: nginx's per-IP throttle also 429s but with a non-JSON body (no
    // detail.code). Only a coded envelope is the daily cap.
    if (err?.body?.detail?.code) return "You've hit the daily limit. Try again tomorrow."
    return 'Too many requests - wait a moment and retry.'
  }
```

- [ ] **Step 4: Run + suite.** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(fe): bare 429 reads as transient throttle, not daily cap (P3 I-04)"`

### Task E3: Reopen duplicate_topic gets a real affordance (I-05)

**Files:**
- Modify: `frontend/src/stores/session.js:234-250` (`reopenSession` + new state ref)
- Modify: `frontend/src/views/SessionView.vue` (error banner region ~58-78, `resume()` ~501)
- Test: `frontend/src/__tests__/sessionStore.test.js` + session view test (append)

- [ ] **Step 1: Failing tests:**

```js
it('reopen 409 duplicate_topic exposes the conflicting session id', async () => {
  const store = useSessionStore()
  sessionsApi.reopenSession.mockRejectedValue(
    new ApiErrorLike(409, { detail: { code: 'duplicate_topic', session_id: 'other1' } }),
  )
  await store.reopenSession('s1').catch(() => {})
  expect(store.duplicateReopen).toEqual({ sessionId: 'other1' })
  expect(store.error).toMatch(/active session with this topic/i)
})
```

View test: with `store.duplicateReopen = { sessionId: 'other1' }`, assert a link `[data-testid="go-to-active-session"]` exists targeting the session route with id `other1`.

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement.** `session.js` — add state near the other refs: `const duplicateReopen = ref(null)` (and export it in the store's return). In `reopenSession`:

```js
  async function reopenSession(sessionId) {
    loading.value = true
    error.value = null
    duplicateReopen.value = null
    try {
      const resp = await sessionsApi.reopenSession(sessionId)
      ...existing success body unchanged...
    } catch (e) {
      // I-05: the contract hands over the conflicting session id - surface
      // it as an affordance instead of the generic dead end.
      if (e?.status === 409 && e?.body?.detail?.code === 'duplicate_topic') {
        duplicateReopen.value = { sessionId: e.body.detail.session_id }
        error.value = 'An active session with this topic already exists.'
        throw e
      }
      _setError(e)
    } finally {
      loading.value = false
    }
  }
```

Also clear it on navigation: first line of `loadSession`'s promise body adds `duplicateReopen.value = null`.

`SessionView.vue` — inside the error banner div (after the Retry button):

```html
        <RouterLink
          v-if="store.duplicateReopen"
          :to="{ name: 'session', params: { id: store.duplicateReopen.sessionId } }"
          class="home-link"
          data-testid="go-to-active-session"
        >
          Go to active session
        </RouterLink>
```

(`RouterLink` import per this file's existing usage; the banner already shows because `store.error` is set.)

- [ ] **Step 4: Run + suite.** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(fe): reopen duplicate_topic surfaces go-to-active-session (P3 I-05)"`

### Task E4: Build-time CSP meta injection (I-06, structural)

**Files:**
- Create: `frontend/cspPlugin.js`
- Modify: `frontend/vite.config.js`, `frontend/vercel.json` (remove the CSP header entry only)
- Test: create `frontend/src/__tests__/cspPlugin.test.js`

- [ ] **Step 1: Failing test:**

```js
import { describe, it, expect } from 'vitest'
import { buildCspContent, cspPlugin } from '../../cspPlugin.js'

describe('csp plugin', () => {
  it('derives connect-src from an absolute API base', () => {
    const csp = buildCspContent('https://crux-api.onrender.com/api')
    expect(csp).toContain("connect-src 'self' https://*.supabase.co https://crux-api.onrender.com")
  })
  it('relative API base collapses to self + supabase', () => {
    const csp = buildCspContent('/api')
    expect(csp).toContain("connect-src 'self' https://*.supabase.co;")
  })
  it('injects a meta tag into index html', () => {
    const html = '<html><head><title>Crux</title></head><body></body></html>'
    const out = cspPlugin('https://x.example/api').transformIndexHtml(html)
    expect(out).toContain('http-equiv="Content-Security-Policy"')
  })
})
```

- [ ] **Step 2: Verify fail** — module not found.

- [ ] **Step 3: Implement `frontend/cspPlugin.js`:**

```js
// I-06: vercel.json headers cannot interpolate env vars, so a committed CSP
// either ships a placeholder (broken deploys, the CRUX_API_HOST landmine) or
// a hardcoded host (breaks previews/forks). Inject the policy at build time
// from VITE_API_BASE_URL instead, as a meta tag. frame-ancestors cannot live
// in a meta CSP - clickjacking stays covered by the X-Frame-Options header
// that remains in vercel.json/nginx.
export function buildCspContent(apiBase) {
  let apiOrigin = ''
  try {
    apiOrigin = apiBase ? new URL(apiBase).origin : ''
  } catch {
    apiOrigin = '' // relative base (/api): same-origin, 'self' covers it
  }
  const connect = ["'self'", 'https://*.supabase.co', apiOrigin].filter(Boolean).join(' ')
  return [
    "default-src 'self'",
    `connect-src ${connect}`,
    "img-src 'self' data:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ') + ';'
}

export function cspPlugin(apiBase) {
  return {
    name: 'crux-csp-meta',
    apply: 'build', // dev server needs HMR websockets a strict CSP would block
    transformIndexHtml(html) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${buildCspContent(apiBase)}">`
      return html.replace('</title>', `</title>\n    ${meta}`)
    },
  }
}
```

`vite.config.js`:

```js
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

import { cspPlugin } from './cspPlugin.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      vue(),
      vueDevTools(),
      cspPlugin(env.VITE_API_BASE_URL || ''),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      },
    },
  }
})
```

`vercel.json`: delete the `Content-Security-Policy` header object (keep X-Content-Type-Options, X-Frame-Options, Referrer-Policy).

- [ ] **Step 4: Build assertions.** `cd frontend`; PowerShell: `$env:VITE_API_BASE_URL='https://crux-api.onrender.com/api'; npm run build`; then confirm `dist/index.html` contains the meta tag with `https://crux-api.onrender.com` and vercel.json no longer mentions CRUX_API_HOST. Also `npm run test:unit -- --run cspPlugin` PASS. Update `docs/deploy/RUNBOOK.md` step 6: replace the "commit the real host into vercel.json" instruction with "CSP is injected at build time from VITE_API_BASE_URL - no commit needed; just verify the meta tag in the deployed page source".
- [ ] **Step 5: Run FE suite + lint.** Expected: PASS.
- [ ] **Step 6: Commit** — `git commit -am "fix(deploy): build-time CSP meta from VITE_API_BASE_URL, drop placeholder (P3 I-06)"`

### Task E5: docker-compose.prod.yml sets ENV=prod (I-07)

**Files:**
- Modify: `docker-compose.prod.yml` (backend environment block ~line 28), `docker-compose.yml` (backend environment block ~line 25)

- [ ] **Step 1: Implement.** `docker-compose.prod.yml` backend environment, first entry:

```yaml
    environment:
      # I-07: without this the "prod" stack boots env=dev - sqlite guard,
      # SUPABASE_URL boot check, and prod logging behavior all inert.
      ENV: prod
      GEMINI_API_KEY: ${GEMINI_API_KEY}
```

`docker-compose.yml` backend environment, first entry: `ENV: dev` (explicit symmetry).

- [ ] **Step 2: Verify** — `docker compose -f docker-compose.prod.yml config | Select-String "ENV"` shows `ENV: prod`; plain `docker compose config` shows `ENV: dev`. Backend suite unaffected (config change only).
- [ ] **Step 3: Commit** — `git commit -am "fix(deploy): compose prod stack sets ENV=prod (P3 I-07)"`

### Task E6: Contract documentation sweep (I-08, I-09 YAML, I-11)

**Files:**
- Modify: `docs/api/openapi.yaml`
- Regenerate: `backend/contracts/` via codegen
- Test: CI drift check locally

- [ ] **Step 1: x-sse-events additions (I-08).** Append to the `x-sse-events` block (after `error`, line ~1568), shapes matching `handleCheckQuestion({gap, items, total})` and the followup_skipped consumer:

```yaml
  check_question:
    data:
      type: object
      required: [gap, total, items]
      properties:
        gap:   { type: string }
        total: { type: integer }
        items:
          type: array
          items:
            type: object
            required: [question, options]
            properties:
              question: { type: string }
              options:
                type: array
                items: { type: string }

  followup_skipped:
    data:
      type: object
      required: [reason]
      properties:
        reason: { type: string, enum: [daily_cap] }
```

- [ ] **Step 2: Upload 415 (I-09).** In the `/api/upload` responses (line ~458), after `"429"`:

```yaml
        "415":
          description: File content does not match its extension (code CONTENT_TYPE_MISMATCH).
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
```

- [ ] **Step 3: 401/503/422 (I-11).** In `components/responses`: replace the orphaned `UpstreamUnavailable` with (description-only responses — the live 401/503 bodies are FastAPI string-detail shapes, not ErrorResponse; do not promise a schema they don't have):

```yaml
    Unauthorized:
      description: Missing, invalid, or expired bearer token.
    ServiceUnavailable:
      description: Upstream dependency unavailable (auth JWKS outage or LLM provider).
    UnprocessableEntity:
      description: Request failed validation (malformed body, or empty/invalid profile patch).
```

Then: add to EVERY path operation's responses `"401": { $ref: "#/components/responses/Unauthorized" }` and `"503": { $ref: "#/components/responses/ServiceUnavailable" }` (every endpoint requires Bearer auth; JWKS outage can 503 any of them) — except `/health` (public). Add `"422": { $ref: "#/components/responses/UnprocessableEntity" }` to the profile PATCH (line ~549) alongside 404/412/428. Remove the now-unused `UpstreamUnavailable` definition; `rg UpstreamUnavailable docs backend` must return nothing.

- [ ] **Step 4: Regenerate + drift check** — from repo root: `backend/.venv/Scripts/python backend/scripts/gen_contracts.py` then `git diff --stat backend/contracts/` (description-only responses should produce no model changes; if models.py changes, inspect — a schema drifted). Run `python -m pytest` (backend) for contract-import safety.
- [ ] **Step 5: Commit** — `git commit -am "docs(api): SSE check_question/followup_skipped shapes, 415/401/503/422 responses (P3 I-08, I-09, I-11)"`

### Task E7: FE error surfacing polish — upload 415 message + composer limit + optimistic bubble (I-09 FE, I-10)

**Files:**
- Modify: `frontend/src/views/SessionView.vue:463-467` (`onAttachFile` catch)
- Modify: `frontend/src/components/chat/Composer.vue:114` (`MAX_DRAFT_LEN`)
- Modify: `frontend/src/stores/session.js` (`sendMessageStreaming` catch)
- Test: session view + composer + store tests (append)

Note: the review's "no composer maxlength" claim is stale — `Composer.vue` already has `:maxlength="MAX_DRAFT_LEN"` (2000) + a counter. The remaining real gaps: the limit disagrees with the contract's 4000, and a rejected send strands the optimistic bubble.

- [ ] **Step 1: Failing tests:**

```js
// composer.test.js
it('caps the draft at the contract limit 4000', () => {
  const wrapper = mountComposer({ modelValue: '' })
  expect(wrapper.get('[data-testid="session-input"]').attributes('maxlength')).toBe('4000')
})

// sessionStore.test.js
it('pops the optimistic user bubble on pre-stream HTTP failure', async () => {
  const store = useSessionStore()
  // seed currentSessionId per this file's existing send tests
  streamSvc.streamChat.mockRejectedValue(new ApiErrorLike(422, { detail: 'too long' }))
  await store.sendMessageStreaming({ text: 'hi' }).catch(() => {})
  expect(store.messages.filter((m) => m.role === 'user' && m.content === 'hi')).toHaveLength(0)
})

// sessionView test
it('upload failure surfaces the backend detail message when present', async () => {
  // reject uploadDocument with ApiError(415, { detail: { code: 'CONTENT_TYPE_MISMATCH',
  //   message: 'file content does not match its extension' } })
  expect(wrapper.text()).toContain('file content does not match its extension')
})
```

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement.** `Composer.vue:114`: `const MAX_DRAFT_LEN = 4000` with comment `// I-10: matches ChatRequest.message maxLength in the API contract.`

`SessionView.vue` `onAttachFile` catch:

```js
  } catch (e) {
    // I-09: the 415 (and friends) carry an actionable server message -
    // prefer it over the generic friendlyError copy.
    const serverMsg = e?.body?.detail?.message
    uploadStatus.value = {
      kind: 'failed',
      text: `Upload failed: ${serverMsg || friendlyError(e)}`,
    }
  } finally {
```

`session.js` `sendMessageStreaming`: add `let sawAnyEvent = false` beside the existing `sawTerminal` flag and set it `true` at the top of the `onEvent` callback (same edit shape as Task C8). In the final catch, after the AbortError arm and before the 429/`_applyCapError` line:

```js
      if (!sawAnyEvent && typeof e?.status === 'number' && e.status >= 400) {
        // I-10: the server persisted nothing pre-stream - drop the
        // optimistic bubble instead of stranding it in the transcript.
        const last = messages.value[messages.value.length - 1]
        if (last?.role === 'user' && last.message_id === undefined) messages.value.pop()
      }
```

- [ ] **Step 4: Run + suite.** Expected: PASS (fix any composer tests asserting 2000).
- [ ] **Step 5: Commit** — `git commit -am "fix(fe): contract-aligned composer cap, upload 415 message, pop stranded bubble (P3 I-09, I-10)"`

### Task E8: U-05 investigation — transient boot toast (timeboxed)

**Files:**
- Modify: `docs/review/2026-07-18-final-adversarial-review.md` (append a U-05 resolution note)

- [ ] **Step 1: Timebox 45 minutes.** Reproduce attempts: cold-load the app (docker stack) with DevTools open — throttled network, expired refresh token in localStorage, backend briefly down at load. Watch for any `errorBus` toast. Audit boot-path API calls for non-silent errors: `rg "reportApiError|silent" frontend/src/services frontend/src/stores` — list every call that can fire during mount before user interaction (user hydrate, session list, usage summary) and check each catch path.
- [ ] **Step 2: Outcome.** If a cause is found: file it as a follow-up fix in this batch (small) or a new finding (large). If not: append to the review doc's U-05 entry: `Resolution (2026-XX-XX): not reproduced in <n> cold loads across throttled/expired-token/backend-down conditions; boot-path non-silent calls audited (<list>); closed as unreproducible.`
- [ ] **Step 3: Commit** — `git commit -am "docs(review): U-05 investigation outcome (P3 U-05)"`

### Batch E close-out

- [ ] Backend suite + FE suite + lint + contracts drift all green; stash-verify E1 + E3 regression tests.
- [ ] Push, PR to `dev` listing I-03..I-11 + U-05. PR body notes: RUNBOOK step 6 rewritten (E4); live Vercel/Render verification of the meta CSP + X-Cost-Warning owed at deploy resume.
- [ ] CI green, merge. All five batches done -> update memory + review doc status.

