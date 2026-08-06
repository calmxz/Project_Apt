# Launch-Gating Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every deployment-checklist item blocking a closed-beta launch (spec: `docs/superpowers/specs/2026-08-06-launch-gating-remediation-design.md`), flipping the 2026-08-06 QA audit verdict from NOT READY to READY-for-closed-beta.

**Architecture:** Five sequential PRs to `dev`: (1) CI/test foundations, (2) cost guards, (3) production logging, (4) ingestion moved to a DB-queue-backed worker process, (5) accessibility + nginx blockers. The worker uses the `documents` row as the job record claimed via `FOR UPDATE SKIP LOCKED`; embedding is restructured to per-batch embed-insert-meter-commit so memory and DB-connection hold time stop scaling with document size.

**Tech Stack:** FastAPI + SQLAlchemy (sync) + Alembic + pgvector on Supabase Postgres; LiteLLM embeddings; Vue 3 + Vitest; GitHub Actions; Docker Compose + Render.

## Global Constraints

- Spec is `docs/superpowers/specs/2026-08-06-launch-gating-remediation-design.md`; audit findings are in `docs/reviews/2026-08-06-qa-audit/` (IDs like B-01, F-03, Q-01 refer to that audit).
- **Naming collision warning:** "B-01" inside `backend/services/ingestion_service.py` comments refers to an old internal finding (deferred-metering lock rationale), NOT audit B-01.
- No emojis in code or comments. No secrets committed. Never read `.env` — if a value is needed, ask the user to paste the specific line.
- API contract discipline: edit `docs/api/openapi.yaml` FIRST, then run `python backend/scripts/gen_contracts.py` from repo root, commit both. Never hand-edit `backend/contracts/`.
- Any new/changed file under `backend/db/alembic/versions/` MUST be reviewed by the `migration-reviewer` agent before commit.
- TDD: write the failing test first for every behavior change.
- Backend tests: run `pytest` from `backend/`. Frontend tests: run `npm run test:unit -- --run` from `frontend/`. Frontend lint: `npm run lint` from `frontend/`.
- Use the native Grep tool for repo sweeps (rtk-rg has a false-zero gotcha).
- The Read/Write/Edit hook hard-blocks when cwd is a subdirectory — keep the shell cwd at repo root; run directory-scoped commands with explicit paths or `working-directory`-style flags, and `cd` back to repo root immediately if a step requires entering a subdirectory.
- Each PR gets its own branch off `dev` (names given per PR below); merge order is PR-1 → PR-5. Open PRs with `gh pr create --base dev`.
- Key defaults fixed by the spec: `MAX_CHUNKS` default **5000** (env `MAX_CHUNKS`); global ceiling env `GLOBAL_DAILY_COST_CAP_USD`, **unset = disabled**; worker start command `python -m worker`; new document status string `processing`.
- Windows PowerShell 5.1 is the shell: no `&&` chaining; use `;` or separate commands.

---

# PR-1 — Foundations (Q-01 hermetic tests, Q-02 lint gate, Q-05 CI on dev)

**Branch:** `fix/lg-pr1-foundations` (create off up-to-date `dev`: `git checkout dev; git pull; git checkout -b fix/lg-pr1-foundations`)

### Task 1: Hermetic backend test suite (Q-01)

The suite currently loads the developer's real `.env` because `backend/config.py:12-17` gives `Settings` an absolute `env_file` path resolved from the module location, and `backend/tests/conftest.py` imports `main` (hence `config`) at collection time. With a real `.env` present (`LLM_SOFT_CAP_USD=0.20`, `LLM_HARD_CAP_USD=0.30`), three tests fail: `tests/test_cost_meter.py:21`, `tests/test_cost_meter.py:44`, `tests/test_usage_route.py:22`.

**Files:**
- Modify: `backend/config.py:12-17`
- Modify: `backend/tests/conftest.py:1` (very top of file)
- Test: `backend/tests/test_hermetic_settings.py` (new)

**Interfaces:**
- Produces: env var contract `CRUX_SKIP_DOTENV=1` disables `.env` loading in `Settings`. Every later task's tests rely on this being active under pytest.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_hermetic_settings.py`:

```python
"""Q-01: the test suite must never load the developer's real .env."""

import os

from config import Settings, settings


def test_dotenv_disabled_under_pytest():
    assert os.environ.get("CRUX_SKIP_DOTENV") == "1"
    assert Settings.model_config.get("env_file") is None


def test_cap_settings_are_code_defaults():
    assert settings.llm_soft_cap_usd == 2.00
    assert settings.llm_hard_cap_usd == 3.00
```

- [ ] **Step 2: Run it to verify it fails**

Run from `backend/`: `pytest tests/test_hermetic_settings.py -v`
Expected: FAIL — `CRUX_SKIP_DOTENV` is not set and `env_file` is the repo-root `.env` path. (On a machine whose `.env` overrides caps, the second test also fails.)

- [ ] **Step 3: Implement**

In `backend/config.py`, replace the `model_config` block (lines 12-17):

```python
import os

_ENV_FILE = (
    None
    if os.environ.get("CRUX_SKIP_DOTENV") == "1"
    else str(_REPO_ROOT / ".env")
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )
```

(`import os` goes at the top of the file with the other imports.)

In `backend/tests/conftest.py`, add as the VERY FIRST executable lines, before any other import:

```python
import os

# Q-01: must run before anything imports `config`, or the real .env loads
# into the test process. Do not move below the imports.
os.environ["CRUX_SKIP_DOTENV"] = "1"
```

- [ ] **Step 4: Run the new test, then the full backend suite**

Run from `backend/`: `pytest tests/test_hermetic_settings.py -v` → PASS.
Then `pytest` (full suite). Expected: all green **including** `test_cost_meter.py` and `test_usage_route.py` even though the real `.env` sits in the repo root. If anything fails, stop and report.

- [ ] **Step 5: Commit**

```bash
git add backend/config.py backend/tests/conftest.py backend/tests/test_hermetic_settings.py
git commit -m "fix(tests): make backend suite hermetic - never load real .env (Q-01)"
```

### Task 2: Lint gate must be able to fail (Q-02)

CI runs `npm run lint` (`.github/workflows/ci.yml:74-75`), but both linters carry `--fix` (`frontend/package.json:15-16`), so the gate silently rewrites files in the runner and exits 0. Fix the scripts; keep autofix ergonomics under a separate name.

**Files:**
- Modify: `frontend/package.json:14-17`

**Interfaces:**
- Produces: `npm run lint` = check-only (CI gate); `npm run fix` = local autofix.

- [ ] **Step 1: Size the backlog before switching**

Run from `frontend/`: `npx oxlint .` then `npx eslint . --cache`
Expected: both exit 0 (autofix has been running everywhere). If violations appear, fix them now (apply `npx eslint . --fix --cache; npx oxlint . --fix`, re-run check-only, manually fix anything remaining) and include those fixes in this commit.

- [ ] **Step 2: Edit the scripts**

In `frontend/package.json`, replace lines 14-17:

```json
    "lint": "run-s lint:*",
    "lint:oxlint": "oxlint .",
    "lint:eslint": "eslint . --cache",
    "fix": "run-s fix:*",
    "fix:oxlint": "oxlint . --fix",
    "fix:eslint": "eslint . --fix --cache",
    "format": "prettier --write --experimental-cli src/",
```

Note: fix scripts are named `fix:*`, not `lint:fix`, because `run-s lint:*` glob-matches every `lint:`-prefixed script and would recurse.

- [ ] **Step 3: Verify the gate can fail**

From `frontend/`: append `const unused = 1` to any `src/` file temporarily, run `npm run lint` → expect non-zero exit. Revert the temp edit (`git checkout -- <file>`), run `npm run lint` → exit 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json
git commit -m "fix(ci): lint gate runs check-only; autofix moves to npm run fix (Q-02)"
```

### Task 3: CI runs on pushes to dev (Q-05)

**Files:**
- Modify: `.github/workflows/ci.yml:3-10`
- Modify: `.github/workflows/e2e.yml:3-16`

- [ ] **Step 1: Edit ci.yml trigger**

Replace `.github/workflows/ci.yml` lines 3-10 with:

```yaml
on:
  push:
    branches: [main, dev]
  pull_request:

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' && github.ref != 'refs/heads/dev' }}
```

- [ ] **Step 2: Edit e2e.yml trigger**

In `.github/workflows/e2e.yml`, change the `push.branches` list (line 11) to `[main, dev]`, and add `- 'docker-compose.prod.yml'` to the `paths:` list (after the existing `docker-compose.yml` entry).

- [ ] **Step 3: Validate YAML**

Run from repo root: `python -c "import yaml,sys; [yaml.safe_load(open(f)) for f in ['.github/workflows/ci.yml','.github/workflows/e2e.yml']]; print('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/e2e.yml
git commit -m "ci: run CI and e2e on pushes to dev (Q-05)"
```

### Task 4: Open PR-1

- [ ] Push and open the PR:

```bash
git push -u origin fix/lg-pr1-foundations
gh pr create --base dev --title "fix: CI/test foundations - hermetic tests, real lint gate, CI on dev (Q-01/Q-02/Q-05)" --body "Closes audit findings Q-01, Q-02, Q-05 per docs/superpowers/specs/2026-08-06-launch-gating-remediation-design.md (PR-1 of 5)."
```

- [ ] Watch CI: `gh pr checks --watch`. All green before starting PR-2. Merge per user's usual flow (do not merge without user's go-ahead if branch protection questions arise).

---

# PR-2 — Money (B-01 cap in ingestion, F-03 chunk cap, B-04 global ceiling)

**Branch:** `feat/lg-pr2-cost-guards` off `dev` (after PR-1 merges: `git checkout dev; git pull; git checkout -b feat/lg-pr2-cost-guards`)

### Task 5: New settings + error codes

**Files:**
- Modify: `backend/config.py` (Settings fields, near `llm_hard_cap_usd` at :51)
- Modify: `backend/lib/error_codes.py`
- Modify: `frontend/src/lib/errorCodes.js` (kept in sync per `error_codes.py:1-6` docstring)
- Modify: `.env.example`
- Test: `backend/tests/test_hermetic_settings.py` (extend), `frontend/src/__tests__/` (existing errorCodes spec if present — check with Grep for `errorCodes` under `frontend/src/__tests__/`)

**Interfaces:**
- Produces: `settings.max_chunks: int = 5000`, `settings.global_daily_cost_cap_usd: float | None = None`; error-code constants `GLOBAL_COST_CAP_REACHED = "global_cost_cap_reached"`, `CHUNK_LIMIT_EXCEEDED = "chunk_limit_exceeded"`. Tasks 6-11 consume all four.

- [ ] **Step 1: Write failing test** — extend `backend/tests/test_hermetic_settings.py`:

```python
def test_cost_guard_defaults():
    assert settings.max_chunks == 5000
    assert settings.global_daily_cost_cap_usd is None
