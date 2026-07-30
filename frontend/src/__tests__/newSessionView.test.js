import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import NewSessionView from '@/views/NewSessionView.vue'
import { useSessionStore } from '@/stores/session.js'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

const uploadDocument = vi.fn()
vi.mock('@/services/uploadApi.js', () => ({
  uploadDocument: (...a) => uploadDocument(...a),
  validateFile: (file) =>
    file.name.endsWith('.exe') ? { ok: false, reason: 'not supported' } : { ok: true },
  ACCEPT_ATTR: '.pdf,.pptx,.txt,.md',
}))

// BackButton was removed from NewSessionView. The stub is kept as a regression
// guard: if BackButton is ever re-added, it renders data-testid="back" and the
// "does not render a back button" test fails instead of silently passing.
const stubs = {
  BackButton: { template: '<button data-testid="back" />' },
}

function mountView() {
  return mount(NewSessionView, { global: { stubs } })
}

describe('NewSessionView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    push.mockClear()
    uploadDocument.mockReset()
    uploadDocument.mockResolvedValue({ document_id: 1 })
  })

  it('renders hero copy and quick picks', () => {
    const wrapper = mountView()
    expect(wrapper.text()).toContain('Start a session')
    expect(wrapper.text()).toContain('Recursion')
    expect(wrapper.text()).toContain('CSS grid')
  })

  it('submit disabled when topic empty', () => {
    const wrapper = mountView()
    const btn = wrapper.get('[data-testid="new-submit"]')
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('typing a topic enables submit', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    const wrapper = mountView()
    await wrapper.get('[data-testid="new-topic"]').setValue('Calculus')
    expect(wrapper.get('[data-testid="new-submit"]').attributes('disabled')).toBeUndefined()
  })

  it('clicking a quick pick fills topic', async () => {
    const wrapper = mountView()
    await wrapper.findAll('.quick-pick')[0].trigger('click')
    expect(wrapper.get('[data-testid="new-topic"]').element.value).toBe('Recursion')
  })

  it('lists sessions on mount when none cached', async () => {
    const store = useSessionStore()
    const listSpy = vi.spyOn(store, 'listSessions').mockResolvedValue([])
    mountView()
    await flushPromises()
    expect(listSpy).toHaveBeenCalledWith()
  })

  it('skips listSessions when store already has sessions', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'X', ended_at: null, created_at: new Date().toISOString() },
    ]
    const listSpy = vi.spyOn(store, 'listSessions').mockResolvedValue([])
    mountView()
    await flushPromises()
    expect(listSpy).not.toHaveBeenCalled()
  })

  it('enter key submits when valid', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    vi.spyOn(store, 'lookupTopic').mockResolvedValue({ active_match: null, ended_match: null })
    vi.spyOn(store, 'createSession').mockResolvedValue({ id: 'new-2' })
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="new-topic"]').setValue('Calculus')
    await wrapper.get('[data-testid="new-topic"]').trigger('keydown.enter')
    await flushPromises()
    await wrapper.get('[data-testid="start-level-skip"]').trigger('click')
    await flushPromises()
    expect(store.createSession).toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'new-2' } })
  })

  it('adds valid attached files as chips and rejects invalid ones', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    const wrapper = mountView()
    const input = wrapper.get('[data-testid="new-file-input"]')
    const good = new File(['a'], 'ref.pdf', { type: 'application/pdf' })
    const bad = new File(['b'], 'virus.exe', { type: 'application/octet-stream' })
    Object.defineProperty(input.element, 'files', { value: [good, bad], configurable: true })
    await input.trigger('change')
    expect(wrapper.findAll('[data-testid="new-file-chip"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="new-file-errors"]').text()).toMatch(/not supported/i)
  })

  it('still routes when no files are attached', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    vi.spyOn(store, 'lookupTopic').mockResolvedValue({ active_match: null, ended_match: null })
    vi.spyOn(store, 'createSession').mockResolvedValue({ id: 'new-10' })
    const wrapper = mountView()
    await wrapper.get('[data-testid="new-topic"]').setValue('Calculus')
    await wrapper.get('[data-testid="new-submit"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="start-level-skip"]').trigger('click')
    await flushPromises()
    expect(uploadDocument).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'new-10' } })
  })

  it('shows a soft warning but still routes when an upload fails', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    vi.spyOn(store, 'lookupTopic').mockResolvedValue({ active_match: null, ended_match: null })
    vi.spyOn(store, 'createSession').mockResolvedValue({ id: 'new-11' })
    uploadDocument.mockRejectedValue(new Error('boom'))
    const wrapper = mountView()
    await wrapper.get('[data-testid="new-topic"]').setValue('Calculus')
    const input = wrapper.get('[data-testid="new-file-input"]')
    const f = new File(['a'], 'ref.pdf', { type: 'application/pdf' })
    Object.defineProperty(input.element, 'files', { value: [f], configurable: true })
    await input.trigger('change')
    await wrapper.get('[data-testid="new-submit"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="start-level-skip"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="new-file-errors"]').text()).toMatch(/failed to upload/i)
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'new-11' } })
  })

  it('does not render a back button', () => {
    const wrapper = mountView()
    expect(wrapper.find('[data-testid="back"]').exists()).toBe(false)
  })

  describe('smart start on /new', () => {
    it('start with no match shows level picker, keeps files pending', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'listSessions').mockResolvedValue([])
      vi.spyOn(store, 'lookupTopic').mockResolvedValue({ active_match: null, ended_match: null })
      const createSpy = vi.spyOn(store, 'createSession').mockResolvedValue({ id: 'n1' })
      const wrapper = mountView()
      await wrapper.get('[data-testid="new-topic"]').setValue('Calculus')
      const input = wrapper.get('[data-testid="new-file-input"]')
      const f = new File(['a'], 'ref.pdf', { type: 'application/pdf' })
      Object.defineProperty(input.element, 'files', { value: [f], configurable: true })
      await input.trigger('change')
      await wrapper.get('[data-testid="new-submit"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="start-level-skip"]').exists()).toBe(true)
      expect(createSpy).not.toHaveBeenCalled()
      expect(wrapper.findAll('[data-testid="new-file-chip"]')).toHaveLength(1)
    })

    it('level chip creates then uploads attached files then navigates', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'listSessions').mockResolvedValue([])
      vi.spyOn(store, 'lookupTopic').mockResolvedValue({ active_match: null, ended_match: null })
      const createSpy = vi.spyOn(store, 'createSession').mockResolvedValue({ id: 'n1' })
      const wrapper = mountView()
      await wrapper.get('[data-testid="new-topic"]').setValue('Calculus')
      const input = wrapper.get('[data-testid="new-file-input"]')
      const f = new File(['a'], 'ref.pdf', { type: 'application/pdf' })
      Object.defineProperty(input.element, 'files', { value: [f], configurable: true })
      await input.trigger('change')
      await wrapper.get('[data-testid="new-submit"]').trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid="start-level-intermediate"]').trigger('click')
      await flushPromises()
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'Calculus', declaredLevel: 'intermediate' }),
      )
      expect(uploadDocument).toHaveBeenCalledWith({ sessionId: 'n1', file: f })
      expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'n1' } })
    })

    it('active match shows shared intercept, not the old warn block', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'listSessions').mockResolvedValue([])
      vi.spyOn(store, 'lookupTopic').mockResolvedValue({
        active_match: { session_id: 'a1', title: 'Calculus' },
        ended_match: null,
      })
      const wrapper = mountView()
      await wrapper.get('[data-testid="new-topic"]').setValue('Calculus')
      await wrapper.get('[data-testid="new-submit"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="start-intercept"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="new-active-warn"]').exists()).toBe(false)
    })

    it('editing the topic after the level picker is shown resets the flow', async () => {
      const store = useSessionStore()
      vi.spyOn(store, 'listSessions').mockResolvedValue([])
      vi.spyOn(store, 'lookupTopic').mockResolvedValue({ active_match: null, ended_match: null })
      const wrapper = mountView()
      await wrapper.get('[data-testid="new-topic"]').setValue('Calculus')
      await wrapper.get('[data-testid="new-submit"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="start-level-skip"]').exists()).toBe(true)

      await wrapper.get('[data-testid="new-topic"]').setValue('Calculus II')
      await flushPromises()
      expect(wrapper.find('[data-testid="start-level-skip"]').exists()).toBe(false)
    })
  })
})
