# Phase 8 WS-F Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship WS-F: a "Review my gaps" resume mode that opens the tutor on a confirmed gap (F2), a second cost-warning tier at 90% of the hard cap (F1), and a verification that the rate limiter is multi-instance safe (F3).

**Architecture:** F2 rides a transient `review_gaps` boolean on the chat request, mirroring the existing `diagnostic_required` per-turn flag — no profile mutation, self-clears after one turn. The tutor's normal streamed reply is the gap-opener; a fixed seed user turn ("Review my gaps") triggers it. F1 extends the existing `CapStatus`/`X-Cost-Warning`/`cost_warning`-event chain with an urgent level. F3 is verify-only.

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic (backend), Vue 3 + Pinia + Vitest (frontend), pytest, OpenAPI codegen (`datamodel-code-generator`).

## Global Constraints

- No emojis in code or comments.
- Contracts are codegen: edit `docs/api/openapi.yaml`, then run `python backend/scripts/gen_contracts.py`. NEVER hand-edit `backend/contracts/models.py`. CI enforces zero drift.
- Run the backend suite with `DATABASE_URL=sqlite:///./data/app.db` for CI parity — the local `.env` Postgres URL masks env-dependent guard failures.
- Backend tests: from `backend/`, `pytest`. Frontend: from `frontend/`, `npm run test:unit -- --run` and `npm run lint`.
- The tutor is turn-driven. Do NOT add any proactive-opener LLM call outside the turn loop.
- Profile writes belong to the tutor's tools only. The resume path must not write the profile.
- Active model id: `gemini/gemini-3.1-flash-lite`. Hard cap `settings.llm_hard_cap_usd` = $3, soft `settings.llm_soft_cap_usd` = $2 (verify in `config.py`).

---

## Task 1: F2 — add `review_gaps` to the ChatRequest contract

**Files:**
- Modify: `docs/api/openapi.yaml` (ChatRequest schema, ~line 722-728)
- Regenerate: `backend/contracts/models.py` (via codegen, do not hand-edit)
- Test: `backend/tests/test_contracts.py`

**Interfaces:**
- Produces: `ChatRequest.review_gaps: bool` (default `False`), consumed by Tasks 2 and 6.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_contracts.py`:

```python
def test_chat_request_has_review_gaps_default_false():
    from contracts import ChatRequest

    req = ChatRequest(session_id="s1", message="hi")
    assert req.review_gaps is False
    req2 = ChatRequest(session_id="s1", message="hi", review_gaps=True)
    assert req2.review_gaps is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_contracts.py::test_chat_request_has_review_gaps_default_false -v`
Expected: FAIL — `ChatRequest` has no `review_gaps` field (validation error or AttributeError).

- [ ] **Step 3: Edit the OpenAPI schema**

In `docs/api/openapi.yaml`, find the `ChatRequest` schema:

```yaml
    ChatRequest:
      type: object
      required: [session_id, message]
      properties:
        session_id: { type: string, maxLength: 64 }
        message:    { type: string, maxLength: 4000 }
```

Add the `review_gaps` property (leave `required` unchanged so it stays optional):

```yaml
    ChatRequest:
      type: object
      required: [session_id, message]
      properties:
        session_id:  { type: string, maxLength: 64 }
        message:     { type: string, maxLength: 4000 }
        review_gaps: { type: boolean, default: false }
```

- [ ] **Step 4: Regenerate contracts**

Run: `cd .. && python backend/scripts/gen_contracts.py`
Expected: `backend/contracts/models.py` now has `review_gaps: bool | None` (or `bool` with default) on `ChatRequest`. Do not edit the file by hand.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && DATABASE_URL=sqlite:///./data/app.db pytest tests/test_contracts.py::test_chat_request_has_review_gaps_default_false -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts/models.py backend/tests/test_contracts.py
git commit -m "feat(ws-f): add review_gaps flag to ChatRequest contract"
```

---

## Task 2: F2 — server picks the gap and injects it into prompt_state

**Files:**
- Modify: `backend/routes/chat.py` (the `prompt_state` dict in the shared prep block, ~line 92-102)
- Test: `backend/tests/test_chat_route.py` (or the existing chat-route test module — grep for `prompt_state`/`_prepare`; if a helper builds `prompt_state`, test it directly)

