# Smart Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prior-topic intercept + knowledge-level capture on the start pages, per spec `docs/superpowers/specs/2026-07-30-smart-start-design.md`.

**Architecture:** New `GET /api/sessions/lookup` (case-insensitive exact topic match), optional `declared_level` on session create, optional `diagnostic_accepted` on chat requests that renders `DIAGNOSTIC: ACCEPTED` into the prompt. Frontend adds a `useStartFlow` composable + two components (`StartTopicIntercept`, `StartLevelPicker`) shared by HomeView and NewSessionView; SessionView gains a `?quiz=1` auto-send mirroring the existing `?review_gap=` pattern.

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic contracts (codegen from OpenAPI), Vue 3 + Pinia + vitest, pytest.

## Global Constraints

- Contracts are codegen: edit `docs/api/openapi.yaml` FIRST, then run `python backend/scripts/gen_contracts.py` from repo root. Never hand-edit `backend/contracts/`.
- No emojis in code or comments.
- No DB migration in this slice. No new columns.
- Branch: `feat/smart-start` off `dev`.
- Backend tests run from `backend/` with `pytest`. Frontend from `frontend/` with `npm run test:unit -- --run`. Lint from `frontend/` with `npm run lint`.
- `git diff` can return false-empty in this environment (rtk wrapper); use `git status --porcelain` to check for drift/changes.
- Level enum values everywhere: `beginner | intermediate | advanced` (contract `KnowledgeLevel`).
- Quiz seed message text, exact: `Quiz me so you can pitch this at the right level.`
- Existing behavior that MUST NOT change: diagnostic grading, all-skip re-fire, PATCH-mid-batch-wins, in-chat DiagnosticConsentCard for the skip path, review-gaps flow.

---

### Task 0: Branch

**Files:** none.

- [ ] **Step 1:** From repo root: `git checkout dev && git pull --ff-only && git checkout -b feat/smart-start`

---

### Task 1: API contract — lookup endpoint, declared_level, diagnostic_accepted

**Files:**
- Modify: `docs/api/openapi.yaml`
- Regenerate: `backend/contracts/` (via script)

**Interfaces:**
- Produces (used by Tasks 2-5): Pydantic models `SessionLookupResult { active_match: SessionMatch | None, ended_match: SessionMatch | None }`, `SessionMatch { session_id: str, title: str, ended_at: datetime | None, gap_count: int, knowledge_level: Literal["beginner","intermediate","advanced"] | None }`; `SessionCreateRequest.declared_level`; `ChatRequest.diagnostic_accepted: bool = False`.

- [ ] **Step 1: Edit `docs/api/openapi.yaml`**

Add path (next to `/api/sessions/library`, ~line 145; match existing inline-flow style):

```yaml
  /api/sessions/lookup:
    get:
      tags: [sessions]
      summary: Case-insensitive exact-match lookup of the caller's sessions by topic.
      operationId: lookupSessionsByTopic
      parameters:
        - in: query
          name: topic
          required: true
          schema: { type: string, maxLength: 200 }
      responses:
        "200":
          description: Lookup result. ended_match is only populated when there is no active match.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SessionLookupResult"
```

Add schemas (near `TopicProfile`, ~line 859):

```yaml
    SessionMatch:
      type: object
      additionalProperties: false
      required: [session_id, title]
      properties:
        session_id: { type: string, maxLength: 64 }
        title:      { type: string, maxLength: 200 }
        ended_at:   { type: [string, "null"], format: date-time, default: null }
        gap_count:  { type: integer, default: 0 }
        knowledge_level:
          oneOf:
            - $ref: "#/components/schemas/KnowledgeLevel"
            - type: "null"
          default: null

    SessionLookupResult:
      type: object
      additionalProperties: false
      properties:
        active_match:
          oneOf:
            - $ref: "#/components/schemas/SessionMatch"
            - type: "null"
          default: null
        ended_match:
          oneOf:
            - $ref: "#/components/schemas/SessionMatch"
            - type: "null"
          default: null
```

Extend `SessionCreateRequest` (~line 1122) with one property:

```yaml
        declared_level:
          oneOf:
            - $ref: "#/components/schemas/KnowledgeLevel"
            - type: "null"
          default: null
```

Extend `ChatRequest` (~line 1109) with one property:

```yaml
        diagnostic_accepted: { type: boolean, default: false }
```

- [ ] **Step 2: Regenerate contracts**

Run from repo root: `python backend/scripts/gen_contracts.py`
Then verify the new models exist: from `backend/`: `python -c "from contracts import SessionLookupResult, SessionMatch, SessionCreateRequest, ChatRequest; print(SessionCreateRequest.model_fields['declared_level']); print(ChatRequest.model_fields['diagnostic_accepted'])"`
Expected: both fields print with default None / False.

- [ ] **Step 3: Run backend suite to confirm nothing broke**

From `backend/`: `pytest -q`
Expected: all pass (new optional fields are backward-compatible).

- [ ] **Step 4: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts/
git commit -m "feat(contract): session lookup endpoint, declared_level, diagnostic_accepted"
```

---

### Task 2: Backend — GET /api/sessions/lookup

**Files:**
- Modify: `backend/routes/sessions.py` (route goes AFTER `list_session_library` ~line 279 and BEFORE `GET /sessions/{session_id}` ~line 337 — literal path must precede the parameterized one)
- Test: `backend/tests/test_session_lookup.py` (new)

**Interfaces:**
- Consumes: Task 1 models.
- Produces: `GET /api/sessions/lookup?topic=` → `SessionLookupResult`. Match rule: `lower(trim(topic))` equality, user-scoped. Active first (latest created); ended only when no active (latest `ended_at`). Empty/whitespace topic → empty result. No side effects.

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_session_lookup.py` (conventions per `backend/tests/test_sessions_route.py`: `client` fixture auto-injects auth from body/query `user_id`; in-memory sqlite):

