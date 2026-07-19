import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import router from '@/router/index.js'
import { useAuthStore } from '@/stores/auth.js'
import { useUserStore } from '@/stores/user.js'

function setAuth(authed) {
  const auth = useAuthStore()
  auth.session = authed ? { user: { id: 'u-1' }, access_token: 'tok' } : null
  auth.ready = true
}

describe('router', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    setAuth(true)
    await router.push('/')
    await router.isReady()
  })

  it('exposes the expected named routes', () => {
    const names = router.getRoutes().map((r) => r.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'home',
        'onboarding',
        'settings',
        'profile-aggregate',
        'new-session',
        'session',
        'session-profile',
        'login',
        'register',
      ]),
    )
  })

  it('has no subject routes', () => {
    const names = router.getRoutes().map((r) => r.name)
    expect(names).not.toContain('subject-new')
    expect(names).not.toContain('subject-overview')
    expect(names).not.toContain('subject-mastery')
  })

  it('redirects unauthenticated user to /login', async () => {
    setAuth(false)
    const user = useUserStore()
    user.onboardingComplete = true
    await router.push({ name: 'home' })
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('login redirect preserves the intended path', async () => {
    setAuth(false)
    const user = useUserStore()
    user.onboardingComplete = true
    await router.push('/session/abc')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/session/abc')
  })

  it('redirects authenticated user away from /login to home', async () => {
    setAuth(true)
    const user = useUserStore()
    user.onboardingComplete = true
    await router.push({ name: 'login' })
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('redirects to onboarding when authed but onboarding incomplete', async () => {
    setAuth(true)
    const user = useUserStore()
    user.onboardingComplete = false
    // Push to a non-default route to avoid hitting the "same route" no-op path
    // when a prior test or beforeEach left us on /onboarding already.
    await router.push({ name: 'settings' })
    expect(router.currentRoute.value.name).toBe('onboarding')
  })

  it('redirects away from onboarding when complete (no retake query)', async () => {
    setAuth(true)
    const user = useUserStore()
    user.onboardingComplete = true
    await router.push({ name: 'settings' })
    await router.push({ name: 'onboarding' })
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('allows onboarding when retake=1 even if complete', async () => {
    setAuth(true)
    const user = useUserStore()
    user.onboardingComplete = true
    await router.push({ name: 'onboarding', query: { retake: '1' } })
    expect(router.currentRoute.value.name).toBe('onboarding')
  })

  it('passes :id as a prop to the session route', () => {
    const route = router.getRoutes().find((r) => r.name === 'session')
    expect(route.props.default).toBe(true)
  })

  it('allows an unauthenticated user to reach /register', async () => {
    setAuth(false)
    await router.push({ name: 'register' })
    expect(router.currentRoute.value.name).toBe('register')
  })

  it('redirects an authenticated user away from /register to home', async () => {
    setAuth(true)
    const user = useUserStore()
    user.onboardingComplete = true
    await router.push({ name: 'register' })
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('guard proceeds unauthenticated when auth.init rejects', async () => {
    const auth = useAuthStore()
    auth._resetForTests()
    globalThis.__supabaseAuthStub.getSession.mockRejectedValueOnce(new Error('corrupt session'))
    // Push to a different route than the current one (beforeEach already
    // landed on '/'): a same-route push is a vue-router no-op and skips the
    // guard entirely, which would defeat this test.
    await router.push('/settings') // must not throw
    expect(router.currentRoute.value.name).toBe('login')
  })
})
