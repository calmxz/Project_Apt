import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import LoginView from '@/views/LoginView.vue'
import { useAuthStore } from '@/stores/auth.js'
import { safeRedirect } from '@/utils/safeRedirect.js'

const { mockQuery, push } = vi.hoisted(() => ({ mockQuery: { value: {} }, push: vi.fn() }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: mockQuery.value }),
  useRouter: () => ({ push }),
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
  return mount(LoginView, { global: { stubs } })
}

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockQuery.value = {}
    push.mockReset()
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

  it('navigates to home after a successful sign-in', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'signIn').mockResolvedValue()
    const wrapper = mountView()
    await wrapper.get('[data-testid="login-email"]').setValue('me@example.com')
    await wrapper.get('[data-testid="login-password"]').setValue('hunter2pw')
    await wrapper.get('[data-testid="login-form"]').trigger('submit.prevent')
    await flushPromises()
    expect(push).toHaveBeenCalledWith({ name: 'home' })
  })

  it('does not navigate when sign-in fails', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'signIn').mockRejectedValue(new Error('Invalid login credentials'))
    const wrapper = mountView()
    await wrapper.get('[data-testid="login-email"]').setValue('me@example.com')
    await wrapper.get('[data-testid="login-password"]').setValue('wrongpass')
    await wrapper.get('[data-testid="login-form"]').trigger('submit.prevent')
    await flushPromises()
    expect(push).not.toHaveBeenCalled()
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
    expect(wrapper.get('[data-testid="login-error"]').text()).toContain('Invalid login credentials')
  })

  it('announces the error to screen readers', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'signIn').mockRejectedValue(new Error('Invalid login credentials'))
    const wrapper = mountView()
    await wrapper.get('[data-testid="login-email"]').setValue('me@example.com')
    await wrapper.get('[data-testid="login-password"]').setValue('wrongpass')
    await wrapper.get('[data-testid="login-form"]').trigger('submit.prevent')
    await flushPromises()
    expect(wrapper.find('[data-testid="login-error"]').attributes('role')).toBe('alert')
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

  it('toggles password visibility via the eye button', async () => {
    const wrapper = mountView()
    const input = wrapper.get('[data-testid="login-password"]')
    const toggle = wrapper.get('[data-testid="login-toggle-password"]')
    expect(input.attributes('type')).toBe('password')
    expect(toggle.attributes('aria-label')).toBe('Show password')
    await toggle.trigger('click')
    expect(input.attributes('type')).toBe('text')
    expect(toggle.attributes('aria-label')).toBe('Hide password')
    await toggle.trigger('click')
    expect(input.attributes('type')).toBe('password')
  })

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

  it('navigates to the redirect target after sign-in when present', async () => {
    mockQuery.value = { redirect: '/session/abc' }
    const auth = useAuthStore()
    vi.spyOn(auth, 'signIn').mockResolvedValue()
    const wrapper = mountView()
    await wrapper.get('[data-testid="login-email"]').setValue('me@example.com')
    await wrapper.get('[data-testid="login-password"]').setValue('hunter2pw')
    await wrapper.get('[data-testid="login-form"]').trigger('submit.prevent')
    await flushPromises()
    expect(push).toHaveBeenCalledWith('/session/abc')
  })

  it('ignores an unsafe redirect target and falls back to home', async () => {
    mockQuery.value = { redirect: '//evil.com' }
    const auth = useAuthStore()
    vi.spyOn(auth, 'signIn').mockResolvedValue()
    const wrapper = mountView()
    await wrapper.get('[data-testid="login-email"]').setValue('me@example.com')
    await wrapper.get('[data-testid="login-password"]').setValue('hunter2pw')
    await wrapper.get('[data-testid="login-form"]').trigger('submit.prevent')
    await flushPromises()
    expect(push).toHaveBeenCalledWith({ name: 'home' })
  })
})

describe('safeRedirect', () => {
  it('accepts a relative path', () => {
    expect(safeRedirect('/session/abc')).toBe('/session/abc')
  })

  it('rejects a protocol-relative path', () => {
    expect(safeRedirect('//evil.com')).toBe(null)
  })

  it('rejects an absolute URL', () => {
    expect(safeRedirect('https://evil.com')).toBe(null)
  })

  it('rejects non-string values', () => {
    expect(safeRedirect(undefined)).toBe(null)
  })
})
