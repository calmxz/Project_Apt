import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import SubjectProfileView from '@/views/SubjectProfileView.vue'
import * as profileApi from '@/services/profileApi.js'

const stubs = {
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
  BackButton: { template: '<button data-testid="back" />', props: ['label', 'fallback'] },
}

describe('SubjectProfileView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('renders mastered, open gaps, and per-lesson rollup', async () => {
    vi.spyOn(profileApi, 'getSubjectProfile').mockResolvedValue({
      subject_id: 'sub1',
      subject_title: 'Organic Chemistry',
      mastered_concepts: ['bonding', 'hybridization'],
      open_gaps: ['chirality'],
      lessons: [
        { lesson_id: 'l0', lesson_title: 'Bonding basics', mastered: ['bonding'], gaps: [] },
        { lesson_id: 'l1', lesson_title: 'Stereochemistry', mastered: [], gaps: ['chirality'] },
      ],
    })
    const wrapper = mount(SubjectProfileView, {
      props: { id: 'sub1' },
      global: { stubs },
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="smap-mastered"]').text()).toContain('bonding')
    expect(wrapper.find('[data-testid="smap-gaps"]').text()).toContain('chirality')
    const byLesson = wrapper.find('[data-testid="smap-lessons"]').text()
    expect(byLesson).toContain('Bonding basics')
    expect(byLesson).toContain('Stereochemistry')
  })

  it('renders empty-but-valid shape', async () => {
    vi.spyOn(profileApi, 'getSubjectProfile').mockResolvedValue({
      subject_id: 'sub1', subject_title: 'New', mastered_concepts: [], open_gaps: [], lessons: [],
    })
    const wrapper = mount(SubjectProfileView, { props: { id: 'sub1' }, global: { stubs } })
    await flushPromises()
    expect(wrapper.find('[data-testid="smap-empty"]').exists()).toBe(true)
  })

  it('shows error banner when the API throws', async () => {
    vi.spyOn(profileApi, 'getSubjectProfile').mockRejectedValue(new Error('boom'))
    const wrapper = mount(SubjectProfileView, { props: { id: 'sub1' }, global: { stubs } })
    await flushPromises()
    expect(wrapper.find('[data-testid="smap-error"]').text()).toContain('boom')
  })
})
