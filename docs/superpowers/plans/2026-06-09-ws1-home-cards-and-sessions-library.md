# WS1 — Home Cards + `/sessions` Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make home session cards informative (layered focus→preview→mastery→meta description) and add a full searchable/filterable/paginated `/sessions` library view, backed by enriching the `recent_topics` payload with the same per-session fields WS0 added to the sidebar list.

**Architecture:** Extract WS0's `_enrich_list_items` computation (2 set-based queries + profile parse) into a shared `services/session_enrichment.py` consumed by BOTH the sidebar list (`SessionListItem`) and the home shelf (`RecentSessionSummary`). The card-description precedence is pure display logic → a frontend util (`utils/sessionCard.js`) reused by Home now and the sidebar in WS2. The `/sessions` library view consumes the WS0 `GET /sessions/library` endpoint (already shipped).

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic-from-OpenAPI (backend); Vue 3 + Vite + Pinia + vue-router + PrimeVue + vitest (frontend).

**Source-of-truth discipline:** `RecentSessionSummary` is codegen. Edit `docs/api/openapi.yaml` FIRST, then run `python backend/scripts/gen_contracts.py`, then commit both. CI fails on drift (`.github/workflows/ci.yml:36-42`).

**Branch:** `feat/sessions-ux-perf` (continue the initiative branch). WS1 ships as its own PR into `dev`.

**Scope guard (do NOT cross into WS2/WS3):**
- WS1 changes the home shelf's **display fields only**. Selection stays `recent = reversed(sessions[-5:])` (created_at order); `sortedRecent` in HomeView is unchanged. Re-sorting/bucketing by `last_activity_at` is WS2.
- No sidebar row changes (WS2). No prefetch/optimistic-render/cache (WS3).

---

## File Structure

**Backend**
- Create: `backend/services/session_enrichment.py` — shared per-session enrichment computation (count, last-activity, preview, progress) + `aware_utc` + preview constants.
- Modify: `backend/routes/sessions.py` — `_enrich_list_items` delegates to the shared module.
- Modify: `backend/services/profile_service.py` — `aggregate_for_user` enriches each `recent_topics` entry.
- Modify: `docs/api/openapi.yaml` — add 4 properties to `RecentSessionSummary`.
- Regenerated: `backend/contracts/models.py` — via `gen_contracts.py` (do not hand-edit).
- Test: `backend/tests/test_session_enrichment.py` (new), `backend/tests/test_profile_aggregate.py` (extend).

**Frontend**
- Create: `frontend/src/utils/sessionCard.js` — `stripAutoPrefix`, `cardDescription`, `cardMeta`.
- Modify: `frontend/src/views/HomeView.vue` — use the util; add "View all sessions →".
- Modify: `frontend/src/services/sessionsApi.js` — `getSessionLibrary(params)`.
- Modify: `frontend/src/stores/session.js` — `fetchLibrary(params)` + `libraryLoading`/`libraryError`.
- Modify: `frontend/src/router/index.js` — `/sessions` route.
- Create: `frontend/src/views/SessionsLibraryView.vue` — library page.
- Test: `frontend/src/__tests__/sessionCard.test.js`, `sessionsLibraryView.test.js` (new); `homeView.test.js`, `sessionStore.test.js` (extend).

---

## Task 1: Extract shared session-enrichment computation

**Why:** `recent_topics` must gain the same fields as `SessionListItem` without duplicating the queries. Extract the computation once; both models consume it. `services/` (not `lib/`) reuses existing import edges (`routes→services`, `services→contracts/db.models`) with no new dependency edge and no cycle.

**Files:**
- Create: `backend/services/session_enrichment.py`
- Modify: `backend/routes/sessions.py:89-168` (and the `_aware_utc` / `PREVIEW_CANDIDATES` / `PREVIEW_MAX` definitions it relies on)
- Modify: `docs/api/openapi.yaml` (`SessionListItem`) + regenerate `backend/contracts/models.py`
- Test: `backend/tests/test_session_enrichment.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_session_enrichment.py`:

```python
import json
from datetime import datetime, timedelta, timezone

from db.models import ChatMessage, Session as SessionModel, User
from services.session_enrichment import compute_enrichment

USER_ID = "u1"


def _seed(db):
    db.add(User(id=USER_ID))
    db.flush()
    base = datetime(2026, 6, 1, tzinfo=timezone.utc)
    prof = {
        "focus_target_gap": "ATP yield",
        "mastered_concepts": ["a", "b", "c"],
        "confirmed_gaps": [],
        "last_session_summary": "[auto] recap of glycolysis",
    }
    db.add(SessionModel(id="s_rich", user_id=USER_ID, topic="Glycolysis",
                        topic_profile_json=json.dumps(prof)))
    db.add(ChatMessage(session_id="s_rich", role="user", content="hi", created_at=base))
    db.add(ChatMessage(session_id="s_rich", role="assistant",
                       content="glycolysis nets 2 ATP per glucose",
                       created_at=base + timedelta(minutes=1)))
    # Aborted-stream trailing-whitespace turn must be skipped by the preview.
    db.add(ChatMessage(session_id="s_rich", role="assistant", content="\n  \n",
                       created_at=base + timedelta(minutes=2)))
    # Empty session: no messages.
    db.add(SessionModel(id="s_empty", user_id=USER_ID, topic="Empty",
                        topic_profile_json="{}"))
    db.commit()


def test_compute_enrichment_fields(db_session):
    _seed(db_session)
    rows = db_session.query(SessionModel).all()
    enr = compute_enrichment(db_session, rows)

    rich = enr["s_rich"]
    assert rich.message_count == 3
    # Newest non-blank message wins; the "\n  \n" turn is skipped.
    assert rich.last_message_preview == "glycolysis nets 2 ATP per glucose"
    assert rich.last_activity_at is not None
    assert rich.last_activity_at.tzinfo is not None
    assert rich.progress.focus_target_gap == "ATP yield"
    assert rich.progress.mastered_count == 3
    # Backend stores the summary raw (with any [auto] prefix); stripping is frontend-side.
    assert rich.last_session_summary == "[auto] recap of glycolysis"

    empty = enr["s_empty"]
    assert empty.message_count == 0
    assert empty.last_message_preview is None
    assert empty.last_activity_at is None
    assert empty.last_session_summary is None
    assert empty.progress.mastered_count == 0
    assert empty.progress.focus_target_gap is None


def test_compute_enrichment_empty_rows(db_session):
    assert compute_enrichment(db_session, []) == {}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_session_enrichment.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'services.session_enrichment'`.