```python
"""TDD: GET /api/sessions/lookup — case-insensitive exact topic match."""

from datetime import datetime, timedelta

from contracts import ConceptEntry, TopicProfile
from db.models import Session as SessionModel, User

USER_ID = "u1"
OTHER_ID = "u2"


def _mk_session(db, *, sid, user_id=USER_ID, topic, ended_at=None, profile=None):
    db.add(
        SessionModel(
            id=sid,
            user_id=user_id,
            topic=topic,
            ended_at=ended_at,
            topic_profile_json=(profile or TopicProfile()).model_dump_json(),
        )
    )
    db.commit()


def _lookup(client, topic, user_id=USER_ID):
    return client.get("/api/sessions/lookup", params={"topic": topic, "user_id": user_id})


def test_no_match_returns_empty(client, db_session):
    db_session.add(User(id=USER_ID))
    db_session.commit()
    r = _lookup(client, "totally new topic")
    assert r.status_code == 200, r.text
    assert r.json() == {"active_match": None, "ended_match": None}


def test_active_match_case_and_whitespace_insensitive(client, db_session):
    db_session.add(User(id=USER_ID))
    _mk_session(db_session, sid="s1", topic="Glycolysis")
    r = _lookup(client, "  glycolysis ")
    body = r.json()
    assert body["active_match"]["session_id"] == "s1"
    assert body["active_match"]["title"] == "Glycolysis"
    assert body["active_match"]["ended_at"] is None
    assert body["ended_match"] is None


def test_ended_match_only_when_no_active(client, db_session):
    db_session.add(User(id=USER_ID))
    profile = TopicProfile(
        knowledge_level="intermediate",
        confirmed_gaps=[ConceptEntry(name="ATP yield"), ConceptEntry(name="ETC location")],
    )
    _mk_session(
        db_session, sid="s2", topic="glycolysis",
        ended_at=datetime(2026, 7, 1), profile=profile,
    )
    r = _lookup(client, "Glycolysis")
    body = r.json()
    assert body["active_match"] is None
    assert body["ended_match"]["session_id"] == "s2"
    assert body["ended_match"]["gap_count"] == 2
    assert body["ended_match"]["knowledge_level"] == "intermediate"


def test_active_beats_ended(client, db_session):
    db_session.add(User(id=USER_ID))
    _mk_session(db_session, sid="s3", topic="css", ended_at=datetime(2026, 7, 1))
    _mk_session(db_session, sid="s4", topic="CSS")
    body = _lookup(client, "css").json()
    assert body["active_match"]["session_id"] == "s4"
    assert body["ended_match"] is None


def test_latest_ended_wins(client, db_session):
    db_session.add(User(id=USER_ID))
    _mk_session(db_session, sid="s5", topic="mitosis", ended_at=datetime(2026, 6, 1))
    _mk_session(db_session, sid="s6", topic="Mitosis", ended_at=datetime(2026, 7, 1))
    body = _lookup(client, "mitosis").json()
    assert body["ended_match"]["session_id"] == "s6"


def test_other_user_sessions_invisible(client, db_session):
    db_session.add(User(id=USER_ID))
    db_session.add(User(id=OTHER_ID))
    db_session.commit()
    _mk_session(db_session, sid="s7", user_id=OTHER_ID, topic="recursion")
    body = _lookup(client, "recursion").json()
    assert body == {"active_match": None, "ended_match": None}


def test_blank_topic_returns_empty(client, db_session):
    db_session.add(User(id=USER_ID))
    db_session.commit()
    body = _lookup(client, "   ").json()
    assert body == {"active_match": None, "ended_match": None}
```

- [ ] **Step 2: Run to verify failure**

From `backend/`: `pytest tests/test_session_lookup.py -q`
Expected: FAIL (404s — route missing).

- [ ] **Step 3: Implement route**

In `backend/routes/sessions.py`, add imports (`SessionLookupResult`, `SessionMatch` from `contracts`; `func` from `sqlalchemy` if not present), then insert AFTER `list_session_library` and BEFORE `get_session`:

```python
@router.get("/sessions/lookup", response_model=SessionLookupResult)
def lookup_sessions_by_topic(
    topic: str = Query(..., max_length=200),
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    """Case-insensitive exact-match lookup used by the start pages.

    Active match wins; ended match (most recently ended) only when no
    active session matches. Read-only.
    """
    normalized = topic.strip().lower()
    if not normalized:
        return SessionLookupResult()

    def _to_match(row: SessionModel) -> SessionMatch:
        profile = TopicProfile.model_validate_json(row.topic_profile_json)
        return SessionMatch(
            session_id=row.id,
            title=row.topic,
            ended_at=row.ended_at,
            gap_count=len(profile.confirmed_gaps),
            knowledge_level=profile.knowledge_level,
        )

    base = db.query(SessionModel).filter(
        SessionModel.user_id == user_id,
        func.lower(func.trim(SessionModel.topic)) == normalized,
    )
    active = (
        base.filter(SessionModel.ended_at.is_(None))
        .order_by(SessionModel.created_at.desc())
        .first()
    )
    if active is not None:
        return SessionLookupResult(active_match=_to_match(active))
    ended = (
        base.filter(SessionModel.ended_at.is_not(None))
        .order_by(SessionModel.ended_at.desc())
        .first()
    )
    if ended is not None:
        return SessionLookupResult(ended_match=_to_match(ended))
    return SessionLookupResult()
```

- [ ] **Step 4: Run tests**

`pytest tests/test_session_lookup.py -q` → PASS. Then `pytest -q` (whole suite) → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/sessions.py backend/tests/test_session_lookup.py
git commit -m "feat(backend): session lookup endpoint for start-page intercept"
```

---

### Task 3: Backend — declared_level on session create

**Files:**
- Modify: `backend/routes/sessions.py` (`create_session`, ~lines 119-198)
- Test: `backend/tests/test_sessions_route.py` (append)

**Interfaces:**
- Consumes: `SessionCreateRequest.declared_level` (Task 1).
- Produces: fresh create with `declared_level` seeds `TopicProfile(knowledge_level=<level>)`; `declared_level` + `seed_mode=resume` → 422.

- [ ] **Step 1: Write failing tests** (append to `backend/tests/test_sessions_route.py`)

```python
def test_post_fresh_with_declared_level_seeds_profile(client, seeded_user):
    r = client.post(
        "/api/sessions",
        json={
            "user_id": USER_ID,
            "topic": "sql joins",
            "seed_mode": "fresh",
            "declared_level": "advanced",
        },
    )
    assert r.status_code == 201, r.text
    profile = TopicProfile.model_validate(r.json()["topic_profile"])
    assert profile.knowledge_level == "advanced"


