import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUserStore } from '@/stores/user.js'

const STORAGE_KEY = 'adaptlearn:user:v1'

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
      STORAGE_KEY,
      JSON.stringify({
        name: 'Eddy',
        interactionPreferences: { feedback: 'hints' },
        onboardingComplete: true,
      }),
    )
    const u = useUserStore()
    u.loadFromLocalStorage()
    expect(u.name).toBe('Eddy')
    expect(u.onboardingComplete).toBe(true)
  })

  it('loadFromLocalStorage drops a corrupt entry', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    const u = useUserStore()
    u.loadFromLocalStorage()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(u.name).toBeNull()
  })

  it('loadFromLocalStorage does nothing when no entry', () => {
    const u = useUserStore()
    u.loadFromLocalStorage()
    expect(u.name).toBeNull()
  })

  it('completeOnboarding sets name, prefs and persists', () => {
    const u = useUserStore()
    u.completeOnboarding({ name: 'Edward', feedback: 'direct_answers' })
    expect(u.name).toBe('Edward')
    expect(u.interactionPreferences.feedback).toBe('direct_answers')
    expect(u.onboardingComplete).toBe(true)
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY))
    expect(raw.name).toBe('Edward')
  })

  it('completeOnboarding falls back to "Learner" when name is empty', () => {
    const u = useUserStore()
    u.completeOnboarding({ name: '   ', feedback: 'hints' })
    expect(u.name).toBe('Learner')
  })

  it('resetOnboarding clears everything', () => {
    const u = useUserStore()
    u.completeOnboarding({ name: 'A', feedback: 'hints' })
    u.resetOnboarding()
    expect(u.name).toBeNull()
    expect(u.onboardingComplete).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('updateProfile merges name and feedback', () => {
    const u = useUserStore()
    u.completeOnboarding({ name: 'A', feedback: 'hints' })
    u.updateProfile({ name: 'B' })
    expect(u.name).toBe('B')
    expect(u.interactionPreferences.feedback).toBe('hints')
    u.updateProfile({ feedback: 'direct_answers' })
    expect(u.interactionPreferences.feedback).toBe('direct_answers')
  })

  it('updateProfile trims and falls back to "Learner"', () => {
    const u = useUserStore()
    u.completeOnboarding({ name: 'A', feedback: 'hints' })
    u.updateProfile({ name: '   ' })
    expect(u.name).toBe('Learner')
  })
})
