import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { uploadPdf, getUploadStatus, validateFile, ACCEPT_ATTR, MAX_UPLOAD_BYTES } from '@/services/uploadApi.js'
import { ApiError } from '@/services/apiClient.js'

function fakeFile(name, size) {
  return { name, size }
}

describe('validateFile', () => {
  it('accepts pdf, pptx, txt, md by extension', () => {
    for (const ext of ['ref.pdf', 'deck.PPTX', 'notes.txt', 'readme.md', 'readme.markdown']) {
      expect(validateFile(fakeFile(ext, 1000)).ok).toBe(true)
    }
  })

  it('rejects unsupported extensions', () => {
    const r = validateFile(fakeFile('paper.docx', 1000))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/supported/i)
  })

  it('rejects oversize files', () => {
    const r = validateFile(fakeFile('big.pdf', MAX_UPLOAD_BYTES + 1))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/too large/i)
  })

  it('exposes an accept attribute string', () => {
    expect(ACCEPT_ATTR).toContain('.pdf')
    expect(ACCEPT_ATTR).toContain('.pptx')
  })
})

describe('uploadApi', () => {
  let fetchMock
  beforeEach(() => {
    setActivePinia(createPinia())
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

  it('uploadPdf posts FormData with session_id and file (no user_id)', async () => {
    fetchMock.mockReturnValueOnce(ok({ document_id: 'd1' }))
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    const out = await uploadPdf({ sessionId: 's1', file })
    expect(out.document_id).toBe('d1')
    const init = fetchMock.mock.calls[0][1]
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    // Phase 7: server resolves user_id from the Authorization header.
    expect(init.body.get('user_id')).toBeNull()
    expect(init.body.get('session_id')).toBe('s1')
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

  it('getUploadStatus hits /upload/:id with no user_id query', async () => {
    fetchMock.mockReturnValueOnce(ok({ status: 'ready' }))
    const out = await getUploadStatus('d1')
    expect(out.status).toBe('ready')
    expect(fetchMock.mock.calls[0][0]).toContain('/upload/d1')
    expect(fetchMock.mock.calls[0][0]).not.toContain('user_id=')
  })
})