- [ ] **Step 3: Create the shared module**

First open `backend/routes/sessions.py` and locate the existing `_aware_utc` helper and the `PREVIEW_CANDIDATES` / `PREVIEW_MAX` constants (used by `_enrich_list_items:89-168`). Move their definitions verbatim into the new module below (rename `_aware_utc` → `aware_utc`). Create `backend/services/session_enrichment.py`:

```python
"""Shared per-session enrichment: message count, last activity, latest non-empty
preview, and a lightweight progress signal. Consumed by both the sidebar list
(SessionListItem in routes/sessions.py) and the home shelf (RecentSessionSummary
in services/profile_service.py) so the two payloads stay in lockstep.

Two set-based queries total regardless of how many sessions are passed.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from contracts import SessionProgress
from db.models import ChatMessage, Session as SessionModel

# Preview window tuning (moved verbatim from routes/sessions.py).
PREVIEW_CANDIDATES = 5
PREVIEW_MAX = 120


def aware_utc(dt):
    """Coerce a (possibly naive / possibly ISO-string) datetime to UTC-aware.
    Body moved verbatim from routes/sessions.py:_aware_utc -- do not rewrite the
    logic; paste the existing implementation here."""
    # PASTE existing _aware_utc body here.
    raise NotImplementedError  # replace with moved body


@dataclass(frozen=True)
class SessionEnrichment:
    message_count: int
    last_activity_at: datetime | None
    last_message_preview: str | None
    last_session_summary: str | None
    progress: SessionProgress


def compute_enrichment(
    db: Session, rows: list[SessionModel]
) -> dict[str, SessionEnrichment]:
    ids = [r.id for r in rows]
    counts: dict[str, int] = {}
    last_act: dict[str, datetime] = {}
    previews: dict[str, str] = {}
    if ids:
        agg = db.execute(
            select(
                ChatMessage.session_id,
                func.count().label("c"),
                func.max(ChatMessage.created_at).label("la"),
            )
            .where(ChatMessage.session_id.in_(ids))
            .group_by(ChatMessage.session_id)
        ).all()
        for sid, c, la in agg:
            counts[sid] = c
            # func.max() over DateTime returns an ISO string on SQLite (not on
            # Postgres); coerce so aware_utc gets a real datetime either way.
            last_act[sid] = la if not isinstance(la, str) else datetime.fromisoformat(la)
        # Latest NON-EMPTY message per session. Rank by recency in SQL (portable
        # window fn), pick the first non-blank in Python because trim() in SQL
        # strips only spaces (not tabs/newlines) on both SQLite and Postgres.
        rn = func.row_number().over(
            partition_by=ChatMessage.session_id,
            order_by=(ChatMessage.created_at.desc(), ChatMessage.id.desc()),
        ).label("rn")
        sub = (
            select(
                ChatMessage.session_id.label("sid"),
                ChatMessage.content.label("content"),
                rn,
            )
            .where(ChatMessage.session_id.in_(ids))
            .subquery()
        )
        for sid, content in db.execute(
            select(sub.c.sid, sub.c.content)
            .where(sub.c.rn <= PREVIEW_CANDIDATES)
            .order_by(sub.c.sid, sub.c.rn)
        ).all():
            if sid in previews:
                continue  # already took the most-recent non-blank for this session
            stripped = (content or "").strip()
            if stripped:
                previews[sid] = stripped[:PREVIEW_MAX]

    out: dict[str, SessionEnrichment] = {}
    for r in rows:
        try:
            prof = json.loads(r.topic_profile_json or "{}")
        except (ValueError, TypeError):
            prof = {}
        out[r.id] = SessionEnrichment(
            message_count=counts.get(r.id, 0),
            last_activity_at=aware_utc(last_act.get(r.id)),
            last_message_preview=previews.get(r.id),
            last_session_summary=prof.get("last_session_summary"),
            progress=SessionProgress(
                focus_target_gap=prof.get("focus_target_gap"),
                mastered_count=len(prof.get("mastered_concepts") or []),
            ),
        )
    return out
```

Replace the `aware_utc` stub with the real body moved from `_aware_utc`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_session_enrichment.py -v`
Expected: PASS (both tests).

- [ ] **Step 5: Refactor `_enrich_list_items` to delegate**

In `backend/routes/sessions.py`: add the import (keep the `_aware_utc` name for other call sites via alias), delete the now-moved `_aware_utc`/`PREVIEW_CANDIDATES`/`PREVIEW_MAX` definitions, and replace the body of `_enrich_list_items`:

```python
from services.session_enrichment import aware_utc as _aware_utc, compute_enrichment


def _enrich_list_items(db: Session, rows: list[SessionModel]) -> list[SessionListItem]:
    """Build SessionListItems with count, last-activity, progress, and preview.
    Enrichment is computed set-based in services.session_enrichment."""
    enr = compute_enrichment(db, rows)
    return [
        SessionListItem(
            id=r.id,
            topic=r.topic,
            created_at=_aware_utc(r.created_at),
            ended_at=_aware_utc(r.ended_at),
            pinned=r.pinned,
            message_count=enr[r.id].message_count,
            last_activity_at=enr[r.id].last_activity_at,
            last_message_preview=enr[r.id].last_message_preview,
            last_session_summary=enr[r.id].last_session_summary,
            progress=enr[r.id].progress,
        )
        for r in rows
    ]
```

Verify `_aware_utc` is still referenced elsewhere in `sessions.py` (e.g. the detail endpoint); the alias import keeps those working. If `json`/`func`/`select` are now unused in `sessions.py`, remove them (CodeQL will flag otherwise).

- [ ] **Step 5b: Extend `SessionListItem` with `last_session_summary` (contract + emit)**

The `/sessions/library` view renders ended cards via the same `cardDescription` (Task 3), whose ended tier needs `last_session_summary`. The library endpoint returns `SessionListItem`, which does NOT carry that field today — so without this, every ended library card reads "Completed" regardless of its real summary. Add it (codegen-first):

In `docs/api/openapi.yaml`, add to `SessionListItem.properties` (after `last_message_preview`):

```yaml
        last_session_summary: { type: [string, "null"], default: null }
