import { test, expect } from '@playwright/test'

// TODO(phase-8): this still needs the auth-session-seeding helper + Postgres
// service in e2e.yml (owed WS-G gate — see docs/planning "paid live smokes")
// before it can pass against a real Supabase-gated deploy: the app now
// redirects unauthenticated visits to /login (see auth.spec.js), and no
// seeding helper exists yet to get a Playwright session past that gate.
// Un-skipped per the roadmap-slice3 plan (Task 12) so the flow/assertions are
// ready the moment that infra lands; every other content-flow spec in this
// folder is still skipped for the identical reason. The Playwright job in
// e2e.yml runs with `continue-on-error: true` (non-blocking soak), so this
// spec failing today does not gate a PR.
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

  test('continue topic from library carries profile into a new session', async ({ page }) => {
    const topic = `Recursion-${Date.now()}`

    // Onboarding.
    await page.goto('/')
    await page.getByTestId('onboarding-submit').click()
    await expect(page).toHaveURL(/\/$/)

    // Session A: fresh, via Home's quick-start card (home-new-session /
    // /new flow was replaced by the single-input quick card).
    await page.getByTestId('home-quick-topic').fill(topic)
    await page.getByTestId('home-quick-go').click()
    await expect(page).toHaveURL(/\/session\//)

    // Capture session id from the URL so we can target the sidebar row and
    // the library's Continue-topic button for it later.
    const sessionId = page.url().split('/session/')[1].split(/[?#]/)[0]

    await page.getByTestId('session-input').fill('teach me base cases')
    await page.getByTestId('session-send').click()
    await expect(page.getByTestId('msg-assistant').last()).toContainText('[STUB:fresh]')

    // End session A. There is no in-page end control on SessionView; ending
    // happens from the session's row in the sidebar (overflow menu -> End
    // session), which awaits the end-of-session summary synchronously and
    // persists it onto topic_profile.last_session_summary.
    await page
      .locator(`[data-session-id="${sessionId}"] [data-testid="sidebar-row-menu-trigger"]`)
      .click()
    await page.getByTestId('sidebar-row-menu-end').click()

    // Continue topic from the Sessions library, Ended filter.
    await page.goto('/sessions')
    await page.getByTestId('library-filter-ended').click()
    await page.getByTestId(`library-continue-${sessionId}`).click()

    // A brand-new session (seed_mode=resume, priorSessionId=A) is created;
    // the URL must not still point at ended session A.
    await expect(page).toHaveURL(/\/session\//)
    await expect(page).not.toHaveURL(new RegExp(`/session/${sessionId}$`))

    await page.getByTestId('session-input').fill('continue')
    await page.getByTestId('session-send').click()

    // Continue-topic carries session A's last_session_summary into session
    // B's profile. The stub emits "[STUB:resumed:<hash8>]" whenever a
    // LAST_SESSION_SUMMARY line is present in the assembled system prompt
    // (backend/agent/_stub.py), which is the resumed-profile signal this
    // spec asserts on.
    const assistant = page.getByTestId('msg-assistant').last()
    await expect(assistant).toBeVisible()
    await expect(assistant).toContainText('[STUB:resumed:')
  })
})
