import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import router from '../router/index.js'
import { useAuthStore } from '../stores/auth.js'
import { useUserStore } from '../stores/user.js'

// Route-level redirect tests. Auth/onboarding guards are made green so only
// the redirect logic under test decides the destination.
function setAuth(authed) {
  const auth = useAuthStore()
  auth.session = authed ? { user: { id: 'u-1' }, access_token: 'tok' } : null
  auth.ready = true
}

beforeEach(async () => {
  setActivePinia(createPinia())
  setAuth(true)
  const user = useUserStore()
  user.hydrated = true
  user.onboardingComplete = true
  await router.push('/')
  await router.isReady()
})

describe('unified settings routing', () => {
  it('/settings redirects to /settings/profile', async () => {
    await router.push('/settings')
    expect(router.currentRoute.value.fullPath).toBe('/settings/profile')
  })

  it('/profile redirects to /settings/profile and keeps its route name usable', async () => {
    await router.push({ name: 'profile-aggregate' })
    expect(router.currentRoute.value.fullPath).toBe('/settings/profile')
  })

  it('invalid tab slug redirects to /settings/profile', async () => {
    await router.push('/settings/bogus')
    expect(router.currentRoute.value.fullPath).toBe('/settings/profile')
  })

  it('each valid tab resolves to the settings route with the tab param', async () => {
    for (const tab of ['profile', 'usage', 'account', 'appearance']) {
      await router.push(`/settings/${tab}`)
      expect(router.currentRoute.value.name).toBe('settings')
      expect(router.currentRoute.value.params.tab).toBe(tab)
    }
  })
})
