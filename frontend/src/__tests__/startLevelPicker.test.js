import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

import StartLevelPicker from '@/components/start/StartLevelPicker.vue'

describe('StartLevelPicker', () => {
  it('emits select with level', async () => {
    const w = mount(StartLevelPicker)
    await w.get('[data-testid="start-level-advanced"]').trigger('click')
    expect(w.emitted('select')).toEqual([['advanced']])
  })

  it('emits quiz and skip', async () => {
    const w = mount(StartLevelPicker)
    await w.get('[data-testid="start-level-quiz"]').trigger('click')
    await w.get('[data-testid="start-level-skip"]').trigger('click')
    expect(w.emitted('quiz')).toHaveLength(1)
    expect(w.emitted('skip')).toHaveLength(1)
  })

  it('disables all buttons when busy', () => {
    const w = mount(StartLevelPicker, { props: { busy: true } })
    for (const b of w.findAll('button')) {
      expect(b.attributes('disabled')).toBeDefined()
    }
  })

  it('has a group label for a11y', () => {
    const w = mount(StartLevelPicker)
    expect(w.get('[role="group"]').attributes('aria-label')).toBeTruthy()
  })
})
