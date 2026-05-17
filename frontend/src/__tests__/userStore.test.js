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
    expect(u.userId).toBeNull()
    expect(u.name).toBeNull()
    expect(u.onboardingComplete).toBe(false)
  })

  it('loadFromLocalStorage hydrates from saved data', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        userId: 'u_x',
        name: 'Eddy',
        interactionPreferences: { feedback: 'hints' },
        onboardingComplete: true,
      }),
    )
    const u = useUserStore()
    u.loadFromLocalStorage()
    expect(u.userId).toBe('u_x')
    expect(u.name).toBe('Eddy')
    expect(u.onboardingComplete).toBe(true)
  })

  it('loadFromLocalStorage drops a corrupt entry', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    const u = useUserStore()
    u.loadFromLocalStorage()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(u.userId).toBeNull()
  })

  it('loadFromLocalStorage does nothing when no entry', () => {
    const u = useUserStore()
    u.loadFromLocalStorage()
    expect(u.userId).toBeNull()
  })

  it('completeOnboarding assigns id, name, prefs and persists', () => {
    const u = useUserStore()
    u.completeOnboarding({ name: 'Edward', feedback: 'direct_answers' })
    expect(u.userId).toBeTruthy()
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

  it('completeOnboarding preserves existing userId', () => {
    const u = useUserStore()
    u.completeOnboarding({ name: 'A', feedback: 'hints' })
    const first = u.userId
    u.completeOnboarding({ name: 'B', feedback: 'hints' })
    expect(u.userId).toBe(first)
  })

  it('resetOnboarding clears everything', () => {
    const u = useUserStore()
    u.completeOnboarding({ name: 'A', feedback: 'hints' })
    u.resetOnboarding()
    expect(u.userId).toBeNull()
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

  it('generates uuid when crypto.randomUUID exists, falls back otherwise', () => {
    const u = useUserStore()
    const originalCrypto = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: () => 'fixed-uuid' },
      configurable: true,
    })
    u.completeOnboarding({ name: 'A', feedback: 'hints' })
    expect(u.userId).toBe('fixed-uuid')

    u.resetOnboarding()
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true })
    u.completeOnboarding({ name: 'B', feedback: 'hints' })
    expect(u.userId).toMatch(/^u_/)

    Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true })
  })
})
