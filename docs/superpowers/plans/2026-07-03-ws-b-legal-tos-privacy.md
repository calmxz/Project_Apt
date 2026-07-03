# WS-B Legal (ToS + Privacy + Consent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish draft ToS + Privacy Policy at public `/tos` and `/privacy` pages, gate registration behind a required consent checkbox, and record acceptance (timestamp + policy version) on the `users` row.

**Architecture:** Consent cannot be written at registration (Supabase `signUp` is client-side; no JWT until after email-confirm + login). User rows are created lazily on the first authenticated backend call. So we centralize the scattered `db.add(User(id=user_id))` into one `ensure_user()` helper that stamps `accepted_terms_at` + `terms_version` on row create. The checkbox is the UI-gated consent act; row-existence corroborates it. No `auth.py` change, no new endpoint, no OpenAPI change.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (backend), Vue 3 + Vue Router + Vite + Vitest (frontend), existing `markdown-it` renderer (`frontend/src/lib/markdownRenderer.js`).

## Global Constraints

- No emojis in code or comments.
- Terms version is a single value shared across FE + BE: `CURRENT_TERMS_VERSION = "2026-07-03"`. Backend const is authoritative; frontend mirrors it with a comment pointing at the backend const.
- Legal markdown lives under `frontend/src/legal/` (NOT `docs/legal/`): `vite.config.js` sets no `server.fs.allow`, so strict-root dev-server cannot import `.md` from outside `frontend/`. This is a deliberate deviation from spec §5's path; the frontend copy is the canonical repo record (backend needs only the version const, not the prose).
- Legal docs open with a banner: "Draft — not legal advice. Seek professional review before large-scale data collection."
- Backend tests use the `db_session` fixture (in-memory SQLite, `Base.metadata.create_all`) and the `client` fixture (auth shim converts a `user_id` field to `Authorization: Bearer test-<user_id>`). Migration DDL is NOT exercised by unit tests (SQLite ≠ Supabase Postgres); migration `0012` is verified by running `alembic upgrade head` against the dev DB — a user gate, same as prior migrations.
- Run backend tests from `backend/`: `pytest`. Run frontend tests from `frontend/`: `npm run test:unit -- --run`.

---

### Task 1: DB schema — acceptance columns + migration 0012

**Files:**
- Modify: `backend/db/models.py:17-25` (User model)
- Create: `backend/db/alembic/versions/0012_terms_acceptance.py`
- Test: `backend/tests/test_terms_acceptance_model.py`

