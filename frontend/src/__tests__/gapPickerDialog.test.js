import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import GapPickerDialog from '@/components/GapPickerDialog.vue'

const GAPS = ['recursion', 'closures', 'hoisting']

function mountPicker(props = {}) {
  return mount(GapPickerDialog, {
    props: { visible: true, gaps: GAPS, ...props },
    global: {
      stubs: {
        teleport: true,
        Dialog: {
          props: ['visible'],
          emits: ['update:visible'],
          template: '<div v-if="visible" data-testid="dialog"><slot /></div>',
        },
      },
    },
  })
}

describe('GapPickerDialog', () => {
  it('renders one option per gap with testids', () => {
    const w = mountPicker()
    GAPS.forEach((g, i) => {
      const btn = w.find(`[data-testid="gap-picker-option-${i}"]`)
      expect(btn.exists()).toBe(true)
      expect(btn.text()).toContain(g)
    })
  })

  it('emits select with the clicked gap and closes', async () => {
    const w = mountPicker()
    await w.find('[data-testid="gap-picker-option-1"]').trigger('click')
    expect(w.emitted('select')[0]).toEqual(['closures'])
    expect(w.emitted('update:visible')[0]).toEqual([false])
  })
})
