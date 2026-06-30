import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AddLessonSuggestion from '@/components/session/AddLessonSuggestion.vue'

const suggestion = {
  subject_id: 'sub1',
  lesson_id: 'l0',
  gap: 'alkanes',
  suggested_title: 'alkanes practice',
  suggested_goal: 'Extra practice on alkanes.',
}

describe('AddLessonSuggestion', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('renders the gap and suggested title', () => {
    const wrapper = mount(AddLessonSuggestion, { props: { suggestion } })
    const text = wrapper.text()
    expect(text).toContain('alkanes')
    expect(wrapper.find('[data-testid="suggest-add"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="suggest-dismiss"]').exists()).toBe(true)
  })

  it('emits add with the suggestion on Add click', async () => {
    const wrapper = mount(AddLessonSuggestion, { props: { suggestion } })
    await wrapper.find('[data-testid="suggest-add"]').trigger('click')
    expect(wrapper.emitted('add')[0][0]).toEqual(suggestion)
  })

  it('emits dismiss on No thanks click', async () => {
    const wrapper = mount(AddLessonSuggestion, { props: { suggestion } })
    await wrapper.find('[data-testid="suggest-dismiss"]').trigger('click')
    expect(wrapper.emitted('dismiss')).toBeTruthy()
  })
})
