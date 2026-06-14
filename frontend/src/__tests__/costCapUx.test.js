import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'

import { apiGet } from '@/services/apiClient.js'
import { costBus } from '@/services/costBus.js'
import { useSessionStore } from '@/stores/session.js'
import { ERR_DAILY_COST_CAP_REACHED } from '@/lib/errorCodes.js'
import SessionView from '@/views/SessionView.vue'

// ---------------------------------------------------------------------------
// apiClient: dispatches cost-warning when X-Cost-Warning header is set on a
// successful response.
// ---------------------------------------------------------------------------

describe('apiClient cost-warning bus', () => {
  let fetchMock
  let listener
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock
    listener = vi.fn()
    costBus.addEventListener('cost-warning', listener)
  })
  afterEach(() => {
    costBus.removeEventListener('cost-warning', listener)
    vi.restoreAllMocks()
  })

  function okWithHeader(body, header) {
    const headers = new Headers()
    if (header) headers.set('x-cost-warning', header)
    return Promise.resolve({
      ok: true,
      status: 200,
      headers,
      text: () => Promise.resolve(JSON.stringify(body)),
    })
  }

  it('does not fire when header absent', async () => {
    fetchMock.mockReturnValueOnce(okWithHeader({ ok: true }, null))
    await apiGet('/x')
    expect(listener).not.toHaveBeenCalled()
  })

  it('fires once with detail.header when X-Cost-Warning is present', async () => {
    fetchMock.mockReturnValueOnce(
      okWithHeader({ ok: true }, 'soft_cap_breached;used_usd=2.5;soft_cap_usd=2'),
    )
    await apiGet('/x')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].detail.header).toContain('soft_cap_breached')
  })
})

// ---------------------------------------------------------------------------
// session store: captures the cost-cap 429 envelope into costCapInfo and
// flips costCapReached.
// ---------------------------------------------------------------------------

describe('session store cost-cap envelope', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('captures cost-cap 429 into costCapInfo', async () => {
    // mock postChat to throw an ApiError-shaped object with the envelope
    vi.doMock('@/services/chatApi.js', () => ({
      postChat: vi.fn().mockRejectedValue(
        Object.assign(new Error('api'), {
          status: 429,
          body: {
            detail: {
              code: ERR_DAILY_COST_CAP_REACHED,
              used_usd: '3.5000',
              soft_cap_usd: '2.0',
              hard_cap_usd: '3.0',
              resets_at: '2026-05-24T00:00:00Z',
            },
          },
        }),
      ),
    }))
    vi.doMock('@/services/sessionsApi.js', () => ({
      listSessions: vi.fn(),
      createSession: vi.fn().mockResolvedValue({ id: 's1', topic: 't' }),
      getSession: vi.fn(),
      endSession: vi.fn(),
      reopenSession: vi.fn(),
    }))
    vi.resetModules()
    const { useSessionStore: useStore } = await import('@/stores/session.js')
    setActivePinia(createPinia())
    const s = useStore()
    await s.createSession({ topic: 't' })
    await expect(s.sendMessage({ text: 'hi' })).rejects.toThrow('api')
    expect(s.costCapReached).toBe(true)
    expect(s.costCapInfo.used_usd).toBe('3.5000')
    expect(s.costCapInfo.hard_cap_usd).toBe('3.0')
    s.clearCostCap()
    expect(s.costCapReached).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SessionView: renders the cost-cap banner when the store reports it
// reached. Composer must also be disabled.
// ---------------------------------------------------------------------------

const stubs = {
  // ChatHeader teleports to the navbar slot; stub Teleport so it renders inline.
  teleport: true,
  BackButton: { template: '<button data-testid="back" />' },
  ReferenceStatusBanner: { template: '<div />' },
  SessionEndedBanner: { template: '<div />' },
  Button: {
    props: ['disabled', 'loading', 'label'],
    template:
      '<button :disabled="disabled"><slot>{{ label }}</slot></button>',
  },
  Dialog: {
    props: ['visible'],
    template: '<div v-if="visible"><slot /><slot name="footer" /></div>',
  },
  Textarea: {
    props: ['modelValue', 'disabled'],
    template:
      '<textarea :value="modelValue" :disabled="disabled" />',
  },
  RouterLink: { template: '<a><slot /></a>' },
}

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))

vi.mock('@/services/uploadApi.js', () => ({
  uploadDocument: vi.fn().mockResolvedValue({ document_id: 1 }),
  validateFile: vi.fn(() => ({ ok: true })),
  getUploadStatus: vi.fn().mockResolvedValue({ id: 1, status: 'ready', error: null }),
  MAX_UPLOAD_BYTES: 25 * 1024 * 1024,
}))

const showError = vi.fn()
const showInfo = vi.fn()
vi.mock('@/composables/useToast.js', () => ({
  useToast: () => ({ showError, showInfo, showSuccess: vi.fn() }),
}))

describe('SessionView cost-cap UX', () => {
  let lastWrapper = null
  beforeEach(() => {
    setActivePinia(createPinia())
    showError.mockClear()
    showInfo.mockClear()
  })
  afterEach(() => {
    if (lastWrapper) {
      lastWrapper.unmount()
      lastWrapper = null
    }
  })

  function seedActive(store) {
    store.currentSession = { id: 's1', topic: 'X', ended_at: null }
    store.currentSessionId = 's1'
    store.messages = []
  }

  it('renders cost-cap banner when costCapReached', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      seedActive(store)
      store.costCapInfo = {
        used_usd: '3.50',
        soft_cap_usd: '2.00',
        hard_cap_usd: '3.00',
        resets_at: '2026-05-24T00:00:00Z',
      }
    })
    const wrapper = (lastWrapper = mount(SessionView, { props: { id: 's1' }, global: { stubs } }))
    await flushPromises()
    expect(wrapper.find('[data-testid="session-cost-cap-banner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="session-cost-cap-banner"]').text()).toContain(
      '$3.50',
    )
    expect(showError).toHaveBeenCalled()
  })

  it('shows soft-warning toast once on cost-warning event', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      seedActive(store)
    })
    lastWrapper = mount(SessionView, { props: { id: 's1' }, global: { stubs } })
    await flushPromises()
    costBus.dispatchEvent(new CustomEvent('cost-warning', { detail: { header: 'x' } }))
    costBus.dispatchEvent(new CustomEvent('cost-warning', { detail: { header: 'x' } }))
    await flushPromises()
    expect(showInfo).toHaveBeenCalledTimes(1)
  })
})
