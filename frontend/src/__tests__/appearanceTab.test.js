import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// The tab now writes the theme directly (light / dark / system) instead of
// flipping a single switch, so the composable is mocked on `override` +
// `setTheme` rather than `isDark` + `toggle`.
const setTheme = vi.fn()
vi.mock('../composables/useTheme.js', async () => {
  const { ref } = await import('vue')
  const override = ref('auto')
  return { useTheme: () => ({ override, setTheme }) }
})

import AppearanceTab from '../components/settings/AppearanceTab.vue'

describe('AppearanceTab', () => {
  it('renders the theme swatches with their testids', () => {
    const w = mount(AppearanceTab)
    expect(w.find('[data-testid="settings-appearance"]').exists()).toBe(true)
    expect(w.find('[data-testid="settings-theme-toggle"]').exists()).toBe(true)
    for (const mode of ['light', 'dark', 'auto']) {
      expect(w.find(`[data-testid="settings-theme-${mode}"]`).exists()).toBe(true)
    }
  })

  it('labels the two lamp swatches and the system option', () => {
    const w = mount(AppearanceTab)
    const text = w.text()
    expect(text).toContain('Lamp on')
    expect(text).toContain('Lamp off')
    expect(text).toContain('Match system')
  })

  it('marks the stored override as checked', () => {
    const w = mount(AppearanceTab)
    expect(w.get('[data-testid="settings-theme-auto"]').element.checked).toBe(true)
    expect(w.get('[data-testid="settings-theme-dark"]').element.checked).toBe(false)
  })

  it('choosing a swatch writes that theme', async () => {
    const w = mount(AppearanceTab)
    setTheme.mockClear()
    await w.get('[data-testid="settings-theme-dark"]').setValue(true)
    expect(setTheme).toHaveBeenCalledWith('dark')
  })
})
