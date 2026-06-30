import { test, expect } from '@playwright/test'

// TODO(phase-8): un-skip when the auth-session seeding helper + Postgres service
// in e2e.yml land (same gate as onboarding-to-chat.spec.js).
test.describe.skip('subject blank create', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies()
    await context.addInitScript(() => { try { localStorage.clear() } catch { /* ignore */ } })
  })

  test('build a subject via 2-step wizard, open the auto-seeded lesson, send a message, return to overview', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('home-build-start').click()
    await expect(page).toHaveURL(/\/subjects\/new$/)

    // Step 1: Title
    await page.getByTestId('wizard-title-input').fill('Organic Chemistry')
    await page.getByTestId('wizard-next').click()
    // Step 2: Duration (defaults: 30 min, deadline mode, 14-day timeline)
    // Optionally click wizard-timeline-14 to be explicit; defaults already apply
    await page.getByTestId('wizard-timeline-14').click()
    await page.getByTestId('wizard-create').click()

    await expect(page).toHaveURL(/\/subjects\/[^/]+$/)
    await expect(page.getByTestId('subject-overview')).toBeVisible()

    await page.getByTestId('subject-open-next').click()
    await expect(page).toHaveURL(/\/session\//)
    await page.getByTestId('session-input').fill('what is a covalent bond?')
    await page.getByTestId('session-send').click()
    await expect(page.getByTestId('session-lesson-back')).toBeVisible()

    await page.getByTestId('session-lesson-back').click()
    await expect(page.getByTestId('subject-overview')).toBeVisible()
  })
})
