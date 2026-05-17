import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import SettingsView from '@/views/SettingsView.vue'
import { useUserStore } from '@/stores/user.js'

const showSuccess = vi.fn()
vi.mock('@/composables/useToast.js', () => ({
  useToast: () => ({ showSuccess, showError: vi.fn(), showWarn: vi.fn() }),
}))

const stubs = {
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
  BackButton: { template: '<button />', props: ['label', 'fallback'] },
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
    await wrapper.get('[data-testid="settings-feedback-direct_answers"]').setValue(true)
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    const user = useUserStore()
    expect(user.name).toBe('Edward')
    expect(user.interactionPreferences.feedback).toBe('direct_answers')
    expect(showSuccess).toHaveBeenCalledOnce()
    expect(wrapper.find('[data-testid="settings-saved"]').exists()).toBe(true)
  })
})
