import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as apiClient from '../services/apiClient.js'
import { answerCheck, skipCheck } from '../services/sessionsApi.js'

vi.mock('../services/apiClient.js')

describe('sessionsApi check operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiClient.apiPost.mockResolvedValue({ correct: true })
  })
  afterEach(() => vi.restoreAllMocks())

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
