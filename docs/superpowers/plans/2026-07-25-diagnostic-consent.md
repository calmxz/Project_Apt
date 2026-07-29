# Diagnostic Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first-turn knowledge diagnostic consent-based: the tutor offers a quiz or self-report instead of force-firing 3 MC questions, and SessionView shows a deterministic consent card with the same choices.

**Architecture:** Two independent halves per the spec (`docs/superpowers/specs/2026-07-25-diagnostic-consent-design.md`). Backend: rewrite the `KNOWLEDGE DIAGNOSTIC` block in `agent/prompts.py` — no server logic changes; the `diagnostic_required` flag, `purpose="diagnostic"` derivation, and grading are untouched invariants. Frontend: new presentational `DiagnosticConsentCard.vue` + SessionView wiring that derives the flag client-side from the existing `GET /profile/{session_id}` (`knowledge_level === null`) and acts via the existing send path and WS-E profile PATCH.

**Tech Stack:** FastAPI backend (prompt string + pytest), Vue 3 + Pinia + vitest frontend. No OpenAPI change, no migration, no new routes.

## Global Constraints

- Branch: create `feat/diagnostic-consent` off `dev` before Task 1 (`git checkout -b feat/diagnostic-consent dev`). PR targets `dev`.
- Run pytest from `backend/`, never repo root ("No tests collected" from root is the known trap).
- After the prompt edit, run the FULL backend suite, not just `test_prompts.py`.
- `backend/contracts/` is codegen output — this plan must not touch it or `docs/api/openapi.yaml`.
- No emojis in code or comments.
- Frontend tests: from `frontend/`: `npm run test:unit -- --run`. Lint: `npm run lint`.
- No `data-testid` deletions anywhere in this plan (only additions), so no e2e grep sweep owed.
- Server-side invariants that MUST NOT change (spec section "What does NOT change"): `routes/chat.py:78` flag computation, `check_question_service.py` purpose derivation, `diagnostic_service.py`, review-gaps precedence at `routes/chat.py:105`.

---

### Task 1: Rewrite KNOWLEDGE DIAGNOSTIC prompt block (backend)

**Files:**
- Modify: `backend/agent/prompts.py:110-115` (the `KNOWLEDGE DIAGNOSTIC:` block inside `IMMUTABLE_RULES`)
- Test: `backend/tests/test_prompts.py`

**Interfaces:**
- Consumes: `prompts.IMMUTABLE_RULES` (module-level string), existing tests at `test_prompts.py:92-107`.
- Produces: `IMMUTABLE_RULES` still contains section headers `KNOWLEDGE DIAGNOSTIC:` followed later by `REVIEW-GAPS MODE:` — the existing split-based test at line 95 and the dynamic-context tests must keep passing unmodified.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_prompts.py`:

```python
def test_diagnostic_block_offers_instead_of_forcing():
    rules = prompts.IMMUTABLE_RULES
    block = rules.split("KNOWLEDGE DIAGNOSTIC:")[1].split("REVIEW-GAPS MODE:")[0]
    # force-fire language must be gone
    assert "Do not teach or explain first" not in block
    assert "before any teaching" not in block
    # consent semantics must be present
    assert "unprompted" in block
    assert "offer" in block.lower()
    assert "beginner / intermediate / advanced" in block
    # both consent outcomes are wired to real tools
    assert "ask_check_questions" in block
    assert "update_topic_profile" in block
    assert "declared" in block
```

Note: `test_prompts.py` already has `from agent import prompts` style imports at top (see existing `test_immutable_rules_has_knowledge_diagnostic_protocol` at line 92 using bare `prompts`). Match whatever import the neighboring tests use.

- [ ] **Step 2: Run test to verify it fails**

Run from `backend/`: `pytest tests/test_prompts.py::test_diagnostic_block_offers_instead_of_forcing -v`
Expected: FAIL — `assert "Do not teach or explain first" not in block` (old text present).

- [ ] **Step 3: Replace the block in `backend/agent/prompts.py`**

Replace exactly these lines (currently 110-115):

```
KNOWLEDGE DIAGNOSTIC:
- When DIAGNOSTIC is REQUIRED, before any teaching, call ask_check_questions ONCE
  with exactly 3 multiple-choice items on the TOPIC at increasing difficulty
  (easy, medium, hard). Do not teach or explain first.