def test_post_resume_with_declared_level_is_422(client, seeded_user, db_session):
    from db.models import Session as SessionModel

    db_session.add(
        SessionModel(
            id="prior1",
            user_id=USER_ID,
            topic="sql joins",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()
    r = client.post(
        "/api/sessions",
        json={
            "user_id": USER_ID,
            "topic": "sql joins",
            "seed_mode": "resume",
            "prior_session_id": "prior1",
            "declared_level": "beginner",
        },
    )
    assert r.status_code == 422, r.text


def test_post_fresh_without_declared_level_unchanged(client, seeded_user):
    r = client.post(
        "/api/sessions",
        json={"user_id": USER_ID, "topic": "plain topic", "seed_mode": "fresh"},
    )
    assert r.status_code == 201, r.text
    profile = TopicProfile.model_validate(r.json()["topic_profile"])
    assert profile.knowledge_level is None
```

Note: if `SessionResponse` nests the profile under a different key than `topic_profile`, read the existing `_to_response` usage in this test file and match it — do not guess.

- [ ] **Step 2: Run to verify failure**

`pytest tests/test_sessions_route.py -q` — the two new tests FAIL (level not seeded; 422 not raised).

- [ ] **Step 3: Implement**

In `create_session`, after the existing seed_mode/prior pairing checks (the two 400 blocks), add:

```python
    if req.declared_level is not None and req.seed_mode == "resume":
        raise HTTPException(
            status_code=422,
            detail="declared_level forbidden when seed_mode=resume",
        )
```

Change the fresh-profile line `profile_json = TopicProfile().model_dump_json()` to:

```python
    profile_json = TopicProfile(knowledge_level=req.declared_level).model_dump_json()
```

(`declared_level` is None by default, so plain fresh creates are byte-identical to before; the resume branch overwrites `profile_json` as today.)

- [ ] **Step 4: Run tests**

`pytest tests/test_sessions_route.py -q` → PASS. `pytest -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/sessions.py backend/tests/test_sessions_route.py
git commit -m "feat(backend): declared_level seeds knowledge level on fresh create"
```

---

### Task 4: Backend — diagnostic_accepted chat flag + DIAGNOSTIC: ACCEPTED prompt

**Files:**
- Modify: `backend/routes/chat.py` (`_build_prompt_state` ~lines 56-110, call site ~249-261)
- Modify: `backend/agent/prompts.py` (IMMUTABLE_RULES diagnostic block ~lines 110-127; `build_dynamic_context` ~lines 234-235)
- Test: `backend/tests/test_chat_diagnostic_accepted.py` (new)

**Interfaces:**
- Consumes: `ChatRequest.diagnostic_accepted` (Task 1).
- Produces: prompt line `DIAGNOSTIC: ACCEPTED` when flag true AND level unknown AND not in review-gaps mode; otherwise existing REQUIRED/OFF behavior. Frontend (Task 11) sends the flag on the quiz seed message.

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_chat_diagnostic_accepted.py`. `_build_prompt_state` is a pure function — unit-test it directly plus the prompt rendering:

```python
"""TDD: diagnostic_accepted flag -> DIAGNOSTIC: ACCEPTED prompt state."""

from agent import prompts
from contracts import ConceptEntry, TopicProfile
from db.models import Session as SessionModel
from routes.chat import _build_prompt_state


def _session(topic="glycolysis"):
    return SessionModel(
        id="s1", user_id="u1", topic=topic,
        topic_profile_json=TopicProfile().model_dump_json(),
    )


def _state(profile, *, accepted, review_gaps=False):
    return _build_prompt_state(
        session=_session(),
        profile=profile,
        ingestion_status="none",
        retrieval_required=False,
        review_gaps=review_gaps,
        diagnostic_accepted=accepted,
        pending_check=None,
        quiz_cooldown=None,
    )


def test_accepted_flag_set_when_level_unknown():
    state = _state(TopicProfile(), accepted=True)
    assert state["diagnostic_required"] is True
    assert state["diagnostic_accepted"] is True


def test_accepted_ignored_when_level_known():
    state = _state(TopicProfile(knowledge_level="beginner"), accepted=True)
    assert state["diagnostic_required"] is False
    assert state.get("diagnostic_accepted", False) is False


def test_review_gaps_wins_over_accepted():
    profile = TopicProfile(confirmed_gaps=[ConceptEntry(name="ATP yield")])
    state = _state(profile, accepted=True, review_gaps=True)
    assert state["diagnostic_required"] is False
    assert state.get("diagnostic_accepted", False) is False


def test_prompt_renders_accepted_label():
    ctx = prompts.build_dynamic_context(
        {"topic": "t", "profile": TopicProfile(), "diagnostic_required": True,
         "diagnostic_accepted": True}
    )
    assert "DIAGNOSTIC: ACCEPTED" in ctx


def test_prompt_renders_required_without_flag():
    ctx = prompts.build_dynamic_context(
        {"topic": "t", "profile": TopicProfile(), "diagnostic_required": True}
    )
    assert "DIAGNOSTIC: REQUIRED" in ctx


def test_immutable_rules_mention_accepted():
    assert "DIAGNOSTIC is ACCEPTED" in prompts.IMMUTABLE_RULES
```

(If `build_dynamic_context` requires more keys than shown, mirror whatever minimal dict existing prompt tests use — check `backend/tests/` for an existing `build_dynamic_context` test and copy its base state.)

- [ ] **Step 2: Run to verify failure**

`pytest tests/test_chat_diagnostic_accepted.py -q` → FAIL (unexpected kwarg `diagnostic_accepted`).

- [ ] **Step 3: Implement**

`backend/routes/chat.py` — add kwarg to `_build_prompt_state` signature: `diagnostic_accepted: bool = False,` (after `review_gap`). After the `prompt_state = {...}` literal, add:

```python
    if diagnostic_accepted and profile.knowledge_level is None:
        prompt_state["diagnostic_accepted"] = True
```

Inside the existing `if review_gaps:` block, where `prompt_state["diagnostic_required"] = False` is set, also add:

```python
            prompt_state["diagnostic_accepted"] = False
```

At the `_prepare_turn` call site, add:

```python
            diagnostic_accepted=getattr(req, "diagnostic_accepted", False),
```

`backend/agent/prompts.py` — in `build_dynamic_context`, replace:

```python
    diagnostic_label = "REQUIRED" if diagnostic_required else "OFF"
```

with:

```python
    if diagnostic_required and state.get("diagnostic_accepted"):
        diagnostic_label = "ACCEPTED"
    elif diagnostic_required:
        diagnostic_label = "REQUIRED"
    else:
        diagnostic_label = "OFF"
```

In `IMMUTABLE_RULES`, inside the KNOWLEDGE DIAGNOSTIC block, after the "If the learner declines or ignores both options" bullet, add:

```
- When DIAGNOSTIC is ACCEPTED, the learner already agreed to the quick check
  before the session started. In this same turn call ask_check_questions with
  exactly 3 multiple-choice items on the TOPIC at increasing difficulty
  (easy, medium, hard). Do not offer the choice again and do not teach in
  depth first.
```

- [ ] **Step 4: Run tests**

`pytest tests/test_chat_diagnostic_accepted.py -q` → PASS. `pytest -q` → PASS (existing prompt/chat tests must be untouched-green).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/chat.py backend/agent/prompts.py backend/tests/test_chat_diagnostic_accepted.py
git commit -m "feat(backend): diagnostic_accepted flag renders DIAGNOSTIC ACCEPTED prompt"
```

---

### Task 5: Frontend plumbing — lookup API, declared_level, diagnosticAccepted

**Files:**
- Modify: `frontend/src/services/sessionsApi.js`
- Modify: `frontend/src/stores/session.js` (`createSession` ~205-227; new `lookupTopic`; `sendMessageStreaming` ~783-806)
- Modify: `frontend/src/services/chatStreamService.js` (`streamChat` ~107-110)
- Test: `frontend/src/__tests__/sessionStore.test.js` (extend — NOTE: its `vi.mock('@/services/sessionsApi.js')` factory enumerates every export; `lookupTopic` MUST be added to that factory or unrelated tests crash)

**Interfaces:**
- Consumes: Tasks 1-4 backend surface.
- Produces (used by Tasks 6-11):
  - `sessionsApi.lookupTopic(topic) -> Promise<{active_match, ended_match}>`
  - `store.lookupTopic(topic)` — same shape, `null` on failure (never throws)
  - `store.createSession({ topic, seedMode, priorSessionId, declaredLevel })` — `declaredLevel` optional, snake_cased into payload
  - `store.sendMessageStreaming({ text, reviewGaps, reviewGap, diagnosticAccepted })`

- [ ] **Step 1: Write failing tests** (extend `frontend/src/__tests__/sessionStore.test.js`)

Add `lookupTopic: vi.fn(),` to the existing `vi.mock('@/services/sessionsApi.js', ...)` factory. Then append:

```js
describe('lookupTopic', () => {
  it('returns lookup payload', async () => {
    sessionsApi.lookupTopic.mockResolvedValue({ active_match: null, ended_match: { session_id: 'e1' } })
    const store = useSessionStore()
    const res = await store.lookupTopic('css')
    expect(sessionsApi.lookupTopic).toHaveBeenCalledWith('css')
    expect(res.ended_match.session_id).toBe('e1')
  })

  it('returns null on failure without setting store error', async () => {
    sessionsApi.lookupTopic.mockRejectedValue(new Error('boom'))
    const store = useSessionStore()
    const res = await store.lookupTopic('css')
    expect(res).toBeNull()
    expect(store.error).toBeNull()
  })
})

describe('createSession declaredLevel', () => {
  it('passes declared_level through', async () => {
    sessionsApi.createSession.mockResolvedValue({ id: 'n1' })
    const store = useSessionStore()
    await store.createSession({ topic: 't', seedMode: 'fresh', priorSessionId: null, declaredLevel: 'advanced' })
    expect(sessionsApi.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ declaredLevel: 'advanced' }),
    )
  })
})
```

Note: existing tests assert `createSession` called with the old three-field object — if any use exact `toHaveBeenCalledWith`, they keep passing because `declaredLevel` defaults to `null` only in the API layer; keep the store passthrough shape `{ topic, seedMode, priorSessionId, declaredLevel }` consistent and fix any exact-match assertions you break by adding `declaredLevel: undefined` — prefer switching those to `expect.objectContaining`.

- [ ] **Step 2: Run to verify failure**

From `frontend/`: `npm run test:unit -- --run src/__tests__/sessionStore.test.js`
Expected: new tests FAIL (`store.lookupTopic` undefined).

- [ ] **Step 3: Implement**

`frontend/src/services/sessionsApi.js` — extend `createSession`, add `lookupTopic`:

```js
export const createSession = ({ topic, seedMode, priorSessionId, declaredLevel }) =>
  apiPost('/sessions', {
    topic,
    seed_mode: seedMode,
    prior_session_id: priorSessionId ?? null,
    declared_level: declaredLevel ?? null,
  })

