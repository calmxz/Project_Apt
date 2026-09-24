import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import LearningTab from '@/components/settings/LearningTab.vue'
import { useUserStore } from '@/stores/user.js'
import * as profileApi from '@/services/profileApi.js'

const showSuccess = vi.fn()
const showError = vi.fn()
vi.mock('@/composables/useToast.js', () => ({
  useToast: () => ({ showSuccess, showError, showWarn: vi.fn() }),
}))

function seedUser() {
  const user = useUserStore()
  user.userId = 'u_test'
  user.name = 'Eddy'
  user.interactionPreferences = { feedback: 'hints' }
  user.onboardingComplete = true
}

describe('LearningTab', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    showSuccess.mockClear()
    showError.mockClear()
  })

  // #350: the tab holds Feedback style only. The aggregate profile stays in
  // profileApi.js for the /profile page (#358) but is no longer read here.
  it('renders only the feedback style section and does not read the aggregate profile', async () => {
    seedUser()
    const spy = vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue({})

    const wrapper = mount(LearningTab)
    await flushPromises()

    expect(wrapper.find('[data-testid="agg-learning"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="learning-feedback"]').exists()).toBe(true)
    for (const id of ['learning-topics', 'learning-weekly', 'learning-accuracy', 'agg-loading']) {
      expect(wrapper.find(`[data-testid="${id}"]`).exists()).toBe(false)
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('save feedback is the filled control, disabled until the choice changes', async () => {
    seedUser()

    const wrapper = mount(LearningTab)
    await flushPromises()

    const saveBtn = wrapper.get('[data-testid="learning-feedback-save"]')
    expect(saveBtn.classes()).toContain('btn-fill')
    expect(saveBtn.attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="feedback-style-direct_answers"]').setValue(true)
    expect(saveBtn.attributes('disabled')).toBeUndefined()
  })

  it('submitting feedback calls user.updateProfile with current name and new feedback', async () => {
    seedUser()
    const user = useUserStore()
    const updateSpy = vi.spyOn(user, 'updateProfile').mockResolvedValue()

    const wrapper = mount(LearningTab)
    await flushPromises()

    await wrapper.get('[data-testid="feedback-style-direct_answers"]').setValue(true)
    await wrapper.get('[data-testid="learning-feedback-save"]').trigger('click')
    await flushPromises()

    expect(updateSpy).toHaveBeenCalledWith({ name: 'Eddy', feedback: 'direct_answers' })
    expect(showSuccess).toHaveBeenCalledOnce()
  })

  it('marks the save button busy while the write is in flight', async () => {
    seedUser()
    const user = useUserStore()
    let resolveSave
    vi.spyOn(user, 'updateProfile').mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve
      }),
    )

    const wrapper = mount(LearningTab)
    await flushPromises()

    await wrapper.get('[data-testid="feedback-style-direct_answers"]').setValue(true)
    await wrapper.get('[data-testid="learning-feedback-save"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="learning-feedback-save"]').classes()).toContain(
      'btn-fill--busy',
    )

    resolveSave()
    await flushPromises()
    expect(wrapper.get('[data-testid="learning-feedback-save"]').classes()).not.toContain(
      'btn-fill--busy',
    )
  })

  it('flashes Saved. beside the button until the value changes again', async () => {
    seedUser()
    const user = useUserStore()
    vi.spyOn(user, 'updateProfile').mockResolvedValue()

    const wrapper = mount(LearningTab)
    await flushPromises()
    await wrapper.get('[data-testid="feedback-style-direct_answers"]').setValue(true)

    await wrapper.get('[data-testid="learning-feedback-save"]').trigger('click')
    await flushPromises()
    const flash = wrapper.get('[data-testid="learning-feedback-saved"]')
    expect(flash.text()).toBe('Saved.')
    expect(flash.find('svg.tick').exists()).toBe(true)

    // Same grammar as the Account tab: the flash clears on the next change.
    await wrapper.get('[data-testid="feedback-style-hints"]').setValue(true)
    expect(wrapper.find('[data-testid="learning-feedback-saved"]').exists()).toBe(false)
  })

  it('does not render the usage panel (usage moved to its own tab)', async () => {
    seedUser()

    const wrapper = mount(LearningTab)
    await flushPromises()

    expect(wrapper.find('[data-testid="usage-panel"]').exists()).toBe(false)
  })
})
