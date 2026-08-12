# Defer Render Worker: In-Process Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the ingestion poll loop as a daemon thread inside the FastAPI web service (flag-gated, default ON) and remove the dedicated worker service from all deploy configs, eliminating the only paid Render line item for beta.

**Architecture:** `backend/worker.py::main_loop` gains optional `stop_event` support (threading.Event) so it can shut down promptly; `backend/main.py` starts it in a daemon thread from the lifespan when `settings.ingest_in_process` is true. Queue semantics (`documents` row, atomic claim, idempotent re-runs, `recover_stuck`) are untouched. `python -m worker` keeps working unchanged for future scale-out.

**Tech Stack:** FastAPI lifespan, `threading` stdlib, pydantic-settings, pytest, YAML deploy configs.

**Spec:** `docs/superpowers/specs/2026-08-12-defer-render-worker-design.md` (approved, committed on this branch).

## Global Constraints

- Branch: `feat/defer-render-worker` (already created; spec committed).
- Env flag name: `INGEST_IN_PROCESS`, settings field `ingest_in_process: bool = True` (default ON).
- No changes to ingestion logic, queue schema, or claim semantics in `worker.py` beyond stop-event plumbing.
- No emojis in code or comments.
- All backend commands run from `backend/`; tests with `pytest`.
- Existing tests in `backend/tests/test_worker.py` must keep passing UNMODIFIED (they monkeypatch `worker.time.sleep` — the no-event code path must still use `time.sleep`).

---

### Task 1: `worker.py` stop-event support

**Files:**
- Modify: `backend/worker.py:71-99` (`main_loop`)
- Test: `backend/tests/test_worker.py` (append two tests; do not modify existing ones)

**Interfaces:**
- Produces: `main_loop(max_iterations: int | None = None, stop_event: threading.Event | None = None) -> None`. When `stop_event` is set the loop exits before the next claim; idle waiting uses `stop_event.wait(POLL_INTERVAL_S)` instead of `time.sleep`. When `stop_event is None`, behavior is byte-for-byte today's (Task 2 depends on this signature).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_worker.py` (existing helpers `_seed_doc`, fixtures `db_session`/`monkeypatch`, and the `sessionmaker` monkeypatch pattern are already in this file — follow `test_main_loop_processes_then_exits` as the model):

```python
def test_main_loop_exits_when_stop_event_already_set(db_session, monkeypatch):
    """A stop_event set before entry must exit the loop without claiming
    anything, even with max_iterations=None (the in-process mode)."""
    import threading

    from sqlalchemy.orm import sessionmaker

    d = _seed_doc(db_session, status="pending")
    test_engine = db_session.get_bind()
    monkeypatch.setattr(
        "worker.SessionLocal",
        sessionmaker(autocommit=False, autoflush=False, bind=test_engine),
    )
    ev = threading.Event()
    ev.set()
    worker.main_loop(stop_event=ev)  # must return, not hang
    db_session.expire_all()
    assert db_session.get(Document, d.id).status == "pending"


def test_main_loop_idle_wait_uses_stop_event_not_sleep(db_session, monkeypatch):
    """With a stop_event provided, idle waiting must go through
    stop_event.wait(POLL_INTERVAL_S) so shutdown interrupts the wait.
    time.sleep must not be touched on this path."""
    from sqlalchemy.orm import sessionmaker

    test_engine = db_session.get_bind()
    monkeypatch.setattr(
        "worker.SessionLocal",
        sessionmaker(autocommit=False, autoflush=False, bind=test_engine),
    )

    def _boom(_s):
        raise AssertionError("time.sleep must not be used when stop_event given")

    monkeypatch.setattr("worker.time", type("T", (), {"sleep": staticmethod(_boom)}))

    class _SelfStoppingEvent:
        def __init__(self):
            self.waits = 0
            self._set = False

        def is_set(self):
            return self._set

        def wait(self, timeout=None):
            assert timeout == worker.POLL_INTERVAL_S
            self.waits += 1
            self._set = True

    ev = _SelfStoppingEvent()
    worker.main_loop(stop_event=ev)  # empty queue: one wait, then exits
    assert ev.waits == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_worker.py -v`