- After the learner answers, continue teaching at their level.
- When DIAGNOSTIC is OFF, follow the normal check-question protocol above.
```

with:

```
KNOWLEDGE DIAGNOSTIC:
- When DIAGNOSTIC is REQUIRED, the learner's level is unknown. Do NOT call
  ask_check_questions unprompted, and do not teach in depth yet.
- In your first response of the session: briefly address the learner's message
  at a neutral level, then in the same turn offer a choice - a quick
  3-question check, or telling you their level
  (beginner / intermediate / advanced).
- If the learner asks to be quizzed or accepts the check (any turn, any
  phrasing): call ask_check_questions immediately with exactly 3
  multiple-choice items on the TOPIC at increasing difficulty
  (easy, medium, hard).
- If the learner states their level instead: call update_topic_profile with
  knowledge_level and evidence_type="declared".
- If the learner declines or ignores both options: teach beginner-friendly.
  Do not repeat the offer every turn; return to it only when it comes up
  naturally.
- After the level is known, continue teaching at that level.
- When DIAGNOSTIC is OFF, follow the normal check-question protocol above.
```

(ASCII hyphen in "- a quick", no em dash; no emojis. The REVIEW-GAPS MODE block that follows is untouched.)

- [ ] **Step 4: Run the new test and the whole prompt test file**

Run from `backend/`: `pytest tests/test_prompts.py -v`
Expected: ALL PASS, including untouched `test_immutable_rules_has_knowledge_diagnostic_protocol` (its split on `RETRIEVAL POLICY:` still finds `ask_check_questions`) and `test_dynamic_context_diagnostic_required` (label rendering unchanged).

- [ ] **Step 5: Run the FULL backend suite**

Run from `backend/`: `pytest`
Expected: all pass. If `test_cost_meter.py` or `test_usage_route.py::test_usage_summary_shape` fail, that is the known ambient-`.env` `LLM_SOFT_CAP_USD`/`LLM_HARD_CAP_USD` sensitivity (pre-existing, unrelated) — report it, do not chase it.

- [ ] **Step 6: Commit**

```bash
git add backend/agent/prompts.py backend/tests/test_prompts.py
git commit -m "feat(prompts): consent-based knowledge diagnostic (offer quiz or self-report)"
```

---

### Task 2: DiagnosticConsentCard component (frontend)

**Files:**
- Create: `frontend/src/components/DiagnosticConsentCard.vue`
- Test: `frontend/src/__tests__/diagnosticConsentCard.test.js`

**Interfaces:**
- Consumes: nothing project-specific (pure presentational).
- Produces: component with props `{ busy: Boolean (default false), error: String (default '') }` and emits `quiz` (no payload), `level` (payload: `'beginner' | 'intermediate' | 'advanced'`), `dismiss` (no payload). Test ids: `diagnostic-consent-card`, `diag-quiz`, `diag-level-beginner`, `diag-level-intermediate`, `diag-level-advanced`, `diag-dismiss`. Task 3 relies on these exact names.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/__tests__/diagnosticConsentCard.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DiagnosticConsentCard from '@/components/DiagnosticConsentCard.vue'

describe('DiagnosticConsentCard', () => {
  it('emits quiz when the quiz button is clicked', async () => {
    const w = mount(DiagnosticConsentCard)
    await w.get('[data-testid="diag-quiz"]').trigger('click')
    expect(w.emitted('quiz')).toHaveLength(1)
  })

  it('emits level with the chosen value', async () => {
    const w = mount(DiagnosticConsentCard)
    await w.get('[data-testid="diag-level-intermediate"]').trigger('click')
    expect(w.emitted('level')).toEqual([['intermediate']])
  })

  it('emits dismiss from the close button', async () => {
    const w = mount(DiagnosticConsentCard)
    await w.get('[data-testid="diag-dismiss"]').trigger('click')
    expect(w.emitted('dismiss')).toHaveLength(1)
  })

  it('disables action buttons while busy, but not dismiss', () => {
    const w = mount(DiagnosticConsentCard, { props: { busy: true } })
    expect(w.get('[data-testid="diag-quiz"]').attributes('disabled')).toBeDefined()
    expect(w.get('[data-testid="diag-level-beginner"]').attributes('disabled')).toBeDefined()
    expect(w.get('[data-testid="diag-dismiss"]').attributes('disabled')).toBeUndefined()
  })

  it('renders the error line only when error is set', () => {
    expect(mount(DiagnosticConsentCard).find('[role="alert"]').exists()).toBe(false)
    const w = mount(DiagnosticConsentCard, { props: { error: 'Could not save.' } })
    expect(w.get('[role="alert"]').text()).toBe('Could not save.')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `frontend/`: `npm run test:unit -- --run diagnosticConsentCard`
Expected: FAIL — cannot resolve `@/components/DiagnosticConsentCard.vue`.

- [ ] **Step 3: Create the component**

`frontend/src/components/DiagnosticConsentCard.vue`:

```vue
<script setup>
defineProps({
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
defineEmits(['quiz', 'level', 'dismiss'])

const LEVELS = ['beginner', 'intermediate', 'advanced']
const LABELS = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }
</script>

<template>
  <section
    class="diag-card"
    data-testid="diagnostic-consent-card"
    aria-label="Knowledge check offer"
  >
    <div class="diag-head">
      <p class="diag-title">Want me to pitch this at the right level?</p>
      <button
        type="button"
        class="diag-dismiss"
        data-testid="diag-dismiss"
        aria-label="Dismiss knowledge check offer"
        @click="$emit('dismiss')"
      >
        &times;
      </button>
    </div>
    <p class="diag-sub">Take a quick 3-question check, or tell me where you are.</p>
    <div class="diag-actions">
      <button
        type="button"
        class="diag-quiz"
        data-testid="diag-quiz"
        :disabled="busy"
        @click="$emit('quiz')"
      >
        Quiz me (3 quick questions)
      </button>
      <button
        v-for="lvl in LEVELS"
        :key="lvl"
        type="button"
        class="diag-level"
        :data-testid="`diag-level-${lvl}`"
        :disabled="busy"
        @click="$emit('level', lvl)"
      >
        {{ LABELS[lvl] }}
      </button>
    </div>
    <p v-if="error" class="diag-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.diag-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  margin: 0.5rem 0;
  background: var(--color-surface);
}
.diag-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}
.diag-title {
  margin: 0;
  font-weight: 600;
}
.diag-sub {
  margin: 0.25rem 0 0.5rem;
  color: var(--color-text-muted);
  font-size: 0.9rem;
}
.diag-dismiss {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
  color: var(--color-text-muted);
}
.diag-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.diag-error {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
  color: var(--color-danger-text, #b00020);
}
</style>
```

Styling note: the CSS custom properties above must be ones that exist in `frontend/src/assets` theme files — before committing, grep the assets directory for each `--color-*` name used and swap any miss for the nearest existing token (flat styling per PR #158; match the look of neighboring cards like `CheckQuestion.vue`). Button classes intentionally unstyled beyond layout if neighboring components rely on global button styles — mirror `CheckQuestion.vue`'s approach.

- [ ] **Step 4: Run tests to verify they pass**

Run from `frontend/`: `npm run test:unit -- --run diagnosticConsentCard`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DiagnosticConsentCard.vue frontend/src/__tests__/diagnosticConsentCard.test.js
git commit -m "feat(fe): DiagnosticConsentCard component"
```

---

### Task 3: SessionView wiring (frontend)

**Files:**
- Modify: `frontend/src/views/SessionView.vue` (template ~line 107-132; script: imports, state near other refs, `loadCurrent` at ~line 360, `onDoneCheck` at ~line 627, new handlers near `send()` at ~line 450)
- Test: `frontend/src/__tests__/sessionView.test.js` (extend existing harness)

**Interfaces:**
- Consumes: `DiagnosticConsentCard.vue` (Task 2 props/emits/test ids), `getSessionProfile(sessionId)` and `patchProfile(sessionId, body, etag)` from `frontend/src/services/profileApi.js` (GET returns `{ profile: { knowledge_level, ... }, etag }`; PATCH returns `{ profile, etag }`, throws `e.status === 412` on ETag conflict, `silent: true` already set), `store.sendMessageStreaming({ text })`, `store.pendingCheck`, `store.streamState`, existing computeds `isEnded` (line 225), `canSend` (line 247), refs `resuming`, `notFound`, `lastError`.
- Produces: card rendered between `CheckQuestion` and `Composer`; no new exports.

- [ ] **Step 1: Write the failing tests**

Extend `frontend/src/__tests__/sessionView.test.js`. Reuse the file's existing mount helper and store-mocking pattern (do not invent a new harness). Add a `vi.mock` for the profile API alongside the file's existing service mocks:

```js
vi.mock('@/services/profileApi.js', () => ({
  getSessionProfile: vi.fn(),
  patchProfile: vi.fn(),
}))
```

(If the file mocks services with relative paths, match its style — check its existing `vi.mock` calls first.)

Test cases to add, using the harness's mount + store conventions:

```js
import { getSessionProfile, patchProfile } from '@/services/profileApi.js'

describe('diagnostic consent card', () => {
  it('shows the card when knowledge_level is null and no check is pending', async () => {
    getSessionProfile.mockResolvedValue({ profile: { knowledge_level: null }, etag: 't1' })
    const w = await mountSessionView() // harness helper; pendingCheck null in store stub
    expect(w.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(true)
  })

  it('hides the card when knowledge_level is set', async () => {
    getSessionProfile.mockResolvedValue({ profile: { knowledge_level: 'beginner' }, etag: 't1' })
    const w = await mountSessionView()
    expect(w.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(false)
  })

  it('hides the card while a check batch is open', async () => {
    getSessionProfile.mockResolvedValue({ profile: { knowledge_level: null }, etag: 't1' })
    const w = await mountSessionView({ pendingCheck: makePendingCheckStub() }) // harness's existing check stub
    expect(w.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(false)
  })

  it('quiz button sends the canned message through the store', async () => {
    getSessionProfile.mockResolvedValue({ profile: { knowledge_level: null }, etag: 't1' })
    const w = await mountSessionView()
    await w.get('[data-testid="diag-quiz"]').trigger('click')
    expect(storeStub.sendMessageStreaming).toHaveBeenCalledWith({ text: 'Quiz me to gauge my level' })
  })

  it('level button PATCHes the profile with the etag and hides the card', async () => {
    getSessionProfile.mockResolvedValue({ profile: { knowledge_level: null }, etag: 't1' })
    patchProfile.mockResolvedValue({ profile: { knowledge_level: 'advanced' }, etag: 't2' })
    const w = await mountSessionView()
    await w.get('[data-testid="diag-level-advanced"]').trigger('click')
    await flushPromises()
    expect(patchProfile).toHaveBeenCalledWith(SESSION_ID, { knowledge_level: 'advanced' }, 't1')
    expect(w.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(false)
  })

  it('412 on PATCH refetches the profile and hides the card if the level is now set', async () => {
    getSessionProfile.mockResolvedValueOnce({ profile: { knowledge_level: null }, etag: 't1' })
    patchProfile.mockRejectedValue(Object.assign(new Error('precondition'), { status: 412 }))
    getSessionProfile.mockResolvedValueOnce({ profile: { knowledge_level: 'beginner' }, etag: 't2' })
    const w = await mountSessionView()
    await w.get('[data-testid="diag-level-beginner"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(false)
  })

  it('dismiss hides the card locally', async () => {
    getSessionProfile.mockResolvedValue({ profile: { knowledge_level: null }, etag: 't1' })
    const w = await mountSessionView()
    await w.get('[data-testid="diag-dismiss"]').trigger('click')
    expect(w.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(false)
  })
})
```

Placeholder names (`mountSessionView`, `storeStub`, `makePendingCheckStub`, `SESSION_ID`, `flushPromises`) refer to whatever the existing file already uses for mounting SessionView, stubbing the session store, and flushing — adopt its exact helpers. `flushPromises` is exported by `@vue/test-utils`.

- [ ] **Step 2: Run tests to verify they fail**

Run from `frontend/`: `npm run test:unit -- --run sessionView`
Expected: the new `diagnostic consent card` describe block FAILS (card testid absent); pre-existing tests still pass.

- [ ] **Step 3: Wire SessionView**

In `frontend/src/views/SessionView.vue` script setup:

Imports (alongside existing component/service imports):

```js
import DiagnosticConsentCard from '../components/DiagnosticConsentCard.vue'
import { getSessionProfile, patchProfile } from '../services/profileApi.js'
```

State (near the other view-local refs):

```js
// Diagnostic consent card (spec 2026-07-25-diagnostic-consent-design.md).
// diagProfile holds the latest GET /profile/:id payload ({ profile, etag });
// null means not loaded or load failed - the card simply does not render,
// the tutor's conversational offer is the fallback.
const diagProfile = ref(null)
const diagDismissed = ref(false)
const diagError = ref('')

const showDiagnosticCard = computed(() =>
  Boolean(
    diagProfile.value &&
      diagProfile.value.profile?.knowledge_level == null &&
      !store.pendingCheck &&
      !diagDismissed.value &&
      !isEnded.value &&
      !resuming.value &&
      !notFound.value,
  ),
)

async function loadDiagProfile(id) {
  try {
    const data = await getSessionProfile(id)
    if (id !== props.id) return // stale response from a previous session
    diagProfile.value = data
  } catch {
    if (id === props.id) diagProfile.value = null
  }
}
```

The stale-guard mirrors the upload-poll session-guard fix (#159) — a slow GET from session A must not paint session B.

In `loadCurrent(id)` (line ~360), immediately after the existing per-load resets (`notFound.value = false` etc.), add:

```js
  diagProfile.value = null
  diagDismissed.value = false
  diagError.value = ''
  loadDiagProfile(id) // deliberately not awaited: card is best-effort
```

Handlers (near `send()`):

```js
async function onDiagQuiz() {
  if (!canSend.value) return
  diagError.value = ''
  try {
    await store.sendMessageStreaming({ text: 'Quiz me to gauge my level' })
  } catch (e) {
    lastError.value = e
  }
}

async function onDiagLevel(level) {
  const etag = diagProfile.value?.etag
  if (!etag) return
  diagError.value = ''
  try {
    const res = await patchProfile(props.id, { knowledge_level: level }, etag)
    diagProfile.value = { profile: res.profile, etag: res.etag }
  } catch (e) {
    if (e?.status === 412) {
      // Concurrent write (e.g. a quiz just graded). Refetch; if the level is
      // now set the card hides itself via showDiagnosticCard.
      await loadDiagProfile(props.id)
    } else {
      diagError.value = 'Could not save your level. Try again.'
    }
  }
}
```

In `onDoneCheck` (line ~627), after `await store.completeCheck()` succeeds, add a refetch so a graded diagnostic (which sets `knowledge_level` server-side) keeps the card gone:

```js
  await loadDiagProfile(props.id)
```

Template — insert between `<CheckQuestion .../>` (ends line 115) and `<Composer` (line 117):

```html
      <DiagnosticConsentCard
        v-if="showDiagnosticCard"
        :busy="store.streamState !== 'idle' || !canSend"
        :error="diagError"
        @quiz="onDiagQuiz"
        @level="onDiagLevel"
        @dismiss="diagDismissed = true"
      />
```

- [ ] **Step 4: Run the new tests, then the full frontend suite**

Run from `frontend/`: `npm run test:unit -- --run sessionView` → new block passes.
Then: `npm run test:unit -- --run` → ALL pass.
Then: `npm run lint` → clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/SessionView.vue frontend/src/__tests__/sessionView.test.js
git commit -m "feat(fe): diagnostic consent card in SessionView"
```

---

### Task 4: Full verification + PR

**Files:** none new.

- [ ] **Step 1: Full backend suite** — from `backend/`: `pytest` → all pass (same ambient-env caveat as Task 1 Step 5).
- [ ] **Step 2: Full frontend suite + lint** — from `frontend/`: `npm run test:unit -- --run` and `npm run lint` → clean.
- [ ] **Step 3: Contract drift check** — `git status` must show no changes under `backend/contracts/` or `docs/api/openapi.yaml` (nothing in this plan touches them; a dirty state means a hook misfired).
- [ ] **Step 4: Push and open PR** targeting `dev`:

```bash
git push -u origin feat/diagnostic-consent
gh pr create --base dev --title "feat: consent-based knowledge diagnostic (prompt offer + FE consent card)" --body "Implements docs/superpowers/specs/2026-07-25-diagnostic-consent-design.md.

- Prompt: KNOWLEDGE DIAGNOSTIC block rewritten - tutor offers quiz or self-report, never force-fires; explicit quiz request fires immediately; decline path via update_topic_profile(evidence_type=declared).
- FE: DiagnosticConsentCard in SessionView (quiz canned message / level PATCH with If-Match / local dismiss), flag derived client-side from GET /profile/:id knowledge_level.
- Server logic untouched: flag computation, purpose derivation, grading, F-25, F-39, review-gaps precedence.

Owed (deferred, per spec): paid reliability eval - (a) no force-fire on first-turn content question, (b) immediate fire on explicit quiz request; threshold >=85%; batch into owed-smokes ledger."
```

## Deferred / owed after merge

- Paid reliability checkpoint (>=85%) per spec Testing section — batch into `docs/reviews/` owed-smokes ledger.
- Manual browser smoke: fresh session → card renders; level click persists; quiz click opens batch and hides card.
