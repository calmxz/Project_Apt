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

  it('shows toast for generic API error', async () => {
    reportApiError({ status: 500, body: { detail: 'boom' } })
    await flushPromises()
    expect(showError).toHaveBeenCalledWith('boom')
  })

  it('falls back to error.message when no body.detail', async () => {
    reportApiError({ status: 503, message: 'gateway' })
    await flushPromises()
    expect(showError).toHaveBeenCalledWith('gateway')
  })

  it('falls back to "Request failed" when body and message are empty', async () => {
    reportApiError({ status: 500 })
    await flushPromises()
    expect(showError).toHaveBeenCalledWith('Request failed')
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

  it('stringifies non-string body.detail', async () => {
    reportApiError({ status: 500, body: { detail: { code: 'x' } } })
    await flushPromises()
    expect(showError).toHaveBeenCalledWith(JSON.stringify({ code: 'x' }))
  })
})
