import { test, expect } from '@playwright/test'

// TODO(phase-8): un-skip when the auth-session seeding helper + Postgres service
// in e2e.yml land (same gate as onboarding-to-chat.spec.js). Blank path only —
// no live LLM; the draft path is covered by mocked unit tests.
test.describe.skip('subject blank create', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies()
    await context.addInitScript(() => { try { localStorage.clear() } catch { /* ignore */ } })
  })

  test('build a blank subject, open a lesson, send a message, return to overview', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('home-build-start').click()
    await expect(page).toHaveURL(/\/subjects\/new$/)

    await page.getByTestId('wizard-title-input').fill('Organic Chemistry')
    await page.getByTestId('wizard-next').click()       // -> duration
    await page.getByTestId('wizard-timeline-14').click()
    await page.getByTestId('wizard-next').click()       // -> plan source
    await page.getByTestId('wizard-mode-blank').click() // -> editor

    await page.getByTestId('wizard-lesson-title').fill('Bonding basics')
    await page.getByTestId('wizard-lesson-goal').fill('Understand covalent bonds')
    await page.getByTestId('wizard-add-lesson').click()
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
