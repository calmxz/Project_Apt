import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import OnboardingView from '@/views/OnboardingView.vue'
import { useUserStore } from '@/stores/user.js'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

// F-46: completeOnboarding writes through to PATCH /me via the real
// apiClient (dynamic import) -- mock global fetch, same pattern as
// userStore.test.js / apiWrappers.test.js.
function ok(body) {
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body)),
  })
}

const stubs = {
  InputText: {
    props: ['modelValue'],
    template:
      '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
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
    globalThis.fetch = vi.fn().mockReturnValue(ok({}))
  })

  it('renders the welcome heading', () => {
    const wrapper = mount(OnboardingView, { global: { stubs } })
    expect(wrapper.text()).toContain('Welcome to')
    expect(wrapper.text()).toContain('Crux')
  })

  it('submit completes onboarding and routes home', async () => {
    const wrapper = mount(OnboardingView, { global: { stubs } })
    await wrapper.get('[data-testid="onboarding-name"]').setValue('Eddy')
    await wrapper.find('form').trigger('submit.prevent')
    // completeOnboarding's write-through chains two on-demand dynamic
    // imports (apiClient.js, then apiClient's internal supabase.js) before
    // resolving; flushPromises' single setImmediate tick isn't enough to
    // drain that in this environment, so wait a real macrotask instead.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const user = useUserStore()
    expect(user.name).toBe('Eddy')
    expect(user.onboardingComplete).toBe(true)
    expect(push).toHaveBeenCalledWith({ name: 'home' })
  })

  it('feedback help copy switches with the selection', async () => {
    const wrapper = mount(OnboardingView, { global: { stubs } })
    expect(wrapper.text()).toContain('nudge')
    await wrapper.get('[data-testid="feedback-style-direct_answers"]').setValue(true)
    expect(wrapper.text()).toContain('explain')
  })
})
