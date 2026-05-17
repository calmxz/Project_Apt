import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { uploadPdf, getUploadStatus } from '@/services/uploadApi.js'
import { ApiError } from '@/services/apiClient.js'

describe('uploadApi', () => {
  let fetchMock
  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock
  })
  afterEach(() => vi.restoreAllMocks())

  function ok(body) {
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(body)),
    })
  }
  function fail(status, body) {
    return Promise.resolve({
      ok: false,
      status,
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    })
  }

  it('uploadPdf posts FormData with session_id and file', async () => {
    fetchMock.mockReturnValueOnce(ok({ document_id: 'd1' }))
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    const out = await uploadPdf({ sessionId: 's1', file })
    expect(out.document_id).toBe('d1')
    const init = fetchMock.mock.calls[0][1]
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('uploadPdf throws ApiError(0) on network failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    const err = await uploadPdf({ sessionId: 's', file: new File([''], 'a.pdf') }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(0)
  })

  it('uploadPdf throws ApiError with parsed body on non-ok', async () => {
    fetchMock.mockReturnValueOnce(fail(413, { detail: 'too big' }))
    const err = await uploadPdf({ sessionId: 's', file: new File([''], 'a.pdf') }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(413)
    expect(err.body.detail).toBe('too big')
  })

  it('uploadPdf returns null body for empty response', async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') }),
    )
    const out = await uploadPdf({ sessionId: 's', file: new File([''], 'a.pdf') })
    expect(out).toBeNull()
  })

  it('uploadPdf returns raw text in body when not JSON', async () => {
    fetchMock.mockReturnValueOnce(fail(500, 'plain text'))
    const err = await uploadPdf({ sessionId: 's', file: new File([''], 'a.pdf') }).catch((e) => e)
    expect(err.body).toBe('plain text')
  })

  it('getUploadStatus hits /upload/:id', async () => {
    fetchMock.mockReturnValueOnce(ok({ status: 'ready' }))
    const out = await getUploadStatus('d1')
    expect(out.status).toBe('ready')
    expect(fetchMock.mock.calls[0][0]).toContain('/upload/d1')
  })
})
