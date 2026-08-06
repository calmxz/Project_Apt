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

  it('announces the error to screen readers', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'updatePassword').mockRejectedValue(new Error('Auth session missing!'))
    const wrapper = mountView()
    await wrapper.get('[data-testid="reset-password"]').setValue('newpass12')
    await wrapper.get('[data-testid="reset-confirm"]').setValue('newpass12')
    await wrapper.get('[data-testid="reset-form"]').trigger('submit.prevent')
    await flushPromises()
    expect(wrapper.find('[data-testid="reset-error"]').attributes('role')).toBe('alert')
  })
})
