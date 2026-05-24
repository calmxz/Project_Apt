// Magic-link auth gate (Phase 7 T9).
//
// Three flows exercised end-to-end against the real app bundle:
//   1) Unauthenticated visit to a protected route is redirected to /login.
//   2) /login renders the magic-link form and validates the email field.
//   3) Submitting a valid email calls Supabase's OTP endpoint and surfaces
//      the "check your inbox" confirmation. Supabase is stubbed via
//      `page.route` so the test runs offline.
//
// The Supabase client reads VITE_SUPABASE_URL at bundle time. If that env
// var is unset, the app constructs a stub client against
// `http://placeholder.invalid` — which is what we route-match here.
import { test, expect } from '@playwright/test'

test.describe('auth gate', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.clearCookies()
    await context.addInitScript(() => {
      try {
        localStorage.clear()
        sessionStorage.clear()
      } catch {
        /* about:blank / isolated contexts can throw SecurityError */
      }
    })

    // Stub Supabase OTP endpoint regardless of which project URL the app
    // was built against. Matches both real-looking supabase.co URLs and
    // the placeholder.invalid fallback used in unconfigured dev envs.
    await page.route('**/auth/v1/otp**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: {}, error: null }),
      })
    })
    // Some Supabase JS versions probe /auth/v1/settings on init; return a
    // permissive payload so the client doesn't error out before our flow runs.
    await page.route('**/auth/v1/settings**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ external: {}, mfa: {}, disable_signup: false }),
      })
    })
  })

  test('unauthenticated visit to / is redirected to /login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByTestId('login-form')).toBeVisible()
  })

  test('login form disables submit until email is valid', async ({ page }) => {
    await page.goto('/login')
    const submit = page.getByTestId('login-submit')
    await expect(submit).toBeDisabled()

    await page.getByTestId('login-email').fill('not-an-email')
    await expect(submit).toBeDisabled()

    await page.getByTestId('login-email').fill('me@example.com')
    await expect(submit).toBeEnabled()
  })

  test('submitting a valid email shows the sent confirmation', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('login-email').fill('me@example.com')
    await page.getByTestId('login-submit').click()

    await expect(page.getByTestId('login-sent')).toBeVisible()
    await expect(page.getByTestId('login-sent')).toContainText('me@example.com')
  })
})
