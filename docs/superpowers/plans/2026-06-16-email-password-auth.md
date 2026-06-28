# Email/Password Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase magic-link sign-in with email + password registration and login, and add pre-confirmed debug accounts for local development.

**Architecture:** Stay on Supabase Auth; swap the client flow from `signInWithOtp` to `signUp` / `signInWithPassword` / `resend`. The backend (`services/auth.py`) is unchanged — it validates the same Supabase JWT regardless of sign-in method. No DB migration. Debug accounts are minted pre-confirmed via the Supabase GoTrue Admin REST API in a backend seed script.

**Tech Stack:** Vue 3 + Pinia + PrimeVue + `@supabase/supabase-js` (frontend), vitest + @vue/test-utils (tests), FastAPI + httpx (backend seed script), Supabase Auth (GoTrue).

**Design spec:** `docs/superpowers/specs/2026-06-16-email-password-auth-design.md`

**Branch:** `feat/email-password-auth` (already created off `dev`).

**Conventions to follow:**
- Frontend is pure JavaScript (no TypeScript). Tests live flat in `frontend/src/__tests__/`.
- Run frontend unit tests from `frontend/`: `npm run test:unit -- --run`.
- Run a single test file: `npm run test:unit -- --run src/__tests__/<file>.test.js`.
- Run backend tests from `backend/`: `pytest`.
- Lint: from `frontend/`: `npm run lint`.
- No emojis in code or comments.

---

## File Structure

**Modified:**
- `frontend/src/__tests__/setup.js` — global Supabase stub: add `signUp`, `signInWithPassword`, `resend`; drop `signInWithOtp`.
- `frontend/src/stores/auth.js` — replace `signInWithMagicLink` with `register`, `signIn`, `resendConfirmation`.
- `frontend/src/views/LoginView.vue` — password login form + resend-confirmation affordance + link to `/register`.
- `frontend/src/router/index.js` — add `/register` public route; generalize guard to honor `meta.public`.
- `frontend/src/__tests__/authStore.test.js` — rewrite magic-link cases as password cases.
- `frontend/src/__tests__/loginView.test.js` — rewrite for password flow.
- `frontend/src/__tests__/router.test.js` — add `/register` route + public-access cases.
- `.gitignore` — ignore `docs/dev/debug-accounts.txt`.
- `docs/auth/supabase-setup.md` — provider section: password + confirm-email; document seed + debug files.
- `docs/superpowers/specs/2026-05-03-adaptlearn-v1-design.md` — Auth constraint line magic-link -> email/password.

**Created:**
- `frontend/src/views/RegisterView.vue` — registration form.
- `frontend/src/__tests__/registerView.test.js` — RegisterView tests.
- `backend/scripts/seed_debug_accounts.py` — idempotent Admin-API seeder.
- `backend/tests/test_seed_debug_accounts.py` — httpx-mocked unit test for the seeder.
- `docs/dev/debug-accounts.example.txt` — committed format template (placeholders only).
- `docs/dev/debug-accounts.txt` — gitignored real debug creds (created locally, never committed).

---

## Task 1: Update the global Supabase test stub

Test-harness change (no production code), so no failing-test step. This unblocks Tasks 2-5.

**Files:**
- Modify: `frontend/src/__tests__/setup.js`

- [ ] **Step 1: Replace the stub methods**

Replace the `authStub` object and the `beforeEach` reset block in `frontend/src/__tests__/setup.js` with:

```js
const authStub = {
  getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
  onAuthStateChange: vi.fn().mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  }),
  signUp: vi.fn().mockResolvedValue({
    data: { user: { id: 'u-new', email: 'new@example.com' }, session: null },
    error: null,
  }),
  signInWithPassword: vi.fn().mockResolvedValue({
    data: { session: { access_token: 'tok', user: { id: 'u-1' } } },
    error: null,
  }),
  resend: vi.fn().mockResolvedValue({ data: {}, error: null }),
  signOut: vi.fn().mockResolvedValue({ error: null }),
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: authStub })),
}))

globalThis.__supabaseAuthStub = authStub

beforeEach(() => {
  authStub.getSession.mockClear()
  authStub.getSession.mockResolvedValue({ data: { session: null }, error: null })
  authStub.onAuthStateChange.mockClear()
  authStub.signUp.mockClear()
  authStub.signUp.mockResolvedValue({
    data: { user: { id: 'u-new', email: 'new@example.com' }, session: null },
    error: null,
  })
  authStub.signInWithPassword.mockClear()
  authStub.signInWithPassword.mockResolvedValue({
    data: { session: { access_token: 'tok', user: { id: 'u-1' } } },
    error: null,
  })
  authStub.resend.mockClear()
  authStub.resend.mockResolvedValue({ data: {}, error: null })
  authStub.signOut.mockClear()
  authStub.signOut.mockResolvedValue({ error: null })
})
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/__tests__/setup.js
git commit -m "test: swap Supabase auth stub from OTP to password methods"
```

---

