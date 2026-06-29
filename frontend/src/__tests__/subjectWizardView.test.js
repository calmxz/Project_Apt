import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
}))
vi.mock('@/services/subjectsApi.js', () => ({ draftPlan: vi.fn(), createSubject: vi.fn() }))

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
})
