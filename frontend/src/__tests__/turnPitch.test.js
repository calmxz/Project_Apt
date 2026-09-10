import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mount } from '@vue/test-utils'
import AssistantBubble from '@/components/chat/AssistantBubble.vue'
import UserBubble from '@/components/chat/UserBubble.vue'

// The notes column paints a 28px ruled background, so every turn must occupy a
// whole multiple of --line-pitch. jsdom has no layout engine -- offsetHeight is
// always 0 -- so the height itself cannot be asserted here (it was measured in
// Chrome: a one-line turn is 56px, one pitch of padding plus one line). What
// this file guards is the CSS that made it 57px: a role tag that shares its
// parent's line box, and any border on the turn that would consume layout
// height. The rules are read from the SFC source because vitest does not apply
// scoped styles to a jsdom mount.
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

describe('turn blocks stay on the 28px pitch', () => {
  it.each(CASES)('%s declares no layout-consuming border on the turn', (_name, rel) => {
    const body = ruleBody(styleOf(rel), '.msg')
    expect(body).not.toMatch(/\bborder(-top|-bottom|-block)?\s*:/)
    expect(body).toContain('padding: var(--line-pitch) 0 0')
  })

  it.each(CASES)('%s blockifies the role tag so the gutter is one pitch', (_name, rel) => {
    const body = ruleBody(styleOf(rel), '.msg-gutter')
    expect(body).toMatch(/display:\s*flex/)
    expect(body).toMatch(/flex-direction:\s*column/)
  })

  it('the landed tick is taken out of flow so it adds no gutter height', () => {
    const body = ruleBody(styleOf('../components/chat/AssistantBubble.vue'), '.landed-tick')
    expect(body).toMatch(/position:\s*absolute/)
  })

  it('renders one-line turns with their test ids intact', () => {
    const a = mount(AssistantBubble, { props: { message: { content: 'One line.' } } })
    expect(a.get('[data-testid="msg-assistant"]').classes()).toContain('msg')
    const u = mount(UserBubble, { props: { content: 'One line.' } })
    expect(u.get('[data-testid="msg-user"]').classes()).toContain('msg')
  })
})
