import { describe, it, expect, beforeEach, vi } from 'vitest'

const STORAGE_KEY = 'adaptlearn:theme:v1'

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    vi.resetModules()
  })

  it('defaults to auto when nothing stored', async () => {
    const { useTheme } = await import('@/composables/useTheme.js')
    const { override } = useTheme()
    expect(override.value).toBe('auto')
  })

  it('loads valid stored value', async () => {
    localStorage.setItem(STORAGE_KEY, 'dark')
    const { useTheme } = await import('@/composables/useTheme.js')
    const { override } = useTheme()
    expect(override.value).toBe('dark')
  })

  it('rejects invalid stored value', async () => {
    localStorage.setItem(STORAGE_KEY, 'pink')
    const { useTheme } = await import('@/composables/useTheme.js')
    const { override } = useTheme()
    expect(override.value).toBe('auto')
  })

  it('setTheme persists and applies data-theme attribute', async () => {
    const { useTheme } = await import('@/composables/useTheme.js')
    const { setTheme, resolved } = useTheme()
    setTheme('light')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(resolved.value).toBe('light')
  })

  it('setTheme ignores invalid values', async () => {
    const { useTheme } = await import('@/composables/useTheme.js')
    const { setTheme, override } = useTheme()
    setTheme('rainbow')
    expect(override.value).toBe('auto')
  })

  it('setTheme to auto removes data-theme attribute', async () => {
    const { useTheme } = await import('@/composables/useTheme.js')
    const { setTheme } = useTheme()
    setTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    setTheme('auto')
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
  })

  it('toggle flips dark<->light', async () => {
    const { useTheme } = await import('@/composables/useTheme.js')
    const { setTheme, toggle, resolved } = useTheme()
    setTheme('dark')
    toggle()
    expect(resolved.value).toBe('light')
    toggle()
    expect(resolved.value).toBe('dark')
  })

  it('isDark reflects resolved', async () => {
    const { useTheme } = await import('@/composables/useTheme.js')
    const { setTheme, isDark } = useTheme()
    setTheme('dark')
    expect(isDark.value).toBe(true)
    setTheme('light')
    expect(isDark.value).toBe(false)
  })

  it('init reads matchMedia and applies attribute', async () => {
    const listeners = {}
    window.matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: (ev, cb) => {
        listeners[ev] = cb
      },
      removeEventListener: vi.fn(),
    }))
    const { useTheme } = await import('@/composables/useTheme.js')
    const { init, resolved } = useTheme()
    init()
    expect(resolved.value).toBe('dark')

    listeners.change?.({ matches: false })
    expect(resolved.value).toBe('light')
  })

  it('init falls back to addListener when addEventListener missing', async () => {
    const addListener = vi.fn()
    window.matchMedia = vi.fn(() => ({
      matches: false,
      addListener,
    }))
    const { useTheme } = await import('@/composables/useTheme.js')
    const { init } = useTheme()
    init()
    expect(addListener).toHaveBeenCalled()
  })
})
