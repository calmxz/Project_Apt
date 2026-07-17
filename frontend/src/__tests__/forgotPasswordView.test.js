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