```

Run: `python backend/scripts/gen_contracts.py` — `SessionListItem` gains `last_session_summary: str | None = None`. The `_enrich_list_items` body above already passes `last_session_summary=enr[r.id].last_session_summary` (Step 5). Confirm `git diff backend/contracts/models.py` shows only the additive `SessionListItem` field, then verify no drift: `python backend/scripts/gen_contracts.py && git diff --exit-code backend/contracts/`.

(`RecentSessionSummary` keeps sourcing its summary via `_parse_profile(...).last_session_summary` in Task 2 — unchanged. Only `SessionListItem` needed the new field.)

- [ ] **Step 6: Run the full sessions suite to verify no regression**

Run: `cd backend && pytest tests/test_sessions_perf.py tests/test_sessions.py tests/test_session_enrichment.py -v`
Expected: all PASS — including `test_list_sessions_query_count_constant` (still set-based) and `test_list_sessions_enriched_fields` (unchanged output).

- [ ] **Step 7: Commit**

```bash
git add backend/services/session_enrichment.py backend/routes/sessions.py backend/tests/test_session_enrichment.py docs/api/openapi.yaml backend/contracts/models.py
git commit -m "refactor(sessions): extract compute_enrichment + add last_session_summary to SessionListItem"
```

---

## Task 2: Enrich `recent_topics` (contract + aggregate)

**Files:**
- Modify: `docs/api/openapi.yaml` (`RecentSessionSummary`, ~lines 836-846)
- Regenerated: `backend/contracts/models.py` (via codegen)
- Modify: `backend/services/profile_service.py:219-242`
- Test: `backend/tests/test_profile_aggregate.py` (extend)

- [ ] **Step 1: Write the failing test (seed ChatMessages — non-vacuous)**

Add to `backend/tests/test_profile_aggregate.py`. The new fields are only meaningful if messages exist, so seed them. Mirror `test_list_sessions_enriched_fields`.

```python
import json
from contextlib import contextmanager
from sqlalchemy import event as _sa_event


# Mirrors backend/tests/test_sessions_perf.py::count_queries (kept local to avoid
# cross-test-module import; dedupe into a shared helper is a future option).
@contextmanager
def _count_queries(db):
    bind = db.get_bind()
    state = {"n": 0}

    def _before(conn, cursor, statement, params, context, executemany):
        state["n"] += 1

    _sa_event.listen(bind, "before_cursor_execute", _before)
    try:
        yield state
    finally:
        _sa_event.remove(bind, "before_cursor_execute", _before)


def test_recent_topics_carry_enriched_fields(client, db_session):
    from datetime import datetime, timedelta, timezone
    from db.models import ChatMessage, Session as SessionModel, User

    db_session.add(User(id=USER_ID))
    db_session.flush()
    base = datetime(2026, 6, 1, tzinfo=timezone.utc)
    prof = {"focus_target_gap": "ATP yield",
            "mastered_concepts": ["a", "b", "c"], "confirmed_gaps": []}
    db_session.add(SessionModel(id="s_rich", user_id=USER_ID, topic="Glycolysis",
                                created_at=base, topic_profile_json=json.dumps(prof)))
    db_session.add(ChatMessage(session_id="s_rich", role="user", content="hi",
                               created_at=base))
    db_session.add(ChatMessage(session_id="s_rich", role="assistant",
                               content="glycolysis nets 2 ATP per glucose",
                               created_at=base + timedelta(minutes=1)))
    db_session.commit()

    r = client.get("/api/profile/aggregate", params={"user_id": USER_ID})
    assert r.status_code == 200, r.text
    rt = next(t for t in r.json()["recent_topics"] if t["id"] == "s_rich")
    assert rt["message_count"] == 2
    assert rt["last_message_preview"] == "glycolysis nets 2 ATP per glucose"
    assert rt["last_activity_at"] is not None
    assert rt["progress"]["focus_target_gap"] == "ATP yield"
    assert rt["progress"]["mastered_count"] == 3


def test_recent_topics_enrichment_is_set_based(client, db_session):
    from datetime import datetime, timezone
    from db.models import ChatMessage, Session as SessionModel, User

    db_session.add(User(id=USER_ID))
    db_session.flush()
    base = datetime(2026, 6, 1, tzinfo=timezone.utc)
    for n in range(8):  # more than the 5-row recent window
        sid = f"s{n}"
        db_session.add(SessionModel(id=sid, user_id=USER_ID, topic=f"t{n}",
                                    created_at=base, topic_profile_json="{}"))
        db_session.add(ChatMessage(session_id=sid, role="user", content="x",
                                   created_at=base))
    db_session.commit()

    with _count_queries(db_session) as q:
        r = client.get("/api/profile/aggregate", params={"user_id": USER_ID})
    assert r.status_code == 200, r.text
    # Set-based path is ~4-5 total queries (baseline ~2 + compute_enrichment's 2);
    # a per-session preview over the 5-row recent window would clear this. Keep the
    # bound tight so the assertion actually proves "set-based", not just "not insane".
    assert q["n"] <= 6, f"aggregate enrichment not set-based: {q['n']} queries"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_profile_aggregate.py::test_recent_topics_carry_enriched_fields -v`
Expected: FAIL — `KeyError` on `rt["message_count"]` / `rt["progress"]`: the service does not yet pass those kwargs, so the serialized `recent_topics` items lack the keys. (The codegen in Step 3-4 makes the fields *legal*; the service change in Step 5 makes them *present* — that is the RED→GREEN flip.)

- [ ] **Step 3: Extend the OpenAPI schema (source of truth)**

In `docs/api/openapi.yaml`, add to `RecentSessionSummary.properties` (after `last_session_summary`):

```yaml
        message_count: { type: integer, default: 0 }
        last_activity_at: { type: [string, "null"], format: date-time, default: null }
        last_message_preview: { type: [string, "null"], default: null }
        progress:
          oneOf:
            - $ref: "#/components/schemas/SessionProgress"
            - type: "null"
          default: null
