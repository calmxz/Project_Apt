import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

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
    expect(showError).toHaveBeenCalledWith(
      'Something went wrong on our side. Try again shortly.',
    )
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
    expect(showError).toHaveBeenCalledWith(
      'Something went wrong on our side. Try again shortly.',
    )
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
    expect(showError).toHaveBeenCalledWith(
      'Something went wrong on our side. Try again shortly.',
    )
  })
})
