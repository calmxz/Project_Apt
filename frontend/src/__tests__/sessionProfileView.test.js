import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import ProfileView from '@/views/ProfileView.vue'
import * as profileApi from '@/services/profileApi.js'

const stubs = {
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
  BackButton: { template: '<button />', props: ['label', 'fallback'] },
}

describe('SessionProfileView (per-session)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('renders mastered, gaps, focus, and learning events', async () => {
    vi.spyOn(profileApi, 'getSessionProfile').mockResolvedValue({
      profile: {
        knowledge_level: 'beginner',
        confirmed_gaps: ['window-fns'],
        mastered_concepts: ['joins', 'select'],
        focus_target_gap: 'window-fns',
        last_session_summary: 'Covered joins and selects.',
      },
      recent_learning_events: [
        {
          id: 1,
          session_id: 's1',
          gap_tested: 'joins',
          question: 'Inner vs outer?',
          correct: true,
          created_at: new Date().toISOString(),
        },
      ],
    })

    const wrapper = mount(ProfileView, {
      props: { id: 's1' },
      global: { stubs },
    })
    await flushPromises()

    const mastered = wrapper.find('[data-testid="sprof-mastered"]').text()
    expect(mastered).toContain('joins')
    expect(mastered).toContain('select')
    expect(wrapper.find('[data-testid="sprof-gaps"]').text()).toContain('window-fns')
    expect(wrapper.find('[data-testid="sprof-focus"]').text()).toContain('window-fns')
    expect(wrapper.find('[data-testid="sprof-summary"]').text()).toContain('Covered joins')
    expect(wrapper.find('[data-testid="sprof-events"]').text()).toContain('Inner vs outer')
  })

  it('shows error when API rejects', async () => {
    vi.spyOn(profileApi, 'getSessionProfile').mockRejectedValue(new Error('nope'))

    const wrapper = mount(ProfileView, {
      props: { id: 's1' },
      global: { stubs },
    })
    await flushPromises()

    const err = wrapper.find('[data-testid="sprof-error"]')
    expect(err.exists()).toBe(true)
    expect(err.text()).toContain('nope')
  })
})
