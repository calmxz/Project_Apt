# Password Reset + Change Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add forgot-password recovery (`/forgot` + `/reset-password`) and an in-app change-password card in Settings, on top of the email/password auth migration.

**Architecture:** Pure frontend + Supabase dashboard config. Three new auth-store actions wrap GoTrue (`resetPasswordForEmail`, `updateUser`). Two new public views mirror Login/Register styling. The recovery email link lands on `/reset-password`, where `detectSessionInUrl` establishes a recovery session; one router-guard exemption stops that session from being bounced to onboarding/home. Reset-confirm signs out and routes to `/login?reset=1`; Settings change-password re-verifies the current password and keeps the session.

**Tech Stack:** Vue 3 (script setup), Pinia, vue-router, PrimeVue InputText, Vitest + @vue/test-utils, Playwright. Supabase JS (`@supabase/supabase-js` 2.106.1).

**Spec:** `docs/superpowers/specs/2026-06-17-password-reset-design.md`

**Branch:** `feat/password-reset` (already created off `feat/email-password-auth`).

**Test commands:**
- Single unit file: `cd frontend && npm run test:unit -- --run src/__tests__/<file>`
- Full unit suite: `cd frontend && npm run test:unit -- --run`
- Lint: `cd frontend && npm run lint`
- e2e auth: `cd frontend && npx playwright test e2e/auth.spec.js --reporter=list`

---

### Task 1: Auth store — `userEmail`, `requestPasswordReset`, `updatePassword`

**Files:**
- Modify: `frontend/src/__tests__/setup.js` (add Supabase stub methods)
- Modify: `frontend/src/stores/auth.js`
- Test: `frontend/src/__tests__/authStore.test.js`

- [ ] **Step 1: Extend the global Supabase stub**

In `frontend/src/__tests__/setup.js`, add two methods to the `authStub` object (after `signOut`):

```js
  signOut: vi.fn().mockResolvedValue({ error: null }),
  resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
  updateUser: vi.fn().mockResolvedValue({
    data: { user: { id: 'u-1' } },
    error: null,
  }),
```

And in the `beforeEach` block, add resets (after the `signOut` resets):

```js
  authStub.signOut.mockClear()
  authStub.signOut.mockResolvedValue({ error: null })
  authStub.resetPasswordForEmail.mockClear()
  authStub.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
  authStub.updateUser.mockClear()
  authStub.updateUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null })
```

- [ ] **Step 2: Write the failing tests**

Append to `frontend/src/__tests__/authStore.test.js`, inside the `describe('auth store', ...)` block (before the closing `})`):

```js
  it('userEmail reflects the session user email', async () => {
    globalThis.__supabaseAuthStub.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 't', user: { id: 'u-1', email: 'a@b.c' } } },
      error: null,
    })
    const auth = useAuthStore()
    await auth.init()
    expect(auth.userEmail).toBe('a@b.c')
  })

  it('requestPasswordReset calls resetPasswordForEmail with a redirectTo', async () => {
    const auth = useAuthStore()
    await auth.requestPasswordReset('me@example.com')
    expect(globalThis.__supabaseAuthStub.resetPasswordForEmail).toHaveBeenCalledWith(
      'me@example.com',
      expect.objectContaining({ redirectTo: expect.stringContaining('/reset-password') }),
    )
  })

  it('requestPasswordReset throws when Supabase returns an error', async () => {
    globalThis.__supabaseAuthStub.resetPasswordForEmail.mockResolvedValueOnce({
      data: null,
      error: new Error('rate limit'),
    })
    const auth = useAuthStore()
    await expect(auth.requestPasswordReset('x@y.z')).rejects.toThrow('rate limit')
  })

  it('updatePassword calls updateUser with the new password', async () => {
    const auth = useAuthStore()
    await auth.updatePassword('newpass12')
    expect(globalThis.__supabaseAuthStub.updateUser).toHaveBeenCalledWith({
      password: 'newpass12',
    })
  })

  it('updatePassword throws when Supabase returns an error', async () => {
    globalThis.__supabaseAuthStub.updateUser.mockResolvedValueOnce({
      data: null,
      error: new Error('same password'),
    })
    const auth = useAuthStore()
    await expect(auth.updatePassword('newpass12')).rejects.toThrow('same password')
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/authStore.test.js`
Expected: FAIL — `auth.userEmail` is undefined; `requestPasswordReset`/`updatePassword` are not functions.