## Task 2: Auth store — register / signIn / resendConfirmation

**Files:**
- Modify: `frontend/src/stores/auth.js`
- Test: `frontend/src/__tests__/authStore.test.js`

- [ ] **Step 1: Rewrite the failing tests**

Replace the `signInWithMagicLink` test cases (lines 68-83 of `authStore.test.js`) with these. Leave the `init()`, `signOut`, and "starts unauthenticated" cases untouched.

```js
  it('register calls Supabase signUp with email + password', async () => {
    const auth = useAuthStore()
    await auth.register('me@example.com', 'hunter2pw')
    expect(globalThis.__supabaseAuthStub.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'me@example.com', password: 'hunter2pw' }),
    )
  })

  it('register throws when Supabase returns an error', async () => {
    globalThis.__supabaseAuthStub.signUp.mockResolvedValueOnce({
      data: null,
      error: new Error('User already registered'),
    })
    const auth = useAuthStore()
    await expect(auth.register('x@y.z', 'hunter2pw')).rejects.toThrow(
      'User already registered',
    )
  })

  it('signIn calls Supabase signInWithPassword with email + password', async () => {
    const auth = useAuthStore()
    await auth.signIn('me@example.com', 'hunter2pw')
    expect(globalThis.__supabaseAuthStub.signInWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'me@example.com', password: 'hunter2pw' }),
    )
  })

  it('signIn throws when Supabase returns an error', async () => {
    globalThis.__supabaseAuthStub.signInWithPassword.mockResolvedValueOnce({
      data: null,
      error: new Error('Invalid login credentials'),
    })
    const auth = useAuthStore()
    await expect(auth.signIn('x@y.z', 'bad')).rejects.toThrow(
      'Invalid login credentials',
    )
  })

  it('resendConfirmation calls Supabase resend for signup type', async () => {
    const auth = useAuthStore()
    await auth.resendConfirmation('me@example.com')
    expect(globalThis.__supabaseAuthStub.resend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'signup', email: 'me@example.com' }),
    )
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run src/__tests__/authStore.test.js`
Expected: FAIL — `auth.register`/`auth.signIn`/`auth.resendConfirmation` are not functions.

- [ ] **Step 3: Implement the store methods**

In `frontend/src/stores/auth.js`: update the header comment line about magic-link, replace the `signInWithMagicLink` function (lines 36-46) with the three functions below, and update the returned object.

Header comment — change:
```js
// - Magic-link is the only sign-in method configured server-side.
```
to:
```js
// - Email + password sign-in is configured server-side. New accounts require
//   email confirmation; `resendConfirmation` re-sends the confirmation mail.
```

Replace the function:
```js
  async function register(email, password) {
    const sb = getSupabase()
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo:
          typeof window !== 'undefined' ? `${window.location.origin}/` : undefined,
      },
    })
    if (error) throw error
    return data
  }

  async function signIn(email, password) {
    const sb = getSupabase()
    const { error } = await sb.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function resendConfirmation(email) {
    const sb = getSupabase()
    const { error } = await sb.auth.resend({ type: 'signup', email })
    if (error) throw error
  }
```

Update the returned object — replace `signInWithMagicLink,` with:
```js
    register,
    signIn,
    resendConfirmation,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run src/__tests__/authStore.test.js`
Expected: PASS (all cases, including the untouched `init`/`signOut` ones).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/auth.js frontend/src/__tests__/authStore.test.js
git commit -m "feat(auth): email/password register, signIn, resendConfirmation in store"
```

---

## Task 3: LoginView — password form + resend confirmation

**Files:**
- Modify: `frontend/src/views/LoginView.vue`
- Test: `frontend/src/__tests__/loginView.test.js`

- [ ] **Step 1: Rewrite the failing tests**

Replace the whole body of `frontend/src/__tests__/loginView.test.js` with:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import LoginView from '@/views/LoginView.vue'
import { useAuthStore } from '@/stores/auth.js'

const stubs = {
  Logo: { props: ['size', 'variant'], template: '<span data-testid="logo" />' },
  InputText: {
    props: ['modelValue', 'type'],
    template:
      '<input :value="modelValue" :type="type" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
}

function mountView() {
  return mount(LoginView, { global: { stubs } })
}

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('disables submit until email and password are present', async () => {
    const wrapper = mountView()
    const btn = wrapper.get('[data-testid="login-submit"]')
    expect(btn.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="login-email"]').setValue('me@example.com')
    expect(btn.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="login-password"]').setValue('hunter2pw')
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('submit calls signIn with email and password', async () => {
    const auth = useAuthStore()
    const spy = vi.spyOn(auth, 'signIn').mockResolvedValue()
    const wrapper = mountView()
    await wrapper.get('[data-testid="login-email"]').setValue('me@example.com')
    await wrapper.get('[data-testid="login-password"]').setValue('hunter2pw')
    await wrapper.get('[data-testid="login-form"]').trigger('submit.prevent')
    await flushPromises()
    expect(spy).toHaveBeenCalledWith('me@example.com', 'hunter2pw')
  })

  it('shows an error banner when sign-in throws', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'signIn').mockRejectedValue(new Error('Invalid login credentials'))
    const wrapper = mountView()
    await wrapper.get('[data-testid="login-email"]').setValue('me@example.com')
    await wrapper.get('[data-testid="login-password"]').setValue('wrongpass')
    await wrapper.get('[data-testid="login-form"]').trigger('submit.prevent')
    await flushPromises()
    expect(wrapper.find('[data-testid="login-error"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="login-error"]').text()).toContain(
      'Invalid login credentials',
    )
  })

  it('offers resend when the account email is not confirmed', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'signIn').mockRejectedValue(new Error('Email not confirmed'))
    const resendSpy = vi.spyOn(auth, 'resendConfirmation').mockResolvedValue()
    const wrapper = mountView()
    await wrapper.get('[data-testid="login-email"]').setValue('me@example.com')
    await wrapper.get('[data-testid="login-password"]').setValue('hunter2pw')
    await wrapper.get('[data-testid="login-form"]').trigger('submit.prevent')
    await flushPromises()
    const resendBtn = wrapper.get('[data-testid="login-resend"]')
    await resendBtn.trigger('click')
    await flushPromises()
    expect(resendSpy).toHaveBeenCalledWith('me@example.com')
    expect(wrapper.find('[data-testid="login-resent"]').exists()).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run src/__tests__/loginView.test.js`
