import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AggregateProfileView from '@/views/AggregateProfileView.vue'
import { useUserStore } from '@/stores/user.js'
import * as profileApi from '@/services/profileApi.js'

const stubs = {
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
  BackButton: { template: '<button />', props: ['label', 'fallback'] },
}

function seedUser() {
  const user = useUserStore()
  user.userId = 'u_test'
  user.name = 'Eddy'
  user.onboardingComplete = true
}

describe('AggregateProfileView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
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
    })

    const wrapper = mount(AggregateProfileView, { global: { stubs } })
    await flushPromises()

    expect(wrapper.find('[data-testid="agg-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agg-stats"]').exists()).toBe(false)
  })

  it('renders stats + concepts when sessions exist', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue({
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
    })

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
})
