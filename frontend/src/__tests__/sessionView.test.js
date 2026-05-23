import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import SessionView from '@/views/SessionView.vue'
import { useSessionStore } from '@/stores/session.js'
import { useUserStore } from '@/stores/user.js'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const showError = vi.fn()
vi.mock('@/composables/useToast.js', () => ({
  useToast: () => ({ showError, showInfo: vi.fn(), showSuccess: vi.fn() }),
}))

const uploadPdf = vi.fn()
const getUploadStatus = vi.fn()
vi.mock('@/services/uploadApi.js', () => ({
  uploadPdf: (...args) => uploadPdf(...args),
  getUploadStatus: (...args) => getUploadStatus(...args),
}))

const stubs = {
  BackButton: { template: '<button data-testid="back" />' },
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
  Textarea: {
    props: ['modelValue', 'disabled'],
    template:
      '<textarea :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown="$emit(\'keydown\', $event)" />',
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
    uploadPdf.mockReset()
    getUploadStatus.mockReset()
    const user = useUserStore()
    user.userId = 'u1'
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
    expect(sendSpy).toHaveBeenCalledWith({ userId: 'u1', text: 'hello' })
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
    expect(sendSpy.mock.calls[1][0]).toEqual({ userId: 'u1', text: 'retry me' })
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
    expect(sendSpy).toHaveBeenCalledWith({ userId: 'u1', text: 'via enter' })
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
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="quick-prompt-0"]').trigger('click')
    expect(wrapper.get('[data-testid="session-input"]').element.value).toBe(
      'Where should I start with this topic?',
    )
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

  it('end click opens summary dialog with returned text', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    vi.spyOn(store, 'endSession').mockResolvedValue({
      summary: { kind: 'summary', text: 'Great progress on derivatives.' },
    })
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="session-end"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="session-summary-summary"]').text()).toContain(
      'Great progress on derivatives.',
    )
  })

  it('summary close routes home', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    vi.spyOn(store, 'endSession').mockResolvedValue({
      summary: { kind: 'summary', text: 'done' },
    })
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="session-end"]').trigger('click')
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

  it('upload triggers uploadPdf and polls status', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => {
      setupSession()
    })
    uploadPdf.mockResolvedValue({ document_id: 'doc-1' })
    getUploadStatus.mockResolvedValue({ status: 'ready' })
    const wrapper = mountView()
    await flushPromises()
    const file = new File(['pdf-bytes'], 'notes.pdf', { type: 'application/pdf' })
    const input = wrapper.get('[data-testid="session-upload-input"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()
    expect(uploadPdf).toHaveBeenCalledWith({ sessionId: 's1', file })
    expect(getUploadStatus).toHaveBeenCalledWith('doc-1')
    expect(wrapper.find('[data-testid="upload-status-ready"]').exists()).toBe(true)
  })
})
