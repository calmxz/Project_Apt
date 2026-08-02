import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AccountTab from '@/components/settings/AccountTab.vue'
import { useUserStore } from '@/stores/user.js'
import { useAuthStore } from '@/stores/auth.js'

const showSuccess = vi.fn()
const showError = vi.fn()
vi.mock('@/composables/useToast.js', () => ({
  useToast: () => ({ showSuccess, showError, showWarn: vi.fn() }),
}))
const routerPush = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
}))

const stubs = {
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
}

// F-46: updateProfile writes through to PATCH /me via the real apiClient
// (dynamic import) -- mock global fetch, same pattern as settingsView.test.js.
function ok(body) {
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body)),
  })
}

describe('AccountTab', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    showSuccess.mockClear()
    showError.mockClear()
    routerPush.mockClear()
    globalThis.fetch = vi.fn().mockReturnValue(ok({}))
    const user = useUserStore()
    user.userId = 'u_test'
    user.name = 'Eddy'
    user.interactionPreferences = { feedback: 'hints' }
    user.onboardingComplete = true
  })

  it('renders name field and danger zone testids', () => {
    const w = mount(AccountTab, { global: { stubs } })
    for (const id of [
      'settings-name',
      'settings-save',
      'settings-danger',
      'settings-retake-onboarding',
    ]) {
      expect(w.find(`[data-testid="${id}"]`).exists()).toBe(true)
    }
  })

  it('renders signout section when authenticated', async () => {
    const auth = useAuthStore()
    auth.session = { user: { id: 'u-1' }, access_token: 't' }
    const w = mount(AccountTab, { global: { stubs } })
    await flushPromises()
    expect(w.find('[data-testid="settings-signout-section"]').exists()).toBe(true)
  })

  it('does not render the security card when unauthenticated', () => {
    const w = mount(AccountTab, { global: { stubs } })
    expect(w.find('[data-testid="settings-security"]').exists()).toBe(false)
  })

  it('renders the security card when authenticated', async () => {
    const auth = useAuthStore()
    auth.session = { user: { id: 'u-1', email: 'a@b.c' }, access_token: 't' }
    const w = mount(AccountTab, { global: { stubs } })
    await flushPromises()
    expect(w.find('[data-testid="settings-security"]').exists()).toBe(true)
  })

  it('save button disabled until name changes (feedback no longer affects dirty)', async () => {
    const w = mount(AccountTab, { global: { stubs } })
    expect(w.find('[data-testid="settings-save"]').attributes('disabled')).toBeDefined()
    await w.find('[data-testid="settings-name"]').setValue('New Name')
    expect(w.find('[data-testid="settings-save"]').attributes('disabled')).toBeUndefined()
  })

  it('save sends name plus current stored feedback', async () => {
    const user = useUserStore()
    const updateProfile = vi.spyOn(user, 'updateProfile').mockResolvedValue()
    const w = mount(AccountTab, { global: { stubs } })
    await w.find('[data-testid="settings-name"]').setValue('New Name')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(updateProfile).toHaveBeenCalledWith({ name: 'New Name', feedback: 'hints' })
    expect(w.find('[data-testid="settings-saved"]').exists()).toBe(true)
  })

  it('shows inline error and re-enables on API failure', async () => {
    const user = useUserStore()
    vi.spyOn(user, 'updateProfile').mockRejectedValue(new Error('down'))
    const w = mount(AccountTab, { global: { stubs } })
    await w.find('[data-testid="settings-name"]').setValue('New Name')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(w.find('[data-testid="settings-error"]').exists()).toBe(true)
    expect(w.find('[data-testid="settings-save"]').attributes('disabled')).toBeUndefined()
  })

  it('password mismatch hint shows when confirm differs', async () => {
    const auth = useAuthStore()
    auth.session = { user: { id: 'u-1', email: 'a@b.c' }, access_token: 't' }
    const w = mount(AccountTab, { global: { stubs } })
    await flushPromises()
    await w.find('[data-testid="settings-pw-new"]').setValue('longenough1')
    await w.find('[data-testid="settings-pw-confirm"]').setValue('different1')
    expect(w.find('[data-testid="settings-pw-mismatch"]').exists()).toBe(true)
  })

  it('change-password submit is gated until current + matching 8+ new password', async () => {
    const auth = useAuthStore()
    auth.session = { user: { id: 'u-1', email: 'a@b.c' }, access_token: 't' }
    const w = mount(AccountTab, { global: { stubs } })
    await flushPromises()
    const btn = w.get('[data-testid="settings-pw-submit"]')
    expect(btn.attributes('disabled')).toBeDefined()
    await w.get('[data-testid="settings-pw-current"]').setValue('oldpass12')
    await w.get('[data-testid="settings-pw-new"]').setValue('newpass12')
    await w.get('[data-testid="settings-pw-confirm"]').setValue('newpass12')
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('valid change verifies current password then updates and shows success', async () => {
    const auth = useAuthStore()
    auth.session = { user: { id: 'u-1', email: 'a@b.c' }, access_token: 't' }
    const signIn = vi.spyOn(auth, 'signIn').mockResolvedValue()
    const update = vi.spyOn(auth, 'updatePassword').mockResolvedValue()
    const w = mount(AccountTab, { global: { stubs } })
    await flushPromises()
    await w.get('[data-testid="settings-pw-current"]').setValue('oldpass12')
    await w.get('[data-testid="settings-pw-new"]').setValue('newpass12')
    await w.get('[data-testid="settings-pw-confirm"]').setValue('newpass12')
    await w.get('[data-testid="settings-pw-submit"]').trigger('click')
    await flushPromises()
    expect(signIn).toHaveBeenCalledWith('a@b.c', 'oldpass12')
    expect(update).toHaveBeenCalledWith('newpass12')
    expect(w.find('[data-testid="settings-pw-success"]').exists()).toBe(true)
    expect(showSuccess).toHaveBeenCalled()
  })

  it('sign-out button is hidden when unauthenticated', () => {
    const w = mount(AccountTab, { global: { stubs } })
    expect(w.find('[data-testid="settings-sign-out"]').exists()).toBe(false)
  })

  it('sign-out signs out and redirects to /login', async () => {
    const auth = useAuthStore()
    auth.session = { user: { id: 'u-1' }, access_token: 't' }
    const w = mount(AccountTab, { global: { stubs } })
    await flushPromises()
    await w.get('[data-testid="settings-sign-out"]').trigger('click')
    await flushPromises()
    expect(globalThis.__supabaseAuthStub.signOut).toHaveBeenCalled()
    expect(routerPush).toHaveBeenCalledWith('/login')
  })

  it('sign-out surfaces an error toast and does not redirect on failure', async () => {
    globalThis.__supabaseAuthStub.signOut.mockResolvedValueOnce({
      error: new Error('network down'),
    })
    const auth = useAuthStore()
    auth.session = { user: { id: 'u-1' }, access_token: 't' }
    const w = mount(AccountTab, { global: { stubs } })
    await flushPromises()
    await w.get('[data-testid="settings-sign-out"]').trigger('click')
    await flushPromises()
    expect(showError).toHaveBeenCalledWith('network down')
    expect(routerPush).not.toHaveBeenCalled()
  })
})
