import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../lib/markdownRenderer.js'

describe('code-block chrome', () => {
  it('wraps fenced code with a header bar containing language tag and copy button', () => {
    const html = renderMarkdown('```python\nprint("hi")\n```')
    expect(html).toContain('class="code-block-header"')
    expect(html).toMatch(/class="code-block-lang"[^>]*>python/)
    expect(html).toContain('data-copy-button')
  })

  it('shows "plain" when no language is given', () => {
    const html = renderMarkdown('```\nx = 1\n```')
    expect(html).toMatch(/class="code-block-lang"[^>]*>plain/)
  })

  it('preserves highlight.js spans inside the code block', () => {
    const html = renderMarkdown('```python\ndef foo(): pass\n```')
    expect(html).toContain('hljs-keyword')
  })
})
