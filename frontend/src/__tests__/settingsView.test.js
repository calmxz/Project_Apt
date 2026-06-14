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

describe('SettingsView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    showSuccess.mockClear()
    showError.mockClear()
    routerPush.mockClear()
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
    await flushPromises()

    const user = useUserStore()
    expect(user.name).toBe('Edward')
    expect(user.interactionPreferences.feedback).toBe('direct_answers')
    expect(showSuccess).toHaveBeenCalledOnce()
    expect(wrapper.find('[data-testid="settings-saved"]').exists()).toBe(true)
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
})
