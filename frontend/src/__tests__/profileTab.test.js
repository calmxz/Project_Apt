import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import ProfileTab from '@/components/settings/ProfileTab.vue'
import { useUserStore } from '@/stores/user.js'
import * as profileApi from '@/services/profileApi.js'

const showSuccess = vi.fn()
const showError = vi.fn()
vi.mock('@/composables/useToast.js', () => ({
  useToast: () => ({ showSuccess, showError, showWarn: vi.fn() }),
}))

const stubs = {
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
}

function seedUser() {
  const user = useUserStore()
  user.userId = 'u_test'
  user.name = 'Eddy'
  user.interactionPreferences = { feedback: 'hints' }
  user.onboardingComplete = true
}

function nonEmptyAggregatePayload() {
  return {
    total_sessions: 3,
    active_sessions: 2,
    ended_sessions: 1,
    total_learning_events: 7,
    last_active_at: new Date().toISOString(),
    combined_mastered_concepts: [
      { concept: 'joins', count: 3, first_seen_session_id: 's1' },
      { concept: 'select', count: 1, first_seen_session_id: 's2' },
    ],
    combined_confirmed_gaps: [{ concept: 'window-fns', count: 2, first_seen_session_id: 's1' }],
    knowledge_level_distribution: { beginner: 2, intermediate: 1, advanced: 0, unknown: 0 },
    recent_topics: [
      { id: 's3', topic: 'sql joins', created_at: new Date().toISOString(), ended_at: null },
    ],
    concept_accuracy: [],
    weekly_mastery: [],
  }
}

function emptyAggregatePayload() {
  return {
    total_sessions: 0,
    active_sessions: 0,
    ended_sessions: 0,
    total_learning_events: 0,
    last_active_at: null,
    combined_mastered_concepts: [],
    combined_confirmed_gaps: [],
    knowledge_level_distribution: { beginner: 0, intermediate: 0, advanced: 0, unknown: 0 },
    recent_topics: [],
    concept_accuracy: [],
    weekly_mastery: [],
  }
}

describe('ProfileTab', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    showSuccess.mockClear()
    showError.mockClear()
  })

  it('displays skeleton loading state during initial fetch', async () => {
    seedUser()
    let resolveProfile
    const profilePromise = new Promise((resolve) => {
      resolveProfile = resolve
    })
    vi.spyOn(profileApi, 'getAggregateProfile').mockReturnValue(profilePromise)
    const getUsageSpy = vi.spyOn(profileApi, 'getUsageSummary')

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="agg-loading"]').exists()).toBe(true)
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    expect(getUsageSpy).not.toHaveBeenCalled()

    resolveProfile(nonEmptyAggregatePayload())
    await flushPromises()
  })

  it('renders stats from getAggregateProfile fixture', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(nonEmptyAggregatePayload())

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await flushPromises()

    expect(wrapper.find('[data-testid="agg-stats"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agg-profile"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agg-dist"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agg-insights"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="weakest-concepts"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mastery-trend"]').exists()).toBe(true)
  })

  it('shows error banner when the API throws', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockRejectedValue(new Error('boom'))

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await flushPromises()

    const err = wrapper.find('[data-testid="agg-error"]')
    expect(err.exists()).toBe(true)
    expect(err.text()).toContain('boom')
  })

  it('renders empty state when zero sessions', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(emptyAggregatePayload())

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await flushPromises()

    expect(wrapper.find('[data-testid="agg-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agg-stats"]').exists()).toBe(false)
  })

  it('renders mastered + gap chips with counts', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(nonEmptyAggregatePayload())

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await flushPromises()

    const masteredText = wrapper.find('[data-testid="agg-mastered"]').text()
    expect(masteredText).toContain('joins')
    expect(masteredText).toContain('×3')
    expect(masteredText).toContain('select')
    const gapsText = wrapper.find('[data-testid="agg-gaps"]').text()
    expect(gapsText).toContain('window-fns')
    expect(gapsText).toContain('×2')
    expect(wrapper.find('[data-testid="agg-recent"]').text()).toContain('sql joins')
  })

  it('feedback style card renders picker and save button; changing feedback enables save', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(nonEmptyAggregatePayload())

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await flushPromises()

    const saveBtn = wrapper.get('[data-testid="profile-feedback-save"]')
    expect(saveBtn.attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="feedback-style-direct_answers"]').setValue(true)
    expect(saveBtn.attributes('disabled')).toBeUndefined()
  })

  it('submitting feedback calls user.updateProfile with current name and new feedback', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(nonEmptyAggregatePayload())
    const user = useUserStore()
    const updateSpy = vi.spyOn(user, 'updateProfile').mockResolvedValue()

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await flushPromises()

    await wrapper.get('[data-testid="feedback-style-direct_answers"]').setValue(true)
    await wrapper.get('[data-testid="profile-feedback-save"]').trigger('click')
    await flushPromises()

    expect(updateSpy).toHaveBeenCalledWith({ name: 'Eddy', feedback: 'direct_answers' })
    expect(showSuccess).toHaveBeenCalledOnce()
  })

  it('does not call getUsageSummary (usage moved to its own tab)', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(nonEmptyAggregatePayload())
    const getUsageSpy = vi.spyOn(profileApi, 'getUsageSummary')

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await flushPromises()

    expect(getUsageSpy).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="usage-panel"]').exists()).toBe(false)
  })
})
