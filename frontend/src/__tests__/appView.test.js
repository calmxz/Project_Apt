import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const showError = vi.fn()
vi.mock('@/composables/useToast.js', () => ({
  useToast: () => ({ showError, showWarn: vi.fn(), showSuccess: vi.fn() }),
}))
const routerPush = vi.fn()
vi.mock('vue-router', () => ({
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
  RouterView: { template: '<div />' },
  useRouter: () => ({ push: routerPush }),
  useRoute: () => ({ fullPath: '/', params: {} }),
}))
vi.mock('primevue/toast', () => ({
  default: { template: '<div data-testid="toast" />' },
}))

import App from '@/App.vue'
import { reportApiError } from '@/services/errorBus.js'

describe('App.vue error listener', () => {
  let wrapper
  beforeEach(() => {
    setActivePinia(createPinia())
    showError.mockClear()
    routerPush.mockClear()
    wrapper = mount(App)
  })
  afterEach(() => wrapper.unmount())

  // F-51: raw backend detail strings (internal error codes, stack fragments)
  // must never reach the toast -- friendlyError() maps by status instead.
  it('shows a friendly toast for a generic API error, not the raw detail', async () => {
    reportApiError({ status: 500, body: { detail: 'raw_internal_code' } })
    await flushPromises()
    expect(showError).toHaveBeenCalledWith('Something went wrong on our side. Try again shortly.')
  })

  it('maps a 503 to the tutor-unavailable message regardless of err.message', async () => {
    reportApiError({ status: 503, message: 'gateway' })
    await flushPromises()
    expect(showError).toHaveBeenCalledWith(
      'The tutor is temporarily unavailable. Try again in a moment.',
    )
  })

  it('maps a bare 500 (no body, no message) to the same friendly copy', async () => {
    reportApiError({ status: 500 })
    await flushPromises()
    expect(showError).toHaveBeenCalledWith('Something went wrong on our side. Try again shortly.')
  })

  it('skips 429 (daily-cap has dedicated UI)', async () => {
    reportApiError({ status: 429, body: { detail: 'cap' } })
    await flushPromises()
    expect(showError).not.toHaveBeenCalled()
  })

  it('skips 404 (inline-handled by consumers)', async () => {
    reportApiError({ status: 404, body: { detail: 'gone' } })
    await flushPromises()
    expect(showError).not.toHaveBeenCalled()
  })

  it('unmount removes the listener', async () => {
    wrapper.unmount()
    reportApiError({ status: 500, body: { detail: 'boom' } })
    await flushPromises()
    expect(showError).not.toHaveBeenCalled()
  })

  it('maps a non-string body.detail to friendly copy instead of stringifying it', async () => {
    reportApiError({ status: 500, body: { detail: { code: 'x' } } })
    await flushPromises()
    expect(showError).toHaveBeenCalledWith('Something went wrong on our side. Try again shortly.')
  })
})

/* global process */
// Source-text assertions: what is under test is the CSS the SFC ships, and
// jsdom neither applies stylesheets nor runs animations, so mounting cannot
// see it. Same file-read approach as tokenContrast.test.js.
const readSrc = (p) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('P2: sidebar collapse is not a layout animation', () => {
  const appSrc = readSrc('src/App.vue')
  const sidebarSrc = readSrc('src/components/sidebar/Sidebar.vue')

  // Animating grid-template-columns relayouts the whole shell every frame
  // (ruled ground + session list). The column must snap.
  it('App.vue never transitions grid-template-columns', () => {
    const transitions = appSrc.match(/transition:[^;}]*/g) || []
    for (const decl of transitions) {
      expect(decl).not.toMatch(/grid-template-columns/)
      expect(decl).not.toMatch(/\ball\b/)
    }
  })

  it('App.vue .shell declares no transition at all', () => {
    const shellRule = appSrc.slice(appSrc.indexOf('.shell {'))
    const body = shellRule.slice(0, shellRule.indexOf('}'))
    expect(body).toContain('grid-template-columns')
    expect(body).not.toContain('transition')
  })

  // The softening moved to the sidebar's own ink: its contents fade in
  // whenever the mode flips, per DESIGN.md ("motion is opacity ... nothing
  // slides").
  it('Sidebar.vue fades its contents in on a mode change, in opacity only', () => {
    expect(sidebarSrc).toMatch(/@keyframes sb-mode-fade\s*\{[^}]*opacity:\s*0/)
    expect(sidebarSrc).toMatch(/animation:\s*sb-mode-fade var\(--motion-fast\)/)
    expect(sidebarSrc).not.toMatch(/will-change/)
  })

  it('Sidebar.vue disables the mode fade under reduced motion', () => {
    const rm = sidebarSrc.slice(sidebarSrc.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    expect(rm).toMatch(/sb-mode-fade|sidebar--expanded|sidebar--collapsed/)
    expect(rm).toMatch(/animation:\s*none/)
  })
})
