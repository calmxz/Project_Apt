import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, RouterLinkStub } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import LearningTab from '@/components/settings/LearningTab.vue'
import { useUserStore } from '@/stores/user.js'
import * as profileApi from '@/services/profileApi.js'

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

// AggregateProfileResponse (docs/api/openapi.yaml): recent_topics carries the
// same progress.{focus_target_gap,level,mastered_count} shape as GET
// /sessions; weekly_mastery and concept_accuracy exist only on this
// aggregate endpoint.
function aggregateFixture() {
  return {
    total_sessions: 3,
    active_sessions: 2,
    ended_sessions: 1,
    total_learning_events: 12,
    combined_mastered_concepts: [],
    combined_confirmed_gaps: [],
    knowledge_level_distribution: { beginner: 1, intermediate: 1, advanced: 0, unknown: 1 },
    recent_topics: [
      {
        id: 's-new',
        topic: 'sql joins',
        created_at: '2026-09-10T10:00:00Z',
        ended_at: null,
        last_activity_at: null,
        progress: {
          focus_target_gap: 'window functions',
          level: 'intermediate',
          mastered_count: 4,
        },
      },
      {
        id: 's-old',
        topic: 'photosynthesis',
        created_at: '2026-09-01T10:00:00Z',
        ended_at: null,
        last_activity_at: '2026-09-02T10:00:00Z',
        progress: { focus_target_gap: null, level: 'beginner', mastered_count: 1 },
      },
      {
        id: 's-ended',
        topic: 'css selectors',
        created_at: '2026-08-01T10:00:00Z',
        ended_at: '2026-08-02T10:00:00Z',
        last_activity_at: '2026-08-02T10:00:00Z',
        progress: null,
      },
    ],
    concept_accuracy: [
      {
        concept: 'window functions',
        correct_count: 3,
        total_count: 5,
        accuracy: 0.6,
        last_results: [true, false, true, true, false],
        first_seen_session_id: 's-new',
      },
    ],
    weekly_mastery: [
      { week_start: '2026-08-24', count: 1 },
      { week_start: '2026-08-31', count: 3 },
      { week_start: '2026-09-07', count: 2 },
    ],
  }
}

// weekly_mastery is always 12 zero-filled points server-side (_learning_insights
// in backend/services/profile_insights.py), even for a session-less account, so
// a fresh-account fixture must reflect that rather than an empty array.
function twelveZeroWeeks() {
  const base = new Date('2026-06-29T00:00:00Z') // a Monday
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(base)
    d.setUTCDate(d.getUTCDate() + i * 7)
    return { week_start: d.toISOString().slice(0, 10), count: 0 }
  })
}

function emptyAggregateFixture() {
  return {
    total_sessions: 0,
    active_sessions: 0,
    ended_sessions: 0,
    total_learning_events: 0,
    combined_mastered_concepts: [],
    combined_confirmed_gaps: [],
    knowledge_level_distribution: { beginner: 0, intermediate: 0, advanced: 0, unknown: 0 },
    recent_topics: [],
    concept_accuracy: [],
    weekly_mastery: twelveZeroWeeks(),
  }
}

