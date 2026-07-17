import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import RegisterView from '../views/RegisterView.vue'

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
  return mount(RegisterView, {
    global: {
      stubs,
    },
  })
}

async function fillValidCredentials(wrapper) {
  await wrapper.find('[data-testid="register-email"]').setValue('a@b.com')
  await wrapper.find('[data-testid="register-password"]').setValue('password1')
  await wrapper.find('[data-testid="register-confirm"]').setValue('password1')
}

describe('registration consent', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders a consent checkbox', () => {
    const wrapper = mountView()
    expect(wrapper.find('[data-testid="register-consent"]').exists()).toBe(true)
  })

  it('keeps submit disabled until consent is checked', async () => {
    const wrapper = mountView()
    await fillValidCredentials(wrapper)
    expect(wrapper.find('[data-testid="register-submit"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-testid="register-consent"]').setValue(true)
    expect(wrapper.find('[data-testid="register-submit"]').attributes('disabled')).toBeUndefined()
  })
})
