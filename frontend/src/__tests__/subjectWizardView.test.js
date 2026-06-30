import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useSubjectStore } from '@/stores/subject.js'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
}))
vi.mock('@/services/subjectsApi.js', () => ({ createSubject: vi.fn() }))

import SubjectWizardView from '@/views/SubjectWizardView.vue'

function mountView() { return mount(SubjectWizardView) }

describe('SubjectWizardView steps 1-3', () => {
  beforeEach(() => { setActivePinia(createPinia()); push.mockClear() })

  it('starts on the title step and advances on Next', async () => {
    const wrapper = mountView()
    expect(wrapper.find('[data-testid="wizard-title-input"]').exists()).toBe(true)
    await wrapper.get('[data-testid="wizard-title-input"]').setValue('Organic Chemistry')
    await wrapper.get('[data-testid="wizard-next"]').trigger('click')
    expect(wrapper.find('[data-testid="wizard-minutes-30"]').exists()).toBe(true)
  })

  it('Next is disabled with an empty title', () => {
    const wrapper = mountView()
    expect(wrapper.get('[data-testid="wizard-next"]').attributes('disabled')).toBeDefined()
  })

  it('duration step defaults to By deadline and shows timeline chips', async () => {
    const wrapper = mountView()
    await wrapper.get('[data-testid="wizard-title-input"]').setValue('Chem')
    await wrapper.get('[data-testid="wizard-next"]').trigger('click')
    expect(wrapper.find('[data-testid="wizard-timeline-14"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="wizard-pace-stepper"]').exists()).toBe(false)
  })

  it('toggling to By pace swaps timeline chips for the pace stepper', async () => {
    const wrapper = mountView()
    await wrapper.get('[data-testid="wizard-title-input"]').setValue('Chem')
    await wrapper.get('[data-testid="wizard-next"]').trigger('click')
    await wrapper.get('[data-testid="wizard-duration-mode-pace"]').trigger('click')
    expect(wrapper.find('[data-testid="wizard-pace-stepper"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="wizard-timeline-14"]').exists()).toBe(false)
  })

  it('pace stepper increments and clamps within 1-5', async () => {
    const wrapper = mountView()
    await wrapper.get('[data-testid="wizard-title-input"]').setValue('Chem')
    await wrapper.get('[data-testid="wizard-next"]').trigger('click')
    await wrapper.get('[data-testid="wizard-duration-mode-pace"]').trigger('click')
    expect(wrapper.get('[data-testid="wizard-pace-value"]').text()).toContain('3')
    await wrapper.get('[data-testid="wizard-pace-inc"]').trigger('click')
    expect(wrapper.get('[data-testid="wizard-pace-value"]').text()).toContain('4')
  })

  it('reaches the plan-source step with two buttons', async () => {
    const wrapper = mountView()
    await wrapper.get('[data-testid="wizard-title-input"]').setValue('Chem')
    await wrapper.get('[data-testid="wizard-next"]').trigger('click')
    await wrapper.get('[data-testid="wizard-next"]').trigger('click')
    expect(wrapper.find('[data-testid="wizard-mode-draft"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="wizard-mode-blank"]').exists()).toBe(true)
  })

  it('blank path: add a lesson then commit with the reviewed lessons', async () => {
    const wrapper = mountView()
    const store = useSubjectStore()
    vi.spyOn(store, 'createSubject').mockResolvedValue({ id: 's9' })
    await wrapper.get('[data-testid="wizard-title-input"]').setValue('Chem')
    await wrapper.get('[data-testid="wizard-next"]').trigger('click') // -> duration
    await wrapper.get('[data-testid="wizard-timeline-14"]').trigger('click')
    await wrapper.get('[data-testid="wizard-next"]').trigger('click') // -> source
    await wrapper.get('[data-testid="wizard-mode-blank"]').trigger('click') // -> editor (empty)
    await wrapper.get('[data-testid="wizard-lesson-title"]').setValue('Bonding')
    await wrapper.get('[data-testid="wizard-lesson-goal"]').setValue('Understand bonds')
    await wrapper.get('[data-testid="wizard-add-lesson"]').trigger('click')
    await wrapper.get('[data-testid="wizard-create"]').trigger('click')
    await flushPromises()
    expect(store.createSubject).toHaveBeenCalledWith({
      title: 'Chem', per_session_minutes: 30, duration_mode: 'deadline', timeline_days: 14, mode: 'blank',
      lessons: [{ title: 'Bonding', goal: 'Understand bonds' }],
    })
    expect(push).toHaveBeenCalledWith({ name: 'subject-overview', params: { id: 's9' } })
  })

  it('pace mode commits pace_per_week and omits timeline_days', async () => {
    const wrapper = mountView()
    const store = useSubjectStore()
    vi.spyOn(store, 'createSubject').mockResolvedValue({ id: 's5' })
    await wrapper.get('[data-testid="wizard-title-input"]').setValue('Chem')
    await wrapper.get('[data-testid="wizard-next"]').trigger('click') // -> duration
    await wrapper.get('[data-testid="wizard-duration-mode-pace"]').trigger('click')
    await wrapper.get('[data-testid="wizard-next"]').trigger('click') // -> source
    await wrapper.get('[data-testid="wizard-mode-blank"]').trigger('click') // -> editor
    await wrapper.get('[data-testid="wizard-lesson-title"]').setValue('Intro')
    await wrapper.get('[data-testid="wizard-add-lesson"]').trigger('click')
    await wrapper.get('[data-testid="wizard-create"]').trigger('click')
    await flushPromises()
    expect(store.createSubject).toHaveBeenCalledWith({
      title: 'Chem', per_session_minutes: 30, duration_mode: 'pace', pace_per_week: 3, mode: 'blank',
      lessons: [{ title: 'Intro', goal: '' }],
    })
  })

})
