import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AggregateProfileView from '@/views/AggregateProfileView.vue'
import { useUserStore } from '@/stores/user.js'
import * as profileApi from '@/services/profileApi.js'

const stubs = {
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
  BackButton: { template: '<button data-testid="back" />', props: ['label', 'fallback'] },
}

function seedUser() {
  const user = useUserStore()
  user.userId = 'u_test'
  user.name = 'Eddy'
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
    combined_confirmed_gaps: [
      { concept: 'window-fns', count: 2, first_seen_session_id: 's1' },
    ],
    knowledge_level_distribution: { beginner: 2, intermediate: 1, advanced: 0, unknown: 0 },
    recent_topics: [
      { id: 's3', topic: 'sql joins', created_at: new Date().toISOString(), ended_at: null },
    ],
    concept_accuracy: [],
    weekly_mastery: [],
  }
}

const usagePayload = {
  daily: [{ date_utc: '2026-07-10', cost_usd: 1.0 }],
  today_spend_usd: 1.0,
  soft_cap_usd: 2.0,
  urgent_cap_usd: 2.7,
  hard_cap_usd: 3.0,
  top_sessions: [],
}

describe('AggregateProfileView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    // Default: usage fetch succeeds so pre-existing tests (which only care
    // about the aggregate payload) don't hit the real apiGet implementation.
    vi.spyOn(profileApi, 'getUsageSummary').mockResolvedValue(usagePayload)
  })

  it('renders loading then empty state when zero sessions', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue({
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
    })

    const wrapper = mount(AggregateProfileView, { global: { stubs } })
    await flushPromises()

    expect(wrapper.find('[data-testid="agg-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agg-stats"]').exists()).toBe(false)
  })

  it('renders stats + concepts when sessions exist', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(nonEmptyAggregatePayload())

    const wrapper = mount(AggregateProfileView, { global: { stubs } })
    await flushPromises()

    expect(wrapper.find('[data-testid="agg-stats"]').exists()).toBe(true)
    const masteredText = wrapper.find('[data-testid="agg-mastered"]').text()
    expect(masteredText).toContain('joins')
    expect(masteredText).toContain('select')
    const gapsText = wrapper.find('[data-testid="agg-gaps"]').text()
    expect(gapsText).toContain('window-fns')
    expect(wrapper.find('[data-testid="agg-recent"]').text()).toContain('sql joins')
  })

  it('shows error banner when the API throws', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockRejectedValue(
      new Error('boom'),
    )

    const wrapper = mount(AggregateProfileView, { global: { stubs } })
    await flushPromises()

    const err = wrapper.find('[data-testid="agg-error"]')
    expect(err.exists()).toBe(true)
    expect(err.text()).toContain('boom')
  })

  it('does not render a back button', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue({
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
    })
    const wrapper = mount(AggregateProfileView, { global: { stubs } })
    await flushPromises()
    expect(wrapper.find('[data-testid="back"]').exists()).toBe(false)
  })

  it('renders insights and usage sections when both fetches succeed', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(nonEmptyAggregatePayload())
    vi.spyOn(profileApi, 'getUsageSummary').mockResolvedValue(usagePayload)

    const wrapper = mount(AggregateProfileView, { global: { stubs } })
    await flushPromises()

    expect(wrapper.find('[data-testid="weakest-concepts"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mastery-trend"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="usage-panel"]').exists()).toBe(true)
  })

  it('usage failure degrades to a notice without breaking insights', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(nonEmptyAggregatePayload())
    vi.spyOn(profileApi, 'getUsageSummary').mockRejectedValue(new Error('boom'))

    const wrapper = mount(AggregateProfileView, { global: { stubs } })
    await flushPromises()

    expect(wrapper.find('[data-testid="weakest-concepts"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="usage-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="usage-panel"]').exists()).toBe(false)
  })

  it('aggregate failure keeps the view-level error and skips usage render', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockRejectedValue(new Error('boom'))
    vi.spyOn(profileApi, 'getUsageSummary').mockResolvedValue(usagePayload)

    const wrapper = mount(AggregateProfileView, { global: { stubs } })
    await flushPromises()

    expect(wrapper.find('[data-testid="agg-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="usage-panel"]').exists()).toBe(false)
  })
})