Expected: FAIL — no `login-password` field; `signIn` not used.

- [ ] **Step 3: Implement LoginView**

Replace the whole `frontend/src/views/LoginView.vue` with:

```vue
<template>
  <section class="login">
    <header class="head">
      <Logo size="lg" variant="mark-only" />
      <span class="folio">sign in</span>
      <h1 class="title">Welcome to Crux</h1>
      <p class="lede">Sign in with your email and password.</p>
    </header>

    <form class="form" data-testid="login-form" @submit.prevent="submit">
      <div class="field">
        <label for="email" class="label">Email</label>
        <InputText
          id="email"
          v-model="email"
          type="email"
          data-testid="login-email"
          autocomplete="email"
          placeholder="you@example.com"
          required
          class="input"
        />
      </div>

      <div class="field">
        <label for="password" class="label">Password</label>
        <InputText
          id="password"
          v-model="password"
          type="password"
          data-testid="login-password"
          autocomplete="current-password"
          placeholder="Your password"
          required
          class="input"
        />
      </div>

      <p v-if="error" class="error" data-testid="login-error">{{ error }}</p>
      <p v-if="needsConfirm" class="hint">
        <button
          type="button"
          class="linkbtn"
          data-testid="login-resend"
          @click="resend"
        >
          Resend confirmation email
        </button>
      </p>
      <p v-if="resent" class="sent" data-testid="login-resent">
        Confirmation email re-sent to <strong>{{ email.trim() }}</strong>.
      </p>

      <div class="actions">
        <button
          type="submit"
          class="cta"
          data-testid="login-submit"
          :disabled="!canSubmit || submitting"
        >
          <span>{{ submitting ? 'Signing in…' : 'Sign in' }}</span>
          <i class="pi pi-arrow-right" aria-hidden="true" />
        </button>
      </div>

      <p class="swap">
        New here?
        <RouterLink to="/register" data-testid="login-to-register">Create an account</RouterLink>
      </p>
    </form>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'

import InputText from 'primevue/inputtext'

import Logo from '../components/Logo.vue'
import { useAuthStore } from '../stores/auth.js'

const auth = useAuthStore()

const email = ref('')
const password = ref('')
const submitting = ref(false)
const error = ref('')
const needsConfirm = ref(false)
const resent = ref(false)

const canSubmit = computed(
  () =>
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim()) &&
    password.value.length > 0,
)

async function submit() {
  if (!canSubmit.value) return
  error.value = ''
  needsConfirm.value = false
  resent.value = false
  submitting.value = true
  try {
    await auth.signIn(email.value.trim(), password.value)
  } catch (e) {
    const msg = e?.message || 'Could not sign in. Try again.'
    error.value = msg
    if (/not confirmed/i.test(msg)) needsConfirm.value = true
  } finally {
    submitting.value = false
  }
}

async function resend() {
  resent.value = false
  try {
    await auth.resendConfirmation(email.value.trim())
    resent.value = true
  } catch (e) {
    error.value = e?.message || 'Could not resend. Try again.'
  }
}
</script>

<style scoped>
.login {
  max-width: 30rem;
  margin: 0 auto;
  padding: 2rem 0;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

.head {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.5rem;
}

.folio {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-accent-text);
}

.title {
  font-family: var(--font-display);
  font-size: clamp(1.875rem, 4vw, 2.5rem);
  font-weight: 700;
  letter-spacing: var(--tracking-display);
  line-height: 1.1;
  margin: 0;
  color: var(--color-heading);
}

.lede {
  margin: 0;
  font-size: 1rem;
  color: var(--color-text-muted);
  max-width: 24rem;
  line-height: var(--lh-body);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.75rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-lift);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.label {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  font-weight: 600;
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.input :deep(input),
.input.p-inputtext {
  font-family: var(--font-sans);
  font-size: 1rem;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  padding: 0.7rem 1.1rem;
  width: 100%;
}

.cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent-strong);
  color: #fff;
  border: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.9375rem;
  cursor: pointer;
  box-shadow: var(--shadow-pop);
  transition: transform var(--motion-fast) var(--motion-bounce);
}

.cta:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

.cta:not(:disabled):hover {
  transform: translateY(-1px);
}

.actions {
  display: flex;
  justify-content: flex-end;
}

.error {
  margin: 0;
  color: var(--color-error-text);
  font-size: 0.875rem;
}

.sent {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-success-text);
}

.hint {
  margin: 0;
  font-size: 0.875rem;
}

.linkbtn {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: var(--color-accent-text);
  cursor: pointer;
  text-decoration: underline;
}

.swap {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-muted);
  text-align: center;
}
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run src/__tests__/loginView.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/LoginView.vue frontend/src/__tests__/loginView.test.js
git commit -m "feat(auth): password login form with resend-confirmation affordance"
```

