import { test, expect } from '@playwright/test'

test.describe('resume carries profile', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies()
    await context.addInitScript(() => {
      try {
        localStorage.clear()
      } catch {
        // Ignore SecurityErrors on isolated/about:blank pages.
      }
    })
  })

  test('end session A, resume on same topic, assistant reply marks it as resumed', async ({
    page,
  }) => {
    const topic = `Recursion-${Date.now()}`

    // Onboarding.
    await page.goto('/')
    await page.getByTestId('onboarding-submit').click()
    await expect(page).toHaveURL(/\/$/)

    // Session A: fresh, send a turn, end it.
    await page.getByTestId('home-new-session').click()
    await page.getByTestId('new-topic').fill(topic)
    await page.getByTestId('new-submit').click()
    await expect(page).toHaveURL(/\/session\//)

    await page.getByTestId('session-input').fill('teach me base cases')
    await page.getByTestId('session-send').click()
    await expect(page.getByTestId('msg-assistant').last()).toContainText('[STUB:fresh]')

    await page.getByTestId('session-end').click()
    await expect(page.getByTestId('session-summary-dialog')).toBeVisible()

    // Close dialog returns to home.
    await page.getByTestId('session-summary-close').click()
    await expect(page).toHaveURL(/\/$/)

    // Session B: resume on same topic.
    await page.getByTestId('home-new-session').click()
    await page.getByTestId('new-topic').fill(topic)

    // Switch to resume mode.
    await page.getByTestId('new-mode').getByText('Resume').click()

    // Pick the only prior session.
    await page.getByTestId('new-prior').click()
    await page.getByRole('option').first().click()

    await page.getByTestId('new-submit').click()
    await expect(page).toHaveURL(/\/session\//)

    await page.getByTestId('session-input').fill('continue')
    await page.getByTestId('session-send').click()

    const assistant = page.getByTestId('msg-assistant').last()
    await expect(assistant).toBeVisible()
    await expect(assistant).toContainText('[STUB:resumed:')
  })
})