```

Leave `required: [id, topic, created_at]` unchanged (the new fields are optional).

- [ ] **Step 4: Regenerate contracts**

Run: `python backend/scripts/gen_contracts.py`
Expected: `backend/contracts/models.py` `RecentSessionSummary` now has the 4 new fields. Confirm with: `git diff backend/contracts/models.py` (should show only the additive RecentSessionSummary fields).

- [ ] **Step 5: Enrich `recent_topics` in the service**

In `backend/services/profile_service.py`, add the import and update the `recent_topics` build (lines ~219-242):

```python
from services.session_enrichment import compute_enrichment
```

```python
    recent = list(reversed(sessions[-5:]))
    recent_enr = compute_enrichment(db, recent)
    recent_topics = [
        RecentSessionSummary(
            id=s.id,
            topic=s.topic or "",
            created_at=s.created_at,
            ended_at=s.ended_at,
            last_session_summary=_parse_profile(
                s.topic_profile_json
            ).last_session_summary,
            message_count=recent_enr[s.id].message_count,
            last_activity_at=recent_enr[s.id].last_activity_at,
            last_message_preview=recent_enr[s.id].last_message_preview,
            progress=recent_enr[s.id].progress,
        )
        for s in recent
    ]
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_profile_aggregate.py tests/test_contracts.py -v`
Expected: PASS — including the two new tests and the contract round-trip tests.

- [ ] **Step 7: Verify no contract drift (CI parity)**

Run: `python backend/scripts/gen_contracts.py && git diff --exit-code backend/contracts/`
Expected: exit 0, no diff (codegen output already committed).

- [ ] **Step 8: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts/models.py backend/services/profile_service.py backend/tests/test_profile_aggregate.py
git commit -m "feat(sessions): enrich recent_topics with count/activity/preview/progress"
```

---

## Task 3: Frontend card-description util

**Why:** The layered precedence is display logic the spec reuses in library + sidebar (WS2). Build it once as pure functions — trivial to unit-test across every tier.

**Files:**
- Create: `frontend/src/utils/sessionCard.js`
- Test: `frontend/src/__tests__/sessionCard.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/sessionCard.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { stripAutoPrefix, cardDescription, cardMeta } from '@/utils/sessionCard.js'

const active = (over = {}) => ({
  id: 's', topic: 'Bio', created_at: '2026-06-01T00:00:00Z',
  ended_at: null, message_count: 0, last_activity_at: null,
  last_message_preview: null, progress: { focus_target_gap: null, mastered_count: 0 },
  ...over,
})

describe('stripAutoPrefix', () => {
  it('removes a leading [auto] marker', () => {
    expect(stripAutoPrefix('[auto] Recap of cells')).toBe('Recap of cells')
  })
  it('passes through plain text and null', () => {
    expect(stripAutoPrefix('hello')).toBe('hello')
    expect(stripAutoPrefix(null)).toBe('')
  })
})

describe('cardDescription — active precedence', () => {
  it('tier 1: focus_target_gap wins', () => {
    const s = active({ progress: { focus_target_gap: 'ATP yield', mastered_count: 2 },
                       last_message_preview: 'ignored' })
    expect(cardDescription(s)).toBe('Focus: ATP yield')
  })
  it('tier 2: preview when no focus', () => {
    const s = active({ last_message_preview: 'glycolysis nets 2 ATP',
                       progress: { focus_target_gap: null, mastered_count: 5 } })
    expect(cardDescription(s)).toBe('glycolysis nets 2 ATP')
  })
  it('tier 2: whitespace-only preview is skipped', () => {
    const s = active({ last_message_preview: '   ',
                       progress: { focus_target_gap: null, mastered_count: 3 } })
    expect(cardDescription(s)).toBe('3 concepts mastered')
  })
  it('tier 3: mastered_count, singular vs plural', () => {
    expect(cardDescription(active({ progress: { focus_target_gap: null, mastered_count: 1 } })))
      .toBe('1 concept mastered')
    expect(cardDescription(active({ progress: { focus_target_gap: null, mastered_count: 4 } })))
      .toBe('4 concepts mastered')
  })
  it('tier 4: empty string when nothing to show', () => {
    expect(cardDescription(active())).toBe('')
  })
  it('handles null progress safely', () => {
    expect(cardDescription(active({ progress: null }))).toBe('')
  })
})

describe('cardDescription — ended', () => {
  it('shows summary with [auto] stripped', () => {
    const s = active({ ended_at: '2026-06-02T00:00:00Z',
                       last_session_summary: '[auto] Covered the Krebs cycle' })
    expect(cardDescription(s)).toBe('Covered the Krebs cycle')
  })
  it('falls back to Completed', () => {
    const s = active({ ended_at: '2026-06-02T00:00:00Z', last_session_summary: null })
    expect(cardDescription(s)).toBe('Completed')
  })
})

describe('cardMeta', () => {
  it('pluralizes messages and includes last-active', () => {
    const s = active({ message_count: 3, last_activity_at: '2026-06-01T00:00:00Z' })
    expect(cardMeta(s)).toMatch(/^3 messages · last active /)
  })
  it('singular message; falls back to created_at when no activity', () => {
    const s = active({ message_count: 1, last_activity_at: null })
    expect(cardMeta(s)).toMatch(/^1 message · last active /)
  })
  it('omits the activity clause when no timestamp at all', () => {
    const s = active({ message_count: 0, created_at: null, last_activity_at: null })
    expect(cardMeta(s)).toBe('0 messages')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- --run sessionCard`
Expected: FAIL — cannot resolve `@/utils/sessionCard.js`.

- [ ] **Step 3: Implement the util**

Create `frontend/src/utils/sessionCard.js`:

```javascript
import { formatRelative } from '@/utils/formatDate.js'

const AUTO_RE = /^\[auto\]\s*/

export function stripAutoPrefix(s) {
  return (s || '').replace(AUTO_RE, '')
}

// Primary description line. Active: focus -> preview -> mastery -> ''.
// Ended: summary (auto-stripped) -> 'Completed'.
export function cardDescription(session) {
  if (session.ended_at) {
    return stripAutoPrefix(session.last_session_summary) || 'Completed'
  }
  const gap = session.progress && session.progress.focus_target_gap
  if (gap) return `Focus: ${gap}`
  const preview = (session.last_message_preview || '').trim()
  if (preview) return preview
  const mastered = (session.progress && session.progress.mastered_count) || 0
  if (mastered > 0) return `${mastered} concept${mastered === 1 ? '' : 's'} mastered`
  return ''
}

// Secondary meta line: "<n> messages · last active <rel>".
export function cardMeta(session) {
  const count = session.message_count || 0
  const noun = count === 1 ? 'message' : 'messages'
  const ts = session.last_activity_at || session.created_at
  const left = `${count} ${noun}`
  return ts ? `${left} · last active ${formatRelative(ts)}` : left
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- --run sessionCard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/sessionCard.js frontend/src/__tests__/sessionCard.test.js
git commit -m "feat(sessions): add cardDescription/cardMeta util for session cards"
```

