import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('vue-router', () => ({ RouterLink: { props: ['to'], template: '<a><slot /></a>' } }))
import LessonContextBar from '@/components/chat/LessonContextBar.vue'
import MarkDoneConfirm from '@/components/chat/MarkDoneConfirm.vue'

describe('LessonContextBar', () => {
  it('renders the lesson goal and a back-link to the subject overview', () => {
    const wrapper = mount(LessonContextBar, { props: { goal: 'Understand bonding', subjectId: 's1' } })
    expect(wrapper.get('[data-testid="session-lesson-goal"]').text()).toContain('Understand bonding')
    expect(wrapper.get('[data-testid="session-lesson-back"]')).toBeTruthy()
  })

  it('renders nothing when there is no goal', () => {
    const wrapper = mount(LessonContextBar, { props: { goal: '', subjectId: 's1' } })
    expect(wrapper.find('[data-testid="session-lesson-goal"]').exists()).toBe(false)
  })
})

describe('MarkDoneConfirm', () => {
  it('emits confirm on Yes and dismiss on Keep going', async () => {
    const wrapper = mount(MarkDoneConfirm, { props: { lessonTitle: 'Reactions' } })
    expect(wrapper.get('[data-testid="session-markdone"]').text()).toContain('Reactions')
    await wrapper.get('[data-testid="session-markdone-yes"]').trigger('click')
    expect(wrapper.emitted('confirm')).toBeTruthy()
    await wrapper.get('[data-testid="session-markdone-keep"]').trigger('click')
    expect(wrapper.emitted('dismiss')).toBeTruthy()
  })
})
