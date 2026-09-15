import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, RouterLinkStub } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import ProfileTab from '@/components/settings/ProfileTab.vue'
import { useUserStore } from '@/stores/user.js'
import * as sessionsApi from '@/services/sessionsApi.js'

const showSuccess = vi.fn()
const showError = vi.fn()
vi.mock('@/composables/useToast.js', () => ({
  useToast: () => ({ showSuccess, showError, showWarn: vi.fn() }),
}))

const stubs = {
  RouterLink: RouterLinkStub,
}

function seedUser() {
  const user = useUserStore()
  user.userId = 'u_test'
  user.name = 'Eddy'
  user.interactionPreferences = { feedback: 'hints' }
  user.onboardingComplete = true
}

// Deliberately out of order: the oldest row is listed first, the middle row
// has no last_activity_at (so the created_at fallback decides), and the last
// row is ended with no progress block at all.
function sessionList() {
  return [
    {
      id: 's-old',
      topic: 'photosynthesis',
      created_at: '2026-09-01T10:00:00Z',
      ended_at: null,
      pinned: false,
      last_activity_at: '2026-09-02T10:00:00Z',
      progress: { focus_target_gap: null, level: 'beginner', mastered_count: 1 },
    },
    {
      id: 's-new',
      topic: 'sql joins',
      created_at: '2026-09-10T10:00:00Z',
      ended_at: null,
      pinned: false,
      last_activity_at: null,
      progress: { focus_target_gap: 'window functions', level: 'intermediate', mastered_count: 4 },
    },
    {
      id: 's-ended',
      topic: 'css selectors',
      created_at: '2026-08-01T10:00:00Z',
      ended_at: '2026-08-02T10:00:00Z',
      pinned: false,
      last_activity_at: '2026-08-02T10:00:00Z',
      progress: null,
    },
  ]
}

