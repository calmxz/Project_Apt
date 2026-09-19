import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// P1: KaTeX and highlight.js are pulled in on demand, so the module keeps
// singleton state (which plugins have landed). Every test resets the module
// registry and re-imports, otherwise a test that ran earlier could have
// already loaded the plugin and "does not load" could never fail.
beforeEach(() => {
  vi.resetModules()
})

async function freshRenderer() {
  return await import('../lib/markdownRenderer.js')
}

describe('markdownRenderer lazy assets', () => {
  it('renders plain markdown without loading katex or highlight.js', async () => {
    const { renderMarkdown, whenRendererReady, markdownAssetsVersion } = await freshRenderer()
    const html = renderMarkdown('just **plain** prose with a [link](https://example.com)')
    await whenRendererReady()
    expect(html).toContain('<strong>plain</strong>')
    expect(html).not.toContain('katex')
    expect(html).not.toContain('hljs-')
    expect(markdownAssetsVersion.value).toBe(0)
  })

  it('math triggers the katex load and the next render carries katex markup', async () => {
    const { renderMarkdown, whenRendererReady, markdownAssetsVersion } = await freshRenderer()
    const first = renderMarkdown('the identity $e^{i\\pi} + 1 = 0$ holds')
    expect(first).not.toContain('katex')
    await whenRendererReady()
    expect(markdownAssetsVersion.value).toBeGreaterThan(0)
    const second = renderMarkdown('the identity $e^{i\\pi} + 1 = 0$ holds')
    expect(second).toContain('katex')
  })

  it('a fenced block triggers the highlight.js load and the next render is highlighted', async () => {
    const { renderMarkdown, whenRendererReady, markdownAssetsVersion } = await freshRenderer()
    const src = '```python\ndef foo(): pass\n```'
    const first = renderMarkdown(src)
    // Fallback chrome is intact even before highlight.js lands.
    expect(first).toContain('class="code-block-header"')
    expect(first).toContain('data-copy-button')
    expect(first).toContain('def foo(): pass')
    expect(first).not.toContain('hljs-keyword')
    await whenRendererReady()
    expect(markdownAssetsVersion.value).toBeGreaterThan(0)
    expect(renderMarkdown(src)).toContain('hljs-keyword')
  })

  it('plain prose after a fence does not re-trigger a load', async () => {
    const { renderMarkdown, whenRendererReady, markdownAssetsVersion } = await freshRenderer()
    renderMarkdown('```python\ndef foo(): pass\n```')
    await whenRendererReady()
    const settled = markdownAssetsVersion.value
    renderMarkdown('```python\ndef bar(): pass\n```')
    await whenRendererReady()
    expect(markdownAssetsVersion.value).toBe(settled)
  })
})

describe('MarkdownContent re-renders when a lazy asset lands', () => {
  it('shows katex markup after the plugin arrives, without a prop change', async () => {
    const { whenRendererReady } = await freshRenderer()
    // Imported after the reset so the component binds to this same instance.
    const MarkdownContent = (await import('../components/chat/MarkdownContent.vue')).default
    const w = mount(MarkdownContent, { props: { text: 'mass $E = mc^2$ energy' } })
    expect(w.html()).not.toContain('katex')
    await whenRendererReady()
    await flushPromises()
    expect(w.html()).toContain('katex')
  })

  it('shows highlighted code after highlight.js arrives, without a prop change', async () => {
    const { whenRendererReady } = await freshRenderer()
    const MarkdownContent = (await import('../components/chat/MarkdownContent.vue')).default
    const w = mount(MarkdownContent, { props: { text: '```python\ndef foo(): pass\n```' } })
    expect(w.html()).not.toContain('hljs-keyword')
    await whenRendererReady()
    await flushPromises()
    expect(w.html()).toContain('hljs-keyword')
  })
})
