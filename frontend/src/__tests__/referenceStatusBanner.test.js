import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

import ReferenceStatusBanner from '@/components/chat/ReferenceStatusBanner.vue'

const getSessionIngestion = vi.fn()
const deleteDocument = vi.fn()
vi.mock('@/services/uploadApi.js', () => ({
  getSessionIngestion: (...a) => getSessionIngestion(...a),
  deleteDocument: (...a) => deleteDocument(...a),
}))

// Capture the confirm config so a test can invoke accept/reject deterministically.
let lastConfirm = null
vi.mock('primevue/useconfirm', () => ({
  useConfirm: () => ({ require: (cfg) => { lastConfirm = cfg } }),
}))
const showSuccess = vi.fn()
const showError = vi.fn()
vi.mock('@/composables/useToast.js', () => ({
  useToast: () => ({ showSuccess, showError, showWarn: vi.fn() }),
}))

describe('ReferenceStatusBanner', () => {
  beforeEach(() => {
    getSessionIngestion.mockReset()
    deleteDocument.mockReset()
    showSuccess.mockReset()
    showError.mockReset()
    lastConfirm = null
  })

  it('renders nothing when the session has no documents', async () => {
    getSessionIngestion.mockResolvedValue({ status: null, documents: [] })
    const wrapper = mount(ReferenceStatusBanner, { props: { sessionId: 's1' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="reference-status"]').exists()).toBe(false)
  })

  it('shows an indexing message while pending', async () => {
    getSessionIngestion.mockResolvedValue({
      status: 'pending',
      documents: [{ id: 1, filename: 'a.pdf', status: 'pending' }],
    })
    const wrapper = mount(ReferenceStatusBanner, { props: { sessionId: 's1' } })
    await flushPromises()
    expect(wrapper.get('[data-testid="reference-status"]').text()).toMatch(/indexing/i)
  })

  it('shows a ready message when all documents are ready', async () => {
    getSessionIngestion.mockResolvedValue({
      status: 'ready',
      documents: [{ id: 1, filename: 'a.pdf', status: 'ready' }],
    })
    const wrapper = mount(ReferenceStatusBanner, { props: { sessionId: 's1' } })
    await flushPromises()
    expect(wrapper.get('[data-testid="reference-status"]').text()).toMatch(/ready/i)
  })

  it('shows a failure message when a document failed', async () => {
    getSessionIngestion.mockResolvedValue({
      status: 'failed',
      documents: [{ id: 1, filename: 'a.pdf', status: 'failed', error: 'bad pdf' }],
    })
    const wrapper = mount(ReferenceStatusBanner, { props: { sessionId: 's1' } })
    await flushPromises()
    expect(wrapper.get('[data-testid="reference-status"]').text()).toMatch(/could not|failed/i)
  })

  it('refetches when the sessionId prop changes', async () => {
    getSessionIngestion.mockResolvedValue({ status: 'ready', documents: [{ id: 1, filename: 'a.pdf', status: 'ready' }] })
    const wrapper = mount(ReferenceStatusBanner, { props: { sessionId: 's1' } })
    await flushPromises()
    expect(getSessionIngestion).toHaveBeenLastCalledWith('s1')
    await wrapper.setProps({ sessionId: 's2' })
    await flushPromises()
    expect(getSessionIngestion).toHaveBeenLastCalledWith('s2')
  })

  it('expands to show a per-file list with filenames', async () => {
    getSessionIngestion.mockResolvedValue({
      status: 'ready',
      documents: [
        { id: 1, filename: 'a.pdf', status: 'ready' },
        { id: 2, filename: 'b.md', status: 'pending' },
      ],
    })
    const wrapper = mount(ReferenceStatusBanner, { props: { sessionId: 's1' } })
    await flushPromises()
    // List hidden until expanded.
    expect(wrapper.find('[data-testid="ref-file-list"]').exists()).toBe(false)
    await wrapper.get('[data-testid="ref-toggle"]').trigger('click')
    expect(wrapper.get('[data-testid="ref-file-list"]').text()).toContain('a.pdf')
    expect(wrapper.get('[data-testid="ref-file-list"]').text()).toContain('b.md')
  })

  it('deletes a file on confirm-accept and shows a success toast', async () => {
    getSessionIngestion.mockResolvedValue({
      status: 'ready',
      documents: [{ id: 1, filename: 'a.pdf', status: 'ready' }],
    })
    deleteDocument.mockResolvedValue(undefined)
    const wrapper = mount(ReferenceStatusBanner, { props: { sessionId: 's1' } })
    await flushPromises()
    await wrapper.get('[data-testid="ref-toggle"]').trigger('click')
    await wrapper.get('[data-testid="ref-delete-1"]').trigger('click')
    // Simulate the user accepting the confirm dialog.
    await lastConfirm.accept()
    await flushPromises()
    expect(deleteDocument).toHaveBeenCalledWith(1)
    expect(showSuccess).toHaveBeenCalled()
  })

  it('styles confirm buttons: a darker destructive accept and a neutral, non-coral cancel', async () => {
    getSessionIngestion.mockResolvedValue({
      status: 'ready',
      documents: [{ id: 1, filename: 'a.pdf', status: 'ready' }],
    })
    const wrapper = mount(ReferenceStatusBanner, { props: { sessionId: 's1' } })
    await flushPromises()
    await wrapper.get('[data-testid="ref-toggle"]').trigger('click')
    await wrapper.get('[data-testid="ref-delete-1"]').trigger('click')
    // Accept carries the darker-delete hook class (styled globally).
    expect(lastConfirm.acceptClass).toContain('confirm-delete-strong')
    // Cancel must opt out of the default primary (coral) fill.
    expect(lastConfirm.rejectClass).toContain('p-button-secondary')
    expect(lastConfirm.rejectClass).not.toContain('p-button-danger')
  })

  it('does not delete when confirm is rejected', async () => {
    getSessionIngestion.mockResolvedValue({
      status: 'ready',
      documents: [{ id: 1, filename: 'a.pdf', status: 'ready' }],
    })
    const wrapper = mount(ReferenceStatusBanner, { props: { sessionId: 's1' } })
    await flushPromises()
    await wrapper.get('[data-testid="ref-toggle"]').trigger('click')
    await wrapper.get('[data-testid="ref-delete-1"]').trigger('click')
    if (lastConfirm.reject) await lastConfirm.reject()
    expect(deleteDocument).not.toHaveBeenCalled()
  })

  it('shows an error toast and refreshes when delete fails', async () => {
    getSessionIngestion.mockResolvedValue({
      status: 'ready',
      documents: [{ id: 1, filename: 'a.pdf', status: 'ready' }],
    })
    deleteDocument.mockRejectedValue(new Error('500'))
    const wrapper = mount(ReferenceStatusBanner, { props: { sessionId: 's1' } })
    await flushPromises()
    getSessionIngestion.mockClear() // count only refresh-driven refetches below
    await wrapper.get('[data-testid="ref-toggle"]').trigger('click')
    await wrapper.get('[data-testid="ref-delete-1"]').trigger('click')
    await lastConfirm.accept()
    await flushPromises()
    expect(showError).toHaveBeenCalled()
    expect(showSuccess).not.toHaveBeenCalled()
    expect(getSessionIngestion).toHaveBeenCalled() // refresh() ran in the catch
  })
})
