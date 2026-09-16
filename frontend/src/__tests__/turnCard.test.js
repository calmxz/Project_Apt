import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mount } from '@vue/test-utils'
import AssistantBubble from '@/components/chat/AssistantBubble.vue'
import UserBubble from '@/components/chat/UserBubble.vue'

// Cornell pitch grid retired 2026-09-15; cards now. Every turn is an index
// card (tutor = white stock, learner = blue stock) instead of a row on a
// ruled page. This file guards the card anatomy that replaced the pitch
// grammar the old turnPitch.test.js pinned. The rules are read from the SFC
// source because vitest does not apply scoped styles to a jsdom mount.
function styleOf(rel) {
  const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
  return src.slice(src.indexOf('<style'))
}

function ruleBody(css, selector) {
  const at = css.indexOf(`${selector} {`)
  expect(at, `${selector} rule missing`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}

const CASES = [
  ['AssistantBubble', '../components/chat/AssistantBubble.vue'],
  ['UserBubble', '../components/chat/UserBubble.vue'],
]

describe('turns are cards, not ruled rows', () => {
  it.each(CASES)('%s renders the card anatomy (radius, no pitch padding)', (_name, rel) => {
    const body = ruleBody(styleOf(rel), '.msg')
    expect(body).toContain('border-radius: var(--radius-card)')
    expect(body).not.toMatch(/padding:\s*var\(--line-pitch\)/)
  })

  it.each(CASES)('%s makes the head line a flex row', (_name, rel) => {
    const body = ruleBody(styleOf(rel), '.msg-gutter')
    expect(body).toMatch(/display:\s*flex/)
    expect(body).not.toMatch(/flex-direction:\s*column/)
  })

  it('the landed tick stays out of flow in the head line', () => {
    const body = ruleBody(styleOf('../components/chat/AssistantBubble.vue'), '.landed-tick')
    expect(body).toMatch(/position:\s*absolute/)
  })

  it('renders one-line turns with their test ids and card class intact', () => {
    const a = mount(AssistantBubble, { props: { message: { content: 'One line.' } } })
    expect(a.get('[data-testid="msg-assistant"]').classes()).toContain('msg')
    const u = mount(UserBubble, { props: { content: 'One line.' } })
    expect(u.get('[data-testid="msg-user"]').classes()).toContain('msg')
  })
})
