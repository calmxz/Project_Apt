import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import CheckQuestion from '../components/chat/CheckQuestion.vue'

function batch(overrides = {}) {
  return {
    gap: 'atp',
    total: 2,
    currentIndex: 0,
    viewIndex: 0,
    items: [
      {
        question: 'Q1',
        options: ['a', 'b'],
        status: 'pending',
        selectedIndex: null,
        correctIndex: null,
        correct: null,
        explanation: null,
      },
      {
        question: 'Q2',
        options: ['a', 'b'],
        status: 'pending',
        selectedIndex: null,
        correctIndex: null,
        correct: null,
        explanation: null,
      },
    ],
    ...overrides,
  }
}

describe('CheckQuestion batch', () => {
  it('shows N of M eyebrow when total > 1', () => {
    const w = mount(CheckQuestion, { props: { check: batch() } })
    expect(w.text()).toContain('1/2')
  })

  it('emits answer with the clicked option index', async () => {
    const w = mount(CheckQuestion, { props: { check: batch() } })
    await w.findAll('[data-testid="check-option"]')[1].trigger('click')
    expect(w.emitted('answer')[0]).toEqual([1])
  })

  it('shows Next when an answered item is not the last', () => {
    const b = batch({ currentIndex: 1 })
    b.items[0] = {
      ...b.items[0],
      status: 'answered',
      selectedIndex: 0,
      correctIndex: 0,
      correct: true,
      explanation: 'a.',
    }
    const w = mount(CheckQuestion, { props: { check: b } })
    expect(w.find('[data-testid="check-next"]').exists()).toBe(true)
    expect(w.find('[data-testid="check-done"]').exists()).toBe(false)
  })

  it('shows Done on the last answered item', () => {
    const b = batch({
      total: 1,
      currentIndex: 1,
      viewIndex: 0,
      items: [
        {
          question: 'Q1',
          options: ['a', 'b'],
          status: 'answered',
          selectedIndex: 0,
          correctIndex: 0,
          correct: true,
          explanation: 'a.',
        },
      ],
    })
    const w = mount(CheckQuestion, { props: { check: b } })
    expect(w.find('[data-testid="check-done"]').exists()).toBe(true)
  })

  it('emits next / done', async () => {
    const b = batch({ currentIndex: 1 })
    b.items[0] = {
      ...b.items[0],
      status: 'answered',
      correct: true,
      correctIndex: 0,
      selectedIndex: 0,
      explanation: 'a.',
    }
    const w = mount(CheckQuestion, { props: { check: b } })
    await w.find('[data-testid="check-next"]').trigger('click')
    expect(w.emitted('next')).toBeTruthy()
  })

  // F-04: while a stream is live, Skip/Next/Done must be disabled so the
  // follow-up stream cannot be started on top of the active one.
  it('busy disables Skip and Done (F-04)', () => {
    const b = batch({
      total: 1,
      currentIndex: 1,
      viewIndex: 0,
      items: [
        {
          question: 'Q1',
          options: ['a', 'b'],
          status: 'answered',
          selectedIndex: 0,
          correctIndex: 0,
          correct: true,
          explanation: 'a.',
        },
      ],
    })
    const done = mount(CheckQuestion, { props: { check: b, busy: true } })
    expect(done.find('[data-testid="check-done"]').element.disabled).toBe(true)
    const pending = mount(CheckQuestion, { props: { check: batch(), busy: true } })
    expect(pending.find('[data-testid="check-skip"]').element.disabled).toBe(true)
  })
})

describe('CheckQuestion accessibility (D-01)', () => {
  function mountUnanswered() {
    return mount(CheckQuestion, { props: { check: batch() } })
  }

  function mountAnswered({ correct = true, explanation = 'a.' } = {}) {
    const b = batch({
      total: 1,
      currentIndex: 1,
      viewIndex: 0,
      items: [
        {
          question: 'Q1',
          options: ['a', 'b'],
          status: 'answered',
          selectedIndex: 0,
          correctIndex: correct ? 0 : 1,
          correct,
          explanation,
        },
      ],
    })
    return mount(CheckQuestion, { props: { check: b } })
  }

  it('has an empty live region before answering', () => {
    const wrapper = mountUnanswered()
    const live = wrapper.find('[data-testid="check-live"]')
    expect(live.exists()).toBe(true)
    expect(live.attributes('role')).toBe('status')
    expect(live.attributes('aria-live')).toBe('polite')
    expect(live.attributes('aria-atomic')).toBe('true')
    expect(live.text()).toBe('')
  })

  it('announces verdict and explanation after answering', () => {
    const wrapper = mountAnswered({ correct: true, explanation: 'Because X.' })
    expect(wrapper.find('[data-testid="check-live"]').text()).toContain('Correct')
    expect(wrapper.find('[data-testid="check-live"]').text()).toContain('Because X.')
  })

  it('marks answered options aria-disabled instead of disabled', () => {
    const wrapper = mountAnswered({})
    const opt = wrapper.find('[data-testid="check-option"]')
    expect(opt.attributes('disabled')).toBeUndefined()
    expect(opt.attributes('aria-disabled')).toBe('true')
  })

  it('does not emit answer from an aria-disabled option', async () => {
    const wrapper = mountAnswered({})
    await wrapper.find('[data-testid="check-option"]').trigger('click')
    expect(wrapper.emitted('answer')).toBeUndefined()
  })
})
