import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUserStore } from '@/stores/user.js'

const key = (uid) => `crux:user:v1:${uid}`

describe('user store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('initial state is empty', () => {
    const u = useUserStore()
    expect(u.name).toBeNull()
    expect(u.onboardingComplete).toBe(false)
  })

  it('loadFromLocalStorage hydrates from saved data', () => {
    localStorage.setItem(
      key('u1'),
      JSON.stringify({
        name: 'Eddy',
        interactionPreferences: { feedback: 'hints' },
        onboardingComplete: true,
      }),
    )
    const u = useUserStore()
    u.setActiveUser('u1')
    expect(u.name).toBe('Eddy')
    expect(u.onboardingComplete).toBe(true)
  })

  it('loadFromLocalStorage drops a corrupt entry', () => {
    localStorage.setItem(key('u1'), '{not json')
    const u = useUserStore()
    u.setActiveUser('u1')
    u.loadFromLocalStorage()
    expect(localStorage.getItem(key('u1'))).toBeNull()
    expect(u.name).toBeNull()
  })

  it('loadFromLocalStorage does nothing when no entry', () => {
    const u = useUserStore()
    u.setActiveUser('u1')
    expect(u.name).toBeNull()
  })

  it('completeOnboarding sets name, prefs and persists', () => {
    const u = useUserStore()
    u.setActiveUser('u1')
    u.completeOnboarding({ name: 'Edward', feedback: 'direct_answers' })
    expect(u.name).toBe('Edward')
    expect(u.interactionPreferences.feedback).toBe('direct_answers')
    expect(u.onboardingComplete).toBe(true)
    const raw = JSON.parse(localStorage.getItem(key('u1')))
    expect(raw.name).toBe('Edward')
  })

  it('completeOnboarding falls back to "Learner" when name is empty', () => {
    const u = useUserStore()
    u.setActiveUser('u1')
    u.completeOnboarding({ name: '   ', feedback: 'hints' })
    expect(u.name).toBe('Learner')
  })

  it('resetOnboarding clears everything', () => {
    const u = useUserStore()
    u.setActiveUser('u1')
    u.completeOnboarding({ name: 'A', feedback: 'hints' })
    u.resetOnboarding()
    expect(u.name).toBeNull()
    expect(u.onboardingComplete).toBe(false)
    expect(localStorage.getItem(key('u1'))).toBeNull()
  })

  it('updateProfile merges name and feedback', () => {
    const u = useUserStore()
    u.setActiveUser('u1')
    u.completeOnboarding({ name: 'A', feedback: 'hints' })
    u.updateProfile({ name: 'B' })
    expect(u.name).toBe('B')
    expect(u.interactionPreferences.feedback).toBe('hints')
    u.updateProfile({ feedback: 'direct_answers' })
    expect(u.interactionPreferences.feedback).toBe('direct_answers')
  })

  it('updateProfile trims and falls back to "Learner"', () => {
    const u = useUserStore()
    u.setActiveUser('u1')
    u.completeOnboarding({ name: 'A', feedback: 'hints' })
    u.updateProfile({ name: '   ' })
    expect(u.name).toBe('Learner')
  })

  it('namespaces storage per uid — two accounts never share prefs (F-08)', () => {
    const u = useUserStore()
    u.setActiveUser('user-a')
    u.completeOnboarding({ name: 'Alice', feedback: 'direct' })

    u.setActiveUser('user-b')
    expect(u.name).toBeNull()
    expect(u.onboardingComplete).toBe(false)

    u.setActiveUser('user-a')
    expect(u.name).toBe('Alice')
    expect(u.onboardingComplete).toBe(true)
  })

  it('setActiveUser(null) clears memory but preserves the persisted blob', () => {
    const u = useUserStore()
    u.setActiveUser('user-a')
    u.completeOnboarding({ name: 'Alice', feedback: 'direct' })

    u.setActiveUser(null)
    expect(u.name).toBeNull()
    expect(localStorage.getItem('crux:user:v1:user-a')).not.toBeNull()
  })

  it('persist is a no-op with no active uid', () => {
    const u = useUserStore()
    u.completeOnboarding({ name: 'Ghost', feedback: 'direct' })
    expect(localStorage.getItem('crux:user:v1')).toBeNull()
  })
})