describe('ProfileTab', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    showSuccess.mockClear()
    showError.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('displays skeleton loading state during initial fetch', async () => {
    seedUser()
    let resolveSessions
    const pending = new Promise((resolve) => {
      resolveSessions = resolve
    })
    vi.spyOn(sessionsApi, 'listSessions').mockReturnValue(pending)

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="agg-loading"]').exists()).toBe(true)
    expect(wrapper.find('[role="status"]').exists()).toBe(true)

    resolveSessions(sessionList())
    await flushPromises()
    expect(wrapper.find('[data-testid="agg-loading"]').exists()).toBe(false)
  })

  it('writes the account-level summary line: topic count, total mastered, most-recent focus', async () => {
    seedUser()
    vi.spyOn(sessionsApi, 'listSessions').mockResolvedValue(sessionList())

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await flushPromises()

    expect(wrapper.find('[data-testid="agg-profile"]').exists()).toBe(true)
    // Mastered totals 1 (s-old) + 4 (s-new) + 0 (s-ended, no progress) = 5.
    // s-new has no last_activity_at, so its created_at (2026-09-10) sorts it
    // first and its focus_target_gap ("window functions") is the one used.
    expect(wrapper.get('[data-testid="profile-summary-line"]').text()).toBe(
      '3 topics · 5 mastered · focus: window functions',
    )
  })

  it('writes just the topic count for a single session with no progress', async () => {
    seedUser()
    vi.spyOn(sessionsApi, 'listSessions').mockResolvedValue([
      {
        id: 's-solo',
        topic: 'algebra',
        created_at: '2026-09-01T10:00:00Z',
        ended_at: null,
        pinned: false,
        last_activity_at: '2026-09-01T10:00:00Z',
        progress: null,
      },
    ])

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await flushPromises()

    expect(wrapper.get('[data-testid="profile-summary-line"]').text()).toBe('1 topic')
  })

  it('links "See all topics" to the sessions library', async () => {
    seedUser()
    vi.spyOn(sessionsApi, 'listSessions').mockResolvedValue(sessionList())

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await flushPromises()

    const link = wrapper.getComponent('[data-testid="profile-see-all"]')
    expect(link.text()).toBe('See all topics')
    expect(link.props('to')).toBe('/sessions')
  })

  it('renders the feedback style section before the summary in DOM order', async () => {
    seedUser()
    vi.spyOn(sessionsApi, 'listSessions').mockResolvedValue(sessionList())

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await flushPromises()

    const html = wrapper.html()
    const feedbackIdx = html.indexOf('profile-feedback')
    const summaryIdx = html.indexOf('profile-summary')
    expect(feedbackIdx).toBeGreaterThan(-1)
    expect(summaryIdx).toBeGreaterThan(-1)
    expect(feedbackIdx).toBeLessThan(summaryIdx)
  })

  it('shows error banner when the API throws', async () => {
    seedUser()
    vi.spyOn(sessionsApi, 'listSessions').mockRejectedValue(new Error('boom'))

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await flushPromises()

    const err = wrapper.find('[data-testid="agg-error"]')
    expect(err.exists()).toBe(true)
    expect(err.text()).toContain('boom')
    expect(wrapper.find('[data-testid="profile-summary-line"]').exists()).toBe(false)
  })

  it('renders empty state when zero sessions', async () => {
    seedUser()
    vi.spyOn(sessionsApi, 'listSessions').mockResolvedValue([])

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await flushPromises()

    expect(wrapper.find('[data-testid="agg-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="profile-summary-line"]').exists()).toBe(false)
  })

  it('save feedback is the filled control, disabled until the choice changes', async () => {
    seedUser()
    vi.spyOn(sessionsApi, 'listSessions').mockResolvedValue(sessionList())

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await flushPromises()

    const saveBtn = wrapper.get('[data-testid="profile-feedback-save"]')
    expect(saveBtn.classes()).toContain('btn-fill')
    expect(saveBtn.attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="feedback-style-direct_answers"]').setValue(true)
    expect(saveBtn.attributes('disabled')).toBeUndefined()
  })

  it('submitting feedback calls user.updateProfile with current name and new feedback', async () => {
    seedUser()
    vi.spyOn(sessionsApi, 'listSessions').mockResolvedValue(sessionList())
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

  it('marks the save button busy while the write is in flight', async () => {
    seedUser()
    vi.spyOn(sessionsApi, 'listSessions').mockResolvedValue(sessionList())
    const user = useUserStore()
    let resolveSave
    vi.spyOn(user, 'updateProfile').mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve
      }),
    )

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await flushPromises()

    await wrapper.get('[data-testid="feedback-style-direct_answers"]').setValue(true)
    await wrapper.get('[data-testid="profile-feedback-save"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="profile-feedback-save"]').classes()).toContain(
      'btn-fill--busy',
    )

    resolveSave()
    await flushPromises()
    expect(wrapper.get('[data-testid="profile-feedback-save"]').classes()).not.toContain(
      'btn-fill--busy',
    )
  })

  it('flashes Saved. beside the button until the value changes again', async () => {
    seedUser()
    vi.spyOn(sessionsApi, 'listSessions').mockResolvedValue(sessionList())
    const user = useUserStore()
    vi.spyOn(user, 'updateProfile').mockResolvedValue()

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await flushPromises()
    await wrapper.get('[data-testid="feedback-style-direct_answers"]').setValue(true)

    await wrapper.get('[data-testid="profile-feedback-save"]').trigger('click')
    await flushPromises()
    const flash = wrapper.get('[data-testid="profile-feedback-saved"]')
    expect(flash.text()).toBe('Saved.')
    expect(flash.find('svg.tick').exists()).toBe(true)

    // Same grammar as the Account tab: the flash clears on the next change.
    await wrapper.get('[data-testid="feedback-style-hints"]').setValue(true)
    expect(wrapper.find('[data-testid="profile-feedback-saved"]').exists()).toBe(false)
  })

  it('does not render the usage panel (usage moved to its own tab)', async () => {
    seedUser()
    vi.spyOn(sessionsApi, 'listSessions').mockResolvedValue(sessionList())

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await flushPromises()

    expect(wrapper.find('[data-testid="usage-panel"]').exists()).toBe(false)
  })
})