export const lookupTopic = (topic) => apiGet('/sessions/lookup', { topic }, { silent: true })
```

`frontend/src/stores/session.js` — in `createSession`, accept and forward `declaredLevel`:

```js
  async function createSession({ topic, seedMode, priorSessionId, declaredLevel } = {}) {
    ...
      const created = await sessionsApi.createSession({
        topic,
        seedMode,
        priorSessionId,
        declaredLevel,
      })
```

Add action (near `createSession`) and export it from the store return object:

```js
  async function lookupTopic(topic) {
    // Start-page enhancement: failure must never block session creation.
    try {
      return await sessionsApi.lookupTopic(topic)
    } catch {
      return null
    }
  }
```

`sendMessageStreaming` — add `diagnosticAccepted = false` to the destructured options and pass `diagnosticAccepted` into the `streamChat({...})` call.

`frontend/src/services/chatStreamService.js`:

```js
export async function streamChat({ sessionId, message, reviewGaps = false, reviewGap = null, diagnosticAccepted = false, onEvent, signal }) {
  const payload = { session_id: sessionId, message, review_gaps: reviewGaps }
  if (reviewGap) payload.review_gap = reviewGap
  if (diagnosticAccepted) payload.diagnostic_accepted = true
```

- [ ] **Step 4: Run tests**

`npm run test:unit -- --run src/__tests__/sessionStore.test.js` → PASS, then full `npm run test:unit -- --run` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/sessionsApi.js frontend/src/services/chatStreamService.js frontend/src/stores/session.js frontend/src/__tests__/sessionStore.test.js
git commit -m "feat(frontend): lookup API, declaredLevel and diagnosticAccepted plumbing"
```

---

### Task 6: StartLevelPicker component

**Files:**
- Create: `frontend/src/components/start/StartLevelPicker.vue`
- Test: `frontend/src/__tests__/startLevelPicker.test.js` (new)

**Interfaces:**
- Produces: `<StartLevelPicker :busy="bool" @select="(level)" @quiz @skip />`. Levels emitted: `beginner | intermediate | advanced`. Test ids: `start-level-beginner|intermediate|advanced`, `start-level-quiz`, `start-level-skip`.

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

import StartLevelPicker from '@/components/start/StartLevelPicker.vue'

describe('StartLevelPicker', () => {
  it('emits select with level', async () => {
    const w = mount(StartLevelPicker)
    await w.get('[data-testid="start-level-advanced"]').trigger('click')
    expect(w.emitted('select')).toEqual([['advanced']])
  })

  it('emits quiz and skip', async () => {
    const w = mount(StartLevelPicker)
    await w.get('[data-testid="start-level-quiz"]').trigger('click')
    await w.get('[data-testid="start-level-skip"]').trigger('click')
    expect(w.emitted('quiz')).toHaveLength(1)
    expect(w.emitted('skip')).toHaveLength(1)
  })

  it('disables all buttons when busy', () => {
    const w = mount(StartLevelPicker, { props: { busy: true } })
    for (const b of w.findAll('button')) {
      expect(b.attributes('disabled')).toBeDefined()
    }
  })

  it('has a group label for a11y', () => {
    const w = mount(StartLevelPicker)
    expect(w.get('[role="group"]').attributes('aria-label')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npm run test:unit -- --run src/__tests__/startLevelPicker.test.js` → FAIL (component missing).

- [ ] **Step 3: Implement**

`frontend/src/components/start/StartLevelPicker.vue` (chip styling mimics `.quick-pick` in `NewSessionView.vue:356-381`; scoped CSS, design tokens):

```vue
<script setup>
defineProps({
  busy: { type: Boolean, default: false },
})
defineEmits(['select', 'quiz', 'skip'])

const LEVELS = [
  { value: 'beginner', label: 'New to this' },
  { value: 'intermediate', label: 'Know some' },
  { value: 'advanced', label: 'Know it well' },
]
</script>

<template>
  <div class="level-picker" role="group" aria-label="How well do you know this topic?">
    <p class="level-title">How well do you know this?</p>
    <div class="level-chips">
      <button
        v-for="lvl in LEVELS"
        :key="lvl.value"
        type="button"
        class="level-chip"
        :data-testid="`start-level-${lvl.value}`"
        :disabled="busy"
        @click="$emit('select', lvl.value)"
      >
        {{ lvl.label }}
      </button>
      <button
        type="button"
        class="level-chip level-chip-quiz"
        data-testid="start-level-quiz"
        :disabled="busy"
        @click="$emit('quiz')"
      >
        Quiz me (3 questions)
      </button>
    </div>
    <button
      type="button"
      class="level-skip"
      data-testid="start-level-skip"
      :disabled="busy"
      @click="$emit('skip')"
    >
      Skip
    </button>
  </div>
</template>

<style scoped>
.level-picker {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
}

.level-title {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.level-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.4rem;
}

.level-chip {
  padding: 0.4rem 0.875rem;
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease,
    border-color var(--motion-fast) ease;
}

.level-chip:hover:not(:disabled) {
  background: var(--color-accent-soft);
  color: var(--color-accent-text);
  border-color: var(--color-accent);
}

.level-chip:disabled,
.level-skip:disabled {
  opacity: 0.5;
  cursor: default;
}

.level-chip-quiz {
  border-color: var(--color-accent);
  color: var(--color-accent-text);
}

.level-skip {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 0.8125rem;
  cursor: pointer;
  text-decoration: underline;
}
</style>
```

- [ ] **Step 4: Run tests** — target file PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/start/StartLevelPicker.vue frontend/src/__tests__/startLevelPicker.test.js
git commit -m "feat(frontend): StartLevelPicker chips component"
```

---

### Task 7: StartTopicIntercept component

**Files:**
- Create: `frontend/src/components/start/StartTopicIntercept.vue`
- Test: `frontend/src/__tests__/startTopicIntercept.test.js` (new)

**Interfaces:**
- Produces: `<StartTopicIntercept :match="SessionMatch" :kind="'active'|'ended'" :busy="bool" @open-existing @continue-topic @start-fresh @cancel />`. Test ids: `intercept-open-existing`, `intercept-continue`, `intercept-fresh`, `intercept-cancel`.

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

import StartTopicIntercept from '@/components/start/StartTopicIntercept.vue'

const activeMatch = { session_id: 'a1', title: 'CSS', ended_at: null, gap_count: 0, knowledge_level: null }
const endedMatch = { session_id: 'e1', title: 'CSS', ended_at: '2026-07-01T00:00:00Z', gap_count: 3, knowledge_level: 'intermediate' }

describe('StartTopicIntercept', () => {
  it('active kind offers open-existing and start-fresh', async () => {
    const w = mount(StartTopicIntercept, { props: { match: activeMatch, kind: 'active' } })
    expect(w.find('[data-testid="intercept-continue"]').exists()).toBe(false)
    await w.get('[data-testid="intercept-open-existing"]').trigger('click')
    await w.get('[data-testid="intercept-fresh"]').trigger('click')
    expect(w.emitted('open-existing')).toHaveLength(1)
    expect(w.emitted('start-fresh')).toHaveLength(1)
  })

  it('ended kind offers continue and start-fresh, shows gap count', async () => {
    const w = mount(StartTopicIntercept, { props: { match: endedMatch, kind: 'ended' } })
    expect(w.find('[data-testid="intercept-open-existing"]').exists()).toBe(false)
    expect(w.text()).toContain('3 gaps open')
    await w.get('[data-testid="intercept-continue"]').trigger('click')
    expect(w.emitted('continue-topic')).toHaveLength(1)
  })

  it('ended kind with zero gaps hides gap copy', () => {
    const w = mount(StartTopicIntercept, {
      props: { match: { ...endedMatch, gap_count: 0 }, kind: 'ended' },
    })
    expect(w.text()).not.toContain('gaps open')
  })

  it('emits cancel', async () => {
    const w = mount(StartTopicIntercept, { props: { match: activeMatch, kind: 'active' } })
    await w.get('[data-testid="intercept-cancel"]').trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify failure** — FAIL (component missing).

- [ ] **Step 3: Implement**

```vue
<script setup>
import { computed } from 'vue'

const props = defineProps({
  match: { type: Object, required: true },
  kind: { type: String, required: true, validator: (v) => ['active', 'ended'].includes(v) },
  busy: { type: Boolean, default: false },
})
defineEmits(['open-existing', 'continue-topic', 'start-fresh', 'cancel'])

const gapLine = computed(() =>
  props.kind === 'ended' && props.match.gap_count > 0
    ? `${props.match.gap_count} ${props.match.gap_count === 1 ? 'gap' : 'gaps'} open`
    : '',
)
</script>

<template>
  <div class="intercept" data-testid="start-intercept" role="region" aria-label="Existing session found">
    <button
      type="button"
      class="intercept-cancel"
      data-testid="intercept-cancel"
      aria-label="Dismiss"
      :disabled="busy"
      @click="$emit('cancel')"
    >
      <i class="pi pi-times" aria-hidden="true" />
    </button>
    <p v-if="kind === 'active'" class="intercept-line">
      You have an active session on <strong>"{{ match.title }}"</strong>.
    </p>
    <p v-else class="intercept-line">
      You studied <strong>"{{ match.title }}"</strong> before<template v-if="gapLine">
        ({{ gapLine }})</template>.
    </p>
    <div class="intercept-actions">
      <button
        v-if="kind === 'active'"
        type="button"
        class="intercept-primary"
        data-testid="intercept-open-existing"
        :disabled="busy"
        @click="$emit('open-existing')"
      >
        Open it
      </button>
      <button
        v-else
        type="button"
        class="intercept-primary"
        data-testid="intercept-continue"
        :disabled="busy"
        @click="$emit('continue-topic')"
      >
        Continue where you left off
      </button>
      <button
        type="button"
        class="intercept-secondary"
        data-testid="intercept-fresh"
        :disabled="busy"
        @click="$emit('start-fresh')"
      >
        Start fresh
      </button>
    </div>
  </div>
</template>

<style scoped>
.intercept {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.875rem 2.25rem 0.875rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.intercept-line {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.intercept-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.intercept-primary,
.intercept-secondary {
  padding: 0.4rem 0.875rem;
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--motion-fast) ease, border-color var(--motion-fast) ease;
}

.intercept-primary {
  background: var(--color-accent-soft);
  color: var(--color-accent-text);
  border: 1px solid var(--color-accent);
}

.intercept-secondary {
  background: var(--color-surface);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}

.intercept-cancel {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
}

.intercept-primary:disabled,
.intercept-secondary:disabled,
.intercept-cancel:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/start/StartTopicIntercept.vue frontend/src/__tests__/startTopicIntercept.test.js
git commit -m "feat(frontend): StartTopicIntercept choice card"
```

---

### Task 8: useStartFlow composable

**Files:**
- Create: `frontend/src/composables/useStartFlow.js`
- Test: `frontend/src/__tests__/useStartFlow.test.js` (new)

**Interfaces:**
- Consumes: `store.lookupTopic`, `store.createSession`, `store.continueTopic` (Task 5 + existing), `router.push`.
- Produces:

```js
const {
  stage,          // ref: 'idle' | 'intercept' | 'level'
  busy,           // ref bool
  interceptMatch, // ref: SessionMatch | null
  interceptKind,  // ref: 'active' | 'ended' | null
  begin,          // (topic) => Promise<void>   lookup -> intercept or level
  openExisting,   // () => void                 navigate to matched session
  continuePrior,  // () => Promise<void>        resume via store.continueTopic
  startFresh,     // () => void                 intercept -> level
  pickLevel,      // (level) => Promise<void>   create with declaredLevel, navigate
  pickQuiz,       // () => Promise<void>        create plain, navigate with ?quiz=1
  skipLevel,      // () => Promise<void>        create plain, navigate
  cancel,         // () => void                 back to idle
} = useStartFlow({ store, router })
```

State machine: `idle --begin--> (intercept | level)`; `intercept --startFresh--> level`; `intercept --openExisting/continuePrior--> navigation`; `level --pickLevel/pickQuiz/skipLevel--> navigation`; `cancel` from any stage back to `idle`. Lookup failure or empty result → straight to `level`. A 409 `duplicate_topic` from create → `intercept` with kind `active` (match built from the 409 body: `{ session_id, title: topic }`).

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'

import { useStartFlow } from '@/composables/useStartFlow.js'

function makeStore(overrides = {}) {
  return {
    lookupTopic: vi.fn().mockResolvedValue({ active_match: null, ended_match: null }),
    createSession: vi.fn().mockResolvedValue({ id: 'new1' }),
    continueTopic: vi.fn().mockResolvedValue({ id: 'res1' }),
    ...overrides,
  }
}

const router = { push: vi.fn() }

beforeEach(() => router.push.mockClear())

describe('useStartFlow', () => {
  it('no match: begin goes to level stage', async () => {
    const flow = useStartFlow({ store: makeStore(), router })
    await flow.begin('new topic')
    expect(flow.stage.value).toBe('level')
  })

  it('lookup failure (null) falls back to level stage', async () => {
    const store = makeStore({ lookupTopic: vi.fn().mockResolvedValue(null) })
    const flow = useStartFlow({ store, router })
    await flow.begin('t')
    expect(flow.stage.value).toBe('level')
  })

  it('active match: intercept stage, openExisting navigates', async () => {
    const store = makeStore({
      lookupTopic: vi.fn().mockResolvedValue({
        active_match: { session_id: 'a1', title: 'CSS' }, ended_match: null,
      }),
    })
    const flow = useStartFlow({ store, router })
    await flow.begin('css')
    expect(flow.stage.value).toBe('intercept')
    expect(flow.interceptKind.value).toBe('active')
    flow.openExisting()
    expect(router.push).toHaveBeenCalledWith({ name: 'session', params: { id: 'a1' } })
  })

  it('ended match: continuePrior resumes and navigates', async () => {
    const store = makeStore({
      lookupTopic: vi.fn().mockResolvedValue({
        active_match: null,
        ended_match: { session_id: 'e1', title: 'CSS', gap_count: 2 },
      }),
    })
    const flow = useStartFlow({ store, router })
    await flow.begin('css')
    expect(flow.interceptKind.value).toBe('ended')
    await flow.continuePrior()
    expect(store.continueTopic).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e1', topic: 'CSS' }),
    )
    expect(router.push).toHaveBeenCalledWith({ name: 'session', params: { id: 'res1' } })
  })

  it('startFresh moves intercept -> level', async () => {
    const store = makeStore({
      lookupTopic: vi.fn().mockResolvedValue({
        active_match: null, ended_match: { session_id: 'e1', title: 'CSS' },
      }),
    })
    const flow = useStartFlow({ store, router })
    await flow.begin('css')
    flow.startFresh()
    expect(flow.stage.value).toBe('level')
  })

  it('pickLevel creates with declaredLevel and navigates', async () => {
    const store = makeStore()
    const flow = useStartFlow({ store, router })
    await flow.begin('t')
    await flow.pickLevel('advanced')
    expect(store.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 't', seedMode: 'fresh', declaredLevel: 'advanced' }),
    )
    expect(router.push).toHaveBeenCalledWith({ name: 'session', params: { id: 'new1' } })
  })

  it('pickQuiz creates plain and navigates with quiz query', async () => {
    const store = makeStore()
    const flow = useStartFlow({ store, router })
    await flow.begin('t')
    await flow.pickQuiz()
    expect(store.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ declaredLevel: null }),
    )
    expect(router.push).toHaveBeenCalledWith({
      name: 'session', params: { id: 'new1' }, query: { quiz: '1' },
    })
  })

  it('skipLevel creates plain and navigates without query', async () => {
    const store = makeStore()
    const flow = useStartFlow({ store, router })
    await flow.begin('t')
    await flow.skipLevel()
    expect(router.push).toHaveBeenCalledWith({ name: 'session', params: { id: 'new1' } })
  })

  it('409 duplicate on create shows active intercept instead of navigating', async () => {
    const err = Object.assign(new Error('dup'), {
      status: 409,
      body: { detail: { code: 'duplicate_topic', session_id: 'a9' } },
    })
    const store = makeStore({ createSession: vi.fn().mockRejectedValue(err) })
    const flow = useStartFlow({ store, router })
    await flow.begin('t')
    await flow.skipLevel()
    expect(router.push).not.toHaveBeenCalled()
    expect(flow.stage.value).toBe('intercept')
    expect(flow.interceptKind.value).toBe('active')
    expect(flow.interceptMatch.value.session_id).toBe('a9')
  })

  it('cancel returns to idle', async () => {
    const flow = useStartFlow({ store: makeStore(), router })
    await flow.begin('t')
    flow.cancel()
    expect(flow.stage.value).toBe('idle')
  })
})
```

- [ ] **Step 2: Run to verify failure** — FAIL (composable missing).

- [ ] **Step 3: Implement**

`frontend/src/composables/useStartFlow.js`:

```js
import { ref } from 'vue'

// State machine for the start pages: lookup -> intercept -> level -> create.
// Lookup is an enhancement: any failure falls through to the level picker.
export function useStartFlow({ store, router }) {
  const stage = ref('idle') // 'idle' | 'intercept' | 'level'
  const busy = ref(false)
  const interceptMatch = ref(null)
  const interceptKind = ref(null) // 'active' | 'ended' | null
  const topic = ref('')

  async function begin(rawTopic) {
    const trimmed = (rawTopic || '').trim()
    if (!trimmed || busy.value) return
    topic.value = trimmed
    busy.value = true
    try {
      const res = await store.lookupTopic(trimmed)
      if (res?.active_match) {
        interceptMatch.value = res.active_match
        interceptKind.value = 'active'
        stage.value = 'intercept'
      } else if (res?.ended_match) {
        interceptMatch.value = res.ended_match
        interceptKind.value = 'ended'
        stage.value = 'intercept'
      } else {
        stage.value = 'level'
      }
    } finally {
      busy.value = false
    }
  }

  function openExisting() {
    router.push({ name: 'session', params: { id: interceptMatch.value.session_id } })
  }

  async function continuePrior() {
    if (busy.value) return
    busy.value = true
    try {
      const created = await store.continueTopic({
        id: interceptMatch.value.session_id,
        topic: interceptMatch.value.title,
      })
      if (created) router.push({ name: 'session', params: { id: created.id } })
    } finally {
      busy.value = false
    }
  }

  function startFresh() {
    stage.value = 'level'
  }

  async function _create({ declaredLevel = null, quiz = false } = {}) {
    if (busy.value) return
    busy.value = true
    try {
      const created = await store.createSession({
        topic: topic.value,
        seedMode: 'fresh',
        priorSessionId: null,
        declaredLevel,
      })
      if (!created) return
      const route = { name: 'session', params: { id: created.id } }
      if (quiz) route.query = { quiz: '1' }
      router.push(route)
    } catch (e) {
      if (e?.status === 409 && e?.body?.detail?.code === 'duplicate_topic') {
        // Race backstop: a session appeared between lookup and create.
        interceptMatch.value = { session_id: e.body.detail.session_id, title: topic.value }
        interceptKind.value = 'active'
        stage.value = 'intercept'
        return
      }
      throw e
    } finally {
      busy.value = false
    }
  }

  const pickLevel = (level) => _create({ declaredLevel: level })
  const pickQuiz = () => _create({ quiz: true })
  const skipLevel = () => _create()

  function cancel() {
    stage.value = 'idle'
    interceptMatch.value = null
    interceptKind.value = null
  }

  return {
    stage,
    busy,
    interceptMatch,
    interceptKind,
    begin,
    openExisting,
    continuePrior,
    startFresh,
    pickLevel,
    pickQuiz,
    skipLevel,
    cancel,
  }
}
```

Note: `store.createSession` swallows non-409 errors into `store.error` and returns `undefined` (see `stores/session.js:205-227`) — the `throw e` path only fires for the 409 the store rethrows? It does NOT: the store catches ALL errors via `_setError(e)`. Check `_setError` — if it does not rethrow, the 409 never reaches the composable. **Implementer must verify:** read `_setError` in `stores/session.js`. If it swallows, change `createSession` in the store to rethrow after `_setError(e)` (HomeView/NewSessionView already rely on catching 409 from `store.createSession`, which proves the store rethrows — `HomeView.vue:60-66` has `catch (e)` around `store.createSession`. Confirm and move on.)

- [ ] **Step 4: Run tests** — PASS. Full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/composables/useStartFlow.js frontend/src/__tests__/useStartFlow.test.js
git commit -m "feat(frontend): useStartFlow start-page state machine"
```

---

### Task 9: HomeView integration

**Files:**
- Modify: `frontend/src/views/HomeView.vue` (script lines 36-72, template `.quick` block lines 11-31)
- Test: `frontend/src/__tests__/homeView.test.js` (extend if exists, else create)

**Interfaces:**
- Consumes: `useStartFlow` (Task 8), `StartTopicIntercept` (Task 7), `StartLevelPicker` (Task 6).
- Produces: Home start flow per spec. The old silent-409-redirect and direct `createSession` call in `startQuick` are REMOVED.

- [ ] **Step 1: Write failing tests**

Check for an existing HomeView test file first (`ls frontend/src/__tests__ | grep -i home`); extend it if present, otherwise create `frontend/src/__tests__/homeView.test.js`. Follow the mount conventions of `newSessionView.test.js` (`vi.mock('vue-router', ...)` with `push`, pinia via `setActivePinia(createPinia())`, `vi.spyOn(store, ...)`):

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import HomeView from '@/views/HomeView.vue'
import { useSessionStore } from '@/stores/session.js'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

async function setup({ lookup = { active_match: null, ended_match: null } } = {}) {
  setActivePinia(createPinia())
  const store = useSessionStore()
  vi.spyOn(store, 'listSessions').mockResolvedValue([])
  vi.spyOn(store, 'lookupTopic').mockResolvedValue(lookup)
  vi.spyOn(store, 'createSession').mockResolvedValue({ id: 'n1' })
  vi.spyOn(store, 'continueTopic').mockResolvedValue({ id: 'r1' })
  const w = mount(HomeView)
  await flushPromises()
  return { w, store }
}

async function typeAndStart(w, topic = 'css') {
  await w.get('[data-testid="home-quick-topic"]').setValue(topic)
  await w.get('[data-testid="home-quick-go"]').trigger('click')
  await flushPromises()
}

beforeEach(() => push.mockClear())

describe('HomeView smart start', () => {
  it('no match: shows level picker instead of creating immediately', async () => {
    const { w, store } = await setup()
    await typeAndStart(w)
    expect(store.createSession).not.toHaveBeenCalled()
    expect(w.find('[data-testid="start-level-quiz"]').exists()).toBe(true)
  })

  it('level chip creates with declaredLevel and navigates', async () => {
    const { w, store } = await setup()
    await typeAndStart(w)
    await w.get('[data-testid="start-level-beginner"]').trigger('click')
    await flushPromises()
    expect(store.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ declaredLevel: 'beginner' }),
    )
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'n1' } })
  })

  it('quiz chip navigates with quiz query', async () => {
    const { w } = await setup()
    await typeAndStart(w)
    await w.get('[data-testid="start-level-quiz"]').trigger('click')
    await flushPromises()
    expect(push).toHaveBeenCalledWith({
      name: 'session', params: { id: 'n1' }, query: { quiz: '1' },
    })
  })

  it('active match shows intercept with open-existing', async () => {
    const { w } = await setup({
      lookup: { active_match: { session_id: 'a1', title: 'CSS' }, ended_match: null },
    })
    await typeAndStart(w)
    expect(w.find('[data-testid="intercept-open-existing"]').exists()).toBe(true)
    await w.get('[data-testid="intercept-open-existing"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'a1' } })
  })

  it('ended match continue resumes', async () => {
    const { w, store } = await setup({
      lookup: {
        active_match: null,
        ended_match: { session_id: 'e1', title: 'CSS', gap_count: 1 },
      },
    })
    await typeAndStart(w)
    await w.get('[data-testid="intercept-continue"]').trigger('click')
    await flushPromises()
    expect(store.continueTopic).toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'r1' } })
  })
})
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