---

## Task 4: Wire Home shelf to the util + "View all sessions →"

**Scope guard:** change DISPLAY only. Do NOT touch `sortedRecent` or the backend's 5-row selection.

**Files:**
- Modify: `frontend/src/views/HomeView.vue` (replace `snippetText`; add meta line + affordance)
- Test: `frontend/src/__tests__/homeView.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/__tests__/homeView.test.js`. Update `makeRecent` (or add a richer factory) to include the new fields, then assert rendered copy. Note the existing `apiAggregate.mockResolvedValue({ recent_topics: [] })` in `beforeEach` — override per test.

```javascript
function makeRichRecent(id, over = {}) {
  return {
    id, topic: 'Glycolysis', created_at: new Date().toISOString(), ended_at: null,
    last_session_summary: null, message_count: 4,
    last_activity_at: new Date().toISOString(), last_message_preview: null,
    progress: { focus_target_gap: 'ATP yield', mastered_count: 0 }, ...over,
  }
}

it('renders the layered card description (focus tier)', async () => {
  apiAggregate.mockResolvedValue({ recent_topics: [makeRichRecent('r1')] })
  const store = useSessionStore()
  vi.spyOn(store, 'listSessions').mockResolvedValue([])
  const wrapper = mountView()
  await flushPromises()
  expect(wrapper.get('[data-testid="home-recent-r1"]').text()).toContain('Focus: ATP yield')
})

it('shows a "View all sessions" link to /sessions when sessions exist', async () => {
  apiAggregate.mockResolvedValue({ recent_topics: [makeRichRecent('r1')] })
  const store = useSessionStore()
  vi.spyOn(store, 'listSessions').mockResolvedValue([])
  store.sessions = [makeRichRecent('r1')]
  const wrapper = mountView()
  await flushPromises()
  const link = wrapper.get('[data-testid="home-view-all"]')
  expect(link.attributes('to') || link.attributes('href')).toContain('/sessions')
})
```

**Required stub fix (mandatory, not optional):** `homeView.test.js` declares `RouterLink` with `props: ['to']`, so `to` is consumed by the prop and never rendered as an HTML attribute — the link assertion CANNOT pass otherwise. Update BOTH stubs to bind it: the `vi.mock('vue-router')` one (~line 11) AND the `global.stubs` one (~line 40 — this is the stub that actually renders under `mount(HomeView, { global: { stubs } })`), each to `{ props: ['to'], template: '<a :href="to"><slot /></a>' }`.

