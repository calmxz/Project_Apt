import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { whenRendererReady } from '../lib/markdownRenderer.js'
import MarkdownContent from '../components/chat/MarkdownContent.vue'

// P1: KaTeX is dynamic-imported on first sight of math, so a math assertion
// waits for the plugin to land and the component to re-render.
async function settle() {
  await whenRendererReady()
  await flushPromises()
}

describe('MarkdownContent', () => {
  it('renders bold and italics', () => {
    const w = mount(MarkdownContent, { props: { text: '**bold** and *italic*' } })
    expect(w.html()).toContain('<strong>bold</strong>')
    expect(w.html()).toContain('<em>italic</em>')
  })

  it('renders fenced code with language class', () => {
    const w = mount(MarkdownContent, {
      props: { text: '```python\ndef foo():\n    pass\n```' },
    })
    expect(w.html()).toMatch(/<code class="language-python[^"]*"/)
  })

  it('renders inline math through KaTeX', async () => {
    const w = mount(MarkdownContent, { props: { text: 'cost $O(n)$ done' } })
    await settle()
    expect(w.html()).toContain('class="katex"')
  })

  it('renders display math through KaTeX', async () => {
    const w = mount(MarkdownContent, { props: { text: '$$\\int_0^1 x dx$$' } })
    await settle()
    expect(w.html()).toContain('class="katex-display"')
  })

  it('renders tables', () => {
    const w = mount(MarkdownContent, {
      props: { text: '| a | b |\n|---|---|\n| 1 | 2 |' },
    })
    expect(w.html()).toContain('<table')
  })

  it('sanitizes raw script tags via DOMPurify', () => {
    const w = mount(MarkdownContent, { props: { text: '<script>x=1</script>hello' } })
    expect(w.html()).not.toContain('<script>')
  })

  it('streaming mode: holds back unclosed math as deferred monospace', () => {
    const w = mount(MarkdownContent, {
      props: { text: 'cost is $O(log ', streaming: true },
    })
    expect(w.html()).toContain('cost is')
    expect(w.html()).toContain('class="deferred"')
    expect(w.html()).toContain('$O(log')
  })

  it('streaming mode: full render once math closes', async () => {
    const w = mount(MarkdownContent, {
      props: { text: 'cost is $O(n)$', streaming: true },
    })
    await settle()
    expect(w.html()).toContain('class="katex"')
    expect(w.html()).not.toContain('class="deferred"')
  })

  it('non-streaming mode: re-renders any open region as literal (defensive)', () => {
    const w = mount(MarkdownContent, {
      props: { text: 'cost is $O(log ', streaming: false },
    })
    // Should render the dollar literally rather than throw.
    expect(w.html()).toContain('$O(log')
  })

  it('renders empty text without throwing', () => {
    const w = mount(MarkdownContent, { props: { text: '' } })
    expect(w.exists()).toBe(true)
  })
})