**Interfaces:**
- Produces: `User.accepted_terms_at: datetime | None`, `User.terms_version: str | None` (new nullable columns consumed by Task 2's `ensure_user`).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_terms_acceptance_model.py`:

```python
from datetime import datetime, timezone

from db.models import User


def test_user_has_acceptance_columns(db_session):
    u = User(
        id="u1",
        accepted_terms_at=datetime(2026, 7, 3, tzinfo=timezone.utc),
        terms_version="2026-07-03",
    )
    db_session.add(u)
    db_session.flush()

    got = db_session.get(User, "u1")
    assert got.accepted_terms_at == datetime(2026, 7, 3, tzinfo=timezone.utc)
    assert got.terms_version == "2026-07-03"


def test_user_acceptance_columns_default_null(db_session):
    u = User(id="u2")
    db_session.add(u)
    db_session.flush()

    got = db_session.get(User, "u2")
    assert got.accepted_terms_at is None
    assert got.terms_version is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_terms_acceptance_model.py -v`
Expected: FAIL — `TypeError: 'accepted_terms_at' is an invalid keyword argument for User`.

- [ ] **Step 3: Add the columns to the User model**

In `backend/db/models.py`, in `class User(Base)`, after the `created_at` line (line 21), add:

```python
    accepted_terms_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )
    terms_version: Mapped[str | None] = mapped_column(String, nullable=True, default=None)
```

(`datetime`, `DateTime`, `String`, `Mapped`, `mapped_column` are already imported at the top of the file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_terms_acceptance_model.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Write the Alembic migration**

Find the current head revision:

Run: `cd backend && alembic heads`
Expected: prints one revision id (the `down_revision` for the new migration — most recently `0011`).

Create `backend/db/alembic/versions/0012_terms_acceptance.py` (set `down_revision` to the id printed above if it differs from `"0011"`):

```python
"""terms acceptance columns on users

Revision ID: 0012
Revises: 0011
"""
from alembic import op
import sqlalchemy as sa


revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("accepted_terms_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("terms_version", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "terms_version")
    op.drop_column("users", "accepted_terms_at")
```

- [ ] **Step 6: Verify the migration file imports cleanly**

Run: `cd backend && python -c "import importlib.util, pathlib; p='db/alembic/versions/0012_terms_acceptance.py'; s=importlib.util.spec_from_file_location('m', p); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.revision, m.down_revision)"`
Expected: prints `0012 0011` (or `0012 <actual-head>`). No import error.

- [ ] **Step 7: Commit**

```bash
git add backend/db/models.py backend/db/alembic/versions/0012_terms_acceptance.py backend/tests/test_terms_acceptance_model.py
git commit -m "feat(backend): add terms-acceptance columns + migration 0012"
```

---

### Task 2: `ensure_user` helper + swap lazy-create call sites

**Files:**
- Create: `backend/lib/terms.py`
- Create: `backend/services/user_service.py`
- Modify: `backend/routes/chat.py:63-65`
- Modify: `backend/routes/sessions.py:110-112`
- Test: `backend/tests/test_ensure_user.py`

**Interfaces:**
- Consumes: `User.accepted_terms_at`, `User.terms_version` (Task 1).
- Produces: `CURRENT_TERMS_VERSION: str` (in `backend/lib/terms.py`); `ensure_user(db: Session, user_id: str) -> User` (in `backend/services/user_service.py`) — creates the row stamping `accepted_terms_at = now(tz)` + `terms_version = CURRENT_TERMS_VERSION` on create, returns the existing row unchanged otherwise.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ensure_user.py`:

```python
from datetime import datetime, timezone

from db.models import User
from lib.terms import CURRENT_TERMS_VERSION
from services.user_service import ensure_user


def test_ensure_user_creates_and_stamps_acceptance(db_session):
    user = ensure_user(db_session, "new-user")
    db_session.flush()

    assert user.id == "new-user"
    assert user.terms_version == CURRENT_TERMS_VERSION
    assert user.accepted_terms_at is not None
    assert user.accepted_terms_at.tzinfo is not None


def test_ensure_user_is_idempotent_and_does_not_restamp(db_session):
    earlier = datetime(2020, 1, 1, tzinfo=timezone.utc)
    db_session.add(
        User(id="existing", accepted_terms_at=earlier, terms_version="old")
    )
    db_session.flush()

    user = ensure_user(db_session, "existing")

    assert user.accepted_terms_at == earlier
    assert user.terms_version == "old"


def test_ensure_user_returns_existing_unstamped_row_untouched(db_session):
    db_session.add(User(id="legacy"))  # created before this feature: nulls
    db_session.flush()

    user = ensure_user(db_session, "legacy")

    assert user.accepted_terms_at is None
    assert user.terms_version is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_ensure_user.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'lib.terms'` (or `services.user_service`).

- [ ] **Step 3: Create the version constant**

Create `backend/lib/terms.py`:

```python
"""Single source of truth for the accepted terms/privacy policy version.

Bump this string whenever terms-of-service.md or privacy-policy.md change in a
way users must re-consent to. The frontend mirror lives in
frontend/src/legal/version.js and must be kept equal to this value.
"""

CURRENT_TERMS_VERSION = "2026-07-03"
```

- [ ] **Step 4: Create the `ensure_user` helper**

Create `backend/services/user_service.py`:

```python
"""User-row lifecycle helper.

User rows are created lazily on the first authenticated backend call (Supabase
signUp is client-side; the backend never sees registration). Centralizing the
create here lets us stamp terms acceptance exactly once, at row creation. A row
can only exist after the user signed in, which required passing the
registration consent checkbox, so row-existence corroborates the consent act.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from db.models import User
from lib.terms import CURRENT_TERMS_VERSION


def ensure_user(db: Session, user_id: str) -> User:
    """Return the users row for user_id, creating it if absent.

    On create, stamp accepted_terms_at (server-owned, tz-aware) and
    terms_version. Existing rows are returned unchanged (no re-stamp).
    """
    user = db.get(User, user_id)
    if user is not None:
        return user
    user = User(
        id=user_id,
        accepted_terms_at=datetime.now(timezone.utc),
        terms_version=CURRENT_TERMS_VERSION,
    )
    db.add(user)
    db.flush()
    return user
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && pytest tests/test_ensure_user.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Swap the chat.py call site**

In `backend/routes/chat.py`, replace lines 63-65:

```python
    if not db.get(User, user_id):
        db.add(User(id=user_id))
        db.flush()
```

with:

```python
    ensure_user(db, user_id)
```

Add the import near the other `services` imports at the top of `chat.py`:

```python
from services.user_service import ensure_user
```

If `User` is now unused in `chat.py`, remove it from its import line (run `pytest` in step 8 to confirm nothing else uses it; if the import is still referenced elsewhere in the file, leave it).

- [ ] **Step 7: Swap the sessions.py call site**

In `backend/routes/sessions.py`, replace lines 110-112:

```python
    if not db.get(User, user_id):
        db.add(User(id=user_id))
        db.flush()
```

with:

```python
    ensure_user(db, user_id)
```

Add the import near the other `services` imports at the top of `sessions.py`:

```python
from services.user_service import ensure_user
```

(Leave the existing `User` import in `sessions.py` if it is still referenced elsewhere in the file; remove only if unused.)

- [ ] **Step 8: Run the full backend suite**

Run: `cd backend && pytest`
Expected: PASS — all tests green, including the existing chat/session tests exercising the swapped call sites. (Import-touching refactor: run the FULL suite, not just the new files.)

- [ ] **Step 9: Commit**

```bash
git add backend/lib/terms.py backend/services/user_service.py backend/routes/chat.py backend/routes/sessions.py backend/tests/test_ensure_user.py
git commit -m "feat(backend): ensure_user helper stamps terms acceptance on row create"
```

---

### Task 3: Legal content + `/tos` and `/privacy` pages

**Files:**
- Create: `frontend/src/legal/terms-of-service.md`
- Create: `frontend/src/legal/privacy-policy.md`
- Create: `frontend/src/legal/version.js`
- Create: `frontend/src/views/TosView.vue`
- Create: `frontend/src/views/PrivacyView.vue`
- Modify: `frontend/src/router/index.js:8-33` (add two routes)
- Test: `frontend/src/__tests__/legalViews.test.js`

**Interfaces:**
- Consumes: `renderMarkdown(text)` from `@/lib/markdownRenderer.js` (existing).
- Produces: routes `/tos` (name `tos`) and `/privacy` (name `privacy`), both `meta.public`; `CURRENT_TERMS_VERSION` export in `frontend/src/legal/version.js` (consumed by Task 4).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/legalViews.test.js`:

```javascript
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PrivacyView from '../views/PrivacyView.vue'
import TosView from '../views/TosView.vue'

describe('legal views', () => {
  it('renders the ToS draft banner', () => {
    const wrapper = mount(TosView)
    expect(wrapper.text()).toContain('not legal advice')
  })

  it('renders the Privacy draft banner', () => {
    const wrapper = mount(PrivacyView)
    expect(wrapper.text()).toContain('not legal advice')
  })

  it('privacy policy names what is collected', () => {
    const wrapper = mount(PrivacyView)
    expect(wrapper.text().toLowerCase()).toContain('email')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/legalViews.test.js`
Expected: FAIL — cannot resolve `../views/TosView.vue`.

- [ ] **Step 3: Write the legal content**

Create `frontend/src/legal/terms-of-service.md`:

```markdown
# Terms of Service

**Draft — not legal advice. Seek professional review before large-scale data collection.**

_Version 2026-07-03 · Effective 2026-07-03_

## Acceptance

By creating an account you agree to these terms.

## The service

Crux is an adaptive study aid. It is a learning tool, not a professional,
medical, legal, or academic authority. Content it generates may be incomplete
or incorrect; verify anything important against primary sources.

## Acceptable use

Do not upload content you lack the right to share, attempt to disrupt the
service, or use it to violate any law.

## No warranty

The service is provided "as is", without warranty of any kind. We are not
liable for losses arising from its use.

## Account termination

We may suspend or terminate accounts that violate these terms.

## Changes

These terms may change. Continued use after a change constitutes acceptance of
the updated terms.
```

Create `frontend/src/legal/privacy-policy.md`:

```markdown
# Privacy Policy

**Draft — not legal advice. Seek professional review before large-scale data collection.**

_Version 2026-07-03 · Effective 2026-07-03_

## What we collect

- **Account email** — handled by our authentication provider (Supabase Auth).
- **Uploaded PDFs** — stored to serve retrieval within the session you upload
  them to.
- **Study data** — your topics, mastered concepts, knowledge gaps, learning
  events, and chat messages, stored in our database (Supabase Postgres).

## How we use it

- To provide tutoring, your chat and relevant document content are sent to
  large-language-model providers via LiteLLM to generate responses.
- We do not sell your personal data.

## Data deletion

To request deletion of your account and associated data, contact us at the
support address listed on the site.

## Changes

This policy may change. We will update the version and effective date above.
```

Create `frontend/src/legal/version.js`:

```javascript
// Mirror of backend/lib/terms.py CURRENT_TERMS_VERSION. Keep equal to it.
export const CURRENT_TERMS_VERSION = '2026-07-03'
```

- [ ] **Step 4: Write the two views**

Create `frontend/src/views/TosView.vue`:

```vue
<template>
  <article class="legal" v-html="html" />
</template>

<script setup>
import { renderMarkdown } from '@/lib/markdownRenderer.js'

import source from '../legal/terms-of-service.md?raw'

const html = renderMarkdown(source)
</script>

<style scoped>
.legal {
  max-width: 44rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
  line-height: var(--lh-body);
}
</style>
```

Create `frontend/src/views/PrivacyView.vue` (identical but importing the privacy source):

```vue
<template>
  <article class="legal" v-html="html" />
</template>

<script setup>
import { renderMarkdown } from '@/lib/markdownRenderer.js'

import source from '../legal/privacy-policy.md?raw'

const html = renderMarkdown(source)
</script>

<style scoped>
.legal {
  max-width: 44rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
  line-height: var(--lh-body);
}
</style>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/legalViews.test.js`
Expected: PASS (3 passed). (Vitest resolves `?raw` imports; if it does not in this project's config, confirm the test still mounts — the `.md?raw` import is a Vite/Vitest built-in transform and needs no extra plugin.)

- [ ] **Step 6: Register the routes**

In `frontend/src/router/index.js`, inside the `routes` array (after the `/reset-password` route block, before the `/` route at line 33), add:

```javascript
    {
      path: '/tos',
      name: 'tos',
      component: () => import('../views/TosView.vue'),
      meta: { public: true, sidebar: false },
    },
    {
      path: '/privacy',
      name: 'privacy',
      component: () => import('../views/PrivacyView.vue'),
      meta: { public: true, sidebar: false },
    },
```

- [ ] **Step 7: Run the full frontend suite**

Run: `cd frontend && npm run test:unit -- --run`
Expected: PASS — all suites green (router tests included).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/legal frontend/src/views/TosView.vue frontend/src/views/PrivacyView.vue frontend/src/router/index.js frontend/src/__tests__/legalViews.test.js
git commit -m "feat(frontend): public /tos and /privacy pages"
```

---

### Task 4: Registration consent checkbox

**Files:**
- Modify: `frontend/src/views/RegisterView.vue` (template + script)
- Test: `frontend/src/__tests__/registerConsent.test.js`

**Interfaces:**
- Consumes: `CURRENT_TERMS_VERSION` from `../legal/version.js`; routes `/tos`, `/privacy` (Task 3); existing `canSubmit` computed + `submit()` in RegisterView.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/registerConsent.test.js`:

```javascript
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { describe, expect, it, vi } from 'vitest'

import RegisterView from '../views/RegisterView.vue'

const stubs = { RouterLink: { template: '<a><slot /></a>' } }

function mountView() {
  return mount(RegisterView, {
    global: {
      plugins: [createTestingPinia({ createSpy: vi.fn })],
      stubs,
    },
  })
}

async function fillValidCredentials(wrapper) {
  await wrapper.find('[data-testid="register-email"]').setValue('a@b.com')
  await wrapper.find('[data-testid="register-password"]').setValue('password1')
  await wrapper.find('[data-testid="register-confirm"]').setValue('password1')
}

describe('registration consent', () => {
  it('renders a consent checkbox', () => {
    const wrapper = mountView()
    expect(wrapper.find('[data-testid="register-consent"]').exists()).toBe(true)
  })

  it('keeps submit disabled until consent is checked', async () => {
    const wrapper = mountView()
    await fillValidCredentials(wrapper)
    expect(wrapper.find('[data-testid="register-submit"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-testid="register-consent"]').setValue(true)
    expect(wrapper.find('[data-testid="register-submit"]').attributes('disabled')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/registerConsent.test.js`
Expected: FAIL — `[data-testid="register-consent"]` does not exist.

- [ ] **Step 3: Add the consent checkbox to the template**

In `frontend/src/views/RegisterView.vue`, immediately before the `<div class="actions">` block (currently line 58), add:

```html
      <label class="consent">
        <input
          type="checkbox"
          v-model="consent"
          data-testid="register-consent"
          class="consent-box"
        />
        <span>
          I agree to the
          <RouterLink to="/tos" target="_blank">Terms of Service</RouterLink>
          and
          <RouterLink to="/privacy" target="_blank">Privacy Policy</RouterLink>.
        </span>
      </label>
```

- [ ] **Step 4: Wire the consent state into the script**

In the `<script setup>` block of `RegisterView.vue`:

Add the ref alongside the other refs (after `const sent = ref(false)`, line 103):

```javascript
const consent = ref(false)
```

Extend the `canSubmit` computed (currently lines 108-110) to require consent:

```javascript
const canSubmit = computed(
  () =>
    emailValid.value &&
    passwordValid.value &&
    confirm.value === password.value &&
    consent.value,
)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/registerConsent.test.js`
Expected: PASS (2 passed).

- [ ] **Step 6: Add minimal checkbox styling**

In the `<style scoped>` block of `RegisterView.vue`, add:

```css
.consent {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--color-text-muted);
  line-height: var(--lh-body);
}

.consent-box {
  margin-top: 0.2rem;
  flex-shrink: 0;
}
```

- [ ] **Step 7: Run the full frontend suite**

Run: `cd frontend && npm run test:unit -- --run`
Expected: PASS — all suites green (existing RegisterView tests still pass; they fill credentials but not consent, so any that asserted an *enabled* submit after filling credentials must also check the box — if one fails, update it to check `register-consent`).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/views/RegisterView.vue frontend/src/__tests__/registerConsent.test.js
git commit -m "feat(frontend): require ToS/privacy consent to register"
```

---

## Post-implementation (user gates, not code steps)

- Run `alembic upgrade head` against the dev/live Supabase DB to apply migration `0012` (verifies the columns land on Postgres; SQLite unit tests do not exercise this).
- Manual smoke: register with the box unchecked (submit stays disabled) → check it → register → confirm email → sign in → first session/chat creates the `users` row with `accepted_terms_at` + `terms_version` set. Visit `/tos` and `/privacy` while signed out (both load).

## Self-review notes

- Spec §3 (row-create stamp) → Task 2. Spec §4 (columns + migration) → Task 1. Spec §5 (content) → Task 3 (relocated to `frontend/src/legal/` per Global Constraints). Spec §6 (routes/views/checkbox/version const) → Tasks 3 + 4. Spec §7 (tests) → each task's tests. Spec §8 (no OpenAPI change) → honored; no contract task.
- Type consistency: `ensure_user(db, user_id) -> User` and `CURRENT_TERMS_VERSION` names identical across Tasks 1-4.
- Version string `"2026-07-03"` identical in `backend/lib/terms.py` and `frontend/src/legal/version.js`.