Expected: the two new tests FAIL (`TypeError: main_loop() got an unexpected keyword argument 'stop_event'`); the four existing tests PASS.

- [ ] **Step 3: Implement stop-event plumbing**

In `backend/worker.py`, replace `main_loop` (keep everything above it unchanged):

```python
def main_loop(max_iterations: int | None = None, stop_event=None) -> None:
    """stop_event (threading.Event, optional): set to request a prompt
    exit. Used by the in-process mode (main.py lifespan); worker mode
    (python -m worker) passes nothing and keeps the plain sleep path."""
    iterations = 0
    boot_db = SessionLocal()
    try:
        n = recover_stuck(boot_db)
        if n:
            log.info("recovered %s stuck documents on boot", n)
    finally:
        boot_db.close()
    while max_iterations is None or iterations < max_iterations:
        if stop_event is not None and stop_event.is_set():
            break
        iterations += 1
        if iterations % RECOVER_EVERY_ITERATIONS == 0:
            recover_db = SessionLocal()
            try:
                n = recover_stuck(recover_db)
                if n:
                    log.info("recovered %s stuck documents mid-run", n)
            finally:
                recover_db.close()
        db = SessionLocal()
        try:
            doc_id = claim_next(db)
        finally:
            db.close()
        if doc_id is None:
            if stop_event is not None:
                stop_event.wait(POLL_INTERVAL_S)
            else:
                time.sleep(POLL_INTERVAL_S)
            continue
        log.info("worker picked up document_id=%s", doc_id)
        ingestion_service.run(doc_id)
```

- [ ] **Step 4: Run tests to verify all pass**

Run from `backend/`: `pytest tests/test_worker.py -v`
Expected: all 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/worker.py backend/tests/test_worker.py
git commit -m "feat: main_loop accepts stop_event for prompt in-process shutdown"
```

---

### Task 2: `INGEST_IN_PROCESS` flag + lifespan thread

**Files:**
- Modify: `backend/config.py` (Settings class, after `debug_timing` at line 45)
- Modify: `backend/main.py:19-26` (lifespan) + new helper above it
- Modify: `backend/tests/conftest.py` (autouse guard fixture)
- Test: Create `backend/tests/test_ingest_in_process.py`

**Interfaces:**
- Consumes: `worker.main_loop(max_iterations=None, stop_event=None)` from Task 1.
- Produces: `settings.ingest_in_process: bool` (env `INGEST_IN_PROCESS`, default `True`); `main.start_ingest_loop() -> tuple[threading.Thread | None, threading.Event | None]` — returns `(None, None)` when the flag is off, else a started daemon thread named `ingest-loop` and its stop event.

- [ ] **Step 1: Add the settings field**

In `backend/config.py`, directly under `debug_timing: bool = False` (line 45):

```python
    # 2026-08-12 worker-deferral spec: the web process drains the ingestion
    # queue itself by default. Set false only when a dedicated worker
    # service (python -m worker) is deployed alongside.
    ingest_in_process: bool = True
```

- [ ] **Step 2: Add the autouse test guard**

In `backend/tests/conftest.py`, add (near the other fixtures; import `settings` the way conftest already does, or `from config import settings` if it doesn't):

```python
@pytest.fixture(autouse=True)
def _no_ingest_thread(monkeypatch):
    """Default-ON ingest_in_process must not start a real poll thread
    inside tests that run the app lifespan. Tests that exercise
    start_ingest_loop() re-enable it explicitly."""
    from config import settings

    monkeypatch.setattr(settings, "ingest_in_process", False)
```

- [ ] **Step 3: Write the failing tests**

Create `backend/tests/test_ingest_in_process.py`:

```python
"""start_ingest_loop: flag-gated daemon thread wrapping worker.main_loop
(2026-08-12 worker-deferral spec)."""

import threading

import main as main_module
from config import settings


