import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import OnboardingView from '@/views/OnboardingView.vue'
import { useUserStore } from '@/stores/user.js'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

const stubs = {
  InputText: {
    props: ['modelValue'],
    template:
      '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  SelectButton: {
    props: ['modelValue', 'options'],
    template: `<div>
      <button
        v-for="o in options"
        :key="o.value"
        :data-testid="'sel-' + o.value"
        @click="$emit('update:modelValue', o.value)"
      >{{ o.label }}</button>
    </div>`,
  },
  Button: {
    props: ['disabled', 'label'],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')"><slot>{{ label }}</slot></button>',
  },
}

describe('OnboardingView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    push.mockClear()
  })

  it('renders the welcome heading', () => {
    const wrapper = mount(OnboardingView, { global: { stubs } })
    expect(wrapper.text()).toContain('Welcome to')
    expect(wrapper.text()).toContain('AdaptLearn')
  })

  it('submit completes onboarding and routes home', async () => {
    const wrapper = mount(OnboardingView, { global: { stubs } })
    await wrapper.get('[data-testid="onboarding-name"]').setValue('Eddy')
    await wrapper.find('form').trigger('submit.prevent')
    const user = useUserStore()
    expect(user.name).toBe('Eddy')
    expect(user.onboardingComplete).toBe(true)
    expect(push).toHaveBeenCalledWith({ name: 'home' })
  })

  it('feedback help copy switches with the selection', async () => {
    const wrapper = mount(OnboardingView, { global: { stubs } })
    expect(wrapper.text()).toContain('nudge')
    await wrapper.get('[data-testid="sel-direct_answers"]').trigger('click')
    expect(wrapper.text()).toContain('explain')
  })
})