describe('LearningTab', () => {
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
    let resolveAggregate
    const pending = new Promise((resolve) => {
      resolveAggregate = resolve
    })
    vi.spyOn(profileApi, 'getAggregateProfile').mockReturnValue(pending)

    const wrapper = mount(LearningTab, { global: { stubs } })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="agg-loading"]').exists()).toBe(true)
    expect(wrapper.find('[role="status"]').exists()).toBe(true)

    resolveAggregate(aggregateFixture())
    await flushPromises()
    expect(wrapper.find('[data-testid="agg-loading"]').exists()).toBe(false)
  })

  it('renders one topic row per recent topic with level, focus and mastered count', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(aggregateFixture())

    const wrapper = mount(LearningTab, { global: { stubs } })
    await flushPromises()

    expect(wrapper.find('[data-testid="agg-learning"]').exists()).toBe(true)
    const rows = wrapper.findAll('[data-testid="learning-topic-row"]')
    expect(rows).toHaveLength(3)

    const first = rows[0]
    expect(first.get('[data-testid="learning-topic-link"]').text()).toBe('sql joins')
    expect(first.getComponent('[data-testid="learning-topic-link"]').props('to')).toEqual({
      name: 'session-profile',
      params: { id: 's-new' },
    })
    // sr-only "focus: " prefix precedes the visible cue text (a11y context).
    expect(first.get('[data-testid="learning-topic-focus"]').text()).toBe('focus: window functions')
    expect(first.get('[data-testid="learning-topic-mastered"]').text()).toContain('4 mastered')
  })

  it('shows "no focus" in place of the focus cue when a topic has none', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(aggregateFixture())

    const wrapper = mount(LearningTab, { global: { stubs } })
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="learning-topic-row"]')
    // s-old (2nd row) has focus_target_gap: null.
    expect(rows[1].find('[data-testid="learning-topic-focus"]').exists()).toBe(false)
    expect(rows[1].text()).toContain('no focus')
  })

  it('renders one weekly-mastery column per point plus its text equivalent', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(aggregateFixture())

    const wrapper = mount(LearningTab, { global: { stubs } })
    await flushPromises()

    const weekly = wrapper.get('[data-testid="learning-weekly"]')
    expect(weekly.findAll('rect.weekly-bar')).toHaveLength(3)

    const text = wrapper.get('[data-testid="learning-weekly-text"]')
    const items = text.findAll('li')
    expect(items).toHaveLength(3)
    expect(items[1].text()).toBe('Week of Aug 31: 3 mastered')
  })

  it('renders concept accuracy rows with correct/total and five result marks', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(aggregateFixture())

    const wrapper = mount(LearningTab, { global: { stubs } })
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="learning-accuracy-row"]')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('window functions')
    expect(rows[0].text()).toContain('3 of 5')

    const marks = rows[0].findAll('.accuracy-mark')
    expect(marks).toHaveLength(5)
    expect(marks.map((m) => m.attributes('aria-label'))).toEqual([
      'correct',
      'incorrect',
      'correct',
      'correct',
      'incorrect',
    ])
  })

  // Story 31: "the concepts I am most and least accurate on" -- a subset,
  // not the full sorted list. Server sends concept_accuracy sorted ascending
  // by accuracy, so first 3 = least accurate, last 3 = most accurate.
  it('shows at most 6 concept accuracy rows split into least/most accurate groups', async () => {
    seedUser()
    const eightConcepts = Array.from({ length: 8 }, (_, i) => ({
      concept: `concept ${i}`,
      correct_count: i,
      total_count: 10,
      accuracy: i / 10,
      last_results: [i % 2 === 0],
      first_seen_session_id: 's-new',
    }))
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue({
      ...aggregateFixture(),
      concept_accuracy: eightConcepts,
    })

    const wrapper = mount(LearningTab, { global: { stubs } })
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="learning-accuracy-row"]')
    expect(rows).toHaveLength(6)
    expect(rows.map((r) => r.get('.accuracy-concept').text())).toEqual([
      'concept 0',
      'concept 1',
      'concept 2',
      'concept 5',
      'concept 6',
      'concept 7',
    ])

    const accuracy = wrapper.get('[data-testid="learning-accuracy"]')
    expect(accuracy.text()).toContain('Least accurate')
    expect(accuracy.text()).toContain('Most accurate')
  })

  it('shows error banner when the API throws', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockRejectedValue(new Error('boom'))

    const wrapper = mount(LearningTab, { global: { stubs } })
    await flushPromises()

    const err = wrapper.find('[data-testid="agg-error"]')
    expect(err.exists()).toBe(true)
    expect(err.text()).toContain('boom')
    expect(wrapper.find('[data-testid="learning-topics"]').exists()).toBe(false)
  })

  // E-10: a failed read is recoverable in place, and it also has to recover
  // when the learner leaves the tab and comes back (SettingsView KeepAlive).
  it('offers Retry on a failed read and refetches on click', async () => {
    seedUser()
    const spy = vi
      .spyOn(profileApi, 'getAggregateProfile')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(aggregateFixture())

    const wrapper = mount(LearningTab, { global: { stubs } })
    await flushPromises()

    const retry = wrapper.find('[data-testid="agg-retry"]')
    expect(retry.exists()).toBe(true)

    await retry.trigger('click')
    await flushPromises()

    expect(spy).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="agg-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="learning-topic-row"]').exists()).toBe(true)
  })

  it('refetches on reactivation only when the previous read failed', async () => {
    seedUser()
    const spy = vi
      .spyOn(profileApi, 'getAggregateProfile')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(aggregateFixture())

    const Host = {
      components: { LearningTab },
      data: () => ({ show: true }),
      template: '<KeepAlive><LearningTab v-if="show" /></KeepAlive>',
    }
    const wrapper = mount(Host, { global: { stubs } })
    await flushPromises()
    expect(spy).toHaveBeenCalledTimes(1)

    // Away and back with an error standing: one more read.
    wrapper.vm.show = false
    await flushPromises()
    wrapper.vm.show = true
    await flushPromises()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="agg-error"]').exists()).toBe(false)

    // Away and back with the read healthy: no extra request.
    wrapper.vm.show = false
    await flushPromises()
    wrapper.vm.show = true
    await flushPromises()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('renders empty state with a start-session link when there are zero sessions, and no learning-weekly section', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(emptyAggregateFixture())

    const wrapper = mount(LearningTab, { global: { stubs } })
    await flushPromises()

    const empty = wrapper.get('[data-testid="agg-empty"]')
    expect(wrapper.find('[data-testid="learning-topic-row"]').exists()).toBe(false)
    // total_sessions === 0 guards weekly/accuracy too, even though
    // weekly_mastery still carries its usual 12 zero-filled points.
    expect(wrapper.find('[data-testid="learning-weekly"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="learning-accuracy"]').exists()).toBe(false)

    const startLink = empty.getComponent(RouterLinkStub)
    expect(startLink.text()).toBe('Start your first session')
    expect(startLink.props('to')).toBe('/new')
  })

  // The weekly section stays visible for a learner with sessions (not a
  // fresh account) but no mastered weeks yet: a "none yet" line replaces
  // the chart of nothing, rather than the section vanishing outright.
  it('shows "none yet" instead of a chart when the aggregate carries all-zero weekly points and no concept accuracy', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue({
      ...aggregateFixture(),
      weekly_mastery: twelveZeroWeeks(),
      concept_accuracy: [],
    })

    const wrapper = mount(LearningTab, { global: { stubs } })
    await flushPromises()

    expect(wrapper.find('[data-testid="learning-topics"]').exists()).toBe(true)

    const weekly = wrapper.get('[data-testid="learning-weekly"]')
    expect(weekly.find('rect.weekly-bar').exists()).toBe(false)
    expect(weekly.text()).toContain('none yet')

    const accuracy = wrapper.get('[data-testid="learning-accuracy"]')
    expect(accuracy.find('[data-testid="learning-accuracy-row"]').exists()).toBe(false)
    expect(accuracy.text()).toContain('none yet')
  })

  it('renders the feedback style section before the topics section', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(aggregateFixture())

    const wrapper = mount(LearningTab, { global: { stubs } })
    await flushPromises()

    const html = wrapper.html()
    const feedbackIdx = html.indexOf('data-testid="learning-feedback"')
    const topicsIdx = html.indexOf('data-testid="learning-topics"')
    expect(feedbackIdx).toBeGreaterThanOrEqual(0)
    expect(topicsIdx).toBeGreaterThan(feedbackIdx)
  })

  it('save feedback is the filled control, disabled until the choice changes', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(aggregateFixture())

    const wrapper = mount(LearningTab, { global: { stubs } })
    await flushPromises()

    const saveBtn = wrapper.get('[data-testid="learning-feedback-save"]')
    expect(saveBtn.classes()).toContain('btn-fill')
    expect(saveBtn.attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="feedback-style-direct_answers"]').setValue(true)
    expect(saveBtn.attributes('disabled')).toBeUndefined()
  })

  it('submitting feedback calls user.updateProfile with current name and new feedback', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(aggregateFixture())
    const user = useUserStore()
    const updateSpy = vi.spyOn(user, 'updateProfile').mockResolvedValue()

    const wrapper = mount(LearningTab, { global: { stubs } })
    await flushPromises()

    await wrapper.get('[data-testid="feedback-style-direct_answers"]').setValue(true)
    await wrapper.get('[data-testid="learning-feedback-save"]').trigger('click')
    await flushPromises()

    expect(updateSpy).toHaveBeenCalledWith({ name: 'Eddy', feedback: 'direct_answers' })
    expect(showSuccess).toHaveBeenCalledOnce()
  })

  it('marks the save button busy while the write is in flight', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(aggregateFixture())
    const user = useUserStore()
    let resolveSave
    vi.spyOn(user, 'updateProfile').mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve
      }),
    )

    const wrapper = mount(LearningTab, { global: { stubs } })
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
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(aggregateFixture())
    const user = useUserStore()
    vi.spyOn(user, 'updateProfile').mockResolvedValue()

    const wrapper = mount(LearningTab, { global: { stubs } })
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
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(aggregateFixture())

    const wrapper = mount(LearningTab, { global: { stubs } })
    await flushPromises()

    expect(wrapper.find('[data-testid="usage-panel"]').exists()).toBe(false)
  })
})