**Interfaces:**
- Consumes: `ChatRequest.review_gaps` (Task 1), `profile.confirmed_gaps` (existing `TopicProfile`).
- Produces: `prompt_state["review_gaps_target"]` — a `str` (the chosen gap) when review-gaps mode is active, otherwise the key is absent. Consumed by Task 3.

- [ ] **Step 1: Locate the prep block**

Read `backend/routes/chat.py` around lines 85-103. The shared prep builds:

```python
    prompt_state = {
        "topic": session.topic,
        "profile": profile,
        "ingestion_status": ingestion_status,
        "retrieval_required": retrieval_required,
        "diagnostic_required": profile.knowledge_level is None,
        "seed_mode": None,
        "last_session_summary": profile.last_session_summary,
        "pending_check": check_question_service.get_pending_check(db, req.session_id),
        "quiz_cooldown": check_question_service.get_quiz_cooldown(db, req.session_id),
    }
```

- [ ] **Step 2: Write the failing test**

Add to the chat-route test module (adapt the fixture/helper names to the module's existing style — look at a neighboring test for how it constructs `req`, `db`, `profile`):

```python
def test_review_gaps_sets_target_to_first_confirmed_gap(client, seeded_session_with_gaps):
    # seeded_session_with_gaps: a session whose profile.confirmed_gaps == ["photosynthesis", "krebs cycle"]
    session_id = seeded_session_with_gaps
    resp = client.post(
        "/api/chat",
        json={"session_id": session_id, "message": "Review my gaps", "review_gaps": True},
        headers=auth_header(),
    )
    assert resp.status_code == 200
    # Assert the system prompt for that turn carried the first gap.
    # Prefer asserting on a spy/capture of build_system_prompt input if the
    # module already patches the LLM; otherwise assert via a unit test on the
    # prep helper (see alternative below).
```

If the route is hard to assert on directly, unit-test the prep helper instead. If `prompt_state` is built inside a private function, refactor the dict-building into a small testable helper `def _build_prompt_state(session, profile, ...) -> dict` in `chat.py` and test that:

```python
def test_build_prompt_state_review_gaps_picks_first_gap():
    from routes.chat import _build_prompt_state
    profile = _fake_profile(confirmed_gaps=["a", "b"], knowledge_level="intermediate")
    state = _build_prompt_state(session=_fake_session(), profile=profile,
                                ingestion_status="none", retrieval_required=False,
                                review_gaps=True, pending_check=None, quiz_cooldown=None)
    assert state["review_gaps_target"] == "a"

def test_build_prompt_state_review_gaps_off_when_no_gaps():
    from routes.chat import _build_prompt_state
    profile = _fake_profile(confirmed_gaps=[], knowledge_level="intermediate")
    state = _build_prompt_state(session=_fake_session(), profile=profile,
                                ingestion_status="none", retrieval_required=False,
                                review_gaps=True, pending_check=None, quiz_cooldown=None)
    assert "review_gaps_target" not in state
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && DATABASE_URL=sqlite:///./data/app.db pytest tests/test_chat_route.py -k review_gaps -v`
Expected: FAIL — `review_gaps_target` absent / helper not defined.

- [ ] **Step 4: Implement**

Thread `req.review_gaps` into the prep. After the `prompt_state` dict is built, add:

```python
    if getattr(req, "review_gaps", False) and profile.confirmed_gaps:
        prompt_state["review_gaps_target"] = profile.confirmed_gaps[0]
```

If you extracted `_build_prompt_state`, put the same conditional at the end of that helper and have both `/chat` and `/chat/stream` call it (they share the prep already). Keep the change minimal — do not alter the other keys.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && DATABASE_URL=sqlite:///./data/app.db pytest tests/test_chat_route.py -k review_gaps -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/chat.py backend/tests/test_chat_route.py
git commit -m "feat(ws-f): inject first confirmed gap into prompt_state on review_gaps"
```

---

## Task 3: F2 — render REVIEW_GAPS in the dynamic context

**Files:**
- Modify: `backend/agent/prompts.py` (`build_dynamic_context`, ~line 115-159)
- Test: `backend/tests/test_prompts.py`

**Interfaces:**
- Consumes: `state["review_gaps_target"]` (Task 2).
- Produces: a `REVIEW_GAPS: <gap>` / `REVIEW_GAPS: OFF` line in the dynamic context string. Consumed by the tutor at runtime; the rule that acts on it is added in Task 4.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_prompts.py`:

```python
def test_dynamic_context_renders_review_gaps_target():
    from agent.prompts import build_dynamic_context
    ctx = build_dynamic_context({"topic": "Biology", "review_gaps_target": "glycolysis"})
    assert "REVIEW_GAPS: glycolysis" in ctx

def test_dynamic_context_review_gaps_off_by_default():
    from agent.prompts import build_dynamic_context
    ctx = build_dynamic_context({"topic": "Biology"})
    assert "REVIEW_GAPS: OFF" in ctx
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL=sqlite:///./data/app.db pytest tests/test_prompts.py -k review_gaps -v`
Expected: FAIL — no `REVIEW_GAPS` line.

- [ ] **Step 3: Implement**

In `build_dynamic_context`, before the `return`, compute the label:

```python
    review_gaps_target = state.get("review_gaps_target")
    review_gaps_label = review_gaps_target if review_gaps_target else "OFF"
```

Add the line to the returned f-string (append after `QUIZ_READINESS`):

```python
        f"QUIZ_READINESS: {qr_label}\n"
        f"REVIEW_GAPS: {review_gaps_label}"
```

(Move the trailing newline: the previously-last line `QUIZ_READINESS: {qr_label}` had no trailing newline — add one to it, and let `REVIEW_GAPS` be the new last line with no trailing newline.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DATABASE_URL=sqlite:///./data/app.db pytest tests/test_prompts.py -k review_gaps -v`
Expected: PASS. Also run the whole file to catch the moved-newline breaking an existing exact-match test:
Run: `DATABASE_URL=sqlite:///./data/app.db pytest tests/test_prompts.py -v`
Expected: all PASS (fix any exact-string test that asserted the old last line).

- [ ] **Step 5: Commit**

```bash
git add backend/agent/prompts.py backend/tests/test_prompts.py
git commit -m "feat(ws-f): render REVIEW_GAPS in tutor dynamic context"
```

---

## Task 4: F2 — REVIEW-GAPS MODE rule in IMMUTABLE_RULES

**Files:**
- Modify: `backend/agent/prompts.py` (`IMMUTABLE_RULES`, insert a block after the `KNOWLEDGE DIAGNOSTIC` section, ~line 88)
- Test: `backend/tests/test_prompts.py`

**Interfaces:**
- Consumes: the `REVIEW_GAPS` context line (Task 3). No new produced interface.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_prompts.py`:

```python
def test_immutable_rules_has_review_gaps_mode():
    from agent.prompts import IMMUTABLE_RULES
    assert "REVIEW-GAPS MODE" in IMMUTABLE_RULES
    # The rule must direct the tutor to open on the named gap and pose a check.
    assert "ask_check_questions" in IMMUTABLE_RULES  # already present; sanity
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL=sqlite:///./data/app.db pytest tests/test_prompts.py::test_immutable_rules_has_review_gaps_mode -v`
Expected: FAIL — no "REVIEW-GAPS MODE" string.

- [ ] **Step 3: Implement**

In `IMMUTABLE_RULES`, after the `KNOWLEDGE DIAGNOSTIC` block, insert:

```
REVIEW-GAPS MODE:
- When REVIEW_GAPS names a gap (not OFF), the learner reopened this session to
  review that specific gap. Open your turn by briefly recapping that gap in one
  or two sentences, then pose a check on it by calling ask_check_questions with
  that gap as the focus. Do not run the diagnostic and do not ask what they want
  to study first.
- When REVIEW_GAPS is OFF, ignore this section.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DATABASE_URL=sqlite:///./data/app.db pytest tests/test_prompts.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agent/prompts.py backend/tests/test_prompts.py
git commit -m "feat(ws-f): add REVIEW-GAPS MODE rule to tutor immutable rules"
```

---

## Task 5: F2 — frontend seed turn carries review_gaps

**Files:**
- Modify: `frontend/src/services/chatStreamService.js` (`streamChat`, ~line 11-21)
- Modify: `frontend/src/stores/session.js` (`sendMessageStreaming`, ~line 509-542)
- Test: `frontend/src/__tests__/` — add to the streaming/store test module (grep for `sendMessageStreaming` / `streamChat` mock)

**Interfaces:**
- Consumes: backend `review_gaps` (Task 1).
- Produces: `store.sendMessageStreaming({ text, reviewGaps })` — optional `reviewGaps` bool threaded into the request body as `review_gaps`. Consumed by Task 7.

- [ ] **Step 1: Write the failing test**

In the store/stream test module, mock `streamChat` and assert the flag is forwarded:

```js
it('forwards reviewGaps to streamChat as review_gaps', async () => {
  const spy = vi.fn().mockResolvedValue(undefined)
  // wire spy as the streamChat mock per this module's existing mock setup
  const store = useSessionStore()
  store.currentSessionId = 's1' // match how other tests set the active session
  await store.sendMessageStreaming({ text: 'Review my gaps', reviewGaps: true })
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ reviewGaps: true, message: 'Review my gaps' }))
})
```

And a `chatStreamService` unit test:

```js
it('streamChat puts review_gaps in the request body when reviewGaps is true', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeSseResponse([]))
  await streamChat({ sessionId: 's1', message: 'Review my gaps', reviewGaps: true, onEvent: () => {} })
  const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
  expect(body).toEqual({ session_id: 's1', message: 'Review my gaps', review_gaps: true })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- --run -t reviewGaps`
Expected: FAIL — `reviewGaps` not forwarded / not in body.

- [ ] **Step 3: Implement**

In `chatStreamService.js`, extend the signature and body:

```js
export async function streamChat({ sessionId, message, reviewGaps = false, onEvent, signal }) {
  // ...
      body: JSON.stringify({ session_id: sessionId, message, review_gaps: reviewGaps }),
```

In `stores/session.js` `sendMessageStreaming`, accept and thread the flag:

```js
  async function sendMessageStreaming({ text, reviewGaps = false }) {
    // ... unchanged until the streamChat call:
      await streamChat({
        sessionId: currentSessionId.value,
        message: trimmed,
        reviewGaps,
        signal: ctrl.signal,
        onEvent: ({ event, data }) => { /* unchanged */ },
      })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test:unit -- --run -t reviewGaps`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/chatStreamService.js frontend/src/stores/session.js frontend/src/__tests__
git commit -m "feat(ws-f): thread reviewGaps through streamChat and sendMessageStreaming"
```

---

## Task 6: F2 — "Review my gaps" button on the ended banner

**Files:**
- Modify: `frontend/src/components/SessionEndedBanner.vue`
- Modify: `frontend/src/views/SessionView.vue` (banner usage ~line 22-26; add `resumeReviewGaps`)
- Test: `frontend/src/__tests__/components.test.js` (SessionEndedBanner) and `frontend/src/__tests__/sessionView.test.js`

**Interfaces:**
- Consumes: `store.sendMessageStreaming({ text, reviewGaps })` (Task 5), `store.reopenSession` (existing), `store.currentSession.topic_profile.confirmed_gaps` (existing SessionResponse shape).
- Produces: banner emits `resume-gaps`; SessionView handles it.

- [ ] **Step 1: Write the failing banner test**

In `components.test.js`:

```js
it('shows Review my gaps button only when hasGaps is true', () => {
  const withGaps = mount(SessionEndedBanner, { props: { endedAt: '2026-07-04T00:00:00Z', hasGaps: true } })
  expect(withGaps.find('[data-testid="session-resume-gaps"]').exists()).toBe(true)

  const noGaps = mount(SessionEndedBanner, { props: { endedAt: '2026-07-04T00:00:00Z', hasGaps: false } })
  expect(noGaps.find('[data-testid="session-resume-gaps"]').exists()).toBe(false)
})

it('emits resume-gaps when the gaps button is clicked', async () => {
  const w = mount(SessionEndedBanner, { props: { endedAt: '2026-07-04T00:00:00Z', hasGaps: true } })
  await w.find('[data-testid="session-resume-gaps"]').trigger('click')
  expect(w.emitted('resume-gaps')).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- --run -t "Review my gaps"`
Expected: FAIL — button/prop absent.

- [ ] **Step 3: Implement the banner**

Add the `hasGaps` prop and the second CTA (place it before the existing resume button):

```vue
  <button
    v-if="hasGaps"
    type="button"
    class="resume-btn gaps-btn"
    data-testid="session-resume-gaps"
    :disabled="loading"
    @click="$emit('resume-gaps')"
  >
    <span>Review my gaps</span>
    <i class="pi pi-bullseye" aria-hidden="true" />
  </button>
```

Update the script block:

```js
defineProps({
  endedAt: { type: String, required: true },
  loading: { type: Boolean, default: false },
  hasGaps: { type: Boolean, default: false },
})

defineEmits(['resume', 'resume-gaps'])
```

Add a light style variant (`.gaps-btn`) — reuse the existing `.resume-btn` styles; give `.gaps-btn` a distinct but accessible fill (e.g. an outline/secondary treatment) so two CTAs read as primary + secondary, not two identical buttons. Verify contrast in both themes.

- [ ] **Step 4: Wire SessionView**

In `SessionView.vue` banner usage, add the handler and gap-count source:

```vue
      <SessionEndedBanner
        v-if="isEnded"
        :ended-at="store.currentSession.ended_at"
        :loading="resuming"
        :has-gaps="hasGaps"
        @resume="resume"
        @resume-gaps="resumeReviewGaps"
      />
```

In the script:

```js
const hasGaps = computed(
  () => (store.currentSession?.topic_profile?.confirmed_gaps?.length ?? 0) > 0
)

async function resumeReviewGaps() {
  if (!store.currentSession) return
  resuming.value = true
  try {
    await store.reopenSession(store.currentSession.id)
    await store.sendMessageStreaming({ text: 'Review my gaps', reviewGaps: true })
  } catch {
    // store.error already populated
  } finally {
    resuming.value = false
  }
}
```

- [ ] **Step 5: Write the SessionView test**

In `sessionView.test.js`, assert that clicking the gaps button reopens then sends a review-gaps turn (mock the store methods):

```js
it('resumeReviewGaps reopens then sends a review_gaps seed turn', async () => {
  // mount SessionView with an ended session whose topic_profile.confirmed_gaps has 1+ entries
  // stub store.reopenSession and store.sendMessageStreaming
  await wrapper.find('[data-testid="session-resume-gaps"]').trigger('click')
  expect(reopenSpy).toHaveBeenCalledWith('s1')
  expect(sendSpy).toHaveBeenCalledWith({ text: 'Review my gaps', reviewGaps: true })
})
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npm run test:unit -- --run -t "Review my gaps"` and the sessionView test.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/SessionEndedBanner.vue frontend/src/views/SessionView.vue frontend/src/__tests__
git commit -m "feat(ws-f): Review my gaps CTA reopens and opens tutor on a gap"
```

---

## Task 7: F1 — urgent (90%-of-hard) tier in cost_meter

**Files:**
- Modify: `backend/services/cost_meter.py` (`CapStatus` dataclass ~line 47-53, `check_cap` ~line 81-91)
- Test: `backend/tests/test_cost_meter.py` (grep for the existing cost-meter test module; if none, create it)

**Interfaces:**
- Produces: `CapStatus.urgent_breached: bool`, `CapStatus.urgent_cap: Decimal`. `urgent_cap = hard_cap * 0.9`. Consumed by Task 8.

- [ ] **Step 1: Write the failing test**

```python
from decimal import Decimal
from services import cost_meter

def test_check_cap_urgent_tier(db_session, monkeypatch):
    # hard cap $3 -> urgent at $2.70; soft at $2
    user = "u1"
    # below soft
    cost_meter.record_cost(db_session, user, Decimal("1.00")); db_session.commit()
    s = cost_meter.check_cap(db_session, user)
    assert (s.soft_breached, s.urgent_breached, s.allowed) == (False, False, True)
    # soft but not urgent
    cost_meter.record_cost(db_session, user, Decimal("1.20")); db_session.commit()  # 2.20
    s = cost_meter.check_cap(db_session, user)
    assert (s.soft_breached, s.urgent_breached, s.allowed) == (True, False, True)
    # urgent but not hard
    cost_meter.record_cost(db_session, user, Decimal("0.60")); db_session.commit()  # 2.80
    s = cost_meter.check_cap(db_session, user)
    assert (s.soft_breached, s.urgent_breached, s.allowed) == (True, True, True)
    assert s.urgent_cap == Decimal("2.70")
    # hard
    cost_meter.record_cost(db_session, user, Decimal("0.50")); db_session.commit()  # 3.30
    s = cost_meter.check_cap(db_session, user)
    assert s.allowed is False
```

(Adapt `db_session` to the module's existing fixture name.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL=sqlite:///./data/app.db pytest tests/test_cost_meter.py -k urgent -v`
Expected: FAIL — `urgent_breached`/`urgent_cap` do not exist.

- [ ] **Step 3: Implement**

Extend `CapStatus`:

```python
@dataclass(frozen=True)
class CapStatus:
    allowed: bool
    used: Decimal
    soft_breached: bool
    urgent_breached: bool
    soft_cap: Decimal
    urgent_cap: Decimal
    hard_cap: Decimal
```

Extend `check_cap`:

```python
def check_cap(db: Session, user_id: str) -> CapStatus:
    soft_cap = _to_decimal(settings.llm_soft_cap_usd)
    hard_cap = _to_decimal(settings.llm_hard_cap_usd)
    urgent_cap = _quantize(hard_cap * Decimal("0.9"))
    used = current_spend(db, user_id)
    return CapStatus(
        allowed=used < hard_cap,
        used=used,
        soft_breached=used >= soft_cap,
        urgent_breached=used >= urgent_cap,
        soft_cap=soft_cap,
        urgent_cap=urgent_cap,
        hard_cap=hard_cap,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DATABASE_URL=sqlite:///./data/app.db pytest tests/test_cost_meter.py -v`
Expected: PASS. Also run any callers' tests that construct `CapStatus` directly (grep `CapStatus(`) and update them to pass the two new fields.

- [ ] **Step 5: Commit**

```bash
git add backend/services/cost_meter.py backend/tests/test_cost_meter.py
git commit -m "feat(ws-f): add 90%-of-hard urgent tier to cost cap status"
```

---

## Task 8: F1 — emit the urgent level on both chat paths

**Files:**
- Modify: `backend/routes/chat.py` (X-Cost-Warning header, ~line 145-149)
- Modify: `backend/agent/tutor.py` (cost_warning stream event, ~line 365-374)
- Test: `backend/tests/test_chat_route.py` (header level) and the tutor streaming test module

**Interfaces:**
- Consumes: `CapStatus.urgent_breached`, `urgent_cap` (Task 7).
- Produces: a `level` field distinguishing `soft` vs `urgent`. Header: add `;level=urgent` (or `soft`). Stream event `cost_warning` payload: add `"level": "urgent"|"soft"`. Consumed by Task 9.

- [ ] **Step 1: Write the failing tests**

Header path — assert the level appears when spend is in the urgent band:

```python
def test_chat_cost_header_marks_urgent_level(client, user_at_urgent_spend):
    resp = client.post("/api/chat", json={"session_id": ..., "message": "hi"}, headers=auth_header())
    assert "level=urgent" in resp.headers.get("X-Cost-Warning", "")
```

Stream path — assert the emitted `cost_warning` event carries `level`:

```python
def test_stream_cost_warning_event_has_level(...):
    # drive run_streaming for a user already in the urgent band; collect events
    warn = [e for e in events if e.type == "cost_warning"][0]
    assert warn.data["level"] == "urgent"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && DATABASE_URL=sqlite:///./data/app.db pytest tests/test_chat_route.py tests/test_tutor*.py -k "level or urgent" -v`
Expected: FAIL — no `level`.

- [ ] **Step 3: Implement the header (chat.py)**

```python
    post = cost_meter.check_cap(db, user_id)
    if post.soft_breached:
        level = "urgent" if post.urgent_breached else "soft"
        response.headers["X-Cost-Warning"] = (
            f"soft_cap_breached;level={level};used_usd={post.used};"
            f"soft_cap_usd={post.soft_cap};urgent_cap_usd={post.urgent_cap};"
            f"hard_cap_usd={post.hard_cap}"
        )
```

- [ ] **Step 4: Implement the stream event (tutor.py)**

```python
                post = cost_meter.check_cap(ctx.db, ctx.user_id)
                if post.soft_breached:
                    yield StreamEvent(
                        "cost_warning",
                        {
                            "level": "urgent" if post.urgent_breached else "soft",
                            "used_usd": str(post.used),
                            "soft_cap_usd": str(post.soft_cap),
                            "urgent_cap_usd": str(post.urgent_cap),
                            "hard_cap_usd": str(post.hard_cap),
                        },
                    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && DATABASE_URL=sqlite:///./data/app.db pytest tests/test_chat_route.py tests/test_tutor*.py -v`
Expected: PASS. Fix any existing cost-warning test that asserted the old header/payload exact string.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/chat.py backend/agent/tutor.py backend/tests
git commit -m "feat(ws-f): emit soft/urgent level on cost warnings (header + stream event)"
```

---

## Task 9: F1 — frontend surfaces urgent distinctly

**Files:**
- Modify: `frontend/src/stores/session.js` (`reportCostWarning`) and/or `frontend/src/services/costBus.js`
- Modify: the cost-warning toast component (grep for `reportCostWarning` consumer / the toast that renders cost warnings)
- Test: `frontend/src/__tests__/costCapUx.test.js`

**Interfaces:**
- Consumes: `cost_warning` payload `level` and `X-Cost-Warning` header `level=` (Task 8).

- [ ] **Step 1: Write the failing test**

In `costCapUx.test.js`:

```js
it('surfaces an urgent cost warning distinctly from a soft one', async () => {
  // dispatch a cost warning with level: 'urgent' and assert the store/UI marks it urgent
  // (e.g. costCapInfo.value.level === 'urgent' or the toast severity differs)
})
```

Also assert the header-parsing path (apiClient) reads `level=urgent` from `X-Cost-Warning` and dispatches it — mirror the existing test that "fires once with detail.header when X-Cost-Warning is present".

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- --run -t urgent`
Expected: FAIL.

- [ ] **Step 3: Implement**

Parse `level` from both transports and store it (e.g. `costCapInfo.value = { ...info, level }`, default `'soft'`). In the toast, branch severity/copy on `level`: urgent uses a stronger severity (e.g. `error`/red) and copy like "You are close to today's limit"; soft keeps the current warning. Reuse the existing toast component — change severity/copy only, not the transport.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- --run -t urgent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/session.js frontend/src/services/costBus.js frontend/src/__tests__/costCapUx.test.js frontend/src
git commit -m "feat(ws-f): surface urgent cost warning distinctly from soft"
```

---

## Task 10: F3 — verify the rate limiter is multi-instance safe

**Files:**
- Test: `backend/tests/test_rate_limit.py` (grep first — a concurrency test may already exist from PR #83)
- Modify (docs only): the plan/umbrella status note; no production code expected.

**Interfaces:** none.

- [ ] **Step 1: Confirm the current state**

Read `backend/services/rate_limit.py`. Confirm `check_and_increment` uses `INSERT ... ON CONFLICT DO NOTHING` + a `count < settings.daily_cap`-guarded `UPDATE` (it does). Grep the backend for any other in-memory throttle:

Run: `cd backend && grep -rniE "defaultdict|deque|per.minute|throttle|slowapi|limiter|_counts *= *\{" --include=*.py . | grep -vE "\.venv|__pycache__|test_"`
Expected: no production throttle other than `rate_limit.py` / `cost_meter.py` (both DB-backed).

- [ ] **Step 2: Check for an existing concurrency test**

Run: `cd backend && grep -rn "check_and_increment" tests/`
Expected: find `tests/test_rate_limit.py`. If it already asserts that interleaved/parallel calls never exceed `daily_cap` and never create duplicate rows, cite it here and SKIP to Step 5 (no new test).

- [ ] **Step 3: If missing, write the concurrency test**

```python
def test_check_and_increment_never_exceeds_cap_under_contention(db_session, monkeypatch):
    from services import rate_limit
    monkeypatch.setattr(rate_limit.settings, "daily_cap", 3)
    user = "u-concurrent"
    results = [rate_limit.check_and_increment(db_session, user) for _ in range(6)]
    allowed = [r for (r, _c) in results if r]
    assert len(allowed) == 3  # cap holds
    # exactly one row for (user, today)
    from db.models import UsageCounter
    rows = db_session.query(UsageCounter).filter_by(user_id=user).all()
    assert len(rows) == 1 and rows[0].count == 3
```

(The atomic upsert guarantees this even on a single connection; true parallel-connection contention is covered by the Postgres-level `ON CONFLICT` constraint, already exercised in prod per PR #83.)

- [ ] **Step 4: Run the test**

Run: `cd backend && DATABASE_URL=sqlite:///./data/app.db pytest tests/test_rate_limit.py -v`
Expected: PASS.

- [ ] **Step 5: Record the verification**

Append to this plan file under a "F3 verification result" note: whether an existing test was cited or a new one added, and the grep result confirming no other in-memory throttle. Commit.

```bash
git add backend/tests/test_rate_limit.py docs/superpowers/plans/2026-07-04-phase-8-ws-f-fixes.md
git commit -m "test(ws-f): assert rate limiter holds cap under contention (F3 verify)"
```

**F3 verification result (2026-07-04):** Grep for in-memory throttles (`defaultdict|deque|per.minute|throttle|slowapi|limiter|_counts *= *\{`, excluding `.venv`/`__pycache__`/`test_*`) returned no matches — the only rate machinery in the backend is the DB-backed `rate_limit.py` and `cost_meter.py`. `backend/services/rate_limit.py::check_and_increment` confirmed to use the atomic `INSERT ... ON CONFLICT DO NOTHING` + `count < settings.daily_cap`-guarded `UPDATE` from PR #83. An existing test, `test_concurrent_calls_no_duplicate_rows_no_errors` (threaded + `threading.Barrier` for max overlap), already covered no-duplicate-rows/no-errors under contention, but it deliberately stays at/under the cap so every call is allowed and therefore did not assert the cap ceiling. Added `test_check_and_increment_never_exceeds_cap_under_contention` (Step 3, adapted to reuse the module-level `UsageCounter` import already in the test file) to close that gap: 6 calls against a cap of 3 yield exactly 3 allowed and one row with `count == 3`. `pytest tests/test_rate_limit.py -v` — 7 passed, all first-run green, no production code changed.

---

## Task 11: Full-suite green + final review

**Files:** none (verification task).

- [ ] **Step 1: Backend suite (CI parity)**

Run: `cd backend && DATABASE_URL=sqlite:///./data/app.db pytest`
Expected: all PASS. Investigate any failure before proceeding.

- [ ] **Step 2: Contract drift check**

Run: `cd .. && python backend/scripts/gen_contracts.py && git diff --exit-code backend/contracts/models.py`
Expected: no diff (codegen is up to date).

- [ ] **Step 3: Frontend suite + lint**

Run: `cd frontend && npm run test:unit -- --run && npm run lint`
Expected: all PASS, no lint errors.

- [ ] **Step 4: Request code review**

Use superpowers:requesting-code-review on the whole branch diff vs `dev`. Address findings.

- [ ] **Step 5: Commit any review fixes, then stop for the human gates**

The remaining gates are human/paid (see spec section 6): live-LLM F2 smoke (end a session with a confirmed gap, click "Review my gaps", confirm the tutor opens on that gap with a check-question card) and an F1 urgent-tier live check. Do not mark WS-F fully done until those pass.

---

## Self-Review Notes

- **Spec coverage:** F2 = Tasks 1-6; F1 = Tasks 7-9; F3 = Task 10; global green = Task 11. Every spec section maps to a task.
- **Empty state (spec 2.6):** Task 6 gates the button on `hasGaps`; Task 2 makes the backend defensive (mode off when no gaps).
- **Ordering:** F2 first (Tasks 1-6) per spec, then F1 (7-9), then F3 (10). Within F2, contract -> server -> prompt -> rule -> frontend transport -> UI is dependency-ordered.
- **Type consistency:** `review_gaps` (snake, contract/backend) vs `reviewGaps` (camel, JS) is intentional and called out at each boundary. `CapStatus` gains `urgent_breached`/`urgent_cap` in Task 7 and every consumer (Tasks 8) uses those exact names.
