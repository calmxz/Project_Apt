import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteProfileItem, patchProfile } from '../services/profileApi.js'

describe('profileApi writes', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ profile: {}, etag: 'new' }),
    }))
  })
  afterEach(() => vi.restoreAllMocks())

  it('patchProfile sends If-Match and body', async () => {
    await patchProfile('s1', { add_mastered: 'loops' }, 'tag123')
    const [url, init] = globalThis.fetch.mock.calls[0]
    expect(url).toContain('/profile/s1')
    expect(init.method).toBe('PATCH')
    expect(init.headers['if-match'] ?? init.headers['If-Match']).toBe('tag123')
    expect(JSON.parse(init.body)).toEqual({ add_mastered: 'loops' })
  })

  it('deleteProfileItem encodes the item and sends If-Match', async () => {
    await deleteProfileItem('s1', 'confirmed_gaps', 'big O', 'tag123')
    const [url, init] = globalThis.fetch.mock.calls[0]
    expect(url).toContain('/profile/s1/confirmed_gaps/big%20O')
    expect(init.method).toBe('DELETE')
    expect(init.headers['if-match'] ?? init.headers['If-Match']).toBe('tag123')
  })
})
