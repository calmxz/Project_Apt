import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import SessionView from '@/views/SessionView.vue'
import SessionHeader from '@/components/chat/SessionHeader.vue'
import SessionEndedBanner from '@/components/SessionEndedBanner.vue'
import CheckQuestion from '@/components/chat/CheckQuestion.vue'
import Composer from '@/components/chat/Composer.vue'
import { useSessionStore } from '@/stores/session.js'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const showError = vi.fn()
vi.mock('@/composables/useToast.js', () => ({
  useToast: () => ({ showError, showWarn: vi.fn(), showSuccess: vi.fn() }),
}))

const uploadDocument = vi.fn()
const validateFile = vi.fn()
const getUploadStatus = vi.fn()
const bannerRefresh = vi.fn()
vi.mock('@/services/uploadApi.js', () => ({
  uploadDocument: (...args) => uploadDocument(...args),
  validateFile: (...args) => validateFile(...args),
  getUploadStatus: (...args) => getUploadStatus(...args),
  MAX_UPLOAD_BYTES: 25 * 1024 * 1024,
}))

const stubs = {
  BackButton: { template: '<button data-testid="back" />' },
  ReferenceStatusBanner: { methods: { refresh: bannerRefresh }, template: '<div />' },
  SessionEndedBanner: {
    props: ['endedAt', 'loading'],
    emits: ['resume'],
    template:
      '<div data-testid="ended-banner"><button data-testid="resume-btn" @click="$emit(\'resume\')" /></div>',
  },
  Button: {
    props: ['disabled', 'loading', 'label'],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')"><slot>{{ label }}</slot></button>',
  },
  Dialog: {
    props: ['visible'],
    emits: ['update:visible'],
    template:
      '<div v-if="visible" data-testid="dialog"><slot /><slot name="footer" /></div>',
  },
  RouterLink: { template: '<a><slot /></a>' },
}

function setupSession({ ended = false, messages = [], dailyCap = null } = {}) {
  const store = useSessionStore()
  store.currentSession = {
    id: 's1',
    topic: 'Calculus',
    ended_at: ended ? new Date().toISOString() : null,
  }
  store.currentSessionId = 's1'
  store.messages = messages
  if (dailyCap) store.dailyCapInfo = dailyCap
  return store
}

function mountView(props = { id: 's1' }) {
  return mount(SessionView, { props, global: { stubs } })
}