def test_start_ingest_loop_noop_when_flag_off(monkeypatch):
    monkeypatch.setattr(settings, "ingest_in_process", False)
    thread, ev = main_module.start_ingest_loop()
    assert thread is None and ev is None


def test_start_ingest_loop_starts_and_stops_thread(monkeypatch):
    monkeypatch.setattr(settings, "ingest_in_process", True)

    entered = threading.Event()

    def fake_main_loop(max_iterations=None, stop_event=None):
        entered.set()
        stop_event.wait(5)

    monkeypatch.setattr(main_module, "main_loop", fake_main_loop)

    thread, ev = main_module.start_ingest_loop()
    assert thread is not None and thread.daemon
    assert thread.name == "ingest-loop"
    assert entered.wait(2), "main_loop was never entered"

    ev.set()
    thread.join(timeout=2)
    assert not thread.is_alive()
```

- [ ] **Step 4: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_ingest_in_process.py -v`
Expected: FAIL with `AttributeError: module 'main' has no attribute 'start_ingest_loop'`.

- [ ] **Step 5: Implement helper + lifespan wiring**

In `backend/main.py`: add `import threading` to the stdlib imports and `from worker import main_loop` to the local imports, then above `lifespan`:

```python
def start_ingest_loop() -> tuple[threading.Thread | None, threading.Event | None]:
    """2026-08-12 worker-deferral spec: the web process drains the
    ingestion queue in a daemon thread unless a dedicated worker
    deployment disables it via INGEST_IN_PROCESS=false."""
    if not settings.ingest_in_process:
        return None, None
    stop_event = threading.Event()
    thread = threading.Thread(
        target=main_loop,
        kwargs={"stop_event": stop_event},
        daemon=True,
        name="ingest-loop",
    )
    thread.start()
    return thread, stop_event
```

Replace the lifespan body:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    assert_prod_database(settings.env, settings.database_url)
    if settings.env == "prod" and not settings.supabase_url:
        raise RuntimeError("SUPABASE_URL is required when ENV=prod")
    validate_jwks_startup()
    create_tables()
    ingest_thread, ingest_stop = start_ingest_loop()
    yield
    if ingest_stop is not None:
        ingest_stop.set()
        # Bounded join: an ingest abandoned mid-shutdown is reclaimed by
        # recover_stuck on next boot (idempotent re-run).
        ingest_thread.join(timeout=5)
```

- [ ] **Step 6: Run tests to verify they pass**

Run from `backend/`: `pytest tests/test_ingest_in_process.py tests/test_worker.py -v`
Expected: all PASS.

- [ ] **Step 7: Run the full backend suite (import-graph regression guard)**

Run from `backend/`: `pytest`
Expected: all PASS. (`main.py` now imports `worker`; the full run catches any circular-import or conftest interaction.)

- [ ] **Step 8: Commit**

```bash
git add backend/config.py backend/main.py backend/tests/conftest.py backend/tests/test_ingest_in_process.py
git commit -m "feat: run ingestion loop in-process via lifespan, gated by INGEST_IN_PROCESS"
```

---

### Task 3: Remove worker service from deploy configs, invert deploy tests

**Files:**
- Modify: `render.yaml:47-88` (delete `crux-worker` block)
- Modify: `docker-compose.yml:48-72` (delete `worker` service)
- Modify: `docker-compose.prod.yml` (delete `worker` service — same shape, find with `grep -n "worker" docker-compose.prod.yml`)
- Test: `backend/tests/test_deploy_config.py:75-89` (replace the two worker tests)

**Interfaces:**
- Consumes: nothing from other tasks (config-only).
- Produces: deploy configs with exactly two compose services (`frontend`, `backend`) and one Render service (`crux-api`).

- [ ] **Step 1: Replace the two worker tests**

In `backend/tests/test_deploy_config.py`, replace `test_compose_files_define_worker_service` (lines 75-81) and `test_render_defines_worker_service` (lines 84-89) with:

```python
def test_compose_files_do_not_define_worker_service():
    """2026-08-12 worker-deferral spec: ingestion runs in-process in the
    web service (INGEST_IN_PROCESS, default on). Re-adding a worker
    service here means the scale-out path was taken deliberately --
    revisit the flag on the web service and the spec before deleting
    this test (see docs/superpowers/specs/2026-08-12-defer-render-worker-design.md)."""
    for path in ("docker-compose.yml", "docker-compose.prod.yml"):
        cfg = _load(path)
        assert "worker" not in cfg["services"]


