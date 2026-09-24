// R2 (UI audit 2026-09-13): at 390x844 with an open check-question batch the
// card was pinned in the notes foot, taking a fixed ~420px out of the viewport.
// The transcript scroller collapsed to ~190px, and expanding the cue strip took
// it to 0px and pushed the composer below the fold (top: 846 on an 840 viewport).
//
// #346 then made the document the scroller: the card scrolls with the page and
// the composer is pinned by a sticky foot. This spec locks what must hold in
// the worst case (cue strip expanded, batch open): the composer and the strip
// stay on screen at both ends of the scroll, the card is never hidden behind
// the foot, and opening the profile never grows the page. A second test checks
// the desktop profile panel stays in view while the page scrolls.
//
// Like auth.spec.js, it runs entirely offline: Supabase GoTrue and every /api
// call is stubbed with page.route, so no backend and no Postgres are needed —
// only the Vite dev server that playwright.config.js starts.
import { test, expect } from '@playwright/test'

const SESSION_ID = 's-mobile-check'
const VIEWPORT = { width: 390, height: 844 }

// A profile long enough that the expanded cue body would overflow the viewport
// if it were not capped — this is the state that broke before the fix.
const TOPIC_PROFILE = {
  knowledge_level: 'intermediate',
  subtopic_levels: {
    glycolysis: 'intermediate',
    'electron transport chain': 'beginner',
    'Krebs cycle': 'advanced',
  },
  focus_target_gap: 'ATP yield per glucose',
  confirmed_gaps: [
    { name: 'ATP yield per glucose', evidence_type: 'tested', last_event_at: null },
    { name: 'proton gradient coupling', evidence_type: 'declared', last_event_at: null },
    { name: 'substrate-level phosphorylation', evidence_type: 'tested', last_event_at: null },
    { name: 'NADH shuttle systems', evidence_type: 'declared', last_event_at: null },
    { name: 'oxidative decarboxylation', evidence_type: 'tested', last_event_at: null },
  ],
  mastered_concepts: [
    { name: 'glycolysis net yield', evidence_type: 'tested', last_event_at: null },
    { name: 'pyruvate transport', evidence_type: 'tested', last_event_at: null },
    { name: 'anaerobic fermentation', evidence_type: 'declared', last_event_at: null },
  ],
}

const MESSAGES = Array.from({ length: 12 }, (_, i) => ({
  id: `m${i}`,
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: `Turn ${i}: cellular respiration, oxidative phosphorylation and the ATP ledger.`,
  citations: [],
  created_at: '2026-01-01T00:00:00Z',
  status: 'complete',
}))

// loadSession seeds store.pendingCheck straight from this payload, so no SSE
// stubbing is needed to get an open batch on screen.
const PENDING_CHECK = {
  gap: 'ATP yield per glucose',
  total: 3,
  current_index: 0,
  items: [
    {
      question: 'How many ATP does one glucose yield through aerobic respiration?',
      options: ['2', '18', '30-32', '100'],
      status: 'pending',
    },
    {
      question: 'Where does the Krebs cycle run?',
      options: ['cytosol', 'matrix'],
      status: 'pending',
    },
    {
      question: 'What reduces oxygen at complex IV?',
      options: ['NADH', 'cytochrome c'],
      status: 'pending',
    },
  ],
}

const SESSION = {
  id: SESSION_ID,
  topic: 'Cellular respiration',
  created_at: '2026-01-01T00:00:00Z',
  ended_at: null,
  pinned: false,
  messages: MESSAGES,
  has_more_messages: false,
  topic_profile: TOPIC_PROFILE,
  pending_check: PENDING_CHECK,
}

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

test.use({ viewport: VIEWPORT, hasTouch: true })