```

Run from `backend/`: `pytest tests/test_hermetic_settings.py -v` → FAIL (attributes missing).

- [ ] **Step 2: Implement**

In `backend/config.py` `Settings`, after `llm_hard_cap_usd` (line 51), add:

```python
    max_chunks: int = 5000
    global_daily_cost_cap_usd: float | None = None
```

In `backend/lib/error_codes.py`, after `DAILY_COST_CAP_REACHED` (line 9), add:

```python
GLOBAL_COST_CAP_REACHED = "global_cost_cap_reached"
CHUNK_LIMIT_EXCEEDED = "chunk_limit_exceeded"
```

In `frontend/src/lib/errorCodes.js`, add matching entries following the file's existing structure (read the file first; mirror how `daily_cost_cap_reached` is mapped), with copy:
- `global_cost_cap_reached`: "The service has reached its daily budget. Please try again tomorrow."
- `chunk_limit_exceeded`: "This document is too large to ingest. Try splitting it into smaller files."

In `.env.example`, add under the cost section:

```
# Optional service-wide daily spend ceiling in USD. Unset = disabled.
# GLOBAL_DAILY_COST_CAP_USD=10.00
# Max chunks a single document may produce (default 5000).
# MAX_CHUNKS=5000
```

- [ ] **Step 3: Run tests** — from `backend/`: `pytest tests/test_hermetic_settings.py -v` → PASS. From `frontend/`: `npm run test:unit -- --run` → green (fix the errorCodes spec if it asserts an exhaustive map).

- [ ] **Step 4: Commit**

```bash
git add backend/config.py backend/lib/error_codes.py frontend/src/lib/errorCodes.js .env.example backend/tests/test_hermetic_settings.py
git commit -m "feat(cost): settings + error codes for chunk cap and global ceiling"
```

### Task 6: cost_meter cap-guard helpers

**Files:**
- Modify: `backend/services/cost_meter.py` (add after `check_cap` at :183)
- Test: `backend/tests/test_cost_guard.py` (new)

**Interfaces:**
- Consumes: `check_cap(db, user_id) -> CapStatus` (`cost_meter.py:183`), `DailyCostLedger` model (`db/models.py:165-173`), `_today_utc()` (`cost_meter.py:30`), `settings.global_daily_cost_cap_usd` (Task 5).
- Produces: `class CostCapExceeded(Exception)` with `.code: str` and `.cap: CapStatus | None`; `global_spend(db) -> Decimal`; `assert_within_caps(db, user_id: str) -> None` (raises `CostCapExceeded`). Tasks 7, 8, 11 consume these.

- [ ] **Step 1: Write failing tests** — create `backend/tests/test_cost_guard.py`:

```python
from decimal import Decimal

import pytest

from db.models import User
from lib.error_codes import DAILY_COST_CAP_REACHED, GLOBAL_COST_CAP_REACHED
from services import cost_meter

USER = "u_guard"


@pytest.fixture
def seeded(db_session):
    db_session.add(User(id=USER))
    db_session.commit()


def test_global_spend_sums_todays_ledger(db_session, seeded):
    assert cost_meter.global_spend(db_session) == Decimal("0.0000")
    cost_meter.record_cost(db_session, USER, Decimal("0.5000"))
    db_session.commit()
    assert cost_meter.global_spend(db_session) == Decimal("0.5000")


def test_assert_within_caps_passes_under_caps(db_session, seeded):
    cost_meter.assert_within_caps(db_session, USER)  # no raise


def test_assert_within_caps_raises_on_user_hard_cap(db_session, seeded, monkeypatch):
    monkeypatch.setattr("services.cost_meter.settings.llm_hard_cap_usd", 0.10)
    cost_meter.record_cost(db_session, USER, Decimal("0.2000"))
    db_session.commit()
    with pytest.raises(cost_meter.CostCapExceeded) as exc:
        cost_meter.assert_within_caps(db_session, USER)
    assert exc.value.code == DAILY_COST_CAP_REACHED


def test_assert_within_caps_raises_on_global_ceiling(db_session, seeded, monkeypatch):
    monkeypatch.setattr(
        "services.cost_meter.settings.global_daily_cost_cap_usd", 0.10
    )
    cost_meter.record_cost(db_session, USER, Decimal("0.2000"))
    db_session.commit()
    with pytest.raises(cost_meter.CostCapExceeded) as exc:
        cost_meter.assert_within_caps(db_session, USER)
    assert exc.value.code == GLOBAL_COST_CAP_REACHED


def test_global_ceiling_disabled_when_unset(db_session, seeded):
    cost_meter.record_cost(db_session, USER, Decimal("1.0000"))
    db_session.commit()
    cost_meter.assert_within_caps(db_session, USER)  # no raise
```

Note: the global-ceiling test sets the ceiling below the user hard cap AND spend below the user hard cap would not trip — order the assertions so the per-user check passes (spend 0.20 < hard 3.00) while the global ceiling (0.10) trips. That is what the code above does.

- [ ] **Step 2: Run** — from `backend/`: `pytest tests/test_cost_guard.py -v` → FAIL (`CostCapExceeded` missing).

- [ ] **Step 3: Implement** — in `backend/services/cost_meter.py` after `check_cap` (:183-184), add:

```python
class CostCapExceeded(Exception):
    """Raised by assert_within_caps when a spend cap blocks the operation."""

    def __init__(self, code: str, cap: CapStatus | None = None):
        self.code = code
        self.cap = cap
        super().__init__(code)


def global_spend(db: Session) -> Decimal:
    """Total spend across ALL users for today (UTC)."""
    total = db.execute(
        select(func.coalesce(func.sum(DailyCostLedger.cost_usd), 0)).where(
            DailyCostLedger.date_utc == _today_utc()
        )
    ).scalar_one()
    return _quantize(Decimal(str(total)))


def assert_within_caps(db: Session, user_id: str) -> None:
    """Raise CostCapExceeded if the per-user hard cap or the optional
    global daily ceiling blocks further paid calls."""
    cap = check_cap(db, user_id)
    if not cap.allowed:
        raise CostCapExceeded(DAILY_COST_CAP_REACHED, cap)
    ceiling = settings.global_daily_cost_cap_usd
    if ceiling is not None and global_spend(db) >= Decimal(str(ceiling)):
        raise CostCapExceeded(GLOBAL_COST_CAP_REACHED, cap)
```

Add the needed imports at the top of `cost_meter.py` if absent: `from sqlalchemy import func, select`, `from lib.error_codes import DAILY_COST_CAP_REACHED, GLOBAL_COST_CAP_REACHED` (check existing imports first — the file already imports some of these).

- [ ] **Step 4: Run** — `pytest tests/test_cost_guard.py tests/test_cost_meter.py tests/test_cost_cap.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/cost_meter.py backend/tests/test_cost_guard.py
git commit -m "feat(cost): CostCapExceeded + global_spend + assert_within_caps (B-04)"
```

### Task 7: Upload route consults the caps (audit B-01, route half)

**Files:**
- Modify: `backend/routes/upload.py` (handler at :62-178; insert the gate after the session-ownership check, BEFORE `rate_limit.check_and_increment`)
- Test: `backend/tests/test_upload_route.py` (extend)

**Interfaces:**
- Consumes: `cost_meter.assert_within_caps`, `cost_meter.CostCapExceeded` (Task 6), `cost_meter.midnight_utc_iso()` (`cost_meter.py:34`).
- Produces: `POST /api/upload` → 429 `{"detail": {"code": "daily_cost_cap_reached" | "global_cost_cap_reached", "resets_at": ...}}` when capped. Mirrors the chat envelope at `routes/chat.py:141-153`.

- [ ] **Step 1: Failing test** — add to `backend/tests/test_upload_route.py` (reuse the file's `seeded` fixture, `SESSION_ID`, `USER_ID` constants at :16-32):

```python
def test_upload_rejected_when_cost_capped(client, db_session, seeded, monkeypatch):
    monkeypatch.setattr("services.cost_meter.settings.llm_hard_cap_usd", 0.10)
    from decimal import Decimal

    from services import cost_meter

    cost_meter.record_cost(db_session, USER_ID, Decimal("0.2000"))
    db_session.commit()
    files = {"file": ("notes.txt", b"hello", "text/plain")}
    r = client.post(
        "/api/upload",
        data={"user_id": USER_ID, "session_id": SESSION_ID},
        files=files,
    )
    assert r.status_code == 429
    assert r.json()["detail"]["code"] == "daily_cost_cap_reached"
    assert "resets_at" in r.json()["detail"]
```

Run from `backend/`: `pytest tests/test_upload_route.py -v` → new test FAILS (202).

- [ ] **Step 2: Implement** — in `backend/routes/upload.py`, directly after the session-ownership 404 check and before the `rate_limit.check_and_increment` call (between :~95 and :~105 — locate the rate-limit call with Grep for `check_and_increment` in the file):

```python
    try:
        cost_meter.assert_within_caps(db, user_id)
    except cost_meter.CostCapExceeded as e:
        raise HTTPException(
            status_code=429,
            detail={
                "code": e.code,
                "resets_at": cost_meter.midnight_utc_iso(),
            },
        ) from e
```

`cost_meter` is already imported in the module (used at :169-171).

- [ ] **Step 3: Run** — `pytest tests/test_upload_route.py -v` → PASS (all, not just the new one).

- [ ] **Step 4: Commit**

```bash
git add backend/routes/upload.py backend/tests/test_upload_route.py
git commit -m "feat(cost): upload route consults per-user and global caps (B-01)"
```

### Task 8: Chat consults the global ceiling

**Files:**
- Modify: `backend/routes/chat.py` (`_prepare_turn`, after the existing per-user check at :137-153)
- Test: `backend/tests/test_cost_cap.py` (extend)

**Interfaces:**
- Consumes: `cost_meter.global_spend`, `settings.global_daily_cost_cap_usd`, `GLOBAL_COST_CAP_REACHED`.

- [ ] **Step 1: Failing test** — add to `backend/tests/test_cost_cap.py`, following that file's existing chat-request pattern (read the file's existing capped-chat test at :76-96 first and copy its request mechanics):

```python
def test_chat_rejected_when_global_ceiling_hit(client, db_session, monkeypatch):
    # Per-user caps stay at defaults (pass); global ceiling trips.
    monkeypatch.setattr(
        "services.cost_meter.settings.global_daily_cost_cap_usd", 0.10
    )
    # ...seed user+session and record Decimal("0.2000") spend exactly as the
    # neighboring cap tests do, then POST the same chat request they POST...
    # assert status_code == 429 and detail["code"] == "global_cost_cap_reached"