**Also update the existing assertion** at `homeView.test.js:281`. Row `a1` is a bare `makeRecent` (no `progress`/`last_message_preview`), so it now renders `cardDescription(s) || 'No activity yet'` instead of the deleted "In progress…" string. Change `.toContain('In progress')` → `.toContain('No activity yet')`. (The `[auto]`-strip test and the ended-row assertion are unaffected by the added `cardMeta` line.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- --run homeView`
Expected: FAIL — description still reads "In progress — pick up…"; no `home-view-all` element.

- [ ] **Step 3: Update HomeView**

In `frontend/src/views/HomeView.vue`:

1. Import the util and drop the inline `snippetText`:

```javascript
import { cardDescription, cardMeta } from '@/utils/sessionCard.js'
```

2. In the template, replace the `<p class="recent-snippet">…snippetText(s)…</p>` block with the description + meta lines:

```vue
<p
  class="recent-snippet"
  :class="{ 'recent-snippet-muted': !cardDescription(s) }"
>
  {{ cardDescription(s) || 'No activity yet' }}
</p>
<p class="recent-meta">{{ cardMeta(s) }}</p>
```

3. Remove the now-unused `snippetText` function (lines ~201-204).

4. Add the affordance directly after the `</ul>` of `.recent-list`, still inside the `v-if="sortedRecent.length"` section:

```vue
<RouterLink to="/sessions" class="recent-view-all" data-testid="home-view-all">
  View all sessions
  <i class="pi pi-arrow-right" aria-hidden="true" />
</RouterLink>
```

Ensure `RouterLink` is imported/available (it's globally registered by vue-router; no import needed in `<script setup>`).

5. Add scoped styles (match existing tokens) for `.recent-meta` and `.recent-view-all`:

```css
.recent-meta {
  margin: 2px 0 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.recent-view-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  font-size: 0.9rem;
  color: var(--color-accent);
  text-decoration: none;
}
.recent-view-all:hover { text-decoration: underline; }
/* Ended-summary descriptions clamp to 2 lines (spec). */
.recent-snippet {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test:unit -- --run homeView`
Expected: PASS — including the updated line-281 assertion ('No activity yet') and the mandatory RouterLink stub fix. NOTE: the existing test at :281 only passes once you have applied BOTH the stub fix and the assertion change above; the original `.toContain('In progress')` will fail because Step 3 deletes that string.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/HomeView.vue frontend/src/__tests__/homeView.test.js
git commit -m "feat(sessions): layered home card copy + View all sessions link"
```

---

## Task 5: API client + store action for the library

**Files:**
- Modify: `frontend/src/services/sessionsApi.js`
- Modify: `frontend/src/stores/session.js`
- Test: `frontend/src/__tests__/sessionStore.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/__tests__/sessionStore.test.js`. Extend the existing `vi.mock('@/services/sessionsApi.js', …)` factory to include `getSessionLibrary: vi.fn()`.

```javascript
it('fetchLibrary returns the page and toggles libraryLoading', async () => {
  const page = { items: [{ id: 's1' }], total: 1, limit: 20, offset: 0 }
  sessionsApi.getSessionLibrary.mockResolvedValueOnce(page)
  const s = useSessionStore()
  const out = await s.fetchLibrary({ status: 'all', limit: 20, offset: 0 })
  expect(sessionsApi.getSessionLibrary).toHaveBeenCalledWith({ status: 'all', limit: 20, offset: 0 })
  expect(out).toEqual(page)
  expect(s.libraryLoading).toBe(false)
  expect(s.libraryError).toBeNull()
})

it('fetchLibrary records error and rethrows', async () => {
  sessionsApi.getSessionLibrary.mockRejectedValueOnce(new Error('boom'))
  const s = useSessionStore()
  await expect(s.fetchLibrary({})).rejects.toThrow('boom')
  expect(s.libraryError).toBeTruthy()
  expect(s.libraryLoading).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- --run sessionStore`
Expected: FAIL — `s.fetchLibrary is not a function` / mock has no `getSessionLibrary`.

- [ ] **Step 3: Add the API call**

In `frontend/src/services/sessionsApi.js` (mirror the existing `listSessions`):

```javascript
// params: { status?: 'all'|'active'|'ended', q?: string,
//           sort?: 'last_activity'|'created'|'topic', limit?: number, offset?: number }
export const getSessionLibrary = (params) => apiGet('/sessions/library', params)
```

- [ ] **Step 4: Add the store action**

In `frontend/src/stores/session.js`: add refs and action (follow the existing `loading`/`error` pattern, but library-scoped so it never clobbers the sidebar's `sessions`):

```javascript
const libraryLoading = ref(false)
const libraryError = ref(null)

async function fetchLibrary(params) {
  libraryLoading.value = true
  libraryError.value = null
  try {
    return await sessionsApi.getSessionLibrary(params)
  } catch (e) {
    libraryError.value = e?.message || 'Failed to load sessions'
    throw e
  } finally {
    libraryLoading.value = false
  }
}
```

Export `libraryLoading`, `libraryError`, `fetchLibrary` from the store's return object. Confirm `sessionsApi` is imported (it is, for `listSessions`).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- --run sessionStore`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/sessionsApi.js frontend/src/stores/session.js frontend/src/__tests__/sessionStore.test.js
git commit -m "feat(sessions): getSessionLibrary api + fetchLibrary store action"
```

---

## Task 6: `/sessions` route + library view shell (list/loading/empty/error)

**Files:**
- Modify: `frontend/src/router/index.js`
- Create: `frontend/src/views/SessionsLibraryView.vue`
- Test: `frontend/src/__tests__/sessionsLibraryView.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/sessionsLibraryView.test.js`:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

vi.mock('@/services/sessionsApi.js', () => ({ getSessionLibrary: vi.fn() }))

import SessionsLibraryView from '@/views/SessionsLibraryView.vue'
import * as sessionsApi from '@/services/sessionsApi.js'

const stubs = {
  EmptyState: { template: '<div data-testid="empty-stub"><slot name="cta" /></div>' },
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}

function page(items, over = {}) {
  return { items, total: items.length, limit: 20, offset: 0, ...over }
}
function item(id, over = {}) {
  return {
    id, topic: `Topic ${id}`, created_at: '2026-06-01T00:00:00Z', ended_at: null,
    message_count: 2, last_activity_at: '2026-06-01T00:00:00Z',
    last_message_preview: null, last_session_summary: null,
    progress: { focus_target_gap: 'gap-' + id, mastered_count: 0 },
    ...over,
  }
}

describe('SessionsLibraryView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    push.mockClear()
    sessionsApi.getSessionLibrary.mockReset()
  })

  it('renders rich cards from the library page', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a'), item('b')]))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    expect(wrapper.findAll('[data-testid^="library-card-"]')).toHaveLength(2)
    expect(wrapper.get('[data-testid="library-card-a"]').text()).toContain('Focus: gap-a')
  })

  it('shows the empty state when no results', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(page([]))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    expect(wrapper.find('[data-testid="empty-stub"]').exists()).toBe(true)
  })

  it('shows an error message when the fetch fails', async () => {
    sessionsApi.getSessionLibrary.mockRejectedValue(new Error('nope'))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    expect(wrapper.get('[data-testid="library-error"]').exists()).toBe(true)
  })

  it('navigates to the session on card click', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')]))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    await wrapper.get('[data-testid="library-card-a"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'a' } })
  })

  // Guards the cross-model defect: the library is fed SessionListItem (not
  // RecentSessionSummary). This fails unless SessionListItem carries
  // last_session_summary (Task 1 Step 5b) AND it is in the item() factory.
  it('ended card shows the auto-stripped summary, not "Completed"', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(page([
      item('z', { ended_at: '2026-06-02T00:00:00Z',
                  last_session_summary: '[auto] Covered the Krebs cycle' }),
    ]))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    const card = wrapper.get('[data-testid="library-card-z"]')
    expect(card.text()).toContain('Covered the Krebs cycle')
    expect(card.text()).not.toContain('Completed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- --run sessionsLibraryView`
Expected: FAIL — cannot resolve `@/views/SessionsLibraryView.vue`.

- [ ] **Step 3: Register the route**

In `frontend/src/router/index.js`, add to the `routes` array (place before `/session/:id` for readability; no path conflict exists):

```javascript
{
  path: '/sessions',
  name: 'sessions-library',
  component: () => import('../views/SessionsLibraryView.vue'),
},
```

- [ ] **Step 4: Implement the view shell**

Create `frontend/src/views/SessionsLibraryView.vue`. This step implements load + list + empty + error + loading; controls and pagination come in Tasks 7-8. Use `cardDescription`/`cardMeta` for copy and `EmptyState` for zero-results.

```vue
<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '@/stores/session.js'
import { cardDescription, cardMeta } from '@/utils/sessionCard.js'
import EmptyState from '@/components/EmptyState.vue'

const router = useRouter()
const store = useSessionStore()

const items = ref([])
const total = ref(0)
const limit = ref(20)
const offset = ref(0)
const loading = ref(false)
const error = ref(null)

// Controls (wired in Task 7).
const status = ref('all')
const q = ref('')
const sort = ref('last_activity')

async function load() {
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
    items.value = page.items
    total.value = page.total
    limit.value = page.limit
    offset.value = page.offset
  } catch (e) {
    error.value = e?.message || 'Failed to load sessions'
  } finally {
    loading.value = false
  }
}

function open(id) {
  router.push({ name: 'session', params: { id } })
}

onMounted(load)
defineExpose({ load }) // used by control/pagination tasks
</script>

<template>
  <main class="library">
    <header class="library-head">
      <h1 class="library-title">All sessions</h1>
    </header>

    <p v-if="loading" class="muted" data-testid="library-loading">Loading...</p>
    <p v-else-if="error" class="error" data-testid="library-error">{{ error }}</p>

    <EmptyState
      v-else-if="!items.length"
      tone="pause"
      eyebrow="library"
      headline="No sessions found"
      subtext="Try a different filter or start a new session."
    />

    <ul v-else class="library-grid">
      <li
        v-for="s in items"
        :key="s.id"
        class="library-card"
        :data-testid="`library-card-${s.id}`"
        role="button"
        tabindex="0"
        @click="open(s.id)"
        @keydown.enter="open(s.id)"
      >
        <div class="library-card-head">
          <span class="library-topic">{{ s.topic || 'Untitled' }}</span>
          <span class="library-status" :class="{ ended: !!s.ended_at }">
            {{ s.ended_at ? 'Ended' : 'Active' }}
          </span>
        </div>
        <p class="library-desc">{{ cardDescription(s) || 'No activity yet' }}</p>
        <p class="library-meta">{{ cardMeta(s) }}</p>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.library { max-width: 880px; margin: 0 auto; padding: 24px 16px 64px; }
.library-title { font-size: 1.4rem; margin: 0 0 16px; color: var(--color-text); }
.library-grid { list-style: none; margin: 0; padding: 0; display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.library-card { border: 1px solid var(--color-border); border-radius: var(--radius-md, 14px);
  background: var(--color-surface); padding: 14px; cursor: pointer;
  transition: border-color var(--motion-fast, 140ms); }
.library-card:hover { border-color: var(--color-accent-soft); }
.library-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.library-topic { font-weight: 600; color: var(--color-text); }
.library-status { font-size: 0.72rem; color: var(--color-accent); }
.library-status.ended { color: var(--color-text-muted); }
.library-desc { margin: 8px 0 4px; color: var(--color-text);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.library-meta { margin: 0; font-size: 0.8rem; color: var(--color-text-muted); }
.muted { color: var(--color-text-muted); }
.error { color: var(--signal-error); }
</style>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npm run test:unit -- --run sessionsLibraryView`
Expected: PASS (render, empty, error, navigate).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/router/index.js frontend/src/views/SessionsLibraryView.vue frontend/src/__tests__/sessionsLibraryView.test.js
git commit -m "feat(sessions): /sessions library view shell (list/empty/error)"
```

---

## Task 7: Library controls — search + Active/Ended/All filter + sort

**Files:**
- Modify: `frontend/src/views/SessionsLibraryView.vue`
- Test: `frontend/src/__tests__/sessionsLibraryView.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Add to `sessionsLibraryView.test.js`:

```javascript
it('refetches with status filter when a tab is clicked', async () => {
  sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')]))
  const wrapper = mount(SessionsLibraryView, { global: { stubs } })
  await flushPromises()
  sessionsApi.getSessionLibrary.mockClear()
  sessionsApi.getSessionLibrary.mockResolvedValue(page([item('b', { ended_at: '2026-06-02T00:00:00Z' })]))
  await wrapper.get('[data-testid="library-filter-ended"]').trigger('click')
  await flushPromises()
  expect(sessionsApi.getSessionLibrary).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'ended', offset: 0 }),
  )
})

it('refetches with sort when sort changes', async () => {
  sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')]))
  const wrapper = mount(SessionsLibraryView, { global: { stubs } })
  await flushPromises()
  sessionsApi.getSessionLibrary.mockClear()
  sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')]))
  await wrapper.get('[data-testid="library-sort"]').setValue('topic')
  await flushPromises()
  expect(sessionsApi.getSessionLibrary).toHaveBeenCalledWith(
    expect.objectContaining({ sort: 'topic' }),
  )
})

it('searching resets offset to 0 and passes q', async () => {
  vi.useFakeTimers()
  sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')], { total: 50 }))
  const wrapper = mount(SessionsLibraryView, { global: { stubs } })
  await flushPromises()
  sessionsApi.getSessionLibrary.mockClear()
  sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')]))
  await wrapper.get('[data-testid="library-search"]').setValue('gly')
  vi.advanceTimersByTime(300)
  await flushPromises()
  expect(sessionsApi.getSessionLibrary).toHaveBeenCalledWith(
    expect.objectContaining({ q: 'gly', offset: 0 }),
  )
  vi.useRealTimers()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- --run sessionsLibraryView`
Expected: FAIL — control elements don't exist yet.

- [ ] **Step 3: Add controls + handlers**

In `SessionsLibraryView.vue` `<script setup>`, add a debounced search and change handlers that reset `offset` and reload:

```javascript
const STATUSES = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'ended', label: 'Ended' },
]

function setStatus(next) {
  status.value = next
  offset.value = 0
  load()
}

function onSortChange() {
  offset.value = 0
  load()
}

let searchTimer = null
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    offset.value = 0
    load()
  }, 250)
}
```

Add to the template, above the list/empty/error block:

```vue
<div class="library-controls">
  <div class="library-filter" role="tablist" aria-label="Filter by status">
    <button
      v-for="opt in STATUSES"
      :key="opt.key"
      type="button"
      class="library-filter-btn"
      :class="{ active: status === opt.key }"
      :data-testid="`library-filter-${opt.key}`"
      role="tab"
      :aria-selected="status === opt.key"
      @click="setStatus(opt.key)"
    >
      {{ opt.label }}
    </button>
  </div>

  <input
    v-model="q"
    type="search"
    class="library-search"
    data-testid="library-search"
    placeholder="Search topics..."
    aria-label="Search sessions by topic"
    @input="onSearchInput"
  />

  <select
    v-model="sort"
    class="library-sort"
    data-testid="library-sort"
    aria-label="Sort sessions"
    @change="onSortChange"
  >
    <option value="last_activity">Last active</option>
    <option value="created">Newest</option>
    <option value="topic">Topic</option>
  </select>
</div>
```

Add minimal scoped styles for `.library-controls` (flex row, gap, wrap), `.library-filter-btn` (pill, `.active` uses `--color-accent`), `.library-search`/`.library-sort` (token border + radius). Keep consistent with existing inputs.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test:unit -- --run sessionsLibraryView`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/SessionsLibraryView.vue frontend/src/__tests__/sessionsLibraryView.test.js
git commit -m "feat(sessions): library search, status filter, and sort controls"
```

---

## Task 8: Library pagination

**Files:**
- Modify: `frontend/src/views/SessionsLibraryView.vue`
- Test: `frontend/src/__tests__/sessionsLibraryView.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Add to `sessionsLibraryView.test.js`:

```javascript
it('Next advances offset by limit and refetches; Prev goes back', async () => {
  sessionsApi.getSessionLibrary.mockResolvedValue(
    page([item('a')], { total: 45, limit: 20, offset: 0 }),
  )
  const wrapper = mount(SessionsLibraryView, { global: { stubs } })
  await flushPromises()

  sessionsApi.getSessionLibrary.mockClear()
  sessionsApi.getSessionLibrary.mockResolvedValue(page([item('b')], { total: 45, limit: 20, offset: 20 }))
  await wrapper.get('[data-testid="library-next"]').trigger('click')
  await flushPromises()
  expect(sessionsApi.getSessionLibrary).toHaveBeenCalledWith(expect.objectContaining({ offset: 20 }))

  sessionsApi.getSessionLibrary.mockClear()
  sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')], { total: 45, limit: 20, offset: 0 }))
  await wrapper.get('[data-testid="library-prev"]').trigger('click')
  await flushPromises()
  expect(sessionsApi.getSessionLibrary).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }))
})

