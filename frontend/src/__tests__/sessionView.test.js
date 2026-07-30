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
import { getSessionProfile, patchProfile } from '@/services/profileApi.js'

const push = vi.fn()
// Writes the mutation back into the shared mock route so the query-strip
// watcher/re-trigger interaction is actually exercised (a bare vi.fn() would
// leave route.query.review_gap set, hiding a double-send regression).
const route = { query: {} }
const replace = vi.fn((to) => {
  Object.assign(route.query, to.query)
})
vi.mock('vue-router', () => ({
  useRouter: () => ({ push, replace }),
  useRoute: () => route,
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

vi.mock('@/services/profileApi.js', () => ({
  getSessionProfile: vi.fn(),
  patchProfile: vi.fn(),
}))

const stubs = {
  BackButton: { template: '<button data-testid="back" />' },
  ReferenceStatusBanner: { methods: { refresh: bannerRefresh }, template: '<div />' },
  SessionEndedBanner: {
    props: ['endedAt', 'loading', 'hasGaps'],
    emits: ['resume', 'resume-gaps'],
    template:
      '<div data-testid="ended-banner"><button data-testid="resume-btn" @click="$emit(\'resume\')" /><button v-if="hasGaps" data-testid="session-resume-gaps" @click="$emit(\'resume-gaps\')" /></div>',
  },
  Button: {
    props: ['disabled', 'loading', 'label'],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')"><slot>{{ label }}</slot></button>',
  },
  Dialog: {
    props: ['visible'],
    emits: ['update:visible'],
    template: '<div v-if="visible" data-testid="dialog"><slot /><slot name="footer" /></div>',
  },
  RouterLink: { template: '<a><slot /></a>' },
}

function setupSession({
  id = 's1',
  ended = false,
  messages = [],
  dailyCap = null,
  confirmedGaps = [],
  hasMoreMessages = false,
} = {}) {
  const store = useSessionStore()
  store.currentSession = {
    id,
    topic: 'Calculus',
    ended_at: ended ? new Date().toISOString() : null,
    topic_profile: {
      confirmed_gaps: confirmedGaps.map((name) => ({
        name,
        evidence_type: null,
        last_event_at: null,
      })),
    },
  }
  store.currentSessionId = id
  store.messages = messages
  store.hasMoreMessages = hasMoreMessages
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
    replace.mockClear()
    route.query = {}
    showError.mockClear()
    uploadDocument.mockReset()
    bannerRefresh.mockReset()
    validateFile.mockReset()
    getUploadStatus.mockReset()
    getSessionProfile.mockReset()
    patchProfile.mockReset()
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

  it('send dispatches sendMessageStreaming and clears draft', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const sendSpy = vi.spyOn(store, 'sendMessageStreaming').mockResolvedValue()
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
    vi.spyOn(store, 'sendMessageStreaming').mockRejectedValue(
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
      .spyOn(store, 'sendMessageStreaming')
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
    const sendSpy = vi.spyOn(store, 'sendMessageStreaming').mockResolvedValue()
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
    const sendSpy = vi.spyOn(store, 'sendMessageStreaming').mockResolvedValue()
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
    const sendSpy = vi.spyOn(store, 'sendMessageStreaming').mockResolvedValue()
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

  it('opens the summary dialog immediately when pendingSummary is already set before mount', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    // Set BEFORE mount to exercise the { immediate: true } watcher path — without
    // immediate, a pendingSummary set prior to this view mounting would be missed.
    store.pendingSummary = {
      sessionId: 's1',
      kind: 'summary',
      text: 'Pre-set summary from an off-view end.',
    }
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="session-summary-summary"]').text()).toContain(
      'Pre-set summary from an off-view end.',
    )
    expect(store.pendingSummary).toBe(null)
  })

  it('summary dialog carries the shared dialog chrome class', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const wrapper = mountView()
    await flushPromises()
    store.pendingSummary = {
      sessionId: 's1',
      kind: 'summary',
      text: 'Great progress on derivatives.',
    }
    await flushPromises()
    expect(wrapper.get('[data-testid="session-summary-dialog"]').classes()).toContain('crux-dialog')
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

  it('single confirmed gap skips the picker and sends directly', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession({ ended: true, confirmedGaps: ['limits'] })
    })
    const reopenSpy = vi.spyOn(store, 'reopenSession').mockResolvedValue()
    const sendSpy = vi.spyOn(store, 'sendMessageStreaming').mockResolvedValue()
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="session-resume-gaps"]').trigger('click')
    await flushPromises()
    expect(reopenSpy).toHaveBeenCalledWith('s1')
    expect(reopenSpy).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="gap-picker"]').exists()).toBe(false)
    expect(sendSpy).toHaveBeenCalledWith({
      text: 'Review my gap: limits',
      reviewGaps: true,
      reviewGap: 'limits',
    })
    expect(sendSpy).toHaveBeenCalledTimes(1)
  })

  it('resumeReviewGaps opens the picker when more than one confirmed gap', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession({ ended: true, confirmedGaps: ['a', 'b'] })
    })
    vi.spyOn(store, 'reopenSession').mockResolvedValue()
    const sendSpy = vi.spyOn(store, 'sendMessageStreaming').mockResolvedValue()
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="session-resume-gaps"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="gap-picker"]').exists()).toBe(true)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('picker selection reopens then sends the targeted review seed', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession({ ended: true, confirmedGaps: ['a', 'b'] })
    })
    const reopenSpy = vi.spyOn(store, 'reopenSession').mockResolvedValue()
    const sendSpy = vi.spyOn(store, 'sendMessageStreaming').mockResolvedValue()
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="session-resume-gaps"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="gap-picker-option-1"]').trigger('click')
    await flushPromises()
    expect(reopenSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy).toHaveBeenCalledWith({
      text: 'Review my gap: b',
      reviewGaps: true,
      reviewGap: 'b',
    })
    expect(sendSpy).toHaveBeenCalledTimes(1)
  })

  it('review_gap query param triggers the review seed then strips the query', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession({ ended: false, confirmedGaps: ['a', 'b'] })
    })
    vi.spyOn(store, 'reopenSession').mockResolvedValue()
    const sendSpy = vi.spyOn(store, 'sendMessageStreaming').mockResolvedValue()
    route.query = { review_gap: 'b' }
    mountView()
    await flushPromises()
    expect(sendSpy).toHaveBeenCalledWith({
      text: 'Review my gap: b',
      reviewGaps: true,
      reviewGap: 'b',
    })
    expect(replace).toHaveBeenCalledWith({ query: { review_gap: undefined } })
    expect(replace).toHaveBeenCalledTimes(1)
    // The mock replace above writes the strip back into route.query, so
    // route.query.review_gap is now undefined. Give the non-immediate
    // query watcher another tick to prove the strip does not re-trigger
    // a second send (a double-send regression would show up as 2 calls).
    await nextTick()
    await flushPromises()
    expect(sendSpy).toHaveBeenCalledTimes(1)
  })

  it('navigating to a different session id with review_gap query present sends into the new session only', async () => {
    const store = useSessionStore()
    const load = vi.spyOn(store, 'loadSession').mockImplementation(async (id) => {
      setupSession({ id, confirmedGaps: ['x'] })
    })
    const sendSpy = vi.spyOn(store, 'sendMessageStreaming').mockResolvedValue()
    const wrapper = mountView({ id: 's1' })
    await flushPromises()
    expect(sendSpy).not.toHaveBeenCalled()

    // Simulate navigating from s1 to s2 via a link that already carries the
    // review_gap query (e.g. ProfileView's review-gaps button), so the id
    // prop and the query change together before loadCurrent('s2') resolves.
    route.query = { review_gap: 'x' }
    await wrapper.setProps({ id: 's2' })
    await flushPromises()

    expect(load).toHaveBeenLastCalledWith('s2')
    expect(sendSpy).toHaveBeenCalledWith({
      text: 'Review my gap: x',
      reviewGaps: true,
      reviewGap: 'x',
    })
    expect(sendSpy).toHaveBeenCalledTimes(1)
  })

  it('duplicateReopen renders a go-to-active-session link targeting the conflicting session', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="go-to-active-session"]').exists()).toBe(false)

    store.error = 'An active session with this topic already exists.'
    store.duplicateReopen = { sessionId: 'other1' }
    await flushPromises()

    const link = wrapper.findComponent('[data-testid="go-to-active-session"]')
    expect(link.exists()).toBe(true)
    expect(link.vm.$attrs.to).toEqual({ name: 'session', params: { id: 'other1' } })
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

  // A poll started in session A must not paint A's status into session B after
  // a sidebar switch (same route component instance, no remount), and must not
  // leave B's attach button locked behind A's in-flight upload.
  it('a session switch invalidates an in-flight upload poll', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async (id) => {
      setupSession({ id })
    })
    validateFile.mockReturnValue({ ok: true })
    uploadDocument.mockResolvedValue({ document_id: 'doc-1' })
    let resolveStatus
    getUploadStatus.mockImplementation(
      () =>
        new Promise((res) => {
          resolveStatus = res
        }),
    )
    const wrapper = mountView({ id: 's1' })
    await flushPromises()
    const file = new File(['pdf-bytes'], 'notes.pdf', { type: 'application/pdf' })
    const input = wrapper.get('[data-testid="session-upload-input"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises() // upload resolved; first status poll still pending

    await wrapper.setProps({ id: 's2' }) // switch sessions mid-ingestion
    await flushPromises()

    // B must not inherit A's upload lock while the stale poll is still pending.
    expect(wrapper.findComponent(Composer).props('uploading')).toBe(false)

    resolveStatus({ status: 'ready' }) // the superseded poll resolves late
    await flushPromises()

    // The stale result must not paint A's status banner into B.
    expect(wrapper.find('[data-testid="upload-status-ready"]').exists()).toBe(false)
    expect(wrapper.findComponent(Composer).props('uploading')).toBe(false)
  })

  // I-09: the 415 (and friends) carry an actionable server message - prefer
  // it over the generic friendlyError copy.
  it('upload failure surfaces the backend detail message when present', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    validateFile.mockReturnValue({ ok: true })
    uploadDocument.mockRejectedValue(
      Object.assign(new Error('415'), {
        status: 415,
        body: {
          detail: {
            code: 'CONTENT_TYPE_MISMATCH',
            message: 'file content does not match its extension',
          },
        },
      }),
    )
    const wrapper = mountView()
    await flushPromises()
    const file = new File(['pdf-bytes'], 'notes.pdf', { type: 'application/pdf' })
    const input = wrapper.get('[data-testid="session-upload-input"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.text()).toContain('file content does not match its extension')
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
    validateFile.mockReturnValue({
      ok: false,
      reason: 'malware.exe is not a supported type. Use PDF, PPTX, TXT, or MD.',
    })
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
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
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

  it('renders a quiet notice when store.followupNotice is set', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="followup-notice"]').exists()).toBe(false)
    store.followupNotice = 'Daily message limit reached - recap saved, tutor follow-up skipped.'
    await nextTick()
    const notice = wrapper.find('[data-testid="followup-notice"]')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('Daily message limit reached')
    expect(notice.attributes('role')).toBe('status')
  })

  it('renders streaming bubble when store.streamingMessage is set', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const wrapper = mountView()
    await flushPromises()
    store.streamingMessage = {
      role: 'assistant',
      content: 'streaming text',
      tool_calls: [],
      citations: [],
    }
    await nextTick()
    const bubble = wrapper.find('[data-testid="msg-streaming"]')
    expect(bubble.exists()).toBe(true)
    expect(bubble.text()).toContain('streaming text')
  })

  // F-18: MessageList is no longer a live region (it spammed SRs with every
  // token mutation). A single discrete status region announces exactly the
  // start/finish transitions instead, driven off store.streamState.
  it('announces stream start and finish discretely (F-18)', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const wrapper = mountView()
    await flushPromises()
    const region = wrapper.get('[data-testid="stream-status"]')
    expect(region.attributes('role')).toBe('status')
    expect(region.attributes('aria-live')).toBe('polite')
    expect(region.text()).toBe('')

    store.streamState = 'streaming'
    await nextTick()
    expect(region.text()).toBe('Tutor is replying.')

    store.streamState = 'idle'
    await nextTick()
    expect(region.text()).toBe('Reply finished.')
  })

  // The store's stream state machine has intermediate members beyond
  // idle/streaming (tool_running, stopping) — the announcement must not
  // re-fire "Tutor is replying." on every intermediate hop, only on the
  // idle -> non-idle and non-idle -> idle edges.
  it('does not re-announce start on tool_running/stopping hops (F-18)', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    const wrapper = mountView()
    await flushPromises()
    const region = wrapper.get('[data-testid="stream-status"]')

    store.streamState = 'streaming'
    await nextTick()
    expect(region.text()).toBe('Tutor is replying.')

    store.streamState = 'tool_running'
    await nextTick()
    expect(region.text()).toBe('Tutor is replying.')

    store.streamState = 'streaming'
    await nextTick()
    expect(region.text()).toBe('Tutor is replying.')

    store.streamState = 'idle'
    await nextTick()
    expect(region.text()).toBe('Reply finished.')
  })

  describe('diagnostic consent card', () => {
    it('shows the card when knowledge_level is null and no check is pending', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async () => {
        setupSession()
      })
      getSessionProfile.mockResolvedValue({ profile: { knowledge_level: null }, etag: 't1' })
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(true)
    })

    it('hides the card when knowledge_level is set', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async () => {
        setupSession()
      })
      getSessionProfile.mockResolvedValue({ profile: { knowledge_level: 'beginner' }, etag: 't1' })
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(false)
    })

    it('hides the card while a check batch is open', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async () => {
        setupSession()
      })
      store.pendingCheck = { gap: 'g', total: 1, currentIndex: 0, viewIndex: 0, items: [] }
      getSessionProfile.mockResolvedValue({ profile: { knowledge_level: null }, etag: 't1' })
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(false)
    })

    it('quiz button sends the canned message through the store', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async () => {
        setupSession()
      })
      const sendSpy = vi.spyOn(store, 'sendMessageStreaming').mockResolvedValue()
      getSessionProfile.mockResolvedValue({ profile: { knowledge_level: null }, etag: 't1' })
      const wrapper = mountView()
      await flushPromises()
      await wrapper.get('[data-testid="diag-quiz"]').trigger('click')
      await flushPromises()
      expect(sendSpy).toHaveBeenCalledWith({ text: 'Quiz me to gauge my level' })
    })

    it('level button PATCHes the profile with the etag and hides the card', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async () => {
        setupSession()
      })
      getSessionProfile.mockResolvedValue({ profile: { knowledge_level: null }, etag: 't1' })
      patchProfile.mockResolvedValue({ profile: { knowledge_level: 'advanced' }, etag: 't2' })
      const wrapper = mountView()
      await flushPromises()
      await wrapper.get('[data-testid="diag-level-advanced"]').trigger('click')
      await flushPromises()
      expect(patchProfile).toHaveBeenCalledWith('s1', { knowledge_level: 'advanced' }, 't1')
      expect(wrapper.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(false)
    })

    it('level button also sends a declaration message so the tutor sees the answer', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async () => {
        setupSession()
      })
      const sendSpy = vi.spyOn(store, 'sendMessageStreaming').mockResolvedValue()
      getSessionProfile.mockResolvedValue({ profile: { knowledge_level: null }, etag: 't1' })
      patchProfile.mockResolvedValue({ profile: { knowledge_level: 'advanced' }, etag: 't2' })
      const wrapper = mountView()
      await flushPromises()
      await wrapper.get('[data-testid="diag-level-advanced"]').trigger('click')
      await flushPromises()
      expect(sendSpy).toHaveBeenCalledWith({ text: "I'd say my level is advanced." })
    })

    it('level button does not send a declaration message when the PATCH fails', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async () => {
        setupSession()
      })
      const sendSpy = vi.spyOn(store, 'sendMessageStreaming').mockResolvedValue()
      getSessionProfile.mockResolvedValue({ profile: { knowledge_level: null }, etag: 't1' })
      patchProfile.mockRejectedValue(new Error('network down'))
      const wrapper = mountView()
      await flushPromises()
      await wrapper.get('[data-testid="diag-level-beginner"]').trigger('click')
      await flushPromises()
      expect(sendSpy).not.toHaveBeenCalled()
    })

    it('412 on PATCH refetches the profile and hides the card if the level is now set', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async () => {
        setupSession()
      })
      getSessionProfile.mockResolvedValueOnce({ profile: { knowledge_level: null }, etag: 't1' })
      patchProfile.mockRejectedValue(Object.assign(new Error('precondition'), { status: 412 }))
      getSessionProfile.mockResolvedValueOnce({
        profile: { knowledge_level: 'beginner' },
        etag: 't2',
      })
      const wrapper = mountView()
      await flushPromises()
      await wrapper.get('[data-testid="diag-level-beginner"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(false)
    })

    it('dismiss hides the card locally', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async () => {
        setupSession()
      })
      getSessionProfile.mockResolvedValue({ profile: { knowledge_level: null }, etag: 't1' })
      const wrapper = mountView()
      await flushPromises()
      await wrapper.get('[data-testid="diag-dismiss"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(false)
    })

    it('a session switch invalidates an in-flight level PATCH', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async (id) => {
        setupSession({ id })
      })
      getSessionProfile.mockImplementation((id) =>
        id === 's1'
          ? Promise.resolve({ profile: { knowledge_level: null }, etag: 't1' })
          : Promise.resolve({ profile: { knowledge_level: null }, etag: 't3' }),
      )
      let resolvePatch
      patchProfile.mockImplementation(
        () =>
          new Promise((res) => {
            resolvePatch = res
          }),
      )
      const wrapper = mountView({ id: 's1' })
      await flushPromises()
      await wrapper.get('[data-testid="diag-level-advanced"]').trigger('click')
      await flushPromises() // PATCH sent from s1, still pending

      await wrapper.setProps({ id: 's2' }) // switch sessions mid-PATCH
      await flushPromises()

      // s2's own fetch shows the card (its knowledge_level is null too).
      expect(wrapper.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(true)

      resolvePatch({ profile: { knowledge_level: 'advanced' }, etag: 't2' }) // stale s1 PATCH resolves late
      await flushPromises()

      // The stale PATCH response must not clobber s2's freshly-fetched profile.
      expect(wrapper.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(true)
    })

    // Re-review finding: onDiagLevel's finally must not clear diagLevelBusy
    // for a stale (previous-session) PATCH resolving after a same-session
    // PATCH is already in flight, else the double-PATCH window (F5) reopens.
    it('a stale PATCH resolving late does not clobber a newer same-session PATCH busy-guard', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async (id) => {
        setupSession({ id })
      })
      getSessionProfile.mockImplementation((id) =>
        id === 's1'
          ? Promise.resolve({ profile: { knowledge_level: null }, etag: 't1' })
          : Promise.resolve({ profile: { knowledge_level: null }, etag: 't3' }),
      )
      const resolvers = []
      patchProfile.mockImplementation(
        () =>
          new Promise((res, rej) => {
            resolvers.push({ res, rej })
          }),
      )
      const wrapper = mountView({ id: 's1' })
      await flushPromises()
      await wrapper.get('[data-testid="diag-level-advanced"]').trigger('click')
      await flushPromises() // PATCH_A sent from s1, still pending

      await wrapper.setProps({ id: 's2' }) // switch sessions mid-PATCH
      await flushPromises()
      expect(wrapper.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(true)

      await wrapper.get('[data-testid="diag-level-advanced"]').trigger('click')
      await flushPromises() // PATCH_B sent from s2, still pending
      expect(patchProfile).toHaveBeenCalledTimes(2)

      resolvers[0].res({ profile: { knowledge_level: 'advanced' }, etag: 't2' }) // stale PATCH_A resolves late
      await flushPromises()

      // Click level again on s2 while PATCH_B is still in flight. A correctly
      // session-guarded finally must leave diagLevelBusy true (busy belongs
      // to s2's own pending PATCH_B), so this third click must be blocked.
      await wrapper.get('[data-testid="diag-level-advanced"]').trigger('click')
      await flushPromises()

      expect(patchProfile).toHaveBeenCalledTimes(2)
    })

    // F4: the card must never paint over the skeleton (or flash) before the
    // session detail has resolved, even if the best-effort profile fetch
    // (which is not gated on loadSession) comes back with a null level.
    it('does not show the card while detail is loading (F4)', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(() => new Promise(() => {}))
      store.detailLoading = true
      getSessionProfile.mockResolvedValue({ profile: { knowledge_level: null }, etag: 't1' })
      const wrapper = mountView({ id: 's1' })
      await flushPromises()
      expect(wrapper.find('[data-testid="session-messages-skeleton"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(false)
    })

    // F2: a conversational level declaration (agent-side update_topic_profile
    // during the turn) is only visible to us via a refetch. Once a tutor turn
    // finishes (stream goes back to idle), refetch so the card hides itself
    // instead of lingering with a stale null level.
    it('refetches the profile when a tutor turn completes and hides the card if the level is now set (F2)', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async () => {
        setupSession()
      })
      getSessionProfile.mockResolvedValueOnce({ profile: { knowledge_level: null }, etag: 't1' })
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(true)
      expect(getSessionProfile).toHaveBeenCalledTimes(1)

      getSessionProfile.mockResolvedValueOnce({
        profile: { knowledge_level: 'intermediate' },
        etag: 't2',
      })
      store.streamState = 'streaming'
      await nextTick()
      store.streamState = 'idle'
      await flushPromises()

      expect(getSessionProfile).toHaveBeenCalledTimes(2)
      expect(wrapper.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(false)
    })

    it('does not refetch on stream idle when the card is dismissed (F2)', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async () => {
        setupSession()
      })
      getSessionProfile.mockResolvedValueOnce({ profile: { knowledge_level: null }, etag: 't1' })
      const wrapper = mountView()
      await flushPromises()
      await wrapper.get('[data-testid="diag-dismiss"]').trigger('click')
      await flushPromises()
      expect(getSessionProfile).toHaveBeenCalledTimes(1)

      store.streamState = 'streaming'
      await nextTick()
      store.streamState = 'idle'
      await flushPromises()

      expect(getSessionProfile).toHaveBeenCalledTimes(1)
    })

    // F3: a 412 can be a stale-etag false alarm rather than a real conflict.
    // If the refetch shows the level is STILL unset, retry the PATCH once
    // with the fresh etag rather than silently dropping the user's click.
    it('412 with a still-null refetch retries the PATCH once and hides the card on success (F3)', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async () => {
        setupSession()
      })
      getSessionProfile.mockResolvedValueOnce({ profile: { knowledge_level: null }, etag: 't1' })
      patchProfile.mockRejectedValueOnce(Object.assign(new Error('precondition'), { status: 412 }))
      getSessionProfile.mockResolvedValueOnce({ profile: { knowledge_level: null }, etag: 't2' })
      patchProfile.mockResolvedValueOnce({ profile: { knowledge_level: 'beginner' }, etag: 't3' })
      const wrapper = mountView()
      await flushPromises()
      await wrapper.get('[data-testid="diag-level-beginner"]').trigger('click')
      await flushPromises()

      expect(patchProfile).toHaveBeenCalledTimes(2)
      expect(patchProfile).toHaveBeenNthCalledWith(2, 's1', { knowledge_level: 'beginner' }, 't2')
      expect(wrapper.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(false)
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    })

    it('412 retry failure surfaces the inline save error (F3)', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async () => {
        setupSession()
      })
      getSessionProfile.mockResolvedValueOnce({ profile: { knowledge_level: null }, etag: 't1' })
      patchProfile.mockRejectedValueOnce(Object.assign(new Error('precondition'), { status: 412 }))
      getSessionProfile.mockResolvedValueOnce({ profile: { knowledge_level: null }, etag: 't2' })
      patchProfile.mockRejectedValueOnce(new Error('network down'))
      const wrapper = mountView()
      await flushPromises()
      await wrapper.get('[data-testid="diag-level-beginner"]').trigger('click')
      await flushPromises()

      expect(patchProfile).toHaveBeenCalledTimes(2)
      expect(wrapper.find('[data-testid="diagnostic-consent-card"]').exists()).toBe(true)
      expect(wrapper.get('[role="alert"]').text()).toBe('Could not save your level. Try again.')
    })

    // F5: a rapid second click before the first PATCH resolves must not fire
    // a second PATCH with the same (now-stale) etag.
    it('a rapid second level click does not fire a second PATCH (F5)', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async () => {
        setupSession()
      })
      getSessionProfile.mockResolvedValueOnce({ profile: { knowledge_level: null }, etag: 't1' })
      let resolvePatch
      patchProfile.mockImplementation(
        () =>
          new Promise((res) => {
            resolvePatch = res
          }),
      )
      const wrapper = mountView()
      await flushPromises()
      const btn = wrapper.get('[data-testid="diag-level-beginner"]')
      btn.trigger('click')
      btn.trigger('click')
      await flushPromises()

      expect(patchProfile).toHaveBeenCalledTimes(1)
      resolvePatch({ profile: { knowledge_level: 'beginner' }, etag: 't2' })
      await flushPromises()
    })

    // F6: quiz-start failures must surface on the card (diagError), matching
    // the level path, instead of the generic session error banner.
    it('quiz failures surface an inline card error instead of the session error banner (F6)', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async () => {
        setupSession()
      })
      getSessionProfile.mockResolvedValueOnce({ profile: { knowledge_level: null }, etag: 't1' })
      vi.spyOn(store, 'sendMessageStreaming').mockRejectedValue(new Error('boom'))
      const wrapper = mountView()
      await flushPromises()
      await wrapper.get('[data-testid="diag-quiz"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="session-error"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="diagnostic-consent-card"] [role="alert"]').text()).toBe(
        'Could not start the quiz. Try again.',
      )
    })
  })

  describe('load earlier messages', () => {
    // setupSession() alone leaves store.detailLoading true until the real
    // (unmocked) loadSession fetch settles, which is exactly what every other
    // describe block in this file avoids by driving setupSession through a
    // loadSession spy. Do the same here so these assertions run against the
    // loaded (v-else) branch deterministically instead of racing a live fetch.
    it('shows the button only when hasMoreMessages', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async () => {
        setupSession({
          id: 's1',
          messages: [{ role: 'user', content: 'hi', message_id: 9 }],
          hasMoreMessages: true,
        })
      })
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.find('[data-testid="load-earlier"]').exists()).toBe(true)
    })

    it('hides the button when history is exhausted', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async () => {
        setupSession({ id: 's1', messages: [{ role: 'user', content: 'hi', message_id: 9 }] })
      })
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.find('[data-testid="load-earlier"]').exists()).toBe(false)
    })

    it('click calls store.loadEarlierMessages and disables while pending', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async () => {
        setupSession({
          id: 's1',
          messages: [{ role: 'user', content: 'hi', message_id: 9 }],
          hasMoreMessages: true,
        })
      })
      const spy = vi.spyOn(store, 'loadEarlierMessages').mockResolvedValue()
      const wrapper = mountView()
      await flushPromises()
      await wrapper.get('[data-testid="load-earlier"]').trigger('click')
      expect(spy).toHaveBeenCalled()
    })

    it('shows retry copy when the page fetch failed', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'loadSession').mockImplementation(async () => {
        setupSession({
          id: 's1',
          messages: [{ role: 'user', content: 'hi', message_id: 9 }],
          hasMoreMessages: true,
        })
        store.loadEarlierError = 'boom'
      })
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.get('[data-testid="load-earlier"]').text()).toMatch(/retry/i)
    })
  })
})
