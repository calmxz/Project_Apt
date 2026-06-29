import { describe, it, expect } from 'vitest'
import { checkBatchAllCorrect } from '@/utils/checkBatch.js'

const item = (over = {}) => ({ status: 'answered', correct: true, ...over })

describe('checkBatchAllCorrect', () => {
  it('true when every item is answered and correct', () => {
    expect(checkBatchAllCorrect([item(), item(), item()])).toBe(true)
  })

  it('false when any item is incorrect', () => {
    expect(checkBatchAllCorrect([item(), item({ correct: false })])).toBe(false)
  })

  it('false when any item is skipped', () => {
    expect(checkBatchAllCorrect([item(), item({ status: 'skipped', correct: null })])).toBe(false)
  })

  it('false when any item is still pending', () => {
    expect(checkBatchAllCorrect([item(), item({ status: 'pending', correct: null })])).toBe(false)
  })

  it('false for an empty or missing batch', () => {
    expect(checkBatchAllCorrect([])).toBe(false)
    expect(checkBatchAllCorrect(undefined)).toBe(false)
  })
})