- [ ] **Step 4: Implement the store changes**

In `frontend/src/stores/auth.js`, add the `userEmail` computed next to the other getters (after `accessToken`):

```js
  const userEmail = computed(() => session.value?.user?.email ?? null)
```

Add two actions (after `resendConfirmation`):

```js
  async function requestPasswordReset(email) {
    const sb = getSupabase()
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo:
        typeof window !== 'undefined'
          ? `${window.location.origin}/reset-password`
          : undefined,
    })
    if (error) throw error
  }

  async function updatePassword(password) {
    const sb = getSupabase()
    const { error } = await sb.auth.updateUser({ password })
    if (error) throw error
  }
```

Add all three to the returned object (alongside the existing exports):

```js
  return {
    session,
    ready,
    userId,
    accessToken,
    userEmail,
    isAuthenticated,
    init,
    register,
    signIn,
    resendConfirmation,
    requestPasswordReset,
    updatePassword,
    signOut,
    _resetForTests,
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/authStore.test.js`
Expected: PASS (all auth store tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/__tests__/setup.js frontend/src/stores/auth.js frontend/src/__tests__/authStore.test.js
git commit -m "feat(auth): add requestPasswordReset, updatePassword, userEmail to auth store"
```

---

### Task 2: ForgotPasswordView

**Files:**
- Create: `frontend/src/views/ForgotPasswordView.vue`
- Test: `frontend/src/__tests__/forgotPasswordView.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/forgotPasswordView.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import ForgotPasswordView from '@/views/ForgotPasswordView.vue'
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
  return mount(ForgotPasswordView, { global: { stubs } })
}