```

Write the full test by mirroring the neighboring test's setup verbatim (session seeding + endpoint + payload), changing only the monkeypatch target and the asserted code. Run → FAIL.

- [ ] **Step 2: Implement** — in `backend/routes/chat.py` `_prepare_turn`, immediately after the existing `if not cost_status.allowed: raise HTTPException(...)` block (:141-153), add:

```python
    if settings.global_daily_cost_cap_usd is not None:
        if cost_meter.global_spend(db) >= Decimal(
            str(settings.global_daily_cost_cap_usd)
        ):
            raise HTTPException(
                status_code=429,
                detail={
                    "code": GLOBAL_COST_CAP_REACHED,
                    "resets_at": cost_meter.midnight_utc_iso(),
                },
            )
```

Import `GLOBAL_COST_CAP_REACHED` alongside the file's existing `DAILY_COST_CAP_REACHED` import; `settings` and `Decimal` are already imported (verify with Grep, add if missing).

- [ ] **Step 3: Run** — `pytest tests/test_cost_cap.py -v` → PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/routes/chat.py backend/tests/test_cost_cap.py
git commit -m "feat(cost): chat turn consults global daily ceiling (B-04)"
```

### Task 9: Plaintext upload pre-estimate rejects oversized documents (F-03, route half)

**Files:**
- Modify: `backend/routes/upload.py` (after `_read_bounded` at :124, before the Document row is created at :136)
- Test: `backend/tests/test_upload_route.py` (extend)

**Interfaces:**
- Consumes: `settings.max_chunks` (Task 5), `CHUNK_LIMIT_EXCEEDED` (Task 5).
- Produces: 413 `{"detail": {"code": "chunk_limit_exceeded", "max_chunks": 5000, "estimated_chunks": N}}` for plaintext files only. Constants `_CHARS_PER_TOKEN = 6.38`, `_CHUNK_STRIDE_TOKENS = 450` in `upload.py`.

- [ ] **Step 1: Failing test:**

```python
def test_plaintext_upload_rejected_by_chunk_estimate(client, seeded, monkeypatch):
    monkeypatch.setattr("routes.upload.settings.max_chunks", 10)
    # 10 chunks * 450 tokens * 6.38 chars ~= 28,710 chars; send well past it
    big = b"a" * 60_000
    files = {"file": ("notes.txt", big, "text/plain")}
    r = client.post(
        "/api/upload",
        data={"user_id": USER_ID, "session_id": SESSION_ID},
        files=files,
    )
    assert r.status_code == 413
    assert r.json()["detail"]["code"] == "chunk_limit_exceeded"


def test_pdf_upload_not_subject_to_byte_estimate(client, seeded, monkeypatch):
    monkeypatch.setattr("routes.upload.settings.max_chunks", 1)
    files = {"file": ("slides.pdf", b"%PDF-1.4 tiny", "application/pdf")}
    r = client.post(
        "/api/upload",
        data={"user_id": USER_ID, "session_id": SESSION_ID},
        files=files,
    )
    assert r.status_code == 202  # PDFs skip the estimate; worker cap catches them
```

Run → first FAILS (202), second PASSES (guard must keep it passing).

- [ ] **Step 2: Implement** — in `backend/routes/upload.py`, module constants near `MAX_UPLOAD_BYTES` (:30):

```python
# F-03: measured plaintext ratios (audit 2026-08-06, live tiktoken run)
_CHARS_PER_TOKEN = 6.38
_CHUNK_STRIDE_TOKENS = 450
_PLAINTEXT_EXTENSIONS = {".txt", ".md", ".markdown"}
```

In the handler, after `data = _read_bounded(...)` (:124) and before the magic-byte check:

```python
    if ext in _PLAINTEXT_EXTENSIONS:
        estimated_chunks = len(data) / _CHARS_PER_TOKEN / _CHUNK_STRIDE_TOKENS
        if estimated_chunks > settings.max_chunks:
            raise HTTPException(
                status_code=413,
                detail={
                    "code": CHUNK_LIMIT_EXCEEDED,
                    "max_chunks": settings.max_chunks,
                    "estimated_chunks": int(estimated_chunks),
                },
            )
```

Use the handler's existing extension variable (Grep for how the extension guard at the top of the handler names it — reuse that variable, do not re-derive). Import `CHUNK_LIMIT_EXCEEDED` from `lib.error_codes`, and `settings` from `config` if not already imported.

- [ ] **Step 3: Run** — `pytest tests/test_upload_route.py -v` → PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/routes/upload.py backend/tests/test_upload_route.py
git commit -m "feat(upload): plaintext chunk-count pre-estimate rejects with coded 413 (F-03)"
```

### Task 10: Ingestion-side hard chunk cap (F-03, enforcement half)

**Files:**
- Modify: `backend/services/ingestion_service.py` (`run`, after `chunks = chunking.chunk_text(pages)` at :201)
- Test: `backend/tests/test_ingestion_service.py` (extend)

**Interfaces:**
- Produces: documents exceeding `settings.max_chunks` fail with `doc.status == "failed"`, `doc.error == "document too large to ingest (chunk limit)"`, and zero embedding calls.

- [ ] **Step 1: Failing test** — add to `backend/tests/test_ingestion_service.py`, using its existing fixtures (`setup_doc` :21-48, `insert_capture` :51-73, `mock_embed` :97-106, `_write_blob_stub` :109-114):

```python
def test_run_fails_over_chunk_cap_before_embedding(
    db_session, monkeypatch, tmp_path, mock_embed, insert_capture
):
    doc = setup_doc_helper(db_session, monkeypatch, tmp_path)  # use the file's existing setup pattern
    monkeypatch.setattr("services.ingestion_service.settings.max_chunks", 1)
    # blob long enough to produce >1 chunk (chunk=500 tokens, stride 450)
    _write_blob_stub(
        monkeypatch, tmp_path, doc.id, doc.filename, content=b"word " * 4000
    )
    ingestion_service.run(doc.id)
    db_session.expire_all()
    refreshed = db_session.get(Document, doc.id)
    assert refreshed.status == "failed"
    assert "chunk limit" in refreshed.error
    assert mock_embed.call_count == 0  # adapt to how mock_embed exposes calls
    assert insert_capture == []  # adapt to the fixture's capture container
```

Adapt the fixture usage to the file's actual signatures (read the fixture bodies first; `setup_doc` seeds and returns the doc). Run → FAIL.

- [ ] **Step 2: Implement** — in `run()` after :201 (and after the existing empty-chunks early return at :202-205):

```python
    if len(chunks) > settings.max_chunks:
        doc.status = "failed"
        doc.error = "document too large to ingest (chunk limit)"
        db.commit()
        return
```

- [ ] **Step 3: Run** — `pytest tests/test_ingestion_service.py -v` → PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/services/ingestion_service.py backend/tests/test_ingestion_service.py
git commit -m "feat(ingestion): hard chunk cap enforced before any embedding call (F-03)"
```

### Task 11: Ingestion consults caps per embedding batch (audit B-01, spend half)

**Files:**
- Modify: `backend/services/ingestion_service.py` (`_embed_all` loop at :144-171, `run` failure arm at :234-262)
- Test: `backend/tests/test_ingestion_service.py` (extend)

**Interfaces:**
- Consumes: `cost_meter.assert_within_caps`, `cost_meter.CostCapExceeded` (Task 6).
- Produces: mid-run cap breach → `doc.status == "failed"`, `doc.error == "daily cost cap reached; ingestion stopped"`, spend for completed batches still recorded.

- [ ] **Step 1: Failing test:**

```python
def test_embed_all_stops_at_cap_between_batches(db_session, monkeypatch):
    # Arrange a user over cap; _embed_all must raise before calling litellm.
    from services import cost_meter as cm

    monkeypatch.setattr("services.cost_meter.settings.llm_hard_cap_usd", 0.10)
    db_session.add(User(id="u_capped"))
    db_session.commit()
    cm.record_cost(db_session, "u_capped", Decimal("0.2000"))
    db_session.commit()
    called = []
    monkeypatch.setattr(
        "services.ingestion_service.litellm.embedding",
        lambda **kw: called.append(1),
    )
    with pytest.raises(cm.CostCapExceeded):
        ingestion_service._embed_all(
            db_session, ["text"], user_id="u_capped", session_id="s_cap"
        )
    assert called == []
```

Plus a `run()`-level test asserting `status == "failed"` and the friendly error string when the cap trips (seed via `setup_doc`, over-cap the owner, call `run`, assert). Run → FAIL.

- [ ] **Step 2: Implement** — in `_embed_all`, at the TOP of the per-batch loop body (before the `litellm.embedding` call at :147):

```python
        if user_id is not None:
            cost_meter.assert_within_caps(db, user_id)
```

In `run()`'s failure arm, before the generic handler sets `doc.error` (the `except Exception` block at :234), add a dedicated branch (Python `except` ordering: put it before the broad one):

```python
    except cost_meter.CostCapExceeded:
        db.rollback()
        _fail_doc(db, document_id, "daily cost cap reached; ingestion stopped")
        return
```

If `run()` has no `_fail_doc` helper, inline the same re-fetch/mark-failed/commit sequence the existing failure arm uses (:258-262) — read it and mirror it, including the `cost_meter.record_cost` re-record of `embed_cost_holder` spend (:248-257), which must ALSO run in this branch (batches before the breach were paid for).

- [ ] **Step 3: Run** — `pytest tests/test_ingestion_service.py tests/test_cost_guard.py -v` → PASS. Then full suite from `backend/`: `pytest` → green.

- [ ] **Step 4: Commit**

```bash
git add backend/services/ingestion_service.py backend/tests/test_ingestion_service.py
git commit -m "feat(ingestion): per-batch cost-cap gate closes the largest spender (B-01)"
```

### Task 12: Open PR-2

- [ ] Full check: from `backend/`: `pytest`; from `frontend/`: `npm run lint`, `npm run test:unit -- --run`. All green or stop and report.
- [ ] Push + PR:

```bash
git push -u origin feat/lg-pr2-cost-guards
gh pr create --base dev --title "feat: cost guards - ingestion cap gate, chunk caps, global ceiling (B-01/F-03/B-04)" --body "PR-2 of 5 per docs/superpowers/specs/2026-08-06-launch-gating-remediation-design.md. Upload+ingestion now consult the per-user cap and optional GLOBAL_DAILY_COST_CAP_USD; documents capped at MAX_CHUNKS=5000 (plaintext pre-estimate 413 + worker-side enforcement)."
```

- [ ] `gh pr checks --watch` → green.

---

# PR-3 — Logging (G-05 dictConfig, G-06 request ids)

