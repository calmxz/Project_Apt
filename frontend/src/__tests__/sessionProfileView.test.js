import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import ProfileView from '@/views/ProfileView.vue'
import * as profileApi from '@/services/profileApi.js'

const routerPushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPushMock }),
}))

const stubs = {
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
  BackButton: { template: '<button />', props: ['label', 'fallback'] },
  teleport: true,
  Dialog: {
    props: ['visible'],
    emits: ['update:visible'],
    template: '<div v-if="visible" data-testid="dialog"><slot /></div>',
  },
}

describe('SessionProfileView (per-session)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    routerPushMock.mockClear()
  })

  it('renders mastered, gaps, focus, and learning events', async () => {
    vi.spyOn(profileApi, 'getSessionProfile').mockResolvedValue({
      profile: {
        knowledge_level: 'beginner',
        confirmed_gaps: [
          { name: 'window-fns', evidence_type: null, last_event_at: null },
        ],
        mastered_concepts: [
          { name: 'joins', evidence_type: 'tested', last_event_at: null },
          { name: 'select', evidence_type: 'declared', last_event_at: null },
        ],
        subtopic_levels: {},
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

  // F-53: last_session_summary may carry the "[auto] " fallback prefix from
  // an auto-generated (no-LLM) recap; strip it before display.
  it('strips the [auto] prefix from the session summary', async () => {
    vi.spyOn(profileApi, 'getSessionProfile').mockResolvedValue({
      profile: {
        knowledge_level: 'beginner',
        confirmed_gaps: [],
        mastered_concepts: [],
        subtopic_levels: {},
        last_session_summary: '[auto] recap text',
      },
      recent_learning_events: [],
    })

    const wrapper = mount(ProfileView, {
      props: { id: 's1' },
      global: { stubs },
    })
    await flushPromises()

    const summary = wrapper.find('[data-testid="sprof-summary"]')
    expect(summary.text()).toContain('recap text')
    expect(summary.text()).not.toContain('[auto]')
  })

  it('renders concept names with evidence badges', async () => {
    vi.spyOn(profileApi, 'getSessionProfile').mockResolvedValue({
      profile: {
        knowledge_level: 'beginner',
        mastered_concepts: [
          { name: 'x', evidence_type: 'tested', last_event_at: '2026-07-01T00:00:00Z' },
        ],
        confirmed_gaps: [
          { name: 'y', evidence_type: null, last_event_at: null },
          { name: 'z', evidence_type: 'declared', last_event_at: null },
        ],
        subtopic_levels: {},
      },
      recent_learning_events: [],
    })

    const wrapper = mount(ProfileView, {
      props: { id: 's1' },
      global: { stubs },
    })
    await flushPromises()

    const chips = wrapper.findAll('[data-testid="sprof-mastered"] .chip')
    expect(chips[0].text()).toContain('x')
    expect(chips[0].find('[data-testid="evidence-badge"]').text()).toBe('tested')
    const gapChips = wrapper.findAll('[data-testid="sprof-gaps"] .chip')
    expect(gapChips[0].find('[data-testid="evidence-badge"]').exists()).toBe(false)
    expect(gapChips[1].find('[data-testid="evidence-badge"]').text()).toBe('declared')
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

  async function mountProfile({ profile = {}, etag = 'e0' } = {}) {
    vi.spyOn(profileApi, 'getSessionProfile').mockResolvedValue({
      profile: {
        knowledge_level: 'beginner',
        confirmed_gaps: [],
        mastered_concepts: [],
        ...profile,
      },
      etag,
      recent_learning_events: [],
    })
    const wrapper = mount(ProfileView, {
      props: { id: 's1' },
      global: { stubs },
    })
    await flushPromises()
    return wrapper
  }

  it('adds a mastered concept and threads the etag', async () => {
    const patchProfile = vi.spyOn(profileApi, 'patchProfile').mockResolvedValue({
      profile: {
        mastered_concepts: [{ name: 'loops', evidence_type: 'declared', last_event_at: null }],
        confirmed_gaps: [],
      },
      etag: 'e1',
    })
    const wrapper = await mountProfile({ etag: 'e0' })
    await wrapper.get('[data-testid="add-mastered"]').setValue('loops')
    await wrapper.get('[data-testid="add-mastered-submit"]').trigger('click')
    await flushPromises()
    expect(patchProfile).toHaveBeenCalledWith('s1', { add_mastered: 'loops' }, 'e0')
  })

  it('adds a confirmed gap and threads the etag', async () => {
    const patchProfile = vi.spyOn(profileApi, 'patchProfile').mockResolvedValue({
      profile: {
        mastered_concepts: [],
        confirmed_gaps: [{ name: 'window-fns', evidence_type: 'declared', last_event_at: null }],
      },
      etag: 'e1',
    })
    const wrapper = await mountProfile({ etag: 'e0' })
    await wrapper.get('[data-testid="add-gap"]').setValue('window-fns')
    await wrapper.get('[data-testid="add-gap-submit"]').trigger('click')
    await flushPromises()
    expect(patchProfile).toHaveBeenCalledWith('s1', { add_gap: 'window-fns' }, 'e0')
  })

  it('removes a chip via deleteProfileItem', async () => {
    const deleteProfileItem = vi.spyOn(profileApi, 'deleteProfileItem').mockResolvedValue({
      profile: { mastered_concepts: [], confirmed_gaps: [] },
      etag: 'e1',
    })
    const wrapper = await mountProfile({
      profile: {
        mastered_concepts: [{ name: 'loops', evidence_type: 'tested', last_event_at: null }],
        confirmed_gaps: [],
      },
      etag: 'e0',
    })
    await wrapper.get('[data-testid="chip-remove"]').trigger('click')
    await flushPromises()
    expect(deleteProfileItem).toHaveBeenCalledWith('s1', 'mastered_concepts', 'loops', 'e0')
  })

  it('sets the knowledge level and threads the etag', async () => {
    const patchProfile = vi.spyOn(profileApi, 'patchProfile').mockResolvedValue({
      profile: { mastered_concepts: [], confirmed_gaps: [], knowledge_level: 'advanced' },
      etag: 'e1',
    })
    const wrapper = await mountProfile({ etag: 'e0' })
    const advancedBtn = wrapper
      .get('[data-testid="level-select"]')
      .findAll('button')
      .find((b) => b.text() === 'advanced')
    await advancedBtn.trigger('click')
    await flushPromises()
    expect(patchProfile).toHaveBeenCalledWith('s1', { knowledge_level: 'advanced' }, 'e0')
  })

  it('on 412 refetches and shows a notice', async () => {
    const getSessionProfile = vi.spyOn(profileApi, 'getSessionProfile').mockResolvedValue({
      profile: { knowledge_level: 'beginner', confirmed_gaps: [], mastered_concepts: [] },
      etag: 'e0',
      recent_learning_events: [],
    })
    vi.spyOn(profileApi, 'patchProfile').mockRejectedValueOnce(
      Object.assign(new Error('x'), { status: 412 }),
    )

    const wrapper = mount(ProfileView, {
      props: { id: 's1' },
      global: { stubs },
    })
    await flushPromises()

    await wrapper.get('[data-testid="add-mastered"]').setValue('loops')
    await wrapper.get('[data-testid="add-mastered-submit"]').trigger('click')
    await flushPromises()

    expect(getSessionProfile).toHaveBeenCalledTimes(2) // initial + refetch
    expect(wrapper.get('[data-testid="sprof-conflict"]').exists()).toBe(true)
  })

  // F-05: a non-412 write failure used to set the load-path `error`, whose
  // template branch supplants the whole data branch -- one transient 500
  // permanently replaced the loaded profile with an error paragraph.
  it('a failed write shows an inline banner and keeps the profile visible (F-05)', async () => {
    vi.spyOn(profileApi, 'patchProfile').mockRejectedValueOnce(
      Object.assign(new Error('boom'), { status: 500 }),
    )
    const wrapper = await mountProfile({
      profile: {
        mastered_concepts: [{ name: 'loops', evidence_type: 'tested', last_event_at: null }],
      },
      etag: 'e0',
    })
    await wrapper.get('[data-testid="add-gap"]').setValue('window-fns')
    await wrapper.get('[data-testid="add-gap-submit"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="sprof-write-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sprof-mastered"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sprof-error"]').exists()).toBe(false)
  })

  it('the write-error banner clears on the next write attempt (F-05)', async () => {
    vi.spyOn(profileApi, 'patchProfile')
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }))
      .mockResolvedValueOnce({
        profile: { mastered_concepts: [], confirmed_gaps: [] },
        etag: 'e1',
      })
    const wrapper = await mountProfile({ etag: 'e0' })
    await wrapper.get('[data-testid="add-gap"]').setValue('a')
    await wrapper.get('[data-testid="add-gap-submit"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="sprof-write-error"]').exists()).toBe(true)
    await wrapper.get('[data-testid="add-gap"]').setValue('b')
    await wrapper.get('[data-testid="add-gap-submit"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="sprof-write-error"]').exists()).toBe(false)
  })

  it('review-gaps button routes to the session with review_gap query', async () => {
    const wrapper = await mountProfile({
      profile: {
        confirmed_gaps: [
          { name: 'a', evidence_type: null, last_event_at: null },
          { name: 'b', evidence_type: null, last_event_at: null },
        ],
      },
    })
    await wrapper.get('[data-testid="sprof-review-gaps"]').trigger('click')
    await wrapper.get('[data-testid="gap-picker-option-0"]').trigger('click')
    expect(routerPushMock).toHaveBeenCalledWith({
      name: 'session',
      params: { id: 's1' },
      query: { review_gap: 'a' },
    })
    expect(routerPushMock).toHaveBeenCalledTimes(1)
  })

  it('review-gaps button skips the picker and routes directly for a single gap', async () => {
    const wrapper = await mountProfile({
      profile: {
        confirmed_gaps: [{ name: 'only-gap', evidence_type: null, last_event_at: null }],
      },
    })
    await wrapper.get('[data-testid="sprof-review-gaps"]').trigger('click')
    expect(wrapper.find('[data-testid="gap-picker"]').exists()).toBe(false)
    expect(routerPushMock).toHaveBeenCalledWith({
      name: 'session',
      params: { id: 's1' },
      query: { review_gap: 'only-gap' },
    })
    expect(routerPushMock).toHaveBeenCalledTimes(1)
  })

  it('does not show the review-gaps button when there are no confirmed gaps', async () => {
    const wrapper = await mountProfile({ profile: { confirmed_gaps: [] } })
    expect(wrapper.find('[data-testid="sprof-review-gaps"]').exists()).toBe(false)
  })

  it('renders subtopic levels with editable pills and remove', async () => {
    const wrapper = await mountProfile({
      profile: { subtopic_levels: { 'chain rule': 'beginner' } },
    })
    const sec = wrapper.find('[data-testid="sprof-subtopics"]')
    expect(sec.exists()).toBe(true)
    expect(sec.text()).toContain('chain rule')
    const active = sec.find('.level-opt.active')
    expect(active.text()).toBe('beginner')
  })

  it('PATCHes subtopic level on pill click and DELETEs on remove', async () => {
    const patchProfile = vi.spyOn(profileApi, 'patchProfile').mockResolvedValue({
      profile: { mastered_concepts: [], confirmed_gaps: [], subtopic_levels: { 'chain rule': 'advanced' } },
      etag: 'e1',
    })
    const deleteProfileItem = vi.spyOn(profileApi, 'deleteProfileItem').mockResolvedValue({
      profile: { mastered_concepts: [], confirmed_gaps: [], subtopic_levels: {} },
      etag: 'e2',
    })
    const wrapper = await mountProfile({
      profile: { subtopic_levels: { 'chain rule': 'beginner' } },
      etag: 'e0',
    })
    const row = wrapper.get('[data-testid="sprof-subtopics"] .subtopic-row')
    const advancedBtn = row.findAll('.level-opt').find((b) => b.text() === 'advanced')
    await advancedBtn.trigger('click')
    await flushPromises()
    expect(patchProfile).toHaveBeenCalledWith(
      's1',
      { subtopic: 'chain rule', subtopic_level: 'advanced' },
      'e0',
    )

    await wrapper.get('[data-testid="subtopic-remove"]').trigger('click')
    await flushPromises()
    expect(deleteProfileItem).toHaveBeenCalledWith('s1', 'subtopic_levels', 'chain rule', 'e1')
  })

  it('hides the subtopics section when subtopic_levels is empty', async () => {
    const wrapper = await mountProfile({ profile: { subtopic_levels: {} } })
    expect(wrapper.find('[data-testid="sprof-subtopics"]').exists()).toBe(false)
  })
})
