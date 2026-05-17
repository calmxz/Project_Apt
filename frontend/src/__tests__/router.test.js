import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import router from '@/router/index.js'
import { useUserStore } from '@/stores/user.js'

describe('router', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
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
      ]),
    )
  })

  it('redirects to onboarding when onboarding incomplete', async () => {
    const user = useUserStore()
    user.onboardingComplete = false
    await router.push({ name: 'home' })
    expect(router.currentRoute.value.name).toBe('onboarding')
  })

  it('redirects away from onboarding when complete (no retake query)', async () => {
    const user = useUserStore()
    user.onboardingComplete = true
    await router.push({ name: 'settings' })
    await router.push({ name: 'onboarding' })
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('allows onboarding when retake=1 even if complete', async () => {
    const user = useUserStore()
    user.onboardingComplete = true
    await router.push({ name: 'onboarding', query: { retake: '1' } })
    expect(router.currentRoute.value.name).toBe('onboarding')
  })

  it('passes :id as a prop to the session route', () => {
    const route = router.getRoutes().find((r) => r.name === 'session')
    expect(route.props.default).toBe(true)
  })
})