**Branch:** `feat/lg-pr3-logging` off updated `dev`

### Task 13: logging_config + LOG_LEVEL setting

**Files:**
- Create: `backend/lib/logging_config.py`
- Modify: `backend/config.py` (add `log_level: str = "INFO"`)
- Modify: `backend/main.py` (call `configure_logging()` at import, before `app = FastAPI(...)` at :38)
- Test: `backend/tests/test_logging_config.py` (new)

**Interfaces:**
- Produces: `configure_logging() -> None`; log format `%(asctime)s %(levelname)s %(name)s [%(request_id)s] %(message)s`; `RequestIdFilter` reading `lib.request_id.request_id_var` (Task 14 provides the real contextvar — this task creates `backend/lib/request_id.py` with ONLY the contextvar so the filter imports cleanly; Task 14 adds the middleware to the same file).

- [ ] **Step 1: Failing test** — create `backend/tests/test_logging_config.py`:

```python
import logging

from lib.logging_config import configure_logging


def test_configure_logging_sets_formatted_console_handler(capsys):
    configure_logging()
    logging.getLogger("crux.test").info("hello world")
    out = capsys.readouterr().out
    assert "INFO" in out
    assert "crux.test" in out
    assert "hello world" in out
    assert "[-]" in out  # request_id placeholder outside a request


def test_root_level_from_settings(monkeypatch):
    monkeypatch.setattr("lib.logging_config.settings.log_level", "WARNING")
    configure_logging()
    assert logging.getLogger().level == logging.WARNING
```

Run from `backend/`: `pytest tests/test_logging_config.py -v` → FAIL (module missing).

- [ ] **Step 2: Implement**

Create `backend/lib/request_id.py` (contextvar only, middleware comes in Task 14):

```python
"""Request-id contextvar. The ASGI middleware that sets it lives below."""

from contextvars import ContextVar

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")
```

Create `backend/lib/logging_config.py`:

```python
"""Production logging config (audit G-05).

PII rule: log identifiers (user_id, session_id, document_id, request_id)
freely; never log message content, document content, or chunk text.
"""

import logging
import logging.config

from config import settings


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        from lib.request_id import request_id_var

        record.request_id = request_id_var.get()
        return True


def configure_logging() -> None:
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "filters": {
                "request_id": {"()": "lib.logging_config.RequestIdFilter"}
            },
            "formatters": {
                "default": {
                    "format": (
                        "%(asctime)s %(levelname)s %(name)s "
                        "[%(request_id)s] %(message)s"
                    ),
                }
            },
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                    "formatter": "default",
                    "filters": ["request_id"],
                    "stream": "ext://sys.stdout",
                }
            },
            "root": {"level": settings.log_level, "handlers": ["console"]},
            "loggers": {
                "uvicorn": {"level": "INFO", "propagate": True, "handlers": []},
                "uvicorn.access": {
                    "level": "INFO",
                    "propagate": True,
                    "handlers": [],
                },
                "uvicorn.error": {
                    "level": "INFO",
                    "propagate": True,
                    "handlers": [],
                },
            },
        }
    )
```

In `backend/config.py` `Settings`, add: `log_level: str = "INFO"` (env `LOG_LEVEL`). Document in `.env.example`: `# LOG_LEVEL=INFO`.

In `backend/main.py`, after the imports and before `app = FastAPI(...)` (:38):

```python
from lib.logging_config import configure_logging

configure_logging()
```

Note: uvicorn applies its own logging config before importing the app; our dictConfig (with `disable_existing_loggers: False`) then re-points the `uvicorn.*` loggers to propagate into our root handler, so every line shares one format.

- [ ] **Step 3: Run** — `pytest tests/test_logging_config.py -v` → PASS; then full `pytest` → green (watch for tests asserting on bare log output).

- [ ] **Step 4: Commit**

```bash
git add backend/lib/logging_config.py backend/lib/request_id.py backend/config.py backend/main.py backend/tests/test_logging_config.py .env.example
git commit -m "feat(obs): logging.dictConfig with request-id field and LOG_LEVEL (G-05)"
```

### Task 14: Request-id ASGI middleware

**Files:**
- Modify: `backend/lib/request_id.py` (add middleware)
- Modify: `backend/main.py` (register middleware AFTER the CORS registration at :40-47 so it runs inside CORS; add `"X-Request-Id"` to `expose_headers`)
- Test: `backend/tests/test_request_id.py` (new)

**Interfaces:**
- Produces: every HTTP response carries `X-Request-Id` (16-hex chars); `request_id_var` is set for the duration of the request. Pure ASGI middleware (NOT `BaseHTTPMiddleware` — the chat SSE stream must not be buffered).

- [ ] **Step 1: Failing test** — create `backend/tests/test_request_id.py`:

```python
def test_response_carries_request_id(client):
    r = client.get("/health")
    rid = r.headers.get("x-request-id")
    assert rid is not None
    assert len(rid) == 16


def test_request_ids_are_unique(client):
    a = client.get("/health").headers["x-request-id"]
    b = client.get("/health").headers["x-request-id"]
    assert a != b


def test_cors_exposes_request_id(client):
    r = client.get(
        "/health", headers={"Origin": "http://localhost:5173"}
    )
    exposed = r.headers.get("access-control-expose-headers", "")
    assert "x-request-id" in exposed.lower()
```

Run → FAIL.

- [ ] **Step 2: Implement** — append to `backend/lib/request_id.py`:

```python
import uuid


class RequestIdMiddleware:
    """Pure ASGI middleware: sets request_id_var and stamps X-Request-Id.

    Deliberately not BaseHTTPMiddleware so SSE streaming stays unbuffered.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        rid = uuid.uuid4().hex[:16]
        token = request_id_var.set(rid)

        async def send_with_header(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers") or [])
                headers.append((b"x-request-id", rid.encode("ascii")))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_header)
        finally:
            request_id_var.reset(token)
```

In `backend/main.py`:
- add `"X-Request-Id"` to the CORS `expose_headers` list (:46): `expose_headers=["X-Cost-Warning", "X-Request-Id"],`
- after the CORS `add_middleware` block, add:

```python
from lib.request_id import RequestIdMiddleware

app.add_middleware(RequestIdMiddleware)
```

(Starlette applies middleware in reverse registration order — registering RequestIdMiddleware after CORS makes it run inside CORS, which is what we want.)

- [ ] **Step 3: Run** — `pytest tests/test_request_id.py tests/test_cors.py -v` → PASS; full `pytest` → green.

- [ ] **Step 4: Commit**

```bash
git add backend/lib/request_id.py backend/main.py backend/tests/test_request_id.py
git commit -m "feat(obs): X-Request-Id ASGI middleware + contextvar correlation (G-06)"
```

### Task 15: Correlation fields on ingestion and agent-loop logs

**Files:**
- Modify: `backend/services/ingestion_service.py` (`run` at :183-264)
- Modify: `backend/routes/chat.py` and/or `backend/agent/tutor.py` (error paths)
- Test: `backend/tests/test_ingestion_service.py` (extend, `caplog`)

**Interfaces:**
- Produces: ingestion start/done/fail log lines containing `document_id=` and `session_id=`; agent-loop failure log lines containing `session_id=` and `user_id=`. Ids only — never content (PII rule in `logging_config.py` docstring).

- [ ] **Step 1: Failing test:**

```python
def test_run_logs_carry_document_and_session_ids(
    db_session, monkeypatch, tmp_path, caplog, mock_embed, insert_capture
):
    doc = ...  # existing setup_doc pattern
    _write_blob_stub(monkeypatch, tmp_path, doc.id, doc.filename)
    import logging

    with caplog.at_level(logging.INFO, logger="services.ingestion_service"):
        ingestion_service.run(doc.id)
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert f"document_id={doc.id}" in joined
    assert f"session_id={doc.session_id}" in joined
```

Run → FAIL.

- [ ] **Step 2: Implement** — in `run()`:
  - after the doc fetch (:186): `log.info("ingestion start document_id=%s session_id=%s filename=%s", doc.id, doc.session_id, doc.filename)`
  - before the final ready-commit (:231): `log.info("ingestion done document_id=%s session_id=%s chunks=%s", doc.id, doc.session_id, len(chunks))`
  - in each failure arm: `log.error("ingestion failed document_id=%s session_id=%s error=%s", document_id, session_id_if_known, e)` — reuse the module's existing `log` logger (Grep for `log = logging.getLogger` in the file; add it if absent).

  Then Grep `backend/routes/chat.py` and `backend/agent/tutor.py` for `except` blocks that log (`log.error`, `log.warning`, `log.exception`). For each that fires on an agent-turn failure, extend the message with ` session_id=%s user_id=%s` and the corresponding variables in scope. Do not add new log statements to non-error hot paths.

- [ ] **Step 3: Run** — `pytest tests/test_ingestion_service.py -v` → PASS; full `pytest` → green.

- [ ] **Step 4: Commit**

```bash
git add backend/services/ingestion_service.py backend/routes/chat.py backend/agent/tutor.py backend/tests/test_ingestion_service.py
git commit -m "feat(obs): correlation ids on ingestion and agent-loop logs (G-06)"
```

### Task 16: Open PR-3

- [ ] Full check (backend pytest, frontend lint+unit) → green.
- [ ] Push + PR:

```bash
git push -u origin feat/lg-pr3-logging
gh pr create --base dev --title "feat: production logging + request ids (G-05/G-06)" --body "PR-3 of 5 per docs/superpowers/specs/2026-08-06-launch-gating-remediation-design.md. logging.dictConfig at app+worker boot, LOG_LEVEL env, X-Request-Id middleware, correlation ids on ingestion/agent logs. PII rule: ids only, never content."
```

- [ ] `gh pr checks --watch` → green.

---

# PR-4 — Worker extraction (F-02 / F-04 / B-02)

**Branch:** `feat/lg-pr4-ingestion-worker` off updated `dev`

### Task 17: `processing` status through the contract chain

**Files:**
- Modify: `docs/api/openapi.yaml:840-842` (`IngestionStatus` enum) and the `202` description at :559 / :539-540
- Regenerate: `backend/contracts/` via `python backend/scripts/gen_contracts.py` (from repo root)
- Modify: `backend/services/documents_service.py:26-52` (`aggregate_status`, `status_from_counts`)
- Modify: `backend/routes/chat.py:159-175` (consolidated status counts)
- Test: `backend/tests/test_documents_service.py` (extend)

**Interfaces:**
- Produces: status vocabulary `pending | processing | ready | failed`; `processing` aggregates exactly like `pending` (in-flight) everywhere. Session-level aggregate stays `pending` while any doc is `pending` or `processing`, so the frontend polling contract is unchanged.