describe('SessionView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    push.mockClear()
    showError.mockClear()
    uploadDocument.mockReset()
    bannerRefresh.mockReset()
    validateFile.mockReset()
    getUploadStatus.mockReset()
  })

  it('renders 404 state when loadSession 404s', async () => {
    const store = useSessionStore()
    const err = Object.assign(new Error('not found'), { status: 404 })
    vi.spyOn(store, 'loadSession').mockRejectedValue(err)
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="session-not-found"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="session-input"]').exists()).toBe(false)
  })

  it('renders chat ui when session loads', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('Calculus')
    expect(wrapper.find('[data-testid="session-input"]').exists()).toBe(true)
    // Header renders inline (no teleport); topic comes from props
    const header = wrapper.findComponent(SessionHeader)
    expect(header.exists()).toBe(true)
    expect(header.props('topic')).toBe('Calculus')
    expect(wrapper.find('[data-testid="session-header"]').exists()).toBe(true)
  })

  it('reloads when the route id prop changes without a remount', async () => {
    const store = useSessionStore()
    const load = vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const wrapper = mountView({ id: 's1' })
    await flushPromises()
    expect(load).toHaveBeenCalledWith('s1')

    load.mockClear()
    await wrapper.setProps({ id: 's2' })
    await flushPromises()
    expect(load).toHaveBeenCalledWith('s2')
  })

  it('clears a prior 404 state when navigating to a valid session', async () => {
    const store = useSessionStore()
    const err = Object.assign(new Error('not found'), { status: 404 })
    const load = vi
      .spyOn(store, 'loadSession')
      .mockRejectedValueOnce(err)
      .mockImplementationOnce(async () => {
        setupSession()
      })
    const wrapper = mountView({ id: 'gone' })
    await flushPromises()
    expect(wrapper.find('[data-testid="session-not-found"]').exists()).toBe(true)

    await wrapper.setProps({ id: 's1' })
    await flushPromises()
    expect(load).toHaveBeenLastCalledWith('s1')
    expect(wrapper.find('[data-testid="session-not-found"]').exists()).toBe(false)
  })

  it('does not flash 404 when a superseded load 404s after navigating away', async () => {
    const store = useSessionStore()
    let rejectGone
    vi.spyOn(store, 'loadSession').mockImplementation((id) => {
      if (id === 'gone') {
        return new Promise((_res, rej) => {
          rejectGone = () => rej(Object.assign(new Error('not found'), { status: 404 }))
        })
      }
      store.currentSession = { id, topic: 'Calculus', ended_at: null }
      store.currentSessionId = id
      store.messages = []
      return Promise.resolve()
    })
    const wrapper = mountView({ id: 'gone' })
    await flushPromises() // first load pending (never resolved yet)

    await wrapper.setProps({ id: 's1' }) // navigate away before 'gone' settles
    await flushPromises()

    rejectGone() // the superseded 'gone' load 404s late
    await flushPromises()

    expect(wrapper.find('[data-testid="session-not-found"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="session-header"]').exists()).toBe(true)
  })

  it('paints the optimistic header topic from the known list row while detail loads', async () => {
    const store = useSessionStore()
    // Hold the loading snapshot: loadSession never resolves.
    vi.spyOn(store, 'loadSession').mockImplementation(() => new Promise(() => {}))
    store.sessions = [{ id: 's2', topic: 'Thermodynamics' }]
    store.detailLoading = true
    const wrapper = mountView({ id: 's2' })
    await flushPromises()
    expect(wrapper.findComponent(SessionHeader).props('topic')).toBe('Thermodynamics')
  })

  it('shows the message skeleton while detailLoading and hides empty-state + stale check card', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(() => new Promise(() => {}))
    store.detailLoading = true
    // Seed a pending check from the PREVIOUS session: it must NOT show over the
    // skeleton during a switch (it isn't overwritten until the await resolves).
    store.pendingCheck = { gap: 'g', total: 1, currentIndex: 0, viewIndex: 0, items: [] }
    const wrapper = mountView({ id: 's1' })
    await flushPromises()
    expect(wrapper.find('[data-testid="session-messages-skeleton"]').exists()).toBe(true)
    // ChatEmptyState (and its quick prompts) must not render behind the skeleton.
    expect(wrapper.find('[data-testid="quick-prompt-0"]').exists()).toBe(false)
    // The old session's CheckQuestion must not leak over the skeleton.
    expect(wrapper.findComponent(CheckQuestion).exists()).toBe(false)
  })

  it('swaps skeleton for messages and shows the real topic once detail resolves', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(() => new Promise(() => {}))
    store.detailLoading = true
    const wrapper = mountView({ id: 's1' })
    await flushPromises()
    expect(wrapper.find('[data-testid="session-messages-skeleton"]').exists()).toBe(true)
    // Flip state the way the real loadSession would on resolve.
    store.detailLoading = false
    store.currentSession = { id: 's1', topic: 'Calculus', ended_at: null }
    store.currentSessionId = 's1'
    store.messages = [{ role: 'assistant', content: 'hi', message_id: 'm1', citations: [] }]
    await nextTick()
    expect(wrapper.find('[data-testid="session-messages-skeleton"]').exists()).toBe(false)
    expect(wrapper.findComponent(SessionHeader).props('topic')).toBe('Calculus')
  })

  it('prefers the target list row topic over a stale previous session during load', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(() => new Promise(() => {}))
    // Previous session still in currentSession; we are navigating to s2.
    store.currentSession = { id: 's1', topic: 'Old Topic', ended_at: null }
    store.sessions = [{ id: 's2', topic: 'Thermodynamics' }]
    store.detailLoading = true
    const wrapper = mountView({ id: 's2' })
    await flushPromises()
    expect(wrapper.findComponent(SessionHeader).props('topic')).toBe('Thermodynamics')
  })

  it('hides the previous ended-session banner while loading a different session', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(() => new Promise(() => {}))
    // Previous session is ENDED; we navigate to a different, still-loading session.
    store.currentSession = { id: 's1', topic: 'Old', ended_at: '2026-01-01T00:00:00Z' }
    store.sessions = [{ id: 's2', topic: 'New' }]
    store.detailLoading = true
    const wrapper = mountView({ id: 's2' })
    await flushPromises()
    expect(wrapper.findComponent(SessionEndedBanner).exists()).toBe(false)
  })

  it('send dispatches sendMessage and clears draft', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const sendSpy = vi.spyOn(store, 'sendMessage').mockResolvedValue()
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="session-input"]').setValue('hello')
    await wrapper.get('[data-testid="session-send"]').trigger('click')
    await flushPromises()
    expect(sendSpy).toHaveBeenCalledWith({ text: 'hello' })
    expect(wrapper.get('[data-testid="session-input"]').element.value).toBe('')
  })

  it('send error restores draft and shows error banner', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    vi.spyOn(store, 'sendMessage').mockRejectedValue(
      Object.assign(new Error('network down'), { status: 500 }),
    )
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="session-input"]').setValue('hello')
    await wrapper.get('[data-testid="session-send"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="session-input"]').element.value).toBe('hello')
    expect(wrapper.find('[data-testid="session-error"]').exists()).toBe(true)
  })

  it('retry button resends last message', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const sendSpy = vi
      .spyOn(store, 'sendMessage')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce()
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="session-input"]').setValue('retry me')
    await wrapper.get('[data-testid="session-send"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="session-error-retry"]').trigger('click')
    await flushPromises()
    expect(sendSpy).toHaveBeenCalledTimes(2)
    expect(sendSpy.mock.calls[1][0]).toEqual({ text: 'retry me' })
  })

  it('enter key sends without shift', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const sendSpy = vi.spyOn(store, 'sendMessage').mockResolvedValue()
    const wrapper = mountView()
    await flushPromises()
    const input = wrapper.get('[data-testid="session-input"]')
    await input.setValue('via enter')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(sendSpy).toHaveBeenCalledWith({ text: 'via enter' })
  })

  it('shift+enter does not send', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const sendSpy = vi.spyOn(store, 'sendMessage').mockResolvedValue()
    const wrapper = mountView()
    await flushPromises()
    const input = wrapper.get('[data-testid="session-input"]')
    await input.setValue('multi\nline')
    await input.trigger('keydown', { key: 'Enter', shiftKey: true })
    await flushPromises()
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('quick prompt fills draft when no messages', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const sendSpy = vi.spyOn(store, 'sendMessage').mockResolvedValue()
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="quick-prompt-0"]').trigger('click')
    expect(wrapper.get('[data-testid="session-input"]').element.value).toBe(
      'Where should I start with this topic?',
    )
    // Quick prompts fill the composer; they must not auto-send.
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('ended session hides composer and shows banner', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession({ ended: true })
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="ended-banner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="session-input"]').exists()).toBe(false)
  })

  it('opens summary dialog when store.pendingSummary targets this session', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const wrapper = mountView()
    await flushPromises()
    // Simulate the End trigger originating from the sidebar row menu —
    // it lands in pendingSummary and SessionView consumes it.
    store.pendingSummary = {
      sessionId: 's1',
      kind: 'summary',
      text: 'Great progress on derivatives.',
    }
    await flushPromises()
    expect(wrapper.get('[data-testid="session-summary-summary"]').text()).toContain(
      'Great progress on derivatives.',
    )
    expect(store.pendingSummary).toBe(null)
  })

  it('ignores pendingSummary targeting a different session', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const wrapper = mountView()
    await flushPromises()
    store.pendingSummary = { sessionId: 'other', kind: 'summary', text: 'x' }
    await flushPromises()
    expect(wrapper.find('[data-testid="session-summary-summary"]').exists()).toBe(false)
    expect(store.pendingSummary).not.toBe(null)
  })

  it('summary close routes home', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const wrapper = mountView()
    await flushPromises()
    store.pendingSummary = { sessionId: 's1', kind: 'summary', text: 'done' }
    await flushPromises()
    await wrapper.get('[data-testid="session-summary-close"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ name: 'home' })
  })

  it('resume click invokes store.reopenSession', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession({ ended: true })
    })
    const reopenSpy = vi.spyOn(store, 'reopenSession').mockResolvedValue()
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="resume-btn"]').trigger('click')
    await flushPromises()
    expect(reopenSpy).toHaveBeenCalledWith('s1')
  })

  it('daily cap banner shown when cap reached', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession({
        dailyCap: { used: 10, cap: 10, resets_at: '2026-05-24T00:00:00Z' },
      })
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="session-cap-banner"]').exists()).toBe(true)
    expect(showError).toHaveBeenCalled()
  })

  it('upload triggers uploadDocument and polls status', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    validateFile.mockReturnValue({ ok: true })
    uploadDocument.mockResolvedValue({ document_id: 'doc-1' })
    getUploadStatus.mockResolvedValue({ status: 'ready' })
    const wrapper = mountView()
    await flushPromises()
    const file = new File(['pdf-bytes'], 'notes.pdf', { type: 'application/pdf' })
    const input = wrapper.get('[data-testid="session-upload-input"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()
    await flushPromises()
    expect(uploadDocument).toHaveBeenCalledWith({ sessionId: 's1', file })
    expect(getUploadStatus).toHaveBeenCalledWith('doc-1')
    expect(wrapper.find('[data-testid="upload-status-ready"]').exists()).toBe(true)
    // Banner is refreshed so the newly uploaded doc's ingestion status appears.
    expect(bannerRefresh).toHaveBeenCalled()
  })

  it('rejects an oversize file client-side without uploading (H5)', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const wrapper = mountView()
    await flushPromises()
    const file = new File(['x'], 'huge.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'size', { value: 25 * 1024 * 1024 + 1 })
    validateFile.mockReturnValue({ ok: false, reason: 'huge.pdf is too large (max 25 MB).' })
    const input = wrapper.get('[data-testid="session-upload-input"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()
    expect(uploadDocument).not.toHaveBeenCalled()
    const failed = wrapper.find('[data-testid="upload-status-failed"]')
    expect(failed.exists()).toBe(true)
    expect(failed.text()).toContain('too large')
  })

  it('rejects an unsupported file type client-side without uploading (H5)', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const wrapper = mountView()
    await flushPromises()
    // .exe is not in the accepted set (PDF/PPTX/TXT/MD); validateFile returns not-ok.
    const file = new File(['x'], 'malware.exe', { type: 'application/octet-stream' })
    validateFile.mockReturnValue({ ok: false, reason: 'malware.exe is not a supported type. Use PDF, PPTX, TXT, or MD.' })
    const input = wrapper.get('[data-testid="session-upload-input"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()
    expect(uploadDocument).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="upload-status-failed"]').exists()).toBe(true)
  })

  it('describes the disabled composer with the cap banner via aria-describedby (WCAG 4.1.2)', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession({ dailyCap: { used: 10, cap: 10, resets_at: '2026-05-24T00:00:00Z' } })
    })
    const wrapper = mountView()
    await flushPromises()
    const textarea = wrapper.get('[data-testid="session-input"]')
    expect(textarea.attributes('aria-describedby')).toContain('cap-banner-daily')
    expect(wrapper.find('#cap-banner-daily').exists()).toBe(true)
  })

  it('logs a dev-only navigate->painted timing after detail resolves', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => { setupSession() })
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    mountView()
    await flushPromises()
    await nextTick()
    const logged = debugSpy.mock.calls.some((c) => String(c[0]).includes('[perf] session'))
    expect(logged).toBe(true)
    debugSpy.mockRestore()
  })

  it('disables the composer during a switch when currentSession still lags props.id', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(() => new Promise(() => {}))
    // currentSession still belongs to the PREVIOUS session (open), we navigate to s2.
    store.currentSession = { id: 's1', topic: 'Old', ended_at: null }
    store.currentSessionId = 's1'
    store.detailLoading = true
    store.sessions = [{ id: 's2', topic: 'New' }]
    const wrapper = mountView({ id: 's2' })
    await flushPromises()
    const composer = wrapper.findComponent(Composer)
    // Composer renders (isEnded is false via discriminator) but must be disabled
    // (canSend false because canEnd's discriminator fails id match).
    expect(composer.exists()).toBe(true)
    expect(composer.props('disabled')).toBe(true)
  })

  it('renders streaming bubble when store.streamingMessage is set', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const wrapper = mountView()
    await flushPromises()
    store.streamingMessage = { role: 'assistant', content: 'streaming text', tool_calls: [], citations: [] }
    await nextTick()
    const bubble = wrapper.find('[data-testid="msg-streaming"]')
    expect(bubble.exists()).toBe(true)
    expect(bubble.text()).toContain('streaming text')
  })
})
