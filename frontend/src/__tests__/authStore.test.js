import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useAuthStore } from '@/stores/auth.js'

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts unauthenticated and not ready', () => {
    const auth = useAuthStore()
    expect(auth.ready).toBe(false)
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.userId).toBeNull()
    expect(auth.accessToken).toBeNull()
  })

  it('init() reads existing Supabase session into the store', async () => {
    globalThis.__supabaseAuthStub.getSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'tok-abc',
          user: { id: 'u-1', email: 'a@b.c' },
        },
      },
      error: null,
    })
    const auth = useAuthStore()
    await auth.init()
    expect(auth.ready).toBe(true)
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.userId).toBe('u-1')
    expect(auth.accessToken).toBe('tok-abc')
  })

  it('init() leaves store unauthenticated when no session exists', async () => {
    const auth = useAuthStore()
    await auth.init()
    expect(auth.ready).toBe(true)
    expect(auth.isAuthenticated).toBe(false)
  })

  it('init() subscribes to onAuthStateChange and updates session on event', async () => {
    let callback
    globalThis.__supabaseAuthStub.onAuthStateChange.mockImplementationOnce(
      (cb) => {
        callback = cb
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    )
    const auth = useAuthStore()
    await auth.init()
    callback('SIGNED_IN', { access_token: 't2', user: { id: 'u-2' } })
    expect(auth.userId).toBe('u-2')
    expect(auth.accessToken).toBe('t2')
    callback('SIGNED_OUT', null)
    expect(auth.isAuthenticated).toBe(false)
  })

  it('init() is idempotent', async () => {
    const auth = useAuthStore()
    await auth.init()
    await auth.init()
    expect(globalThis.__supabaseAuthStub.getSession).toHaveBeenCalledTimes(1)
  })

  it('signInWithMagicLink calls Supabase signInWithOtp with the email', async () => {
    const auth = useAuthStore()
    await auth.signInWithMagicLink('me@example.com')
    expect(globalThis.__supabaseAuthStub.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'me@example.com' }),
    )
  })

  it('signInWithMagicLink throws when Supabase returns an error', async () => {
    globalThis.__supabaseAuthStub.signInWithOtp.mockResolvedValueOnce({
      data: null,
      error: new Error('rate limited'),
    })
    const auth = useAuthStore()
    await expect(auth.signInWithMagicLink('x@y.z')).rejects.toThrow('rate limited')
  })

  it('signOut clears session', async () => {
    const auth = useAuthStore()
    auth.session = { user: { id: 'u-3' }, access_token: 't' }
    await auth.signOut()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.userId).toBeNull()
  })

  it('signOut throws when Supabase returns an error', async () => {
    globalThis.__supabaseAuthStub.signOut.mockResolvedValueOnce({
      error: new Error('network'),
    })
    const auth = useAuthStore()
    await expect(auth.signOut()).rejects.toThrow('network')
  })
})
