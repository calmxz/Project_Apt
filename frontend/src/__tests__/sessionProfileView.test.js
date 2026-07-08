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
      profile: { mastered_concepts: ['loops'], confirmed_gaps: [] },
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
      profile: { mastered_concepts: [], confirmed_gaps: ['window-fns'] },
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
      profile: { mastered_concepts: ['loops'], confirmed_gaps: [] },
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

  it('review-gaps button routes to the session with review_gap query', async () => {
    const wrapper = await mountProfile({ profile: { confirmed_gaps: ['a', 'b'] } })
    await wrapper.get('[data-testid="sprof-review-gaps"]').trigger('click')
    await wrapper.get('[data-testid="gap-picker-option-0"]').trigger('click')
    expect(routerPushMock).toHaveBeenCalledWith({
      name: 'session',
      params: { id: 's1' },
      query: { review_gap: 'a' },
    })
  })

  it('review-gaps button skips the picker and routes directly for a single gap', async () => {
    const wrapper = await mountProfile({ profile: { confirmed_gaps: ['only-gap'] } })
    await wrapper.get('[data-testid="sprof-review-gaps"]').trigger('click')
    expect(wrapper.find('[data-testid="gap-picker"]').exists()).toBe(false)
    expect(routerPushMock).toHaveBeenCalledWith({
      name: 'session',
      params: { id: 's1' },
      query: { review_gap: 'only-gap' },
    })
  })

  it('does not show the review-gaps button when there are no confirmed gaps', async () => {
    const wrapper = await mountProfile({ profile: { confirmed_gaps: [] } })
    expect(wrapper.find('[data-testid="sprof-review-gaps"]').exists()).toBe(false)
  })
})