test.describe('mobile 390 check card', () => {
  test.beforeEach(async ({ context, page }) => {
    // No addInitScript storage wipe here (unlike auth.spec.js): it re-runs on
    // every navigation, which would drop the supabase-js session between the
    // sign-in below and the page.goto in the test. A fresh Playwright context
    // already starts with empty storage.
    await context.clearCookies()

    // --- Supabase GoTrue (same stubbing approach as auth.spec.js) ---
    await page.route('**/auth/v1/settings**', (route) =>
      json(route, { external: {}, mfa: {}, disable_signup: false }),
    )
    await page.route('**/auth/v1/token**', (route) =>
      json(route, {
        access_token: 'e2e-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'e2e-refresh-token',
        user: {
          id: 'u-e2e',
          aud: 'authenticated',
          role: 'authenticated',
          email: 'me@example.com',
          app_metadata: {},
          user_metadata: {},
          created_at: '2026-01-01T00:00:00Z',
        },
      }),
    )
    await page.route('**/auth/v1/user**', (route) =>
      json(route, { id: 'u-e2e', email: 'me@example.com', app_metadata: {}, user_metadata: {} }),
    )

    // --- Backend. One catch-all so an endpoint we did not anticipate returns
    // an empty payload instead of a network error toast over the layout. ---
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '')
      if (path === '/me') {
        return json(route, {
          display_name: 'Eddy',
          feedback_pref: 'hints',
          onboarding_complete: true,
        })
      }
      if (path === '/sessions') return json(route, { sessions: [], active_total: 1 })
      if (path === `/sessions/${SESSION_ID}`) return json(route, SESSION)
      if (path === `/profile/${SESSION_ID}`) {
        return json(route, { profile: TOPIC_PROFILE, etag: 'e2e-etag' })
      }
      return json(route, {})
    })

    // Sign in through the real form so supabase-js persists the session itself
    // (its localStorage key is derived from VITE_SUPABASE_URL at bundle time).
    await page.goto('/login')
    await page.getByTestId('login-email').fill('me@example.com')
    await page.getByTestId('login-password').fill('hunter2pw')
    await page.getByTestId('login-submit').click()
    await expect(page).toHaveURL(/\/$/)
  })

  const docHeight = (page) => page.evaluate(() => document.documentElement.scrollHeight)
  const scrollDoc = (page, y) => page.evaluate((top) => window.scrollTo(0, top), y)

  async function expectInViewport(locator, height) {
    const box = await locator.boundingBox()
    expect(box).not.toBeNull()
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(height)
  }

  test('the page scrolls, the card rides the transcript, composer and strip stay put', async ({
    page,
  }) => {
    await page.goto(`/session/${SESSION_ID}`)

    const messages = page.getByTestId('session-messages')
    const send = page.getByTestId('session-send')
    const disclosure = page.getByTestId('cue-disclosure')
    await expect(page.getByTestId('check-card')).toBeVisible()

    // The card scrolls with the transcript rather than sitting in the foot.
    await expect(messages.getByTestId('check-card')).toHaveCount(1)

    // The document is the scroller, not the .messages box.
    expect(await messages.evaluate((el) => getComputedStyle(el).overflowY)).toBe('visible')
    const before = await docHeight(page)
    expect(before).toBeGreaterThan(VIEWPORT.height)

    // Worst case: expand the cue strip so the profile is on screen too. The
    // profile sheet overlays the thread, so the page must not grow (an
    // escaping absolute box once added ~290px of phantom height, 2026-09-16).
    await disclosure.click()
    await expect(page.getByTestId('cue-focus')).toBeVisible()
    expect(await docHeight(page)).toBe(before)

    for (const y of [0, before]) {
      await scrollDoc(page, y)
      await expectInViewport(send, VIEWPORT.height)
      await expectInViewport(disclosure, VIEWPORT.height)
    }

    // Fully scrolled, the card clears the sticky foot instead of hiding under it.
    await disclosure.click()
    const cardBox = await page.getByTestId('check-card').boundingBox()
    const footBox = await page.locator('.notes-foot').boundingBox()
    expect(cardBox).not.toBeNull()
    expect(footBox).not.toBeNull()
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(footBox.y)
  })

  test('the desktop profile panel stays in view while the page scrolls', async ({ page }) => {
    const desktop = { width: 1366, height: 768 }
    await page.setViewportSize(desktop)
    await page.goto(`/session/${SESSION_ID}`)
    await expect(page.getByTestId('check-card')).toBeVisible()

    const height = await docHeight(page)
    expect(height).toBeGreaterThan(desktop.height)

    await scrollDoc(page, 0)
    await expectInViewport(page.getByTestId('session-send'), desktop.height)

    await scrollDoc(page, height)
    await expectInViewport(page.getByTestId('session-send'), desktop.height)
    const cue = await page.locator('.cue').boundingBox()
    expect(cue).not.toBeNull()
    expect(cue.y).toBeGreaterThanOrEqual(0)
    expect(cue.y).toBeLessThan(desktop.height / 2)
  })
})
