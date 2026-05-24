import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import LoginView from '@/views/LoginView.vue'
import { useAuthStore } from '@/stores/auth.js'

const stubs = {
  Logo: { props: ['size', 'variant'], template: '<span data-testid="logo" />' },
  InputText: {
    props: ['modelValue'],
    template:
      '<input :value="modelValue" data-testid="login-email" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
}

function mountView() {
  return mount(LoginView, { global: { stubs } })
}

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('disables submit until email is valid', async () => {
    const wrapper = mountView()
    const btn = wrapper.get('[data-testid="login-submit"]')
    expect(btn.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="login-email"]').setValue('not-an-email')
    expect(btn.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="login-email"]').setValue('me@example.com')
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('submit calls signInWithMagicLink and shows sent state', async () => {
    const auth = useAuthStore()
    const spy = vi.spyOn(auth, 'signInWithMagicLink').mockResolvedValue()
    const wrapper = mountView()
    await wrapper.get('[data-testid="login-email"]').setValue('me@example.com')
    await wrapper.get('[data-testid="login-form"]').trigger('submit.prevent')
    await flushPromises()
    expect(spy).toHaveBeenCalledWith('me@example.com')
    expect(wrapper.find('[data-testid="login-sent"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('me@example.com')
  })

  it('submit shows error banner when sign-in throws', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'signInWithMagicLink').mockRejectedValue(
      new Error('rate limited'),
    )
    const wrapper = mountView()
    await wrapper.get('[data-testid="login-email"]').setValue('me@example.com')
    await wrapper.get('[data-testid="login-form"]').trigger('submit.prevent')
    await flushPromises()
    expect(wrapper.find('[data-testid="login-error"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="login-error"]').text()).toContain('rate limited')
  })
})
