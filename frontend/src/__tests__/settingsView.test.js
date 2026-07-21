import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import SettingsView from '@/views/SettingsView.vue'
import { useUserStore } from '@/stores/user.js'
import { useAuthStore } from '@/stores/auth.js'
import { useTheme } from '@/composables/useTheme.js'

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
  BackButton: { template: '<button data-testid="back" />', props: ['label', 'fallback'] },
  Button: {
    props: ['disabled', 'label'],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')"><slot>{{ label }}</slot></button>',
  },
}

// F-46: updateProfile writes through to PATCH /me via the real apiClient
// (dynamic import) -- mock global fetch, same pattern as userStore.test.js.
function ok(body) {
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body)),
  })
}

describe('SettingsView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    showSuccess.mockClear()
    showError.mockClear()
    routerPush.mockClear()
    globalThis.fetch = vi.fn().mockReturnValue(ok({}))
    useTheme().setTheme('light')
    const user = useUserStore()
    user.userId = 'u_test'
    user.name = 'Eddy'
    user.interactionPreferences = { feedback: 'hints' }
    user.onboardingComplete = true
  })

  it('save button is disabled until something changes', async () => {
    const wrapper = mount(SettingsView, { global: { stubs } })
    const saveBtn = wrapper.get('[data-testid="settings-save"]')
    expect(saveBtn.attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="settings-name"]').setValue('Edward')
    expect(saveBtn.attributes('disabled')).toBeUndefined()
  })

  it('saving persists to the user store and fires a toast', async () => {
    const wrapper = mount(SettingsView, { global: { stubs } })
    await wrapper.get('[data-testid="settings-name"]').setValue('Edward')
    await wrapper.get('[data-testid="feedback-style-direct_answers"]').setValue(true)
    await wrapper.find('form').trigger('submit.prevent')
    // updateProfile's write-through chains on-demand dynamic imports before
    // resolving; flushPromises' single setImmediate tick isn't enough to
    // drain that in this environment, so wait a real macrotask instead.
    await new Promise((resolve) => setTimeout(resolve, 50))

    const user = useUserStore()
    expect(user.name).toBe('Edward')
    expect(user.interactionPreferences.feedback).toBe('direct_answers')
    expect(showSuccess).toHaveBeenCalledOnce()
    expect(wrapper.find('[data-testid="settings-saved"]').exists()).toBe(true)
  })

  // F-11: API failure must surface inline and re-enable the form, not leave
  // it frozen with an unhandled rejection.
  it('shows inline error and re-enables on API failure', async () => {
    const user = useUserStore()
    vi.spyOn(user, 'updateProfile').mockRejectedValue(new Error('down'))
    const wrapper = mount(SettingsView, { global: { stubs } })
    await wrapper.get('[data-testid="settings-name"]').setValue('Edward')
    await wrapper.find('form').trigger('submit.prevent')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(wrapper.find('[data-testid="settings-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="settings-save"]').attributes('disabled')).toBeUndefined()
    expect(showSuccess).not.toHaveBeenCalled()
  })

  it('ignores double submit while in flight', async () => {
    const user = useUserStore()
    let resolveCompletion
    vi.spyOn(user, 'updateProfile').mockReturnValue(
      new Promise((resolve) => {
        resolveCompletion = resolve
      }),
    )
    const wrapper = mount(SettingsView, { global: { stubs } })
    await wrapper.get('[data-testid="settings-name"]').setValue('Edward')
    await wrapper.find('form').trigger('submit.prevent')
    await wrapper.find('form').trigger('submit.prevent')

    expect(user.updateProfile).toHaveBeenCalledTimes(1)
    resolveCompletion()
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  it('appearance switch reflects and toggles dark mode', async () => {
    const wrapper = mount(SettingsView, { global: { stubs } })
    const sw = wrapper.get('[data-testid="settings-theme-toggle"]')
    expect(sw.attributes('role')).toBe('switch')
    expect(sw.attributes('aria-checked')).toBe('false')
    await sw.trigger('click')
    expect(sw.attributes('aria-checked')).toBe('true')
  })

  it('sign-out button is hidden when unauthenticated', () => {
    const wrapper = mount(SettingsView, { global: { stubs } })
    expect(wrapper.find('[data-testid="settings-sign-out"]').exists()).toBe(false)
  })

  it('sign-out signs out and redirects to /login', async () => {
    const auth = useAuthStore()
    auth.session = { user: { id: 'u-1' }, access_token: 't' }
    const wrapper = mount(SettingsView, { global: { stubs } })
    await flushPromises()
    await wrapper.get('[data-testid="settings-sign-out"]').trigger('click')
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
    const wrapper = mount(SettingsView, { global: { stubs } })
    await flushPromises()
    await wrapper.get('[data-testid="settings-sign-out"]').trigger('click')
    await flushPromises()
    expect(showError).toHaveBeenCalledWith('network down')
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('does not render a back button', () => {
    const wrapper = mount(SettingsView, { global: { stubs } })
    expect(wrapper.find('[data-testid="back"]').exists()).toBe(false)
  })

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
})