Rewrite `HomeView.vue` script + extend template. Script becomes:

```vue
<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import StartLevelPicker from '../components/start/StartLevelPicker.vue'
import StartTopicIntercept from '../components/start/StartTopicIntercept.vue'
import { useStartFlow } from '../composables/useStartFlow.js'
import { useSessionStore } from '../stores/session.js'

const router = useRouter()
const store = useSessionStore()
const quickTopic = ref('')
const flow = useStartFlow({ store, router })

onMounted(() => {
  store.listSessions().catch(() => {})
})

function startQuick() {
  flow.begin(quickTopic.value)
}
</script>
```

Template: keep the `.quick` input/button block (Start button `:disabled="flow.busy.value"` — in template refs auto-unwrap: `:disabled="flow.busy"`), hide it or keep it while the flow panel shows beneath. Insert directly under the `.quick` div:

```vue
      <StartTopicIntercept
        v-if="flow.stage.value === 'intercept'"
        :match="flow.interceptMatch.value"
        :kind="flow.interceptKind.value"
        :busy="flow.busy.value"
        @open-existing="flow.openExisting"
        @continue-topic="flow.continuePrior"
        @start-fresh="flow.startFresh"
        @cancel="flow.cancel"
      />
      <StartLevelPicker
        v-else-if="flow.stage.value === 'level'"
        :busy="flow.busy.value"
        @select="flow.pickLevel"
        @quiz="flow.pickQuiz"
        @skip="flow.skipLevel"
      />
```

