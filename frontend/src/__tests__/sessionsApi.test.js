import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as apiClient from '../services/apiClient.js'
import { apiGet } from '../services/apiClient.js'
import * as sessionsApi from '../services/sessionsApi.js'
import { answerCheck, skipCheck } from '../services/sessionsApi.js'

vi.mock('../services/apiClient.js')

describe('sessionsApi check operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiClient.apiPost.mockResolvedValue({ correct: true })
    apiClient.apiGet.mockResolvedValue({ items: [] })
  })
  afterEach(() => vi.restoreAllMocks())

  it('getSessionLibrary forwards opts to apiGet (silent boot loads)', async () => {
    await sessionsApi.getSessionLibrary({ status: 'active' }, { silent: true })
    expect(apiGet).toHaveBeenCalledWith('/sessions/library', { status: 'active' }, { silent: true })
  })

  it('getSessionMessages calls apiGet with silent:true (inline error UI, never a toast)', async () => {
    await sessionsApi.getSessionMessages('s1', { before: 5, limit: 30 })
    expect(apiGet).toHaveBeenCalledWith(
      '/sessions/s1/messages',
      { before: 5, limit: 30 },
      { silent: true },
    )
  })

  it('getSessionLibrary defaults items to [] when apiGet resolves {}', async () => {
    apiGet.mockResolvedValueOnce({})
    const result = await sessionsApi.getSessionLibrary({ status: 'active' }, { silent: true })
    expect(result.items).toEqual([])
  })

  it('getSessionLibrary defaults items to [] when apiGet resolves a partial object', async () => {
    apiGet.mockResolvedValueOnce({ total: 5, limit: 20, offset: 0 })
    const result = await sessionsApi.getSessionLibrary({ status: 'active' }, { silent: true })
    expect(result.items).toEqual([])
    expect(result.total).toBe(5)
  })

  it('getSessionLibrary defaults items to [] when apiGet resolves null', async () => {
    apiGet.mockResolvedValueOnce(null)
    const result = await sessionsApi.getSessionLibrary({ status: 'active' }, { silent: true })
    expect(result.items).toEqual([])
  })

  it('getSessionLibrary passes a full valid payload through unchanged', async () => {
    const page = { items: [{ id: 's1' }], total: 1, limit: 20, offset: 0 }
    apiGet.mockResolvedValueOnce(page)
    const result = await sessionsApi.getSessionLibrary({ status: 'active' }, { silent: true })
    expect(result).toEqual(page)
  })

  it('answerCheck and skipCheck opt out of the errorBus toast', async () => {
    // Test answerCheck calls apiPost with { silent: true } as third argument
    await answerCheck('s1', 0, 2)
    expect(apiClient.apiPost).toHaveBeenCalledWith(
      '/sessions/s1/check/answer',
      { index: 0, selected_index: 2 },
      { silent: true },
    )

    // Test skipCheck calls apiPost with { silent: true } as third argument
    vi.clearAllMocks()
    await skipCheck('s1', 0)
    expect(apiClient.apiPost).toHaveBeenCalledWith(
      '/sessions/s1/check/skip',
      { index: 0 },
      { silent: true },
    )
  })
})
