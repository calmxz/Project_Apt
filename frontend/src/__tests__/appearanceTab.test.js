import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const toggle = vi.fn()
vi.mock('../composables/useTheme.js', () => ({
  useTheme: () => ({ isDark: { value: false }, toggle }),
}))

import AppearanceTab from '../components/settings/AppearanceTab.vue'

describe('AppearanceTab', () => {
  it('renders the dark mode switch with its testids', () => {
    const w = mount(AppearanceTab)
    expect(w.find('[data-testid="settings-appearance"]').exists()).toBe(true)
    expect(w.find('[data-testid="settings-theme-toggle"]').exists()).toBe(true)
  })

  it('clicking the switch calls theme toggle', async () => {
    const w = mount(AppearanceTab)
    await w.find('[data-testid="settings-theme-toggle"]').trigger('click')
    expect(toggle).toHaveBeenCalled()
  })
})