IMPORTANT template note: refs returned from a composable object are NOT auto-unwrapped in templates when accessed via the object (`flow.stage` is a ref). Either destructure in script (`const { stage, busy, interceptMatch, interceptKind, begin, ... } = useStartFlow(...)`) and use `stage === 'level'` in the template — RECOMMENDED, matches Vue idiom — or use `.value` explicitly. Destructure and write the template without `.value`.

Also: typing in the input while intercept/level shows should reset the flow — add `@input="flow.cancel"` on the topic input ONLY when stage is not idle (or simply `watch(quickTopic, () => cancel())` in script — one-liner; use the watch).

Delete the old try/catch 409-redirect body of `startQuick` entirely.

- [ ] **Step 4: Run tests** — target + full suite PASS. `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/HomeView.vue frontend/src/__tests__/homeView.test.js
git commit -m "feat(frontend): HomeView smart start with intercept and level picker"
```

---

### Task 10: NewSessionView integration

**Files:**
- Modify: `frontend/src/views/NewSessionView.vue` (replace bespoke duplicate warning lines 83-102 + `submit()` lines 209-244 + supporting state)
- Test: `frontend/src/__tests__/newSessionView.test.js` (extend)

**Interfaces:**
- Consumes: same trio as Task 9.
- Produces: /new keeps quick picks + doc attach; Start goes through `useStartFlow`; uploads still run after create. The `findActiveSessionByTopic` client-side warning + `dupeBlocked` logic are REMOVED (server lookup replaces them).