def test_render_does_not_define_worker_service():
    """See test_compose_files_do_not_define_worker_service."""
    cfg = _load("render.yaml")
    names = {s["name"] for s in cfg["services"]}
    assert "crux-worker" not in names
    assert {s["type"] for s in cfg["services"]} == {"web"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_deploy_config.py -v`
Expected: the two new tests FAIL (worker still present in the YAML); all others PASS.

- [ ] **Step 3: Delete the worker blocks**

- `render.yaml`: delete lines 47-88 (the whole `- type: worker` entry, `crux-worker`, through its last envVar `R2_BUCKET`). File must end after the `crux-api` envVars.
- `docker-compose.yml`: delete lines 48-72 (the whole `worker:` service: `build`, `command`, `environment`, `volumes`, `depends_on`, `healthcheck`).
- `docker-compose.prod.yml`: delete the equivalent `worker:` service block (locate with `grep -n "worker" docker-compose.prod.yml`; delete the full block, same keys as the dev one).

- [ ] **Step 4: Run tests to verify they pass**

Run from `backend/`: `pytest tests/test_deploy_config.py -v`
Expected: all PASS.

- [ ] **Step 5: Sanity-check compose parse**

From repo root: `docker compose config --quiet && docker compose -f docker-compose.prod.yml config --quiet`
Expected: exit 0, no output (or only env-var warnings). If `docker` is unavailable in the environment, skip and note it in the task report.

- [ ] **Step 6: Commit**

```bash
git add render.yaml docker-compose.yml docker-compose.prod.yml backend/tests/test_deploy_config.py
git commit -m "feat: remove dedicated worker service from deploy configs"
```

---

### Task 4: RUNBOOK note + final verification

**Files:**
- Modify: `docs/deploy/RUNBOOK.md` (add worker-deferral note; update any stale worker instructions)

**Interfaces:**
- Consumes: nothing (docs + verification only).
- Produces: RUNBOOK consistent with the two-service deploy.

- [ ] **Step 1: Find stale worker references**

From repo root: `grep -in "worker" docs/deploy/RUNBOOK.md docs/deploy/RESTORE.md`
Any instruction that says to create/deploy/verify a `crux-worker` Render service must be updated to match the note below (rewrite the instruction, do not delete surrounding steps).

- [ ] **Step 2: Add the deferral note**

In `docs/deploy/RUNBOOK.md`, in the section that describes the Render services to create (place it where a reader setting up services will see it; if no such section exists, add under the top-level deploy prerequisites):

```markdown
### Ingestion worker: deferred (2026-08-12)

There is deliberately NO `crux-worker` service. The web service drains the
ingestion queue itself in a background thread (`INGEST_IN_PROCESS`, default
on) per `docs/superpowers/specs/2026-08-12-defer-render-worker-design.md`.
This accepts the B-02 isolation revert for beta (ingestion CPU and memory
share the web instance).

Scale-out restore (real users / ingestion latency complaints / chat stutter
correlated with uploads):
1. Restore the `crux-worker` block in `render.yaml` and the `worker` service
   in both compose files from git history.
2. Set `INGEST_IN_PROCESS=false` on the crux-api web service.
3. Re-invert the two worker tests in `backend/tests/test_deploy_config.py`.
```

- [ ] **Step 3: Full backend suite, one last time**

Run from `backend/`: `pytest`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/deploy/RUNBOOK.md
git commit -m "docs: RUNBOOK note for deferred ingestion worker"
```

---

## Not in this plan

- Frontend changes: none (ingestion status UI already polls document status; source of ingestion is invisible to it).
- No new paid smoke; live verification folds into the already-owed deploy smokes.
- Worker heartbeat/auto-detection, queue-depth alerting: rejected/deferred per spec.