it('disables Next on the last page', async () => {
  sessionsApi.getSessionLibrary.mockResolvedValue(
    page([item('a')], { total: 10, limit: 20, offset: 0 }),
  )
  const wrapper = mount(SessionsLibraryView, { global: { stubs } })
  await flushPromises()
  expect(wrapper.get('[data-testid="library-next"]').attributes('disabled')).toBeDefined()
  expect(wrapper.get('[data-testid="library-prev"]').attributes('disabled')).toBeDefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- --run sessionsLibraryView`
Expected: FAIL — no pager elements.

- [ ] **Step 3: Add pagination**

In `<script setup>` add computed bounds + handlers:

```javascript
import { computed } from 'vue'

const hasPrev = computed(() => offset.value > 0)
const hasNext = computed(() => offset.value + limit.value < total.value)
const rangeLabel = computed(() => {
  if (!total.value) return '0 of 0'
  const start = offset.value + 1
  const end = Math.min(offset.value + limit.value, total.value)
  return `${start}–${end} of ${total.value}`
})

function nextPage() {
  if (!hasNext.value) return
  offset.value += limit.value
  load()
}
function prevPage() {
  if (!hasPrev.value) return
  offset.value = Math.max(0, offset.value - limit.value)
  load()
}
```

(Add `computed` to the existing `vue` import.) Add the pager below the list (only when there are items):

```vue
<nav v-if="items.length" class="library-pager" aria-label="Pagination">
  <button
    type="button"
    class="library-pg-btn"
    data-testid="library-prev"
    :disabled="!hasPrev"
    @click="prevPage"
  >
    Prev
  </button>
  <span class="library-range">{{ rangeLabel }}</span>
  <button
    type="button"
    class="library-pg-btn"
    data-testid="library-next"
    :disabled="!hasNext"
    @click="nextPage"
  >
    Next
  </button>
</nav>
```

Add minimal scoped styles for `.library-pager` (flex, centered, gap), `.library-pg-btn` (token border, `:disabled` dimmed), `.library-range` (muted).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test:unit -- --run sessionsLibraryView`
Expected: PASS.

- [ ] **Step 5: Run the full frontend + backend suites**

Run: `cd frontend && npm run test:unit -- --run`
Run: `cd backend && pytest -q`
Expected: all green. Coverage thresholds are global (`lines:80, statements:80, functions:70, branches:65`). The new view adds several untested fallback branches (`s.topic || 'Untitled'`, `cardDescription(s) || 'No activity yet'`, the empty `rangeLabel` `'0 of 0'` path, and the `e?.message || 'Failed to load sessions'` catch fallback). If branches dip below 65, add these two targeted tests to `sessionsLibraryView.test.js`:

```javascript
it('covers Untitled topic and the empty 0-of-0 range', async () => {
  // total:0 with one item exercises both `topic || 'Untitled'` and rangeLabel '0 of 0'.
  sessionsApi.getSessionLibrary.mockResolvedValue(
    page([item('a', { topic: '' })], { total: 0, limit: 20, offset: 0 }),
  )
  const wrapper = mount(SessionsLibraryView, { global: { stubs } })
  await flushPromises()
  expect(wrapper.get('[data-testid="library-card-a"]').text()).toContain('Untitled')
})

it('falls back to a generic message on a non-Error rejection', async () => {
  sessionsApi.getSessionLibrary.mockRejectedValue('weird')
  const wrapper = mount(SessionsLibraryView, { global: { stubs } })
  await flushPromises()
  expect(wrapper.get('[data-testid="library-error"]').text()).toBe('Failed to load sessions')
})
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/SessionsLibraryView.vue frontend/src/__tests__/sessionsLibraryView.test.js
git commit -m "feat(sessions): library pagination (prev/next + range)"
```

---

## Executor notes (read before starting)

- **Backend before frontend.** Frontend descriptions read `progress`/`last_message_preview`/`last_activity_at` off `recent_topics`; those only exist after Tasks 1-2 ship. Unit tests mock the payload, so frontend tests pass regardless — but a **manual smoke against a not-yet-deployed backend will show empty descriptions** ("No activity yet"). That is expected, not a bug.
- **Frontend tests must supply the new fields** in any mocked `recent_topics` / library `items` — use the `makeRichRecent` / `item` factories in the plan, not bare `{id, topic}`.
- **Codegen, never hand-edit** `backend/contracts/models.py`. Run `python backend/scripts/gen_contracts.py` and commit the diff with the YAML.
- **No scope creep into WS2/WS3:** display-only changes to the home shelf; do not re-sort by `last_activity`, do not touch the sidebar rows, do not add prefetch/cache.

## Manual smoke (after Task 8, with backend running)

1. `docker compose up` (or run backend + `npm run dev`). Sign in.
2. Home: recent cards show real focus/preview/mastery copy + "N messages · last active …"; "View all sessions →" is present.
3. Click "View all sessions" → `/sessions`. Verify: cards render; search filters by topic; Active/Ended/All tabs filter; sort changes order; Prev/Next paginate and disable at bounds; empty filter shows the empty state.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-09-ws1-home-cards-and-sessions-library.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session via executing-plans, batch execution with checkpoints.

Which approach?
