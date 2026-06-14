import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

import ReferenceStatusBanner from '@/components/chat/ReferenceStatusBanner.vue'

const getSessionIngestion = vi.fn()
vi.mock('@/services/uploadApi.js', () => ({
  getSessionIngestion: (...a) => getSessionIngestion(...a),
}))

describe('ReferenceStatusBanner', () => {
  beforeEach(() => {
    getSessionIngestion.mockReset()
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
})