- [ ] **Step 1: Write failing tests** (extend `newSessionView.test.js`; reuse its stubs/mount helper)

```js
describe('smart start on /new', () => {
  it('start with no match shows level picker, keeps files pending', async () => {
    // spyOn store.lookupTopic -> { active_match: null, ended_match: null }
    // set topic, click submit button
    // expect level picker visible, createSession NOT yet called
  })

  it('level chip creates then uploads attached files then navigates', async () => {
    // attach a file via existing helper in this test file
    // click start, then click [data-testid="start-level-intermediate"]
    // expect createSession called with declaredLevel 'intermediate'
    // expect uploadDocument called with created session id
    // expect push to session n1
  })

  it('active match shows shared intercept, not the old warn block', async () => {
    // lookupTopic -> active_match
    // expect [data-testid="start-intercept"] visible
    // expect [data-testid="new-active-warn"] absent
  })
})
```

Write these as real tests following the file's existing patterns (mount helper, `uploadDocument` mock, file-attach helper already present in that file). The upload-after-create ordering is the key assertion of the second test.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

In `NewSessionView.vue`:
- Remove: `findActiveSessionByTopic` import + `activeOnTopic` / `dupeBlocked` computeds + the `v-if="activeOnTopic"` warn block (lines 83-102) + the 409 handling in `submit()`.
- Add: `useStartFlow` (destructured), the two components rendered where the warn block was.
- Uploads must run AFTER create but BEFORE navigation. `useStartFlow` navigates inside `_create`. Give the composable an optional hook: `useStartFlow({ store, router, beforeNavigate })` where `beforeNavigate(created)` is awaited (if provided) between create and `router.push`. Add this parameter in Task 8's file now (backward-compatible, one line: `if (beforeNavigate) await beforeNavigate(created)`), with a test in `useStartFlow.test.js`:

```js
  it('awaits beforeNavigate hook between create and push', async () => {
    const order = []
    const store = makeStore({
      createSession: vi.fn().mockImplementation(async () => { order.push('create'); return { id: 'n1' } }),
    })
    const beforeNavigate = vi.fn().mockImplementation(async () => order.push('hook'))
    const flow = useStartFlow({ store, router, beforeNavigate })
    await flow.begin('t')
    await flow.skipLevel()
    expect(order).toEqual(['create', 'hook'])
    expect(router.push).toHaveBeenCalled()
  })
```

- NewSessionView passes its existing upload loop as `beforeNavigate` (move the `if (files.value.length)` upload block from `submit()` into that callback; keep its error handling as-is).
- `submit()` shrinks to validation + `begin(topic.value)`.

- [ ] **Step 4: Run tests** — extended files + full suite PASS. Lint clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/NewSessionView.vue frontend/src/composables/useStartFlow.js frontend/src/__tests__/newSessionView.test.js frontend/src/__tests__/useStartFlow.test.js
git commit -m "feat(frontend): NewSessionView shared smart-start flow with upload hook"
```

---

### Task 11: SessionView ?quiz=1 auto-send

**Files:**
- Modify: `frontend/src/views/SessionView.vue` (mirror `handleReviewGapQuery` at ~lines 770-801 and the watcher at ~530-537; call sites where `handleReviewGapQuery()` runs after load)
- Test: `frontend/src/__tests__/sessionViewQuiz.test.js` (new; or extend the existing SessionView query test file if one covers review_gap — check `ls frontend/src/__tests__ | grep -i session` first)

**Interfaces:**
- Consumes: `store.sendMessageStreaming({ text, diagnosticAccepted })` (Task 5).
- Produces: landing on `/session/:id?quiz=1` strips the param and auto-sends the seed message `Quiz me so you can pitch this at the right level.` with `diagnosticAccepted: true`. Guarded on `store.currentSession.id === props.id` (same guard as review seed).

- [ ] **Step 1: Write failing tests**

Locate the existing test covering `?review_gap=` handling and copy its harness (router mock with `route.query`, store spies). Assert:

```js
  it('quiz=1 sends seeded diagnostic message and strips param', async () => {
    // route.query = { quiz: '1' }, currentSession.id matches props.id
    // mount, flushPromises
    expect(replace).toHaveBeenCalledWith({ query: expect.objectContaining({ quiz: undefined }) })
    expect(sendMessageStreaming).toHaveBeenCalledWith({
      text: 'Quiz me so you can pitch this at the right level.',
      diagnosticAccepted: true,
    })
  })

  it('quiz param ignored when session id mismatched', async () => {
    // currentSession null -> no send
  })
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

In `SessionView.vue`, next to `handleReviewGapQuery`:

```js
async function handleQuizQuery() {
  if (!route.query.quiz) return
  router.replace({ query: { ...route.query, quiz: undefined } })
  if (!store.currentSession || store.currentSession.id !== props.id) return
  try {
    await store.sendMessageStreaming({
      text: 'Quiz me so you can pitch this at the right level.',
      diagnosticAccepted: true,
    })
  } catch {
    // store.error already populated; consent card remains as fallback
  }
}
```

Call `handleQuizQuery()` at every site where `handleReviewGapQuery()` is invoked (post-load path in `loadCurrent` and add a `watch(() => route.query.quiz, ...)` twin of the review_gap watcher at lines 530-537). Review-gap takes precedence if both params present: call `handleReviewGapQuery()` first and make `handleQuizQuery()` a no-op when `route.query.review_gap` is set.

- [ ] **Step 4: Run tests** — PASS; full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/SessionView.vue frontend/src/__tests__/sessionViewQuiz.test.js
git commit -m "feat(frontend): quiz query auto-sends accepted diagnostic seed"
```

---

### Task 12: Final verification

**Files:** none new.

- [ ] **Step 1:** From `backend/`: `pytest -q` → all pass (record count).
- [ ] **Step 2:** From `frontend/`: `npm run test:unit -- --run` → all pass (record count). `npm run lint` → clean.
- [ ] **Step 3:** Contract drift: from repo root run `python backend/scripts/gen_contracts.py` then `git status --porcelain backend/contracts/` → EMPTY output (no drift). Do not trust `git diff` (rtk false-empty).
- [ ] **Step 4:** Grep sweep (native Grep, not rtk-rg): no remaining references to `findActiveSessionByTopic` in `NewSessionView.vue`; no `new-active-warn` testid references left in tests except deletions.
- [ ] **Step 5:** Push branch, open PR to `dev` titled `feat: smart start — prior-topic intercept + level-at-start`. PR body: summary, spec link, owed paid smoke (Quiz-me chip → 3 MCQs first response; declared-level chip → no consent card, level-appropriate pitch).

---

## Out of Scope (from spec)

Fuzzy matching, personalized Home cards, goal capture, consent-dismissal persistence, migrations.