- [ ] **Step 1: Failing tests** — add to `backend/tests/test_documents_service.py` (mirror the file's existing aggregate tests):

```python
def test_aggregate_status_treats_processing_as_in_flight():
    assert documents_service.aggregate_status(["processing"]) == "pending"
    assert documents_service.aggregate_status(["ready", "processing"]) == "pending"
```

And a `status_from_counts` equivalent following that function's existing test pattern. Run → FAIL.

- [ ] **Step 2: Contract first** — in `docs/api/openapi.yaml:840-842` change the enum to `[pending, processing, ready, failed]`; update the `202` description at :559 and the note at :539-540 to say ingestion is performed by a background worker process. Run from repo root: `python backend/scripts/gen_contracts.py`. Verify `git diff backend/contracts/` shows `processing` added to the `Literal[...]` types and nothing unexpected.

- [ ] **Step 3: Implement aggregation** — in `backend/services/documents_service.py`, update `aggregate_status` (:26-40) so `processing` ranks with `pending` (any pending OR processing → `"pending"`), and `status_from_counts` (:43-52) so the pending count includes processing. In `backend/routes/chat.py:159-175`, the consolidated SELECT counts `pending`/`ready` explicitly — include `processing` in the pending count (otherwise processing docs silently read as failed there).

- [ ] **Step 4: Run** — `pytest tests/test_documents_service.py tests/test_contracts.py -v` → PASS; full `pytest` → green. Frontend check: from `frontend/`: `npm run test:unit -- --run` → green (the per-upload poller treats anything not ready/failed as still-pending, so no change expected).

- [ ] **Step 5: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts/ backend/services/documents_service.py backend/routes/chat.py backend/tests/test_documents_service.py
git commit -m "feat(worker): add processing status through contract + aggregation chain"
```

### Task 18: Migration 0023 — queue columns + chunk idempotency constraint

**Files:**
- Create: `backend/db/alembic/versions/0023_worker_queue.py`
- Modify: `backend/db/models.py` (`Document` :134-147, `ChunkEmbedding` :150-162)
- Test: `backend/tests/test_migration_chain.py` (existing chain assertion must stay green)

**Interfaces:**
- Produces: `documents.claimed_at` (nullable tz DateTime); index `ix_documents_status_id` on `(status, id)`; unique constraint `uq_chunk_embeddings_doc_idx` on `chunk_embeddings (document_id, chunk_index)`. Tasks 19-21 rely on all three.

- [ ] **Step 1: Update models** — in `backend/db/models.py`:

`Document` — add after `page_count`:

```python
    claimed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
```

`ChunkEmbedding` — add a `__table_args__` (or extend the existing one — read the class first):

```python
    __table_args__ = (
        UniqueConstraint(
            "document_id", "chunk_index", name="uq_chunk_embeddings_doc_idx"
        ),
    )
```

(`from sqlalchemy import UniqueConstraint` with the file's existing imports.)

- [ ] **Step 2: Write the migration** — create `backend/db/alembic/versions/0023_worker_queue.py`:

```python
"""Worker queue: documents.claimed_at + status index + chunk idempotency.

Revision ID: 0023_worker_queue
Revises: 0022_documents_session_idx
"""

import sqlalchemy as sa
from alembic import op

revision = "0023_worker_queue"
down_revision = "0022_documents_session_idx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_documents_status_id", "documents", ["status", "id"]
    )
    # Dedup before the unique constraint: keep the lowest id per
    # (document_id, chunk_index). No-op on healthy data.
    op.execute(
        """
        DELETE FROM chunk_embeddings a
        USING chunk_embeddings b
        WHERE a.document_id = b.document_id
          AND a.chunk_index = b.chunk_index
          AND a.id > b.id
        """
    )
    op.create_unique_constraint(
        "uq_chunk_embeddings_doc_idx",
        "chunk_embeddings",
        ["document_id", "chunk_index"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_chunk_embeddings_doc_idx", "chunk_embeddings", type_="unique"
    )
    op.drop_index("ix_documents_status_id", table_name="documents")
    op.drop_column("documents", "claimed_at")
```

Note: the `DELETE ... USING` is Postgres syntax; the sqlite test path never runs Alembic (tables come from `Base.metadata.create_all`), so no dialect branch is needed — but confirm `test_migration_chain.py` only walks the revision graph, not the SQL.

- [ ] **Step 3: MANDATORY — migration-reviewer** — dispatch the `migration-reviewer` agent on `backend/db/alembic/versions/0023_worker_queue.py` before committing. Apply its findings.

- [ ] **Step 4: Run** — from `backend/`: `pytest tests/test_migration_chain.py -v` → PASS; full `pytest` → green.

- [ ] **Step 5: Commit**

```bash
git add backend/db/models.py backend/db/alembic/versions/0023_worker_queue.py
git commit -m "feat(worker): migration 0023 - claimed_at, status index, chunk unique constraint"
```

### Task 19: Idempotent chunk insert

**Files:**
- Modify: `backend/services/pgvector_store.py:30-53` (`insert_chunks`)
- Test: `backend/tests/` — Grep for existing `insert_chunks` unit coverage (`test_pgvector_retrieval.py` and any pgvector store tests); extend where it lives

**Interfaces:**
- Consumes: `services/sql_dialect.py` `dialect_insert(db)` (the repo's existing Postgres-vs-sqlite divergence pattern, used by `cost_meter.record_cost`).
- Produces: `insert_chunks(db, session_id, document_id, rows) -> int` now skips rows whose `(document_id, chunk_index)` already exist (ON CONFLICT DO NOTHING) and returns the number actually inserted.

- [ ] **Step 1: Failing test** — in the pgvector store's test home (locate first):

```python
def test_insert_chunks_is_idempotent(db_session):
    rows = [(0, 1, "alpha", [0.1] * 8), (1, 1, "beta", [0.2] * 8)]
    n1 = pgvector_store.insert_chunks(
        db_session, session_id="s1", document_id=1, rows=rows
    )
    n2 = pgvector_store.insert_chunks(
        db_session, session_id="s1", document_id=1, rows=rows
    )
    assert n1 == 2
    assert n2 == 0
```

(If the sqlite test schema lacks the Vector column, follow however the existing tests fake it — read `test_pgvector_retrieval.py` first. If only Postgres-marked tests exercise this function, put the test there.) Run → FAIL.

- [ ] **Step 2: Implement** — rewrite `insert_chunks` body to use `dialect_insert` with `on_conflict_do_nothing(index_elements=["document_id", "chunk_index"])`, executing per-row or with `values(list)` + conflict clause, and return the inserted rowcount. Keep the "flushes, does not commit" contract stated in its docstring (:36-39). Mirror `cost_meter.record_cost` (:79-103) for the dialect mechanics.

- [ ] **Step 3: Run** — targeted tests + full `pytest` → green.

- [ ] **Step 4: Commit**

```bash
git add backend/services/pgvector_store.py backend/tests/
git commit -m "feat(worker): idempotent chunk insert via ON CONFLICT DO NOTHING"
```

### Task 20: Streaming per-batch ingestion (kills the 630 MB peak and the long connection hold)

This is the core restructure. `_embed_all` (accumulates every vector in `out` at :142 and every raw response in `pending_meter` at :143) and the bulk insert at :215-223 are replaced by one loop: per batch — cap-check, embed (no DB transaction open), insert, meter, commit.

**Files:**
- Modify: `backend/services/ingestion_service.py` (replace `_embed_all` :133-180 and the middle of `run` :207-233)
- Test: `backend/tests/test_ingestion_service.py` (rewrite the deferred-metering test at :651-684; extend)

**Interfaces:**
- Consumes: `insert_chunks` idempotent form (Task 19), `cost_meter.assert_within_caps` (Task 6), `cost_meter.embedding_cost` / `meter_embedding_response` (`cost_meter.py:267,298`).
- Produces: `_embed_and_store(db, doc, chunks, *, user_id) -> int` (returns chunks stored this run); `run(document_id)` unchanged signature. Metering now commits per batch, so the failure-arm re-record dance (:241-257) is DELETED — spend survives via committed batches. Resume: already-persisted chunk indexes are skipped before any embedding call.

- [ ] **Step 1: Failing tests** — replace/extend in `test_ingestion_service.py`. These drive `_embed_and_store` directly with a fake doc + chunks (adapt the seeding to the file's `setup_doc` fixture — it returns the seeded pending Document and patches `services.ingestion_service.SessionLocal` at :44-47):

```python
def _fake_embedding_factory(fail_on_call: int | None = None):
    """Returns (stub, calls) where stub mimics litellm.embedding and
    optionally raises on the Nth call (1-based)."""
    calls = []

    def stub(*, model, input, dimensions, timeout):
        calls.append(list(input))
        if fail_on_call is not None and len(calls) == fail_on_call:
            raise RuntimeError("embedding api down")
        return SimpleNamespace(
            data=[{"embedding": [0.1] * 8} for _ in input]
        )

    return stub, calls


def test_batches_commit_incrementally_and_resume_skips_paid_batches(
    db_session, setup_doc, monkeypatch
):
    doc = setup_doc  # pending Document seeded by the fixture
    monkeypatch.setattr("services.ingestion_service.EMBED_BATCH", 2)
    chunks = [
        chunking.Chunk(text=f"c{i}", page=1, chunk_idx=i) for i in range(5)
    ]
    stored_rows = []

    def fake_insert(db, *, session_id, document_id, rows):
        fresh = [r for r in rows if r[0] not in {x[0] for x in stored_rows}]
        stored_rows.extend(fresh)
        return len(fresh)

    monkeypatch.setattr(
        "services.ingestion_service.pgvector_store.insert_chunks", fake_insert
    )
    # Expose the persisted indexes to the skip-set query:
    monkeypatch.setattr(
        "services.ingestion_service._existing_chunk_indexes",
        lambda db, doc_id: {r[0] for r in stored_rows},
        raising=False,
    )
    stub, calls = _fake_embedding_factory(fail_on_call=2)
    monkeypatch.setattr("services.ingestion_service.litellm.embedding", stub)

    with pytest.raises(RuntimeError):
        ingestion_service._embed_and_store(
            db_session, doc, chunks, user_id=None
        )
    assert [r[0] for r in stored_rows] == [0, 1]  # batch 1 survived

    stub2, calls2 = _fake_embedding_factory()
    monkeypatch.setattr("services.ingestion_service.litellm.embedding", stub2)
    n = ingestion_service._embed_and_store(
        db_session, doc, chunks, user_id=None
    )
    assert n == 3  # only the unpaid chunks were embedded and stored
    assert sorted(r[0] for r in stored_rows) == [0, 1, 2, 3, 4]
    assert all(len(c) <= 2 for c in calls2)  # still batched


def test_metering_commits_per_batch(db_session, setup_doc, monkeypatch):
    doc = setup_doc
    monkeypatch.setattr("services.ingestion_service.EMBED_BATCH", 1)
    chunks = [
        chunking.Chunk(text=f"c{i}", page=1, chunk_idx=i) for i in range(2)
    ]
    monkeypatch.setattr(
        "services.ingestion_service.pgvector_store.insert_chunks",
        lambda db, **kw: len(kw["rows"]),
    )
    metered = []
    monkeypatch.setattr(
        "services.ingestion_service.cost_meter.meter_embedding_response",
        lambda db, resp, **kw: metered.append(len(kw["texts"])),
    )
    ledger_seen_at_call = []
    stub, calls = _fake_embedding_factory()

    def spying_stub(**kw):
        ledger_seen_at_call.append(len(metered))
        return stub(**kw)

    monkeypatch.setattr(
        "services.ingestion_service.litellm.embedding", spying_stub
    )
    ingestion_service._embed_and_store(db_session, doc, chunks, user_id=None)
    # Before batch 2's embedding call, batch 1 was already metered:
    assert ledger_seen_at_call == [0, 1]
```

Imports needed at the top of the test file (merge with existing): `from types import SimpleNamespace`, `from lib import chunking` — check how the file already imports `chunking` (it may be `from lib import chunking` or `import lib.chunking`; mirror it). If the implementation does not use a helper named `_existing_chunk_indexes`, adapt the first test's skip-set hook to however the skip query is expressed (the cleanest implementation extracts it into exactly such a helper — do that). Also DELETE the old deferred-metering test at :651-684 (its behavior is intentionally removed). Run → FAIL.

- [ ] **Step 2: Implement** — in `ingestion_service.py`:

Replace `_embed_all` with:

```python
def _existing_chunk_indexes(db, document_id: int) -> set[int]:
    """Chunk indexes already persisted for this document (resume skip-set)."""
    return {
        idx
        for (idx,) in db.execute(
            select(ChunkEmbedding.chunk_index).where(
                ChunkEmbedding.document_id == document_id
            )
        )
    }


def _embed_and_store(db, doc, chunks, *, user_id: str | None) -> int:
    """Embed and persist chunks in EMBED_BATCH slices.

    Per slice: cap-check -> embed (no open transaction during the HTTP
    call) -> insert -> meter -> commit. Skips chunk indexes already
    persisted by a previous attempt, so re-runs never re-pay.
    """
    existing = _existing_chunk_indexes(db, doc.id)
    todo = [c for c in chunks if c.chunk_idx not in existing]
    stored = 0
    for i in range(0, len(todo), EMBED_BATCH):
        batch = todo[i : i + EMBED_BATCH]
        if user_id is not None:
            cost_meter.assert_within_caps(db, user_id)
        db.commit()  # release the connection before the network call
        try:
            resp = litellm.embedding(
                model=settings.embedding_model,
                input=[c.text for c in batch],
                dimensions=settings.embedding_dim,
                timeout=settings.embedding_timeout_s,
            )
        except Exception as e:
            raise RuntimeError(f"embedding api failed: {e}") from e
        rows = [
            (c.chunk_idx, c.page, c.text, item["embedding"])
            for c, item in zip(batch, resp.data)
        ]
        stored += pgvector_store.insert_chunks(
            db, session_id=doc.session_id, document_id=doc.id, rows=rows
        )
        cost_meter.meter_embedding_response(
            db,
            resp,
            user_id=user_id,
            session_id=doc.session_id,
            texts=[c.text for c in batch],
        )
        db.commit()
    return stored
```

(Adapt `resp.data` item access to how the existing code reads it at :170-171 — dict vs attribute.) Add `ChunkEmbedding` and `select` imports if missing.

In `run()`: replace the owner-lookup→`_embed_all`→bulk-insert block (:207-223) with owner lookup, then `_embed_and_store(db, doc, chunks, user_id=owner_id)`; keep keyword stems + `doc.status = "ready"` final commit (:225-233). Delete `pending_meter`, `cost_holder`, `embed_cost_holder`, and the failure-arm re-record (:241-257) — update the `CostCapExceeded` branch from Task 11 accordingly (it no longer re-records; it just marks the doc failed).

Also update the module docstring (:1-34) — the deferred-metering design it documents is gone; describe the per-batch commit design and the resume contract instead.

- [ ] **Step 3: Run** — `pytest tests/test_ingestion_service.py -v` → PASS; full `pytest` → green.

- [ ] **Step 4: Commit**

```bash
git add backend/services/ingestion_service.py backend/tests/test_ingestion_service.py
git commit -m "feat(worker): streaming per-batch embed-insert-meter-commit ingestion (F-02/F-03/B-02)"
```

### Task 21: The worker process

**Files:**
- Create: `backend/worker.py`
- Test: `backend/tests/test_worker.py` (new)

**Interfaces:**
- Consumes: `ingestion_service.run(document_id)` (Task 20), `Document.claimed_at` (Task 18), `SessionLocal` (`db/database.py:49`), `configure_logging` (Task 13).
- Produces: `claim_next(db) -> int | None` (claims oldest pending → `processing`, returns doc id); `recover_stuck(db, *, now=None) -> int` (processing older than `STALE_PROCESSING_MINUTES=30` → back to `pending`); `main_loop(max_iterations=None)`; module runnable as `python -m worker`.

- [ ] **Step 1: Failing tests** — create `backend/tests/test_worker.py`:

```python
from datetime import datetime, timedelta, timezone

import worker
from db.models import Document, Session as SessionModel, User


def _seed_doc(db, status="pending", claimed_at=None, sid="s_w", uid="u_w"):
    if db.get(User, uid) is None:
        db.add(User(id=uid))
        db.flush()
        db.add(
            SessionModel(
                id=sid, user_id=uid, topic="t", topic_profile_json="{}"
            )
        )
    doc = Document(
        session_id=sid, filename="a.txt", status=status, claimed_at=claimed_at
    )
    db.add(doc)
    db.commit()
    return doc


def test_claim_next_claims_oldest_pending(db_session):
    d1 = _seed_doc(db_session)
    d2 = _seed_doc(db_session)
    got = worker.claim_next(db_session)
    assert got == d1.id
    db_session.expire_all()
    assert db_session.get(Document, d1.id).status == "processing"
    assert db_session.get(Document, d1.id).claimed_at is not None
    assert db_session.get(Document, d2.id).status == "pending"


def test_claim_next_returns_none_when_empty(db_session):
    assert worker.claim_next(db_session) is None


def test_recover_stuck_resets_old_processing(db_session):
    old = datetime.now(timezone.utc) - timedelta(minutes=45)
    d = _seed_doc(db_session, status="processing", claimed_at=old)
    fresh = _seed_doc(db_session, status="processing",
                      claimed_at=datetime.now(timezone.utc))
    n = worker.recover_stuck(db_session)
    assert n == 1
    db_session.expire_all()
    assert db_session.get(Document, d.id).status == "pending"
    assert db_session.get(Document, fresh.id).status == "processing"


def test_main_loop_processes_then_exits(db_session, monkeypatch):
    d = _seed_doc(db_session)
    processed = []
    monkeypatch.setattr(
        "worker.ingestion_service", type("M", (), {
            "run": staticmethod(lambda doc_id: processed.append(doc_id))
        }),
    )
    monkeypatch.setattr(
        "worker.SessionLocal",
        lambda: db_session,
    )
    monkeypatch.setattr("worker.time", type("T", (), {
        "sleep": staticmethod(lambda s: None)
    }))
    worker.main_loop(max_iterations=2)
    assert processed == [d.id]
```

Adapt the `SessionLocal` monkeypatch so the loop does not close the shared test session (wrap: give `main_loop` a session factory it closes, and in the test hand it a factory returning a no-op-close proxy — implement `main_loop` to call `db.close()` in a `finally`, and in the test monkeypatch `worker.SessionLocal` to a `sessionmaker` bound to `db_session.get_bind()` exactly as `conftest.py:110-114` does for `main`). Run → FAIL (module missing).

- [ ] **Step 2: Implement** — create `backend/worker.py`:

```python
"""Ingestion worker: claims pending documents and ingests them
out-of-process (audit F-02/F-04/B-02).

Run: python -m worker
Queue: the documents row is the job record. Claim is an atomic
pending -> processing transition; on Postgres it uses
FOR UPDATE SKIP LOCKED so multiple workers are safe.
"""

import logging
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from config import settings
from db.database import SessionLocal
from db.models import Document
from lib.logging_config import configure_logging
from services import ingestion_service

log = logging.getLogger(__name__)

POLL_INTERVAL_S = 2.0
STALE_PROCESSING_MINUTES = 30


def claim_next(db) -> int | None:
    stmt = (
        select(Document.id)
        .where(Document.status == "pending")
        .order_by(Document.id)
        .limit(1)
    )
    if db.get_bind().dialect.name == "postgresql":
        stmt = stmt.with_for_update(skip_locked=True)
    row = db.execute(stmt).first()
    if row is None:
        db.rollback()
        return None
    doc = db.get(Document, row[0])
    doc.status = "processing"
    doc.claimed_at = datetime.now(timezone.utc)
    db.commit()
    return doc.id


def recover_stuck(db, *, now: datetime | None = None) -> int:
    """A worker died mid-ingestion: put its claims back in the queue.
    Safe because ingestion re-runs are idempotent (persisted chunk
    indexes are skipped)."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=STALE_PROCESSING_MINUTES)
    result = db.execute(
        update(Document)
        .where(Document.status == "processing")
        .where(Document.claimed_at < cutoff)
        .values(status="pending", claimed_at=None)
    )
    db.commit()
    return result.rowcount


def main_loop(max_iterations: int | None = None) -> None:
    iterations = 0
    boot_db = SessionLocal()
    try:
        n = recover_stuck(boot_db)
        if n:
            log.info("recovered %s stuck documents on boot", n)
    finally:
        boot_db.close()
    while max_iterations is None or iterations < max_iterations:
        iterations += 1
        db = SessionLocal()
        try:
            doc_id = claim_next(db)
        finally:
            db.close()
        if doc_id is None:
            time.sleep(POLL_INTERVAL_S)
            continue
        log.info("worker picked up document_id=%s", doc_id)
        ingestion_service.run(doc_id)


if __name__ == "__main__":
    configure_logging()
    log.info("ingestion worker starting (poll=%ss)", POLL_INTERVAL_S)
    main_loop()
```

Coverage: `worker.py` sits outside the `--cov=services --cov=lib` allow-list, so it would be unmeasured. Add `--cov=worker` to the addopts line at `backend/pyproject.toml:52`.

- [ ] **Step 3: Run** — `pytest tests/test_worker.py -v` → PASS; full `pytest` → green (the coverage floor now includes worker.py).

- [ ] **Step 4: Commit**

```bash
git add backend/worker.py backend/tests/test_worker.py backend/pyproject.toml
git commit -m "feat(worker): DB-queue worker process - claim, recover, loop (F-02/B-02)"
```

### Task 22: Upload route hands off to the queue; lifespan reaper retired

**Files:**
- Modify: `backend/routes/upload.py` (remove `background_tasks.add_task(...)` at :167 and the now-unused `BackgroundTasks` parameter/import)
- Modify: `backend/main.py:24-34` (remove the `reap_stale_pending` lifespan call)
- Modify: `backend/services/ingestion_service.py` (delete `reap_stale_pending` :68-82 and its constants :64-65)
- Test: `backend/tests/test_upload_route.py`, `backend/tests/test_main_lifespan.py` (update)

**Interfaces:**
- Produces: `POST /api/upload` returns 202 with `status="pending"` and does NO ingestion work in-process; the document sits queued until the worker claims it. Crash recovery is `worker.recover_stuck` (Task 21), not the age-based reaper.

- [ ] **Step 1: Failing test** — in `test_upload_route.py`, replace the `stub_background` autouse fixture (:35-38) with a spy asserting ingestion is NOT called in-process:

```python
@pytest.fixture(autouse=True)
def ingestion_never_inline(monkeypatch):
    def _boom(doc_id):
        raise AssertionError("ingestion must not run in the request process")

    monkeypatch.setattr("services.ingestion_service.run", _boom)
```

Run `pytest tests/test_upload_route.py -v` → the happy-path test FAILS (BackgroundTasks fires `_boom` — TestClient runs background tasks synchronously after the response).

- [ ] **Step 2: Implement** — remove the `background_tasks.add_task(ingestion_service.run, doc.id)` line (:167), the `background_tasks: BackgroundTasks` parameter, and the `BackgroundTasks` import from `routes/upload.py`. In `main.py`, delete the lifespan reaper block (:24-34) and its `ingestion_service` import if now unused. In `ingestion_service.py`, delete `reap_stale_pending`, `REAP_PENDING_AFTER_MINUTES`, `REAP_ERROR`. Update `test_main_lifespan.py`: remove/replace assertions about the reaper (read the file; keep the JWKS/create_tables assertions). Grep the whole backend for `reap_stale_pending` to catch stragglers.

- [ ] **Step 3: Run** — full `pytest` from `backend/` → green.

- [ ] **Step 4: Commit**

```bash
git add backend/routes/upload.py backend/main.py backend/services/ingestion_service.py backend/tests/
git commit -m "feat(worker): upload enqueues only; in-process ingestion and reaper removed (F-04)"
```

### Task 23: Deploy config — compose + Render worker services

**Files:**
- Modify: `docker-compose.yml` (new `worker` service)
- Modify: `docker-compose.prod.yml` (same)
- Modify: `render.yaml` (second service, `type: worker`)
- Test: `backend/tests/test_deploy_config.py` (extend — read its existing assertions first)

**Interfaces:**
- Produces: `worker` service in both compose files (same build context/env as backend, `command: ["python", "-m", "worker"]`, no ports, healthcheck disabled); `crux-worker` in render.yaml.

- [ ] **Step 1: Failing test** — extend `backend/tests/test_deploy_config.py` following its existing YAML-parsing style:

```python
def test_compose_files_define_worker_service():
    for path in ("docker-compose.yml", "docker-compose.prod.yml"):
        cfg = _load(path)  # use the file's existing loader helper
        worker = cfg["services"]["worker"]
        assert worker["command"] == ["python", "-m", "worker"]
        assert "ports" not in worker
        assert worker["healthcheck"] == {"disable": True}


def test_render_defines_worker_service():
    cfg = _load("render.yaml")
    names = {s["name"]: s for s in cfg["services"]}
    w = names["crux-worker"]
    assert w["type"] == "worker"
    assert w["dockerCommand"] == "python -m worker"
```

Run → FAIL.

- [ ] **Step 2: Implement**

`docker-compose.yml` — add after the `backend` service (mirror its `environment:` block :25-38 and volume :39-40 exactly):

```yaml
  worker:
    build:
      context: ./backend
    command: ["python", "-m", "worker"]
    environment:
      # identical block to backend's - copy lines 25-38 verbatim
    volumes:
      - ./data:/data
    depends_on:
      backend:
        condition: service_healthy
    healthcheck:
      disable: true
```

(`depends_on: service_healthy` makes the worker start after the web container has run `alembic upgrade head` — the worker itself never migrates.) Same addition to `docker-compose.prod.yml` mirroring ITS backend `environment:` block (:28-45). The image HEALTHCHECK curls `/health` which a worker doesn't serve — `healthcheck: disable: true` is required, not optional.

`render.yaml` — append a second service:

```yaml
  - type: worker
    name: crux-worker
    runtime: docker
    dockerfilePath: ./backend/Dockerfile
    dockerContext: ./backend
    plan: starter
    dockerCommand: python -m worker
    envVars:
      # duplicate the crux-api envVars block (lines 12-45) verbatim
```

Flag in the PR body: `plan: starter` is PAID — Render free tier does not run workers; the user accepted this cost in the spec decision.

- [ ] **Step 3: Run** — `pytest tests/test_deploy_config.py -v` → PASS. Local smoke: from repo root `docker compose config` → parses; optionally `docker compose up --build backend worker` and confirm the worker logs its startup line, then `docker compose down`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml docker-compose.prod.yml render.yaml backend/tests/test_deploy_config.py
git commit -m "feat(deploy): worker service in compose and Render (paid plan flagged)"
```

### Task 24: Frontend poll ceiling for queued ingestion

Queueing adds latency; the per-upload poller gives up at 30 s (`frontend/src/views/SessionView.vue:747`, 30 polls x 1 s) and the copy then claims work continues — which stays true, but large files will now routinely outlive 30 s.

**Files:**
- Modify: `frontend/src/views/SessionView.vue:747` (30 → 90)
- Test: `frontend/src/__tests__/sessionView.test.js` (:714, :743 — the upload-poll tests)

- [ ] **Step 1:** Read the two poll tests; if either encodes the 30-poll ceiling, write the updated expectation (90) first and watch it fail.
- [ ] **Step 2:** Change `for (let i = 0; i < 30; i += 1)` to `for (let i = 0; i < 90; i += 1)`.
- [ ] **Step 3:** From `frontend/`: `npm run test:unit -- --run` → green.
- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/SessionView.vue frontend/src/__tests__/sessionView.test.js
git commit -m "fix(fe): extend per-upload poll ceiling to 90s for queued ingestion"
```

### Task 25: Open PR-4

- [ ] Full check: backend `pytest`; frontend `npm run lint` + `npm run test:unit -- --run`; `docker compose config`. All green or stop and report.
- [ ] Push + PR:

```bash
git push -u origin feat/lg-pr4-ingestion-worker
gh pr create --base dev --title "feat: ingestion worker - DB queue, streaming batches, idempotent resume (F-02/F-04/B-02)" --body "PR-4 of 5 per docs/superpowers/specs/2026-08-06-launch-gating-remediation-design.md. Upload now only enqueues; a worker process claims documents via FOR UPDATE SKIP LOCKED and ingests with per-batch embed-insert-meter-commit (memory and connection hold no longer scale with document size; restarts resume without re-paying). Migration 0023 (claimed_at + chunk unique constraint) reviewed by migration-reviewer. NOTE: render.yaml worker uses a PAID plan (accepted in spec). Live migration 0023 must be applied at deploy (entrypoint handles it)."
```

- [ ] `gh pr checks --watch` → green.

---

# PR-5 — Accessibility blockers + nginx (D-01..D-04, C-02)

**Branch:** `fix/lg-pr5-a11y-nginx` off updated `dev`

### Task 26: D-02 — announce auth errors (five one-line changes)

**Files:**
- Modify: `frontend/src/views/LoginView.vue:43`, `frontend/src/views/RegisterView.vue:54`, `frontend/src/views/ForgotPasswordView.vue:25`, `frontend/src/views/ResetPasswordView.vue:40`, `frontend/src/components/settings/AccountTab.vue:87`
- Test: `frontend/src/__tests__/loginView.test.js`, `registerView.test.js`, `forgotPasswordView.test.js`, `resetPasswordView.test.js`, `accountTab.test.js`

- [ ] **Step 1: Failing tests** — add one assertion per spec, e.g. in `loginView.test.js` (mirror for the other four, using each file's error-triggering setup):

```javascript
it('announces the error to screen readers', async () => {
  // ...existing arrange that makes [data-testid="login-error"] visible...
  expect(wrapper.find('[data-testid="login-error"]').attributes('role')).toBe('alert')
})
```

Run from `frontend/`: `npm run test:unit -- --run` → 5 new failures.

- [ ] **Step 2: Implement** — add `role="alert"` to each of the five error `<p>` elements, matching the existing convention at `OnboardingView.vue:51`. Example for `LoginView.vue:43`:

```vue
<p v-if="error" class="error" role="alert" data-testid="login-error">{{ error }}</p>
```

(`AccountTab.vue:87` keeps its `pw-error` class.) Also add `role="status"` to the `settings-pw-success` flash at `AccountTab.vue:88-91` — same announcement gap, same file, two lines.

- [ ] **Step 3: Run** — `npm run test:unit -- --run` → green.
- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/LoginView.vue frontend/src/views/RegisterView.vue frontend/src/views/ForgotPasswordView.vue frontend/src/views/ResetPasswordView.vue frontend/src/components/settings/AccountTab.vue frontend/src/__tests__/
git commit -m "fix(a11y): announce auth and password errors with role=alert (D-02)"
```

### Task 27: D-01 — check-question verdict announced, focus preserved

**Files:**
- Modify: `frontend/src/components/chat/CheckQuestion.vue` (options :41-50, verdict :54-59, buttons :61-91, CSS :136-144)
- Test: `frontend/src/__tests__/checkQuestion.test.js`

**Interfaces:**
- Produces: an always-present sr-only live region (`data-testid="check-live"`); option buttons use `aria-disabled` (focus survives answering); focus moves to Next/Done on answer.

- [ ] **Step 1: Failing tests** — add to `checkQuestion.test.js` (it mounts `CheckQuestion` directly):

```javascript
it('has an empty live region before answering', () => {
  const wrapper = mountUnanswered() // use the file's existing mount helper/props
  const live = wrapper.find('[data-testid="check-live"]')
  expect(live.exists()).toBe(true)
  expect(live.attributes('role')).toBe('status')
  expect(live.attributes('aria-live')).toBe('polite')
  expect(live.attributes('aria-atomic')).toBe('true')
  expect(live.text()).toBe('')
})

it('announces verdict and explanation after answering', () => {
  const wrapper = mountAnswered({ correct: true, explanation: 'Because X.' })
  expect(wrapper.find('[data-testid="check-live"]').text()).toContain('Correct')
  expect(wrapper.find('[data-testid="check-live"]').text()).toContain('Because X.')
})

it('marks answered options aria-disabled instead of disabled', () => {
  const wrapper = mountAnswered({})
  const opt = wrapper.find('[data-testid="check-option"]')
  expect(opt.attributes('disabled')).toBeUndefined()
  expect(opt.attributes('aria-disabled')).toBe('true')
})

it('does not emit answer from an aria-disabled option', async () => {
  const wrapper = mountAnswered({})
  await wrapper.find('[data-testid="check-option"]').trigger('click')
  expect(wrapper.emitted('answer')).toBeUndefined()
})
```

Adapt `mountUnanswered`/`mountAnswered` to the file's existing fixture props (read it first — it drives state via the `check` prop's item status). Before editing, Grep `frontend/src/__tests__/` for `attributes('disabled')` on check specs — any existing assertion on the option buttons' `disabled` attribute must flip to `aria-disabled`. Run → FAIL.

- [ ] **Step 2: Implement** in `CheckQuestion.vue`:

Template — inside the root section, ABOVE the options list (always rendered, `.sr-only` comes from the global rule in `assets/base.css:336-349`):

```vue
<div
  class="sr-only"
  role="status"
  aria-live="polite"
  aria-atomic="true"
  data-testid="check-live"
>
  <template v-if="item.status === 'answered'">
    {{ correct ? 'Correct.' : 'Not quite.' }} {{ item.explanation || '' }}
  </template>
</div>
```

Options (:41-50) — replace `:disabled="answered"` with:

```vue
:aria-disabled="answered ? 'true' : undefined"
@click="answered ? undefined : emit('answer', i)"
```

(Match how the component names its emit — it uses `emit('answer', i)` per the existing template.)

Focus move — in the script block:

```javascript
import { nextTick, ref, watch } from 'vue'

const nextBtn = ref(null)
const doneBtn = ref(null)

watch(answered, async (is) => {
  if (!is) return
  await nextTick()
  const target = nextBtn.value ?? doneBtn.value
  target?.focus()
})
```

Add `ref="nextBtn"` to the Next button (:72-81) and `ref="doneBtn"` to Done (:82-91). Merge imports with the component's existing `vue` import line.

CSS (:136-144) — anywhere the scoped styles use `.check-option:disabled` / `:not(:disabled)`, add the equivalent `[aria-disabled='true']` selectors so the visual answered state is unchanged, e.g. `.check-option:disabled, .check-option[aria-disabled='true'] { ... }`.

- [ ] **Step 3: Run** — `npm run test:unit -- --run` → green, including `sessionCheckFlow.test.js`.
- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/chat/CheckQuestion.vue frontend/src/__tests__/
git commit -m "fix(a11y): check verdict live region, aria-disabled options, focus move (D-01)"
```

### Task 28: D-03 — closed drawer is inert

**Files:**
- Modify: `frontend/src/components/sidebar/Sidebar.vue` (the `<aside>` at :256-268)
- Test: `frontend/src/__tests__/sidebarA11y.test.js`

- [ ] **Step 1: Failing test** — add to `sidebarA11y.test.js` (it drives viewport via `useSidebar`'s `__test__._setViewport(w)` — read its existing tests for the mount recipe):

```javascript
it('closed mobile drawer is inert', async () => {
  // mount with _setViewport(500) so isDesktop=false, mode!=='drawer-open'
  expect(wrapper.find('aside.sidebar').attributes('inert')).toBeDefined()
})

it('open mobile drawer is not inert', async () => {
  // open the drawer via the component's existing toggle path
  expect(wrapper.find('aside.sidebar').attributes('inert')).toBeUndefined()
})

it('desktop sidebar is never inert', () => {
  // _setViewport(1400)
  expect(wrapper.find('aside.sidebar').attributes('inert')).toBeUndefined()
})
```

Run → FAIL.

- [ ] **Step 2: Implement** — on the `<aside>` (:256), add:

```vue
:inert="!isDesktop && mode !== 'drawer-open'"
```

Vue 3 renders `:inert="false"` by omitting the attribute, so desktop and open-drawer states are untouched; when true, the whole subtree (17+ session rows, New session, Settings) leaves the tab order and the accessibility tree in one attribute. Keep the existing `pointer-events: none` CSS (:568-570) as a belt-and-braces visual guard.

- [ ] **Step 3: Run** — `npm run test:unit -- --run` → green (`sidebar.test.js`'s 1540 lines must stay green — if any test tabs into the closed drawer, fix the test, the behavior change is the point).
- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/sidebar/Sidebar.vue frontend/src/__tests__/sidebarA11y.test.js
git commit -m "fix(a11y): closed mobile drawer is inert (D-03)"
```

### Task 29: D-04 — start intercept announced and focused

**Files:**
- Modify: `frontend/src/components/start/StartTopicIntercept.vue` (root :19-24, primary buttons :44-63, script)
- Test: `frontend/src/__tests__/startTopicIntercept.test.js`

- [ ] **Step 1: Failing tests** — add to `startTopicIntercept.test.js` (it mounts the component directly with `activeMatch`/`endedMatch` fixtures):

```javascript
it('is a polite live region', () => {
  const wrapper = mountActive() // the file's existing mount helper
  const root = wrapper.find('[data-testid="start-intercept"]')
  expect(root.attributes('role')).toBe('status')
  expect(root.attributes('aria-live')).toBe('polite')
})

it('focuses the primary action on mount', async () => {
  const wrapper = mountActive({ attachTo: document.body })
  await nextTick()
  await nextTick()
  expect(document.activeElement?.dataset?.testid).toBe('intercept-open-existing')
  wrapper.unmount()
})
```

(Import `nextTick` from vue; extend the mount helper to pass `attachTo` through to `mount` — jsdom focus only works when attached.) Run → FAIL.

- [ ] **Step 2: Implement** — in `StartTopicIntercept.vue`:

Root (:19-24): change `role="region"` to `role="status"` and add `aria-live="polite"` (keep `aria-label="Existing session found"`).

Script — the component appears only when `stage === 'intercept'` (mounted fresh via `v-if` at `HomeView.vue:46`), so `onMounted` is the right hook:

```javascript
import { nextTick, onMounted, ref } from 'vue'

const primaryBtn = ref(null)

onMounted(async () => {
  await nextTick()
  primaryBtn.value?.focus()
})
```

Add `ref="primaryBtn"` to BOTH primary buttons — the `kind === 'active'` "Open it" button (:44-53) and the `kind === 'ended'` "Continue where you left off" button (:54-63); only one renders at a time, so the ref resolves to whichever exists. Merge the vue import with any existing one.

- [ ] **Step 3: Run** — `npm run test:unit -- --run` → green including `homeView.test.js` (:138-168 intercept assertions).
- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/start/StartTopicIntercept.vue frontend/src/__tests__/startTopicIntercept.test.js
git commit -m "fix(a11y): start intercept announces and moves focus (D-04)"
```

### Task 30: C-02 — nginx accepts 25 MB uploads

**Files:**
- Modify: `frontend/nginx.conf` (inside `location /api/` at :34-47)

- [ ] **Step 1: Edit** — inside the `location /api/` block (after the `limit_req_status 429;` line), add:

```nginx
        client_max_body_size 25m;
```

Matches `MAX_UPLOAD_BYTES` at `backend/routes/upload.py:30`. Directive placement inside `location /api/` is safe — the :54-57 warning in the file is about `add_header` only. Do NOT add any `add_header` here.

- [ ] **Step 2: Verify** — from repo root:

```bash
docker build -t crux-frontend-nginx-check ./frontend
docker run --rm crux-frontend-nginx-check nginx -t
```

Expected: `syntax is ok` / `test is successful`. (The nginx.conf is baked into the image — a conf edit requires image rebuild to take effect, which `docker compose up --build` does.)

- [ ] **Step 3: Commit**

```bash
git add frontend/nginx.conf
git commit -m "fix(deploy): nginx client_max_body_size 25m matches app upload limit (C-02)"
```

### Task 31: Open PR-5

- [ ] Full check: from `frontend/`: `npm run lint`, `npm run test:unit -- --run`; from `backend/`: `pytest` (untouched but cheap). Green or stop.
- [ ] Push + PR:

```bash
git push -u origin fix/lg-pr5-a11y-nginx
gh pr create --base dev --title "fix: screen-reader blockers + nginx upload size (D-01..D-04, C-02)" --body "PR-5 of 5 per docs/superpowers/specs/2026-08-06-launch-gating-remediation-design.md. Auth errors announced, check verdict live region + focus, closed drawer inert, start intercept announced+focused, nginx body cap 25m. Manual screen-reader verification still owed (see human gates)."
```

- [ ] `gh pr checks --watch` → green.

---

# Human gates (after PR-4/PR-5 merge — user actions, guide interactively)

These are NOT code tasks. Walk the user through each; record outcomes in `docs/reviews/2026-08-06-qa-audit/deployment-checklist.md`.

- [ ] **W-02 — restore drill:** follow `docs/deploy/RESTORE.md` end-to-end against a scratch database. Expect first-run failures (that is the point — C-15/C-16/C-18 may fire). Document RTO. Update `RESTORE.md`'s "Not yet run" line.
- [ ] **W-07 — branch protection + code scanning:** GitHub repo settings; require the CI checks that now run on dev.
- [ ] **W-14 — Supabase anonymous sign-in DISABLED:** Supabase dashboard → Authentication → Providers. Confirm and record.
- [ ] **W-15 — `SUPABASE_JWKS_URL_OVERRIDE` absent in prod env:** Render dashboard env vars — must be absent, not empty.
- [ ] **Verdict update:** when all Failed rows F-1..F-8 are closed, update the checklist Recommendation from NOT READY to READY-for-closed-beta, and update the memory file `project_qa_audit_2026-08-06.md`.

# Success criteria (from the spec)

- `pytest` green from `backend/` on this machine with the real `.env` present.
- A 25 MB `.txt` upload fails cleanly with a coded reason (413 pre-estimate); no OOM path remains because vectors are never accumulated.
- Kill the worker mid-ingestion; restart resumes without duplicate chunks or re-paid batches (covered by the Task 20 resume test; verify once live during deploy).
- Deployed logs show timestamped, leveled, request-id-tagged lines for a chat turn and an ingestion run.
- Restore drill performed once; checklist verdict updated.
