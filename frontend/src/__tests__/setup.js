// Global vitest setup. Mocks `@supabase/supabase-js` so importing
// `services/supabase.js` in any test never touches the network.
//
// Tests can refine the default behavior by accessing
// `globalThis.__supabaseAuthStub` and calling .mockResolvedValueOnce(...)
// on individual stub methods.

import { vi, beforeEach } from 'vitest'

const authStub = {
  getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
  onAuthStateChange: vi.fn().mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  }),
  signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
  signOut: vi.fn().mockResolvedValue({ error: null }),
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: authStub })),
}))

globalThis.__supabaseAuthStub = authStub

beforeEach(() => {
  authStub.getSession.mockClear()
  authStub.getSession.mockResolvedValue({ data: { session: null }, error: null })
  authStub.onAuthStateChange.mockClear()
  authStub.signInWithOtp.mockClear()
  authStub.signInWithOtp.mockResolvedValue({ data: {}, error: null })
  authStub.signOut.mockClear()
  authStub.signOut.mockResolvedValue({ error: null })
})