describe('ForgotPasswordView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('disables submit until the email is valid', async () => {
    const wrapper = mountView()
    const btn = wrapper.get('[data-testid="forgot-submit"]')
    expect(btn.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="forgot-email"]').setValue('not-an-email')
    expect(btn.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="forgot-email"]').setValue('me@example.com')
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('submit calls requestPasswordReset and shows the sent state', async () => {
    const auth = useAuthStore()
    const spy = vi.spyOn(auth, 'requestPasswordReset').mockResolvedValue()
    const wrapper = mountView()
    await wrapper.get('[data-testid="forgot-email"]').setValue('me@example.com')
    await wrapper.get('[data-testid="forgot-form"]').trigger('submit.prevent')
    await flushPromises()
    expect(spy).toHaveBeenCalledWith('me@example.com')
    expect(wrapper.find('[data-testid="forgot-sent"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('me@example.com')
  })

  it('shows an error banner when the request throws', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'requestPasswordReset').mockRejectedValue(new Error('rate limit'))
    const wrapper = mountView()
    await wrapper.get('[data-testid="forgot-email"]').setValue('me@example.com')
    await wrapper.get('[data-testid="forgot-form"]').trigger('submit.prevent')
    await flushPromises()
    expect(wrapper.find('[data-testid="forgot-error"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="forgot-error"]').text()).toContain('rate limit')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/forgotPasswordView.test.js`
Expected: FAIL — cannot resolve `@/views/ForgotPasswordView.vue`.

- [ ] **Step 3: Create the view**

Create `frontend/src/views/ForgotPasswordView.vue`:

```vue
<template>
  <section class="login">
    <header class="head">
      <Logo size="lg" variant="mark-only" />
      <span class="folio">reset password</span>
      <h1 class="title">Forgot your password?</h1>
      <p class="lede">Enter your email and we'll send you a reset link.</p>
    </header>

    <form v-if="!sent" class="form" data-testid="forgot-form" @submit.prevent="submit">
      <div class="field">
        <label for="email" class="label">Email</label>
        <InputText
          id="email"
          v-model="email"
          type="email"
          data-testid="forgot-email"
          autocomplete="email"
          placeholder="you@example.com"
          required
          class="input"
        />
      </div>

      <p v-if="error" class="error" data-testid="forgot-error">{{ error }}</p>

      <div class="actions">
        <button
          type="submit"
          class="cta"
          data-testid="forgot-submit"
          :disabled="!canSubmit || submitting"
        >
          <span>{{ submitting ? 'Sending…' : 'Send reset link' }}</span>
          <i class="pi pi-arrow-right" aria-hidden="true" />
        </button>
      </div>

      <p class="swap">
        Remembered it?
        <RouterLink to="/login" data-testid="forgot-to-login">Back to sign in</RouterLink>
      </p>
    </form>

    <div v-else class="form" data-testid="forgot-sent">
      <p class="sent">
        If an account exists for <strong>{{ email.trim() }}</strong>, a password
        reset link is on its way. Check your inbox.
      </p>
      <p class="swap">
        <RouterLink to="/login" data-testid="forgot-sent-to-login">Back to sign in</RouterLink>
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
const submitting = ref(false)
const error = ref('')
const sent = ref(false)

const canSubmit = computed(() => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim()))

async function submit() {
  if (!canSubmit.value) return
  error.value = ''
  submitting.value = true
  try {
    await auth.requestPasswordReset(email.value.trim())
    sent.value = true
  } catch (e) {
    error.value = e?.message || 'Could not send reset link. Try again.'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
/* Copy the ENTIRE `<style scoped>...</style>` block from
   frontend/src/views/RegisterView.vue verbatim — same .login/.head/.folio/
   .title/.lede/.form/.field/.label/.input/.cta/.actions/.error/.hint/.sent/
   .swap classes are used here. */
</style>
```

Then open `frontend/src/views/RegisterView.vue`, copy everything between `<style scoped>` and `</style>` (inclusive of the rules, not the tags), and paste it in place of the comment above.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/forgotPasswordView.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/ForgotPasswordView.vue frontend/src/__tests__/forgotPasswordView.test.js
git commit -m "feat(auth): add ForgotPasswordView request-reset page"
```

---

### Task 3: ResetPasswordView

**Files:**
- Create: `frontend/src/views/ResetPasswordView.vue`
- Test: `frontend/src/__tests__/resetPasswordView.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/resetPasswordView.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import ResetPasswordView from '@/views/ResetPasswordView.vue'
import { useAuthStore } from '@/stores/auth.js'

const routerPush = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
}))

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
  return mount(ResetPasswordView, { global: { stubs } })
}

describe('ResetPasswordView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    routerPush.mockClear()
  })

  it('disables submit until an 8+ char password matches confirm', async () => {
    const wrapper = mountView()
    const btn = wrapper.get('[data-testid="reset-submit"]')
    expect(btn.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="reset-password"]').setValue('short')
    await wrapper.get('[data-testid="reset-confirm"]').setValue('short')
    expect(btn.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="reset-password"]').setValue('newpass12')
    await wrapper.get('[data-testid="reset-confirm"]').setValue('different')
    expect(btn.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="reset-confirm"]').setValue('newpass12')
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('shows the mismatch hint only when confirm differs', async () => {
    const wrapper = mountView()
    await wrapper.get('[data-testid="reset-password"]').setValue('newpass12')
    await wrapper.get('[data-testid="reset-confirm"]').setValue('different')
    expect(wrapper.find('[data-testid="reset-mismatch"]').exists()).toBe(true)
    await wrapper.get('[data-testid="reset-confirm"]').setValue('newpass12')
    expect(wrapper.find('[data-testid="reset-mismatch"]').exists()).toBe(false)
  })

  it('on submit updates the password, signs out, and routes to /login?reset=1', async () => {
    const auth = useAuthStore()
    const update = vi.spyOn(auth, 'updatePassword').mockResolvedValue()
    const signOut = vi.spyOn(auth, 'signOut').mockResolvedValue()
    const wrapper = mountView()
    await wrapper.get('[data-testid="reset-password"]').setValue('newpass12')
    await wrapper.get('[data-testid="reset-confirm"]').setValue('newpass12')
    await wrapper.get('[data-testid="reset-form"]').trigger('submit.prevent')
    await flushPromises()
    expect(update).toHaveBeenCalledWith('newpass12')
    expect(signOut).toHaveBeenCalled()
    expect(routerPush).toHaveBeenCalledWith('/login?reset=1')
  })

  it('shows an error banner when the update throws', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'updatePassword').mockRejectedValue(new Error('Auth session missing!'))
    const wrapper = mountView()
    await wrapper.get('[data-testid="reset-password"]').setValue('newpass12')
    await wrapper.get('[data-testid="reset-confirm"]').setValue('newpass12')
    await wrapper.get('[data-testid="reset-form"]').trigger('submit.prevent')
    await flushPromises()
    expect(wrapper.find('[data-testid="reset-error"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="reset-error"]').text()).toContain('Auth session missing!')
    expect(routerPush).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/resetPasswordView.test.js`
Expected: FAIL — cannot resolve `@/views/ResetPasswordView.vue`.

- [ ] **Step 3: Create the view**

Create `frontend/src/views/ResetPasswordView.vue`:

```vue
<template>
  <section class="login">
    <header class="head">
      <Logo size="lg" variant="mark-only" />
      <span class="folio">reset password</span>
      <h1 class="title">Set a new password</h1>
      <p class="lede">Choose a new password for your account.</p>
    </header>

    <form class="form" data-testid="reset-form" @submit.prevent="submit">
      <div class="field">
        <label for="password" class="label">New password</label>
        <InputText
          id="password"
          v-model="password"
          type="password"
          data-testid="reset-password"
          autocomplete="new-password"
          placeholder="At least 8 characters"
          required
          class="input"
        />
      </div>

      <div class="field">
        <label for="confirm" class="label">Confirm new password</label>
        <InputText
          id="confirm"
          v-model="confirm"
          type="password"
          data-testid="reset-confirm"
          autocomplete="new-password"
          placeholder="Re-enter password"
          required
          class="input"
        />
      </div>

      <p v-if="mismatch" class="hint" data-testid="reset-mismatch">
        Passwords do not match.
      </p>
      <p v-if="error" class="error" data-testid="reset-error">{{ error }}</p>
      <p v-if="error" class="swap">
        Link expired?
        <RouterLink to="/forgot" data-testid="reset-to-forgot">Request a new one</RouterLink>
      </p>

      <div class="actions">
        <button
          type="submit"
          class="cta"
          data-testid="reset-submit"
          :disabled="!canSubmit || submitting"
        >
          <span>{{ submitting ? 'Updating…' : 'Update password' }}</span>
          <i class="pi pi-arrow-right" aria-hidden="true" />
        </button>
      </div>
    </form>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import InputText from 'primevue/inputtext'

import Logo from '../components/Logo.vue'
import { useAuthStore } from '../stores/auth.js'

const auth = useAuthStore()
const router = useRouter()

const password = ref('')
const confirm = ref('')
const submitting = ref(false)
const error = ref('')

const passwordValid = computed(() => password.value.length >= 8)
const mismatch = computed(() => confirm.value.length > 0 && confirm.value !== password.value)
const canSubmit = computed(() => passwordValid.value && confirm.value === password.value)

async function submit() {
  if (!canSubmit.value) return
  error.value = ''
  submitting.value = true
  try {
    await auth.updatePassword(password.value)
    await auth.signOut()
    router.push('/login?reset=1')
  } catch (e) {
    error.value = e?.message || 'Could not update password. The link may have expired.'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
/* Copy the ENTIRE `<style scoped>...</style>` block from
   frontend/src/views/RegisterView.vue verbatim — identical classes are used. */
</style>
```

Then copy the style rules from `RegisterView.vue`'s `<style scoped>` block into the block above, replacing the comment.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/resetPasswordView.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/ResetPasswordView.vue frontend/src/__tests__/resetPasswordView.test.js
git commit -m "feat(auth): add ResetPasswordView set-new-password page"
```

---

### Task 4: Router routes + guard exemption

**Files:**
- Modify: `frontend/src/router/index.js`

- [ ] **Step 1: Add the two routes**

In `frontend/src/router/index.js`, add these route entries to the `routes` array, immediately after the `/register` route object (after its closing `},` near line 20):

```js
    {
      path: '/forgot',
      name: 'forgot-password',
      component: () => import('../views/ForgotPasswordView.vue'),
      meta: { public: true, sidebar: false },
    },
    {
      path: '/reset-password',
      name: 'reset-password',
      component: () => import('../views/ResetPasswordView.vue'),
      meta: { public: true, sidebar: false },
    },
```

- [ ] **Step 2: Exempt reset-password from the onboarding bounce**

In the same file, change the onboarding-redirect condition inside `router.beforeEach` from:

```js
  if (auth.isAuthenticated && !user.onboardingComplete && to.name !== 'onboarding') {
    return { name: 'onboarding' }
  }
```

to:

```js
  if (
    auth.isAuthenticated &&
    !user.onboardingComplete &&
    to.name !== 'onboarding' &&
    to.name !== 'reset-password'
  ) {
    return { name: 'onboarding' }
  }
```

(Rationale: the recovery email link establishes a session, so the user is
"authenticated" when landing on `/reset-password`. Without this exemption the
guard would redirect them to onboarding before they can set a password. The
login/register bounce above does not list `reset-password`, so an authenticated
recovery user is correctly left on the page.)

- [ ] **Step 3: Verify the full unit suite still passes**

Run: `cd frontend && npm run test:unit -- --run`
Expected: PASS (all existing + new tests). No router test references the new
routes yet; e2e in Task 7 exercises them.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/router/index.js
git commit -m "feat(auth): route /forgot + /reset-password with recovery guard exemption"
```

---

### Task 5: LoginView — forgot link + post-reset banner

**Files:**
- Modify: `frontend/src/views/LoginView.vue`
- Test: `frontend/src/__tests__/loginView.test.js`

- [ ] **Step 1: Add the failing tests**

In `frontend/src/__tests__/loginView.test.js`, add a vue-router mock at the top (after the imports, before `const stubs`):

```js
const { mockQuery } = vi.hoisted(() => ({ mockQuery: { value: {} } }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: mockQuery.value }),
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
}))
```

In the existing `beforeEach`, reset the query (add after `setActivePinia(...)`):

```js
    mockQuery.value = {}
```

Add these two tests inside the `describe('LoginView', ...)` block (before its closing `})`):

```js
  it('links to the forgot-password page', () => {
    const wrapper = mountView()
    expect(wrapper.find('[data-testid="login-to-forgot"]').exists()).toBe(true)
  })

  it('shows a reset-done banner when ?reset=1 is present', () => {
    mockQuery.value = { reset: '1' }
    const wrapper = mountView()
    expect(wrapper.find('[data-testid="login-reset-done"]').exists()).toBe(true)
  })

  it('hides the reset-done banner without ?reset=1', () => {
    const wrapper = mountView()
    expect(wrapper.find('[data-testid="login-reset-done"]').exists()).toBe(false)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/loginView.test.js`
Expected: FAIL — `login-to-forgot` and `login-reset-done` not found.

- [ ] **Step 3: Implement in LoginView**

In `frontend/src/views/LoginView.vue` `<script setup>`, add the import and computed (after the existing `import { computed, ref } from 'vue'` line, add the router import; after `const auth = useAuthStore()`, add the route/computed):

```js
import { useRoute } from 'vue-router'
```
```js
const route = useRoute()
const resetDone = computed(() => route.query.reset === '1')
```

In the template, add the banner immediately after the opening `<form ...>` tag's first child area — place it right before the email `<div class="field">`:

```html
      <p v-if="resetDone" class="sent" data-testid="login-reset-done">
        Password updated — sign in with your new password.
      </p>
```

Then replace the existing swap paragraph:

```html
      <p class="swap">
        New here?
        <RouterLink to="/register" data-testid="login-to-register">Create an account</RouterLink>
      </p>
```

with these two lines:

```html
      <p class="swap">
        <RouterLink to="/forgot" data-testid="login-to-forgot">Forgot password?</RouterLink>
      </p>
      <p class="swap">
        New here?
        <RouterLink to="/register" data-testid="login-to-register">Create an account</RouterLink>
      </p>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/loginView.test.js`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/LoginView.vue frontend/src/__tests__/loginView.test.js
git commit -m "feat(auth): add forgot-password link + post-reset banner to LoginView"
```

---

### Task 6: SettingsView — change-password card

**Files:**
- Modify: `frontend/src/views/SettingsView.vue`
- Test: `frontend/src/__tests__/settingsView.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/__tests__/settingsView.test.js`, inside the `describe('SettingsView', ...)` block (before its closing `})`):

```js
  it('change-password card is hidden when unauthenticated', () => {
    const wrapper = mount(SettingsView, { global: { stubs } })
    expect(wrapper.find('[data-testid="settings-security"]').exists()).toBe(false)
  })

  it('change-password submit is gated until current + matching 8+ new password', async () => {
    const auth = useAuthStore()
    auth.session = { user: { id: 'u-1', email: 'a@b.c' }, access_token: 't' }
    const wrapper = mount(SettingsView, { global: { stubs } })
    await flushPromises()
    const btn = wrapper.get('[data-testid="settings-pw-submit"]')
    expect(btn.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="settings-pw-current"]').setValue('oldpass12')
    await wrapper.get('[data-testid="settings-pw-new"]').setValue('newpass12')
    await wrapper.get('[data-testid="settings-pw-confirm"]').setValue('different')
    expect(btn.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="settings-pw-confirm"]').setValue('newpass12')
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('wrong current password shows an error and does not update', async () => {
    const auth = useAuthStore()
    auth.session = { user: { id: 'u-1', email: 'a@b.c' }, access_token: 't' }
    vi.spyOn(auth, 'signIn').mockRejectedValue(new Error('Invalid login credentials'))
    const update = vi.spyOn(auth, 'updatePassword').mockResolvedValue()
    const wrapper = mount(SettingsView, { global: { stubs } })
    await flushPromises()
    await wrapper.get('[data-testid="settings-pw-current"]').setValue('wrongpass')
    await wrapper.get('[data-testid="settings-pw-new"]').setValue('newpass12')
    await wrapper.get('[data-testid="settings-pw-confirm"]').setValue('newpass12')
    await wrapper.get('[data-testid="settings-pw-submit"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="settings-pw-error"]').exists()).toBe(true)
    expect(update).not.toHaveBeenCalled()
  })

  it('valid change verifies current password then updates and shows success', async () => {
    const auth = useAuthStore()
    auth.session = { user: { id: 'u-1', email: 'a@b.c' }, access_token: 't' }
    const signIn = vi.spyOn(auth, 'signIn').mockResolvedValue()
    const update = vi.spyOn(auth, 'updatePassword').mockResolvedValue()
    const wrapper = mount(SettingsView, { global: { stubs } })
    await flushPromises()
    await wrapper.get('[data-testid="settings-pw-current"]').setValue('oldpass12')
    await wrapper.get('[data-testid="settings-pw-new"]').setValue('newpass12')
    await wrapper.get('[data-testid="settings-pw-confirm"]').setValue('newpass12')
    await wrapper.get('[data-testid="settings-pw-submit"]').trigger('click')
    await flushPromises()
    expect(signIn).toHaveBeenCalledWith('a@b.c', 'oldpass12')
    expect(update).toHaveBeenCalledWith('newpass12')
    expect(wrapper.find('[data-testid="settings-pw-success"]').exists()).toBe(true)
    expect(showSuccess).toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/settingsView.test.js`
Expected: FAIL — `settings-security`/`settings-pw-*` not found.

- [ ] **Step 3: Add the Security card to the template**

In `frontend/src/views/SettingsView.vue`, insert this `<section>` between the Appearance `</section>` and the Sign-out `<section ...>` (i.e., after the appearance card closes, before `<section v-if="authStore.isAuthenticated" class="signout" ...>`):

```html
    <section
      v-if="authStore.isAuthenticated"
      class="card"
      data-testid="settings-security"
    >
      <h2 class="card-title">
        <i class="pi pi-lock card-icon" aria-hidden="true" />
        Security
      </h2>
      <form class="pw-form" @submit.prevent="changePassword">
        <div class="field">
          <label class="lbl" for="pw-current">Current password</label>
          <input
            id="pw-current"
            v-model="pwCurrent"
            data-testid="settings-pw-current"
            class="input"
            type="password"
            autocomplete="current-password"
          />
        </div>
        <div class="field">
          <label class="lbl" for="pw-new">New password</label>
          <input
            id="pw-new"
            v-model="pwNew"
            data-testid="settings-pw-new"
            class="input"
            type="password"
            autocomplete="new-password"
            placeholder="At least 8 characters"
          />
        </div>
        <div class="field">
          <label class="lbl" for="pw-confirm">Confirm new password</label>
          <input
            id="pw-confirm"
            v-model="pwConfirm"
            data-testid="settings-pw-confirm"
            class="input"
            type="password"
            autocomplete="new-password"
          />
        </div>
        <p v-if="pwMismatch" class="hint" data-testid="settings-pw-mismatch">
          New passwords do not match.
        </p>
        <p v-if="pwError" class="pw-error" data-testid="settings-pw-error">{{ pwError }}</p>
        <p v-if="pwSuccess" class="saved-flash" data-testid="settings-pw-success">
          <i class="pi pi-check-circle" aria-hidden="true" />
          Password updated.
        </p>
        <div class="actions">
          <button
            type="submit"
            class="save-btn"
            data-testid="settings-pw-submit"
            :disabled="!pwCanSubmit || pwSubmitting"
          >
            <i class="pi pi-lock" aria-hidden="true" />
            <span>{{ pwSubmitting ? 'Updating…' : 'Update password' }}</span>
          </button>
        </div>
      </form>
    </section>
```

- [ ] **Step 4: Add the change-password logic to the script**

In the same file's `<script setup>`, add state + handler (after the existing `savedFlash` ref / `save` function — anywhere in the setup scope):

```js
const pwCurrent = ref('')
const pwNew = ref('')
const pwConfirm = ref('')
const pwError = ref('')
const pwSuccess = ref(false)
const pwSubmitting = ref(false)

const pwMismatch = computed(
  () => pwConfirm.value.length > 0 && pwConfirm.value !== pwNew.value,
)
const pwCanSubmit = computed(
  () =>
    pwCurrent.value.length > 0 &&
    pwNew.value.length >= 8 &&
    pwNew.value === pwConfirm.value,
)

async function changePassword() {
  if (!pwCanSubmit.value) return
  pwError.value = ''
  pwSuccess.value = false
  pwSubmitting.value = true
  try {
    await authStore.signIn(authStore.userEmail, pwCurrent.value)
  } catch {
    pwError.value = 'Current password is incorrect.'
    pwSubmitting.value = false
    return
  }
  try {
    await authStore.updatePassword(pwNew.value)
    pwCurrent.value = ''
    pwNew.value = ''
    pwConfirm.value = ''
    pwSuccess.value = true
    showSuccess('Password updated.')
  } catch (e) {
    pwError.value = e?.message || 'Could not update password. Try again.'
  } finally {
    pwSubmitting.value = false
  }
}
```

(`computed`, `ref`, `authStore`, and `showSuccess` are already imported/defined
in this file — no new imports needed.)

- [ ] **Step 5: Add the two new styles**

In the same file's `<style scoped>`, add (the other classes — `.field`, `.lbl`,
`.input`, `.hint`, `.actions`, `.save-btn`, `.saved-flash` — already exist):

```css
.pw-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.pw-error {
  margin: 0;
  color: var(--color-error-text);
  font-size: 0.875rem;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/settingsView.test.js`
Expected: PASS (existing + 4 new).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/views/SettingsView.vue frontend/src/__tests__/settingsView.test.js
git commit -m "feat(auth): add change-password card to SettingsView"
```

---

### Task 7: e2e — forgot-password sent confirmation

**Files:**
- Modify: `frontend/e2e/auth.spec.js`

- [ ] **Step 1: Add the e2e test**

In `frontend/e2e/auth.spec.js`, add this test inside the `test.describe('auth gate', ...)` block (before its closing `})`):

```js
  test('requesting a password reset shows the sent confirmation', async ({ page }) => {
    // Stub the recover endpoint so the flow runs offline.
    await page.route('**/auth/v1/recover**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      })
    })

    await page.goto('/forgot')
    await page.getByTestId('forgot-email').fill('me@example.com')
    await page.getByTestId('forgot-submit').click()

    await expect(page.getByTestId('forgot-sent')).toBeVisible()
    await expect(page.getByTestId('forgot-sent')).toContainText('me@example.com')
  })
```

- [ ] **Step 2: Run the e2e auth suite**

Run: `cd frontend && npx playwright test e2e/auth.spec.js --reporter=list`
Expected: PASS (all auth gate tests, including the new one).

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/auth.spec.js
git commit -m "test(auth): e2e for forgot-password sent confirmation"
```

---

### Task 8: Docs — Supabase redirect URL + flows

**Files:**
- Modify: `docs/auth/supabase-setup.md`

- [ ] **Step 1: Document the reset config and flows**

Open `docs/auth/supabase-setup.md`. Append a new section at the end:

```markdown
## Password reset + change password

The forgot-password flow uses GoTrue's recovery email. For the emailed link to
land correctly, allowlist the redirect target in the Supabase dashboard:

- Dashboard → Authentication → URL Configuration → Redirect URLs, add:
  - `http://localhost:5173/reset-password` (dev)
  - `https://<your-prod-host>/reset-password` (prod)

Flows:
- **Forgot password:** `/forgot` calls `resetPasswordForEmail(email, { redirectTo:
  <origin>/reset-password })`. The email link lands on `/reset-password`, where
  `detectSessionInUrl` establishes a short-lived recovery session. The user sets
  a new password (`updateUser`), is signed out, and is redirected to
  `/login?reset=1`.
- **Change password (signed in):** Settings → Security re-verifies the current
  password (`signInWithPassword`) then calls `updateUser({ password })`. The
  session is retained.

No backend or database change is involved — GoTrue handles email, token, and
password update.
```

If `docs/auth/supabase-setup.md` does not exist, create it with the section
above under a top-level `# Supabase Auth Setup` heading.

- [ ] **Step 2: Commit**

```bash
git add docs/auth/supabase-setup.md
git commit -m "docs(auth): document password reset + change-password setup"
```

---

### Task 9: Full verification

- [ ] **Step 1: Full unit suite**

Run: `cd frontend && npm run test:unit -- --run`
Expected: PASS — all tests (was 501 + new ones).

- [ ] **Step 2: Lint**

Run: `cd frontend && npm run lint`
Expected: "No issues found".

- [ ] **Step 3: e2e auth suite**

Run: `cd frontend && npx playwright test e2e/auth.spec.js --reporter=list`
Expected: all PASS.

- [ ] **Step 4: Backend unchanged sanity (no contract drift)**

Run: `python backend/scripts/gen_contracts.py` then `git status --short`
Expected: no changes (this feature touches no contracts).

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin feat/password-reset
gh pr create --base feat/email-password-auth --title "feat(auth): password reset + change password" --body "Forgot-password recovery (/forgot + /reset-password) and in-app change-password in Settings. Spec: docs/superpowers/specs/2026-06-17-password-reset-design.md. Plan: docs/superpowers/plans/2026-06-17-password-reset.md."
```

(Base is `feat/email-password-auth` because the reset views depend on the
email/password views not yet in `dev`. Re-target to `dev` if PR #85 merges first.)

---

## Notes for the implementer

- The two new views reuse `RegisterView.vue`'s `<style scoped>` block verbatim.
  Do not hand-write new CSS for them beyond that copy.
- Manual live smoke (cannot be automated — needs a real Supabase project):
  request a reset, click the email link, confirm it lands on `/reset-password`
  (not onboarding/home), set a password, confirm redirect to `/login?reset=1`,
  sign in; then in Settings change the password with a wrong-then-correct
  current password. Document under the PR checklist.