---

## Task 4: RegisterView — registration form

**Files:**
- Create: `frontend/src/views/RegisterView.vue`
- Test: `frontend/src/__tests__/registerView.test.js`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/__tests__/registerView.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import RegisterView from '@/views/RegisterView.vue'
import { useAuthStore } from '@/stores/auth.js'

const stubs = {
  Logo: { props: ['size', 'variant'], template: '<span data-testid="logo" />' },
  InputText: {
    props: ['modelValue', 'type'],
    template:
      '<input :value="modelValue" :type="type" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
}

function mountView() {
  return mount(RegisterView, { global: { stubs } })
}

describe('RegisterView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('disables submit until email, an 8+ char password, and a matching confirm are present', async () => {
    const wrapper = mountView()
    const btn = wrapper.get('[data-testid="register-submit"]')
    expect(btn.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="register-email"]').setValue('me@example.com')
    await wrapper.get('[data-testid="register-password"]').setValue('short')
    await wrapper.get('[data-testid="register-confirm"]').setValue('short')
    expect(btn.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="register-password"]').setValue('hunter2pw')
    await wrapper.get('[data-testid="register-confirm"]').setValue('different')
    expect(btn.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="register-confirm"]').setValue('hunter2pw')
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('submit calls register and shows the check-inbox state', async () => {
    const auth = useAuthStore()
    const spy = vi.spyOn(auth, 'register').mockResolvedValue({ user: { id: 'u-new' }, session: null })
    const wrapper = mountView()
    await wrapper.get('[data-testid="register-email"]').setValue('me@example.com')
    await wrapper.get('[data-testid="register-password"]').setValue('hunter2pw')
    await wrapper.get('[data-testid="register-confirm"]').setValue('hunter2pw')
    await wrapper.get('[data-testid="register-form"]').trigger('submit.prevent')
    await flushPromises()
    expect(spy).toHaveBeenCalledWith('me@example.com', 'hunter2pw')
    expect(wrapper.find('[data-testid="register-sent"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('me@example.com')
  })

  it('shows an error banner when register throws', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'register').mockRejectedValue(new Error('User already registered'))
    const wrapper = mountView()
    await wrapper.get('[data-testid="register-email"]').setValue('me@example.com')
    await wrapper.get('[data-testid="register-password"]').setValue('hunter2pw')
    await wrapper.get('[data-testid="register-confirm"]').setValue('hunter2pw')
    await wrapper.get('[data-testid="register-form"]').trigger('submit.prevent')
    await flushPromises()
    expect(wrapper.find('[data-testid="register-error"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="register-error"]').text()).toContain(
      'User already registered',
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run src/__tests__/registerView.test.js`
Expected: FAIL — `RegisterView.vue` does not exist.

- [ ] **Step 3: Implement RegisterView**

Create `frontend/src/views/RegisterView.vue`:

```vue
<template>
  <section class="login">
    <header class="head">
      <Logo size="lg" variant="mark-only" />
      <span class="folio">create account</span>
      <h1 class="title">Join Crux</h1>
      <p class="lede">Register with your email and a password.</p>
    </header>

    <form v-if="!sent" class="form" data-testid="register-form" @submit.prevent="submit">
      <div class="field">
        <label for="email" class="label">Email</label>
        <InputText
          id="email"
          v-model="email"
          type="email"
          data-testid="register-email"
          autocomplete="email"
          placeholder="you@example.com"
          required
          class="input"
        />
      </div>

      <div class="field">
        <label for="password" class="label">Password</label>
        <InputText
          id="password"
          v-model="password"
          type="password"
          data-testid="register-password"
          autocomplete="new-password"
          placeholder="At least 8 characters"
          required
          class="input"
        />
      </div>

      <div class="field">
        <label for="confirm" class="label">Confirm password</label>
        <InputText
          id="confirm"
          v-model="confirm"
          type="password"
          data-testid="register-confirm"
          autocomplete="new-password"
          placeholder="Re-enter password"
          required
          class="input"
        />
      </div>

      <p v-if="mismatch" class="hint" data-testid="register-mismatch">
        Passwords do not match.
      </p>
      <p v-if="error" class="error" data-testid="register-error">{{ error }}</p>

      <div class="actions">
        <button
          type="submit"
          class="cta"
          data-testid="register-submit"
          :disabled="!canSubmit || submitting"
        >
          <span>{{ submitting ? 'Creating…' : 'Create account' }}</span>
          <i class="pi pi-arrow-right" aria-hidden="true" />
        </button>
      </div>

      <p class="swap">
        Already have an account?
        <RouterLink to="/login" data-testid="register-to-login">Sign in</RouterLink>
      </p>
    </form>

    <div v-else class="form" data-testid="register-sent">
      <p class="sent">
        Check your inbox at <strong>{{ email.trim() }}</strong> to confirm your
        account, then sign in.
      </p>
      <p class="swap">
        <RouterLink to="/login" data-testid="register-sent-to-login">Back to sign in</RouterLink>
      </p>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'

import InputText from 'primevue/inputtext'

import Logo from '../components/Logo.vue'
import { useAuthStore } from '../stores/auth.js'

const auth = useAuthStore()

const email = ref('')
const password = ref('')
const confirm = ref('')
const submitting = ref(false)
const error = ref('')
const sent = ref(false)

const emailValid = computed(() => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim()))
const passwordValid = computed(() => password.value.length >= 8)
const mismatch = computed(() => confirm.value.length > 0 && confirm.value !== password.value)
const canSubmit = computed(
  () => emailValid.value && passwordValid.value && confirm.value === password.value,
)

async function submit() {
  if (!canSubmit.value) return
  error.value = ''
  submitting.value = true
  try {
    await auth.register(email.value.trim(), password.value)
    sent.value = true
  } catch (e) {
    error.value = e?.message || 'Could not create account. Try again.'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.login {
  max-width: 30rem;
  margin: 0 auto;
  padding: 2rem 0;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

.head {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.5rem;
}

.folio {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-accent-text);
}

.title {
  font-family: var(--font-display);
  font-size: clamp(1.875rem, 4vw, 2.5rem);
  font-weight: 700;
  letter-spacing: var(--tracking-display);
  line-height: 1.1;
  margin: 0;
  color: var(--color-heading);
}

.lede {
  margin: 0;
  font-size: 1rem;
  color: var(--color-text-muted);
  max-width: 24rem;
  line-height: var(--lh-body);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.75rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-lift);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.label {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  font-weight: 600;
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.input :deep(input),
.input.p-inputtext {
  font-family: var(--font-sans);
  font-size: 1rem;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  padding: 0.7rem 1.1rem;
  width: 100%;
}

.cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent-strong);
  color: #fff;
  border: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.9375rem;
  cursor: pointer;
  box-shadow: var(--shadow-pop);
  transition: transform var(--motion-fast) var(--motion-bounce);
}

.cta:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

.cta:not(:disabled):hover {
  transform: translateY(-1px);
}

.actions {
  display: flex;
  justify-content: flex-end;
}

.error {
  margin: 0;
  color: var(--color-error-text);
  font-size: 0.875rem;
}

.hint {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.sent {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--color-success-text);
  line-height: var(--lh-body);
}

.swap {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-muted);
  text-align: center;
}
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run src/__tests__/registerView.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/RegisterView.vue frontend/src/__tests__/registerView.test.js
git commit -m "feat(auth): RegisterView email/password registration form"
```

---

## Task 5: Router — /register route + public-route guard

**Files:**
- Modify: `frontend/src/router/index.js`
- Test: `frontend/src/__tests__/router.test.js`

- [ ] **Step 1: Write the failing tests**

In `frontend/src/__tests__/router.test.js`, add `'register'` to the `arrayContaining` list in the "exposes the expected named routes" test, and append these two cases inside the `describe('router', ...)` block:

```js
  it('allows an unauthenticated user to reach /register', async () => {
    setAuth(false)
    await router.push({ name: 'register' })
    expect(router.currentRoute.value.name).toBe('register')
  })

  it('redirects an authenticated user away from /register to home', async () => {
    setAuth(true)
    const user = useUserStore()
    user.onboardingComplete = true
    await router.push({ name: 'register' })
    expect(router.currentRoute.value.name).toBe('home')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run src/__tests__/router.test.js`
Expected: FAIL — no `register` route; unauthenticated push to `register` redirects to `login`.

- [ ] **Step 3: Implement the route + guard change**

In `frontend/src/router/index.js`, add this route object immediately after the `/login` route object (after line 14):

```js
    {
      path: '/register',
      name: 'register',
      component: () => import('../views/RegisterView.vue'),
      meta: { public: true, sidebar: false },
    },
```

Then replace the two redirect conditions in `beforeEach` (the current lines 67-72):

```js
  if (!auth.isAuthenticated && to.name !== 'login') {
    return { name: 'login' }
  }
  if (auth.isAuthenticated && to.name === 'login') {
    return { name: 'home' }
  }
```

with:

```js
  const isPublic = to.meta?.public === true
  if (!auth.isAuthenticated && !isPublic) {
    return { name: 'login' }
  }
  if (auth.isAuthenticated && (to.name === 'login' || to.name === 'register')) {
    return { name: 'home' }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run src/__tests__/router.test.js`
Expected: PASS (including the pre-existing redirect cases — `/login` is still `meta.public`, so unauthenticated users still land there).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/router/index.js frontend/src/__tests__/router.test.js
git commit -m "feat(auth): add public /register route and meta.public guard"
```

---

## Task 6: Backend seed script for pre-confirmed debug accounts

**Files:**
- Create: `backend/scripts/seed_debug_accounts.py`
- Test: `backend/tests/test_seed_debug_accounts.py`

Background: the GoTrue Admin endpoint is `POST {SUPABASE_URL}/auth/v1/admin/users` with headers `apikey: <secret>` and `Authorization: Bearer <secret>`, JSON body `{"email", "password", "email_confirm": true}`. A `200`/`201` means created; a `422` with an "already been registered"/"email_exists" message means the account exists (treat as success/skip).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_seed_debug_accounts.py`:

```python
import httpx
import pytest

from scripts.seed_debug_accounts import create_account, parse_accounts


def _client(handler):
    transport = httpx.MockTransport(handler)
    return httpx.Client(
        base_url="https://example.supabase.co",
        transport=transport,
        headers={"apikey": "k", "Authorization": "Bearer k"},
    )


def test_parse_accounts_skips_comments_and_blanks():
    text = "\n".join(
        [
            "# debug accounts",
            "",
            "alice@example.com,Passw0rd123",
            "  bob@example.com , Hunter2pw  ",
            "# trailing comment",
        ]
    )
    assert parse_accounts(text) == [
        ("alice@example.com", "Passw0rd123"),
        ("bob@example.com", "Hunter2pw"),
    ]


def test_create_account_created_on_2xx():
    def handler(request):
        assert request.url.path == "/auth/v1/admin/users"
        import json

        body = json.loads(request.content)
        assert body == {
            "email": "alice@example.com",
            "password": "Passw0rd123",
            "email_confirm": True,
        }
        return httpx.Response(200, json={"id": "u-1"})

    with _client(handler) as client:
        assert create_account(client, "alice@example.com", "Passw0rd123") == "created"


def test_create_account_exists_on_duplicate():
    def handler(request):
        return httpx.Response(
            422, json={"msg": "A user with this email address has already been registered"}
        )

    with _client(handler) as client:
        assert create_account(client, "alice@example.com", "Passw0rd123") == "exists"


def test_create_account_raises_on_other_error():
    def handler(request):
        return httpx.Response(500, json={"msg": "boom"})

    with _client(handler) as client:
        with pytest.raises(RuntimeError):
            create_account(client, "alice@example.com", "Passw0rd123")
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `backend/`): `pytest tests/test_seed_debug_accounts.py -v`
Expected: FAIL — `scripts.seed_debug_accounts` does not exist.

- [ ] **Step 3: Implement the seed script**

Create `backend/scripts/seed_debug_accounts.py`:

```python
"""Seed pre-confirmed debug accounts into Supabase Auth.

Real registrations go through email confirmation. Debug accounts are created
with `email_confirm: true` via the GoTrue Admin API so they can sign in
immediately. Requires SUPABASE_URL + SUPABASE_SECRET_KEY (service role) from
the backend env. The secret key is backend-only and never shipped to clients.

Usage (from backend/):
    python scripts/seed_debug_accounts.py [path/to/debug-accounts.txt]

Default account list: docs/dev/debug-accounts.txt (gitignored).
File format: one `email,password` per line; blank lines and `#` comments
are ignored.
"""
from __future__ import annotations

import sys
from pathlib import Path

import httpx

# Make `config` importable when run as a script from backend/.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import settings  # noqa: E402

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_ACCOUNTS = _REPO_ROOT / "docs" / "dev" / "debug-accounts.txt"
_EXISTS_MARKERS = ("already been registered", "email_exists", "already registered")


def parse_accounts(text: str) -> list[tuple[str, str]]:
    """Parse `email,password` lines, skipping blanks and `#` comments."""
    accounts: list[tuple[str, str]] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        email, _, password = stripped.partition(",")
        email = email.strip()
        password = password.strip()
        if email and password:
            accounts.append((email, password))
    return accounts


def create_account(client: httpx.Client, email: str, password: str) -> str:
    """Create one pre-confirmed account. Returns 'created' or 'exists'.

    Raises RuntimeError on any other non-success response.
    """
    resp = client.post(
        "/auth/v1/admin/users",
        json={"email": email, "password": password, "email_confirm": True},
    )
    if resp.status_code in (200, 201):
        return "created"
    body = resp.text.lower()
    if resp.status_code in (422, 409, 400) and any(m in body for m in _EXISTS_MARKERS):
        return "exists"
    raise RuntimeError(
        f"Failed to create {email}: HTTP {resp.status_code} {resp.text}"
    )


def run(accounts_path: Path) -> int:
    if not settings.supabase_url or not settings.supabase_secret_key:
        print("ERROR: SUPABASE_URL and SUPABASE_SECRET_KEY must be set.", file=sys.stderr)
        return 2
    if not accounts_path.exists():
        print(f"ERROR: account file not found: {accounts_path}", file=sys.stderr)
        print("Create it from docs/dev/debug-accounts.example.txt.", file=sys.stderr)
        return 2

    accounts = parse_accounts(accounts_path.read_text(encoding="utf-8"))
    if not accounts:
        print(f"No accounts found in {accounts_path}.")
        return 0

    key = settings.supabase_secret_key
    with httpx.Client(
        base_url=settings.supabase_url.rstrip("/"),
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=30.0,
    ) as client:
        for email, password in accounts:
            try:
                result = create_account(client, email, password)
            except RuntimeError as e:
                print(str(e), file=sys.stderr)
                return 1
            print(f"  {result:>8}  {email}")
    print(f"Done. {len(accounts)} account(s) processed.")
    return 0


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else _DEFAULT_ACCOUNTS
    return run(path)


if __name__ == "__main__":
    raise SystemExit(main())
```

Note: `backend/config.py` defines `supabase_url` (line 30) and `supabase_secret_key` (line 33) on `Settings`, and exports `settings` (line 54) — the names used above are verified correct.

- [ ] **Step 4: Run the test to verify it passes**

Run (from `backend/`): `pytest tests/test_seed_debug_accounts.py -v`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/seed_debug_accounts.py backend/tests/test_seed_debug_accounts.py
git commit -m "feat(auth): idempotent seed script for pre-confirmed debug accounts"
```

---

## Task 7: Debug account files + .gitignore

**Files:**
- Create: `docs/dev/debug-accounts.example.txt` (committed)
- Create: `docs/dev/debug-accounts.txt` (gitignored, local only)
- Modify: `.gitignore`

- [ ] **Step 1: Add the gitignore rule**

In `.gitignore`, under the `# Secrets` block (after line 9, the `!**/.env.example` line), add:

```gitignore
# Debug account credentials — dev-only throwaway creds, never commit.
docs/dev/debug-accounts.txt
```

- [ ] **Step 2: Create the committed example file**

Create `docs/dev/debug-accounts.example.txt`:

```text
# Crux debug accounts — TEMPLATE (committed, placeholders only).
#
# Copy this file to docs/dev/debug-accounts.txt (gitignored) and replace the
# values with throwaway dev credentials, then seed them into Supabase Auth:
#
#   cd backend && python scripts/seed_debug_accounts.py
#
# DEV ONLY. Use only against a disposable Supabase dev project. Never use real
# passwords. Never point this at production. The real file is gitignored so
# these credentials never enter git history.
#
# Format: one account per line as  email,password
# Blank lines and lines starting with # are ignored.

debug1@adaptlearn.test,ChangeMe-Dev1
debug2@adaptlearn.test,ChangeMe-Dev2
```

- [ ] **Step 3: Create the local (gitignored) real file**

Create `docs/dev/debug-accounts.txt` with the same two lines as the example (these are throwaway dev creds; edit later as needed):

```text
# Crux debug accounts — LOCAL, gitignored. DEV ONLY, throwaway creds.
# Format: email,password  (blank lines and # comments ignored)
debug1@adaptlearn.test,ChangeMe-Dev1
debug2@adaptlearn.test,ChangeMe-Dev2
```

- [ ] **Step 4: Verify the real file is ignored**

Run: `git check-ignore docs/dev/debug-accounts.txt`
Expected: prints `docs/dev/debug-accounts.txt` (confirming it is ignored).

Run: `git status --porcelain docs/dev/`
Expected: shows only `docs/dev/debug-accounts.example.txt` as untracked — NOT `debug-accounts.txt`.

- [ ] **Step 5: Commit (example + gitignore only)**

```bash
git add .gitignore docs/dev/debug-accounts.example.txt
git commit -m "chore(auth): debug-accounts template + gitignore real creds file"
```

---

## Task 8: Update docs

**Files:**
- Modify: `docs/auth/supabase-setup.md`
- Modify: `docs/superpowers/specs/2026-05-03-adaptlearn-v1-design.md`

- [ ] **Step 1: Update the Supabase provider section**

In `docs/auth/supabase-setup.md`, replace section `## 2. Enable Email magic-link` (lines 16-34) with:

```markdown
## 2. Enable Email + password

`Authentication → Providers → Email`:

- **Enable** Email provider.
- **Enable** "Email + Password" sign-in (password provider ON).
- **Confirm email**: ON — new self-service registrations must confirm via the
  emailed link before first sign-in.
- **Secure email change**: ON.
- Magic-link / OTP-only sign-in: not used by the app (the app calls
  `signUp` / `signInWithPassword`). The OTP toggle can stay at its default.

`Authentication → URL Configuration`:

- **Site URL**: `http://localhost:5173` for dev. Switch to your Fly.io URL
  for Phase 8.
- **Redirect URLs**: add `http://localhost:5173/**` for dev. The confirmation
  link redirects back here and `supabase-js` (`detectSessionInUrl: true`)
  completes the session.

Disable every other provider (GitHub, Google, etc.) under `Providers`.

### Debug accounts (pre-confirmed)

Real registrations require email confirmation. For local debugging, create
pre-confirmed accounts that skip the inbox step:

1. Copy `docs/dev/debug-accounts.example.txt` to `docs/dev/debug-accounts.txt`
   (gitignored) and set throwaway dev credentials.
2. From `backend/`, run `python scripts/seed_debug_accounts.py`. It calls the
   GoTrue Admin API with `email_confirm: true` using `SUPABASE_SECRET_KEY`
   (backend-only) and is idempotent. The seeded accounts log in via the normal
   `/login` form.
```

- [ ] **Step 2: Update section 5 sign-in description**

In `docs/auth/supabase-setup.md`, in `## 5. How verification works`, replace the first bullet (lines 84-89, the `signInWithOtp` / magic-link description) with:

```markdown
- Frontend: `frontend/src/services/supabase.js` exposes a lazy singleton
  `@supabase/supabase-js` client. `frontend/src/stores/auth.js` calls
  `supabase.auth.signUp` (registration) and `supabase.auth.signInWithPassword`
  (login) from `RegisterView.vue` / `LoginView.vue`. On email confirmation the
  link redirects back to the app; `supabase-js` parses the URL and emits a
  `SIGNED_IN` event, which the auth store consumes.
```

- [ ] **Step 3: Update the page title note**

In `docs/auth/supabase-setup.md`, replace line 3:

```markdown
Phase 7 wires Crux to Supabase Auth (magic-link only). This doc is the
```

with:

```markdown
Crux uses Supabase Auth with email + password sign-in. This doc is the
```

- [ ] **Step 4: Update the design spec constraint line**

In `docs/superpowers/specs/2026-05-03-adaptlearn-v1-design.md`, find the Auth constraint row containing `Supabase magic-link (JWT)` and replace `Supabase magic-link (JWT)` with `Supabase email/password (JWT)`. Find the out-of-scope note referencing `Supabase magic-link JWT` and replace `magic-link JWT` with `email/password JWT`.

- [ ] **Step 5: Commit**

```bash
git add docs/auth/supabase-setup.md docs/superpowers/specs/2026-05-03-adaptlearn-v1-design.md
git commit -m "docs(auth): document email/password provider + debug account seeding"
```

---

## Task 9: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Run the full frontend unit suite**

Run (from `frontend/`): `npm run test:unit -- --run`
Expected: PASS, no failures. (Confirms no other test referenced `signInWithMagicLink`/`signInWithOtp`.)

- [ ] **Step 2: Grep for any leftover magic-link references in source**

Run (from repo root): `git grep -n "signInWithMagicLink\|signInWithOtp\|magic-link\|magic link" -- frontend/src`
Expected: no matches in `frontend/src` (the stub, store, views, and tests are all migrated). Matches in `docs/` history are acceptable.

- [ ] **Step 3: Run the frontend linter**

Run (from `frontend/`): `npm run lint`
Expected: clean (no errors).

- [ ] **Step 4: Run the backend test suite**

Run (from `backend/`): `pytest -q`
Expected: PASS, including the new `test_seed_debug_accounts.py`.

- [ ] **Step 5: Confirm no API contract drift**

Run (from repo root): `python backend/scripts/gen_contracts.py`
Expected: no file changes (this feature adds no API endpoints). `git status` should show no modified contract files.

- [ ] **Step 6: Final commit if anything regenerated**

Only if Step 5 produced changes (it should not):

```bash
git add -A
git commit -m "chore: regenerate contracts (no-op expected)"
```

---

## Manual smoke (post-merge, requires live Supabase)

Not part of automated tasks — run against a real dev Supabase project with the
password provider enabled:

1. Register a new email at `/register` → see "check your inbox" → confirm via
   the emailed link → land in the app (onboarding on first run).
2. Sign out, sign back in at `/login` with the same credentials.
3. Try logging in before confirming → see "Email not confirmed" → click
   "Resend confirmation email" → receive a new mail.
4. Run `python backend/scripts/seed_debug_accounts.py` → log in immediately
   with a seeded debug account (no inbox step).
5. Confirm a protected API call (e.g. create a session) still works with the
   issued JWT, and returns 401 when the token is removed.
```
