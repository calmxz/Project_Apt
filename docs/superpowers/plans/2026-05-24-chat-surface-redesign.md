# Chat Surface Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw-markdown chat surface with a fully rendered, SSE-streamed, Claude.ai-styled chat experience — backed by a server-side cancellation path with cost-accurate accounting.

**Architecture:** Three sequenced PRs off `feat/chat-surface-redesign` (cut from `dev`). PR 1 ships the markdown render pipeline with the existing JSON endpoint untouched; PR 2 adds the SSE backend + frontend stream service behind a `VITE_CHAT_STREAM` feature flag; PR 3 completes the 10-component split, applies the Claude.ai visual tokens, wires the Stop button, and flips the flag default.

**Tech Stack:** Vue 3 + Pinia + Vite + Vitest (frontend); FastAPI + SQLAlchemy + Alembic + pytest + LiteLLM (backend); markdown-it + KaTeX + highlight.js + DOMPurify (markdown pipeline); fetch + ReadableStream + AbortController (SSE client).

**Spec:** `docs/superpowers/specs/2026-05-24-chat-surface-redesign-design.md`. Read it before starting.

**Branch:** `feat/chat-surface-redesign` (cut from `dev` once Task 0 verifies prereqs).

---

## Task 0: Branch + prerequisites

**Files:** none modified — this is a setup task.

- [ ] **Step 1: Confirm Phase 7 PR #17 is merged on `dev` and CI is green**

Run: `git -C . fetch origin && git -C . log --oneline origin/dev | head -5`
Expected: see commit `a88fc90 Merge supabase intergration and some fixes to dev (#17)` reachable from `origin/dev`.

- [ ] **Step 2: Cut branch from `dev`**

```bash
git checkout dev
git pull --ff-only origin dev
git checkout -b feat/chat-surface-redesign
git push -u origin feat/chat-surface-redesign
```

- [ ] **Step 3: Smoke the existing test suites pass on the fresh branch**

Run from `frontend/`: `npm run test:unit -- --run`
Expected: all existing tests pass (159+ passing as of branch HEAD).

Run from `backend/`: `pytest`
Expected: all existing tests pass.

If either suite fails on a clean branch, stop and fix before any feature work.

- [ ] **Step 4: Commit the spec reference into the branch as a CHANGELOG entry placeholder (no other changes)**

Skip this step if `CHANGELOG.md` does not exist. If it exists:

```bash
# Append a line referencing the spec under an "Unreleased" heading
git add CHANGELOG.md
git commit -m "chore: mark chat surface redesign in changelog"
```

---

# PHASE 1 — Markdown Render Pipeline (PR 1)

PR 1 ships the new markdown render pipeline integrated minimally into the existing non-streaming chat. No backend changes, no SSE, no component split yet. The existing `POST /api/chat` JSON path remains the only chat endpoint. Tool calls and citations render statically from the JSON response, exactly as today, but now with bold/italic/code/math rendered correctly.

## Task 1: Install markdown rendering dependencies

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json` (npm-managed)

- [ ] **Step 1: Install runtime deps**

Run from `frontend/`:

```bash
npm install markdown-it@^14 markdown-it-katex@^2 highlight.js@^11 katex@^0.16 dompurify@^3
```

- [ ] **Step 2: Install dev-deps for types and tests**

```bash
npm install --save-dev @types/markdown-it@^14
```

- [ ] **Step 3: Verify `package.json` lists the new deps under `dependencies`**

Run: `grep -E '"(markdown-it|katex|highlight|dompurify)"' frontend/package.json`
Expected: 5 lines listing markdown-it, markdown-it-katex, highlight.js, katex, dompurify with explicit semver ranges.

- [ ] **Step 4: Confirm `npm run test:unit -- --run` still passes after install**

Run from `frontend/`: `npm run test:unit -- --run`
Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore(frontend): add markdown-it + katex + hljs + dompurify"
```

## Task 2: Markdown stream buffer (delimiter-aware scanner)

The buffer scans a partial markdown string and returns the prefix safe to render. Any region inside an unclosed `$`, `$$`, `` ` ``, or ` ``` ` delimiter is held back until its closer arrives. The "deferred" tail is returned separately so the renderer can show it as plain monospace while waiting.

**Files:**
- Create: `frontend/src/lib/markdownStreamBuffer.js`
- Test: `frontend/src/__tests__/markdownStreamBuffer.test.js`

- [ ] **Step 1: Write the failing test file**

```javascript
// frontend/src/__tests__/markdownStreamBuffer.test.js
import { describe, it, expect } from 'vitest'
import { splitSafePrefix } from '../lib/markdownStreamBuffer.js'

describe('splitSafePrefix', () => {
  it('returns whole text when no delimiters are open', () => {
    expect(splitSafePrefix('plain prose')).toEqual({ safe: 'plain prose', deferred: '' })
  })

  it('holds back text inside unclosed inline math', () => {
    expect(splitSafePrefix('cost is $O(log ')).toEqual({
      safe: 'cost is ',
      deferred: '$O(log ',
    })
  })

  it('emits whole text once inline math closes', () => {
    expect(splitSafePrefix('cost is $O(log n)$ here')).toEqual({
      safe: 'cost is $O(log n)$ here',
      deferred: '',
    })
  })

  it('holds back unclosed display math', () => {
    expect(splitSafePrefix('see $$ \\int_0^1 x ')).toEqual({
      safe: 'see ',
      deferred: '$$ \\int_0^1 x ',
    })
  })

  it('emits closed display math', () => {
    expect(splitSafePrefix('see $$ \\int_0^1 x \\,dx $$ done')).toEqual({
      safe: 'see $$ \\int_0^1 x \\,dx $$ done',
      deferred: '',
    })
  })

  it('holds back unclosed fenced code', () => {
    expect(splitSafePrefix('```python\ndef foo')).toEqual({
      safe: '',
      deferred: '```python\ndef foo',
    })
  })

  it('emits closed fenced code', () => {
    expect(splitSafePrefix('```python\ndef foo():\n  pass\n```\nafter')).toEqual({
      safe: '```python\ndef foo():\n  pass\n```\nafter',
      deferred: '',
    })
  })

  it('holds back unclosed inline code', () => {
    expect(splitSafePrefix('call `foo()')).toEqual({
      safe: 'call ',
      deferred: '`foo()',
    })
  })

  it('emits closed inline code', () => {
    expect(splitSafePrefix('call `foo()` now')).toEqual({
      safe: 'call `foo()` now',
      deferred: '',
    })
  })

  it('breaks inline math on newline (treats as literal $)', () => {
    expect(splitSafePrefix('$broken\nrest')).toEqual({
      safe: '$broken\nrest',
      deferred: '',
    })
  })

  it('prioritizes fenced code over inline backtick when both candidates exist', () => {
    expect(splitSafePrefix('```\n`inner` still in fence')).toEqual({
      safe: '',
      deferred: '```\n`inner` still in fence',
    })
  })

  it('handles fenced code immediately followed by math', () => {
    expect(splitSafePrefix('```py\nx=1\n```\nand $a')).toEqual({
      safe: '```py\nx=1\n```\nand ',
      deferred: '$a',
    })
  })

  it('is empty-safe', () => {
    expect(splitSafePrefix('')).toEqual({ safe: '', deferred: '' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `frontend/`: `npm run test:unit -- --run markdownStreamBuffer`
Expected: FAIL — `Cannot find module '../lib/markdownStreamBuffer.js'`.

- [ ] **Step 3: Implement the buffer**

```javascript
// frontend/src/lib/markdownStreamBuffer.js
//
// Scans a partial markdown buffer and splits it into a "safe" prefix
// (everything outside any unclosed delimited region) and a "deferred" tail
// (the unclosed region plus everything after it). Callers render the safe
// prefix through markdown-it and show the deferred tail as plain monospace
// until more text arrives.
//
// Delimiter precedence (matches markdown-it parse order):
//   fenced code (```)   — strongest, ignores everything inside until ```
//   inline code (`)     — same-line only
//   display math ($$)   — multi-line, balanced
//   inline math ($)     — same-line only, breaks on newline

const FENCE = '```'

function findOpener(text) {
  // Returns { type, index } for the earliest open delimiter, or null.
  const candidates = []
  let i = text.indexOf(FENCE)
  if (i !== -1) candidates.push({ type: 'fence', index: i, len: 3 })
  i = text.indexOf('$$')
  if (i !== -1) candidates.push({ type: 'display', index: i, len: 2 })
  // Inline math: single $, but only if not part of $$
  for (let k = 0; k < text.length; k++) {
    if (text[k] === '$' && text[k + 1] !== '$' && text[k - 1] !== '$') {
      candidates.push({ type: 'inline-math', index: k, len: 1 })
      break
    }
  }
  i = text.indexOf('`')
  if (i !== -1 && (text.slice(i, i + 3) !== FENCE)) {
    candidates.push({ type: 'inline-code', index: i, len: 1 })
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => a.index - b.index)
  return candidates[0]
}

function findCloser(text, opener) {
  const start = opener.index + opener.len
  switch (opener.type) {
    case 'fence': {
      const idx = text.indexOf(FENCE, start)
      return idx === -1 ? -1 : idx + FENCE.length
    }
    case 'display': {
      const idx = text.indexOf('$$', start)
      return idx === -1 ? -1 : idx + 2
    }
    case 'inline-math': {
      // Closes on next $ on same line, breaks on newline
      for (let k = start; k < text.length; k++) {
        if (text[k] === '\n') return start - 1 // treat opener as literal — recurse
        if (text[k] === '$') return k + 1
      }
      return -1
    }
    case 'inline-code': {
      for (let k = start; k < text.length; k++) {
        if (text[k] === '\n') return start - 1
        if (text[k] === '`') return k + 1
      }
      return -1
    }
  }
  return -1
}

export function splitSafePrefix(text) {
  if (!text) return { safe: '', deferred: '' }

  let cursor = 0
  while (cursor < text.length) {
    const tail = text.slice(cursor)
    const opener = findOpener(tail)
    if (!opener) {
      return { safe: text, deferred: '' }
    }
    const absoluteOpenerIndex = cursor + opener.index
    const absoluteOpenerEndIndex = absoluteOpenerIndex + opener.len
    const localCloser = findCloser(tail, opener)
    if (localCloser === -1) {
      // Unclosed — defer from the opener onward.
      return {
        safe: text.slice(0, absoluteOpenerIndex),
        deferred: text.slice(absoluteOpenerIndex),
      }
    }
    if (localCloser < opener.index + opener.len) {
      // Inline math/code "broke" on newline — treat opener as literal and continue.
      cursor = absoluteOpenerEndIndex
      continue
    }
    cursor = cursor + localCloser
  }
  return { safe: text, deferred: '' }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run from `frontend/`: `npm run test:unit -- --run markdownStreamBuffer`
Expected: PASS — all 13 tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/markdownStreamBuffer.js frontend/src/__tests__/markdownStreamBuffer.test.js
git commit -m "feat(chat): markdown stream buffer with delimiter-aware safe-prefix split"
```

## Task 3: MarkdownContent.vue — render pipeline

`MarkdownContent.vue` accepts `text` (raw markdown) and a `streaming` flag. When `streaming` is false, it renders the whole buffer through markdown-it. When `streaming` is true, it splits via `splitSafePrefix`, renders the safe prefix through markdown-it, and appends the deferred tail as plain monospace text in a `<span class="deferred">`.

**Files:**
- Create: `frontend/src/components/chat/MarkdownContent.vue`
- Create: `frontend/src/lib/markdownRenderer.js` (factory: builds and memoizes the configured markdown-it instance)
- Test: `frontend/src/__tests__/markdownContent.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/__tests__/markdownContent.test.js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MarkdownContent from '../components/chat/MarkdownContent.vue'

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
    expect(w.html()).toMatch(/<pre[^>]*><code class="language-python[^"]*"/)
  })

  it('renders inline math through KaTeX', () => {
    const w = mount(MarkdownContent, { props: { text: 'cost $O(n)$ done' } })
    expect(w.html()).toContain('class="katex"')
  })

  it('renders display math through KaTeX', () => {
    const w = mount(MarkdownContent, { props: { text: '$$\\int_0^1 x dx$$' } })
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
    expect(w.html()).toContain('cost is ')
    expect(w.html()).toContain('class="deferred"')
    expect(w.html()).toContain('$O(log ')
  })

  it('streaming mode: full render once math closes', () => {
    const w = mount(MarkdownContent, {
      props: { text: 'cost is $O(n)$', streaming: true },
    })
    expect(w.html()).toContain('class="katex"')
    expect(w.html()).not.toContain('class="deferred"')
  })

  it('non-streaming mode: re-renders any open region as literal (defensive)', () => {
    const w = mount(MarkdownContent, {
      props: { text: 'cost is $O(log ', streaming: false },
    })
    // Should render the dollar literally rather than throw.
    expect(w.html()).toContain('$O(log ')
  })

  it('renders empty text without throwing', () => {
    const w = mount(MarkdownContent, { props: { text: '' } })
    expect(w.exists()).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `frontend/`: `npm run test:unit -- --run markdownContent`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the renderer factory**

```javascript
// frontend/src/lib/markdownRenderer.js
import MarkdownIt from 'markdown-it'
import mdKatex from 'markdown-it-katex'
import hljs from 'highlight.js/lib/core'
import python from 'highlight.js/lib/languages/python'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import sql from 'highlight.js/lib/languages/sql'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'
import DOMPurify from 'dompurify'

hljs.registerLanguage('python', python)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('markdown', markdown)

let _md = null

function build() {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: false,
    highlight: (str, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
        } catch {
          return ''
        }
      }
      return ''
    },
  })
  md.use(mdKatex, { throwOnError: false, errorColor: 'var(--math-accent, #ff6b5b)' })
  return md
}

export function getRenderer() {
  if (!_md) _md = build()
  return _md
}

const PURIFY_CONFIG = {
  ADD_TAGS: ['math', 'semantics', 'annotation', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'msup', 'msub'],
  ADD_ATTR: ['target', 'rel'],
}

export function renderMarkdown(text) {
  if (!text) return ''
  const md = getRenderer()
  const raw = md.render(text)
  return DOMPurify.sanitize(raw, PURIFY_CONFIG)
}
```

- [ ] **Step 4: Implement the component**

```vue
<!-- frontend/src/components/chat/MarkdownContent.vue -->
<script setup>
import { computed } from 'vue'
import { renderMarkdown } from '@/lib/markdownRenderer.js'
import { splitSafePrefix } from '@/lib/markdownStreamBuffer.js'

const props = defineProps({
  text: { type: String, required: true },
  streaming: { type: Boolean, default: false },
})

const parts = computed(() => {
  if (!props.streaming) {
    return { safeHtml: renderMarkdown(props.text), deferred: '' }
  }
  const { safe, deferred } = splitSafePrefix(props.text)
  return { safeHtml: renderMarkdown(safe), deferred }
})
</script>

<template>
  <div class="markdown-content">
    <div class="md-rendered" v-html="parts.safeHtml"></div>
    <span v-if="parts.deferred" class="deferred">{{ parts.deferred }}</span>
  </div>
</template>

<style scoped>
.markdown-content { line-height: 1.6; }
.md-rendered :deep(p) { margin: 0 0 0.6em 0; }
.md-rendered :deep(pre) {
  background: var(--code-block-bg, #f7f3ed);
  color: var(--code-block-text, #2c2316);
  border: 1px solid var(--code-block-border, rgba(0,0,0,0.06));
  border-radius: 8px;
  padding: 12px 14px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  overflow-x: auto;
}
.md-rendered :deep(code:not(pre code)) {
  background: #f4e9d8;
  color: #8a4a00;
  padding: 1px 5px;
  border-radius: 3px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 0.9em;
}
.md-rendered :deep(.katex-display) {
  background: var(--math-bg, #fff8ed);
  border-left: 3px solid var(--math-accent, #ff6b5b);
  padding: 8px 12px;
  margin: 6px 0;
}
.md-rendered :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
}
.md-rendered :deep(th), .md-rendered :deep(td) {
  border: 1px solid rgba(0,0,0,0.08);
  padding: 4px 8px;
}
.deferred {
  font-family: 'Consolas', 'Monaco', monospace;
  white-space: pre-wrap;
  color: var(--color-text-muted, #888);
}
</style>
```

Also need to import KaTeX CSS once. Add to `frontend/src/main.js`:

```javascript
// frontend/src/main.js — add near other CSS imports
import 'katex/dist/katex.min.css'
```

- [ ] **Step 5: Run tests to verify they pass**

Run from `frontend/`: `npm run test:unit -- --run markdownContent`
Expected: PASS — all 10 tests green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/markdownRenderer.js \
        frontend/src/components/chat/MarkdownContent.vue \
        frontend/src/__tests__/markdownContent.test.js \
        frontend/src/main.js
git commit -m "feat(chat): MarkdownContent component with delimiter-aware streaming"
```

## Task 4: Code-block chrome (language tag + copy button)

Override the `fence` renderer in `markdownRenderer.js` so each fenced code block is wrapped with a header bar showing the language and a Copy button. Copy uses `navigator.clipboard.writeText`.

**Files:**
- Modify: `frontend/src/lib/markdownRenderer.js`
- Create: `frontend/src/components/chat/codeBlockClipboard.js` (event delegation handler — wires copy-button clicks at the chat container)
- Test: `frontend/src/__tests__/codeBlockChrome.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/__tests__/codeBlockChrome.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `frontend/`: `npm run test:unit -- --run codeBlockChrome`
Expected: FAIL — header markup not present.

- [ ] **Step 3: Extend the renderer with a fence override**

Add to `frontend/src/lib/markdownRenderer.js`, inside `build()` after `md.use(mdKatex, ...)`:

```javascript
function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const langRaw = token.info.trim().split(/\s+/)[0] || ''
  const lang = langRaw || 'plain'
  let body
  if (langRaw && hljs.getLanguage(langRaw)) {
    body = hljs.highlight(token.content, { language: langRaw, ignoreIllegals: true }).value
  } else {
    body = md.utils.escapeHtml(token.content)
  }
  const langClass = langRaw ? `language-${escapeAttr(langRaw)} hljs` : 'hljs'
  return (
    `<pre class="code-block">` +
    `<div class="code-block-header">` +
    `<span class="code-block-lang">${escapeAttr(lang)}</span>` +
    `<button type="button" class="code-block-copy" data-copy-button>copy</button>` +
    `</div>` +
    `<code class="${langClass}">${body}</code>` +
    `</pre>`
  )
}
```

- [ ] **Step 4: Implement the clipboard event-delegation handler**

```javascript
// frontend/src/components/chat/codeBlockClipboard.js
//
// Wire one delegated click listener at a chat-container element. When a
// child .code-block-copy button is clicked, copy the sibling <code> text.
// Returns a teardown function.
export function attachCopyHandlers(rootEl) {
  function onClick(event) {
    const btn = event.target.closest('[data-copy-button]')
    if (!btn || !rootEl.contains(btn)) return
    const pre = btn.closest('pre.code-block')
    if (!pre) return
    const code = pre.querySelector('code')
    if (!code) return
    const text = code.textContent || ''
    navigator.clipboard?.writeText(text).then(() => {
      btn.textContent = 'copied'
      setTimeout(() => { btn.textContent = 'copy' }, 1500)
    }).catch(() => {
      btn.textContent = 'failed'
      setTimeout(() => { btn.textContent = 'copy' }, 1500)
    })
  }
  rootEl.addEventListener('click', onClick)
  return () => rootEl.removeEventListener('click', onClick)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run from `frontend/`: `npm run test:unit -- --run codeBlockChrome`
Expected: PASS — all 3 tests green. Also confirm `markdownContent` tests still pass:
Run: `npm run test:unit -- --run markdownContent`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/markdownRenderer.js \
        frontend/src/components/chat/codeBlockClipboard.js \
        frontend/src/__tests__/codeBlockChrome.test.js
git commit -m "feat(chat): code-block header w/ language tag + copy button"
```

## Task 5: CitationsList.vue

Static component. Renders the dashed-border footer with doc name and page numbers from the existing `citations` field on assistant messages (returned by `POST /api/chat`).

**Files:**
- Create: `frontend/src/components/chat/CitationsList.vue`
- Test: `frontend/src/__tests__/citationsList.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/__tests__/citationsList.test.js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CitationsList from '../components/chat/CitationsList.vue'

describe('CitationsList', () => {
  it('renders nothing for empty array', () => {
    const w = mount(CitationsList, { props: { citations: [] } })
    expect(w.html().trim()).toBe('<!--v-if-->')
  })

  it('renders document name and page list', () => {
    const w = mount(CitationsList, {
      props: {
        citations: [
          { doc_id: 'algo-ch3', doc_name: 'Algorithms Chapter 3', page: 42 },
          { doc_id: 'algo-ch3', doc_name: 'Algorithms Chapter 3', page: 44 },
        ],
      },
    })
    expect(w.text()).toContain('Algorithms Chapter 3')
    expect(w.text()).toContain('p.42')
    expect(w.text()).toContain('p.44')
  })

  it('groups citations from same document', () => {
    const w = mount(CitationsList, {
      props: {
        citations: [
          { doc_id: 'a', doc_name: 'A', page: 1 },
          { doc_id: 'b', doc_name: 'B', page: 2 },
          { doc_id: 'a', doc_name: 'A', page: 3 },
        ],
      },
    })
    const docs = w.findAll('.citation-doc')
    expect(docs).toHaveLength(2)
    expect(docs[0].text()).toContain('A')
    expect(docs[0].text()).toContain('p.1')
    expect(docs[0].text()).toContain('p.3')
  })

  it('falls back to doc_id when doc_name is missing', () => {
    const w = mount(CitationsList, {
      props: { citations: [{ doc_id: 'fallback-id', page: 7 }] },
    })
    expect(w.text()).toContain('fallback-id')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run citationsList`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the component**

```vue
<!-- frontend/src/components/chat/CitationsList.vue -->
<script setup>
import { computed } from 'vue'

const props = defineProps({
  citations: { type: Array, required: true },
})

const grouped = computed(() => {
  const map = new Map()
  for (const c of props.citations || []) {
    const key = c.doc_id
    const name = c.doc_name || c.doc_id
    if (!map.has(key)) map.set(key, { doc_id: key, doc_name: name, pages: [] })
    map.get(key).pages.push(c.page)
  }
  return Array.from(map.values())
})
</script>

<template>
  <div v-if="grouped.length" class="citations-list">
    <div v-for="doc in grouped" :key="doc.doc_id" class="citation-doc">
      <span class="citation-doc-name">{{ doc.doc_name }}</span>
      <span class="citation-pages">
        <span v-for="(p, i) in doc.pages" :key="i" class="citation-page">p.{{ p }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.citations-list {
  border-top: 1px dashed rgba(0,0,0,0.15);
  margin-top: 10px;
  padding-top: 8px;
  font-size: 11px;
  color: var(--color-text-muted, #888);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.citation-doc { display: flex; gap: 8px; align-items: baseline; }
.citation-doc-name { font-weight: 600; }
.citation-pages { display: inline-flex; gap: 6px; }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run citationsList`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/chat/CitationsList.vue \
        frontend/src/__tests__/citationsList.test.js
git commit -m "feat(chat): CitationsList component"
```

## Task 6: ToolCallChip.vue (static states only — streaming added in Phase 2)

Three visual states: `running`, `done`, `error`. Tool-name → label map lives in `toolLabels.js`. In Phase 1 the component is static (props-only); Phase 2 wires it to live stream events.

**Files:**
- Create: `frontend/src/components/chat/toolLabels.js`
- Create: `frontend/src/components/chat/ToolCallChip.vue`
- Test: `frontend/src/__tests__/toolCallChip.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/__tests__/toolCallChip.test.js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ToolCallChip from '../components/chat/ToolCallChip.vue'

describe('ToolCallChip', () => {
  it('renders running label for retrieve_chunks', () => {
    const w = mount(ToolCallChip, {
      props: { tool_call: { name: 'retrieve_chunks', id: '1' }, state: 'running' },
    })
    expect(w.text()).toMatch(/Searching your document/i)
    expect(w.classes()).toContain('tool-pill--running')
  })

  it('renders running label for update_topic_profile', () => {
    const w = mount(ToolCallChip, {
      props: { tool_call: { name: 'update_topic_profile', id: '1' }, state: 'running' },
    })
    expect(w.text()).toMatch(/Updating profile/i)
  })

  it('renders running label for record_learning_event', () => {
    const w = mount(ToolCallChip, {
      props: { tool_call: { name: 'record_learning_event', id: '1' }, state: 'running' },
    })
    expect(w.text()).toMatch(/Recording answer/i)
  })

  it('renders done label and class', () => {
    const w = mount(ToolCallChip, {
      props: {
        tool_call: { name: 'retrieve_chunks', id: '1', summary: 'Found 5 passages' },
        state: 'done',
      },
    })
    expect(w.text()).toContain('Found 5 passages')
    expect(w.classes()).toContain('tool-pill--done')
  })

  it('renders fallback done label when no summary provided', () => {
    const w = mount(ToolCallChip, {
      props: { tool_call: { name: 'retrieve_chunks', id: '1' }, state: 'done' },
    })
    expect(w.text()).toMatch(/Search complete/i)
  })

  it('renders error label and class', () => {
    const w = mount(ToolCallChip, {
      props: { tool_call: { name: 'retrieve_chunks', id: '1' }, state: 'error' },
    })
    expect(w.text()).toMatch(/Search failed/i)
    expect(w.classes()).toContain('tool-pill--error')
  })

  it('falls back to tool name for unknown tool', () => {
    const w = mount(ToolCallChip, {
      props: { tool_call: { name: 'mystery_tool', id: '1' }, state: 'running' },
    })
    expect(w.text()).toContain('mystery_tool')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run toolCallChip`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the labels map**

```javascript
// frontend/src/components/chat/toolLabels.js
export const TOOL_LABELS = {
  retrieve_chunks: {
    running: 'Searching your document…',
    done: 'Search complete',
    error: 'Search failed — continuing',
  },
  update_topic_profile: {
    running: 'Updating profile…',
    done: 'Profile updated',
    error: 'Profile update failed',
  },
  record_learning_event: {
    running: 'Recording answer…',
    done: 'Answer recorded',
    error: 'Recording failed',
  },
}

export function labelFor(toolName, state) {
  const labels = TOOL_LABELS[toolName]
  if (!labels) return toolName
  return labels[state] || toolName
}
```

- [ ] **Step 4: Implement the component**

```vue
<!-- frontend/src/components/chat/ToolCallChip.vue -->
<script setup>
import { computed } from 'vue'
import { labelFor } from './toolLabels.js'

const props = defineProps({
  tool_call: { type: Object, required: true },
  state: {
    type: String,
    required: true,
    validator: (v) => ['running', 'done', 'error'].includes(v),
  },
})

const display = computed(() => {
  if (props.state === 'done' && props.tool_call.summary) {
    return props.tool_call.summary
  }
  return labelFor(props.tool_call.name, props.state)
})
</script>

<template>
  <span
    class="tool-pill"
    :class="`tool-pill--${state}`"
  >
    <span class="tool-pill-dot" aria-hidden="true"></span>
    <span class="tool-pill-text">{{ display }}</span>
  </span>
</template>

<style scoped>
.tool-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--tool-pill-bg, rgba(255,107,91,0.08));
  border: 1px solid var(--tool-pill-border, rgba(255,107,91,0.2));
  color: var(--tool-pill-text, #c44);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  line-height: 1.2;
}
.tool-pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}
.tool-pill--running .tool-pill-dot {
  animation: tool-pill-pulse 1s ease-in-out infinite;
}
.tool-pill--error {
  background: rgba(0,0,0,0.04);
  border-color: rgba(0,0,0,0.1);
  color: var(--color-text-muted, #888);
}
@keyframes tool-pill-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:unit -- --run toolCallChip`
Expected: PASS — all 7 tests green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/chat/toolLabels.js \
        frontend/src/components/chat/ToolCallChip.vue \
        frontend/src/__tests__/toolCallChip.test.js
git commit -m "feat(chat): ToolCallChip component w/ tool-label map"
```

## Task 7: Wire MarkdownContent into existing SessionView.vue

Replace the `<p class="content">{{ m.content }}</p>` block with `<MarkdownContent :text="m.content" />` for assistant messages and `<MarkdownContent :text="m.content" />` for user messages too (so user input also gets formatted). Render tool-call chips and citations from the existing JSON response fields.

**Files:**
- Modify: `frontend/src/views/SessionView.vue` (around the assistant-message render block; precise line varies — find by searching `{{ m.content }}`)
- Modify: `frontend/src/__tests__/sessionView.test.js` (existing test — update assertions that check raw text rendering)

- [ ] **Step 1: Locate the render block**

Run: `grep -n "m.content" frontend/src/views/SessionView.vue`
Expected: at least one match where `{{ m.content }}` is interpolated into a `<p>`.

- [ ] **Step 2: Read the existing test for SessionView to find which assertions will break**

Run: `grep -n "toContain\|toMatch" frontend/src/__tests__/sessionView.test.js`
Inspect any assertion that expects literal `**bold**` or `$math$` text in the DOM — these will need to expect rendered HTML instead.

- [ ] **Step 3: Modify SessionView.vue**

Inside `<script setup>` add:

```javascript
import MarkdownContent from '@/components/chat/MarkdownContent.vue'
import ToolCallChip from '@/components/chat/ToolCallChip.vue'
import CitationsList from '@/components/chat/CitationsList.vue'
```

In the template, replace the assistant message render block. The current block looks roughly like:

```vue
<div class="message message-assistant">
  <p class="content">{{ m.content }}</p>
</div>
```

Replace with:

```vue
<div class="message message-assistant">
  <span
    v-for="tc in m.tool_calls || []"
    :key="tc.id"
    class="tool-call-row"
  >
    <ToolCallChip :tool_call="tc" state="done" />
  </span>
  <MarkdownContent :text="m.content" />
  <CitationsList :citations="m.citations || []" />
</div>
```

And the user message render block similarly:

```vue
<div class="message message-user">
  <MarkdownContent :text="m.content" />
</div>
```

- [ ] **Step 4: Update SessionView tests**

For each assertion expecting `**` or `$` literal text in rendered HTML, update to expect the rendered output (`<strong>`, `class="katex"`, etc.). Where the test only checked that *some* content appears, keep it but use `w.text()` rather than `w.html()` if possible.

- [ ] **Step 5: Run frontend tests**

Run: `npm run test:unit -- --run`
Expected: all tests pass — especially `sessionView` and the new `markdownContent` / `toolCallChip` / `citationsList` tests.

- [ ] **Step 6: Manual smoke**

Run: `npm run dev`
Open a session, send a message with markdown (`**bold** and $O(n)$ and a ```python block```). Confirm rendering.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/views/SessionView.vue \
        frontend/src/__tests__/sessionView.test.js
git commit -m "feat(chat): render messages through MarkdownContent in SessionView"
```

## Task 8: Aura tokens for chat surface

Add the new tokens listed in spec §5 to `aura-tokens.css`. These will be consumed by Phase 3's component split, but they are declared now so `MarkdownContent.vue` and `ToolCallChip.vue` (which already reference them) resolve to real values instead of fallbacks.

**Files:**
- Modify: `frontend/src/assets/aura-tokens.css`

- [ ] **Step 1: Confirm the tokens file exists**

Run: `ls frontend/src/assets/aura-tokens.css`
Expected: file present. If not, create it and add an import to `frontend/src/main.js`.

- [ ] **Step 2: Add chat tokens**

Append to `frontend/src/assets/aura-tokens.css`:

```css
:root {
  --chat-bubble-bg: #ffffff;
  --chat-bubble-border: rgba(0, 0, 0, 0.06);
  --chat-bubble-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  --chat-bubble-radius: 14px;

  --code-block-bg: #f7f3ed;
  --code-block-border: rgba(0, 0, 0, 0.06);
  --code-block-text: #2c2316;

  --math-bg: #fff8ed;
  --math-accent: #ff6b5b;

  --tool-pill-bg: rgba(255, 107, 91, 0.08);
  --tool-pill-border: rgba(255, 107, 91, 0.2);
  --tool-pill-text: #c44;

  --user-bubble-bg: #ff6b5b;
  --user-bubble-text: #ffffff;
  --user-bubble-radius: 18px 18px 4px 18px;
}
```

- [ ] **Step 3: Run frontend tests**

Run: `npm run test:unit -- --run`
Expected: no regressions.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/assets/aura-tokens.css
git commit -m "feat(chat): aura tokens for chat surface"
```

## Task 9: Phase 1 PR

- [ ] **Step 1: Push branch**

```bash
git push
```

- [ ] **Step 2: Open PR against `dev`**

```bash
gh pr create --base dev --title "feat(chat): markdown render pipeline (Phase 1 of chat redesign)" --body "$(cat <<'EOF'
## Summary
- Add markdown-it + katex + highlight.js + DOMPurify pipeline
- New components: MarkdownContent, ToolCallChip, CitationsList
- Wire into existing SessionView.vue minimally (replace raw-text render)
- No backend changes; existing POST /api/chat JSON path untouched

## Spec
docs/superpowers/specs/2026-05-24-chat-surface-redesign-design.md

## Test plan
- [ ] `npm run test:unit -- --run` green (all suites)
- [ ] Manual: send markdown / math / code in a session, confirm renders
- [ ] Manual: DOMPurify strips `<script>` injected in assistant content
- [ ] No backend-test regressions (`pytest` from backend/)
EOF
)"
```

- [ ] **Step 3: Wait for CI, address review, merge**

CI must be green. After approval, merge into `dev`. After merge, keep working on `feat/chat-surface-redesign` — pull `dev` back in if it advanced:

```bash
git checkout dev
git pull --ff-only origin dev
git checkout feat/chat-surface-redesign
git merge dev
```

---

# PHASE 2 — SSE Backend + Stream Service (PR 2)

Phase 2 adds the streaming path. New endpoint `POST /api/chat/stream`, new `TutorAgent.run_streaming()` async generator, schema migration for cancelled-message persistence, cancel-cost estimator, frontend SSE parser, frontend stream service, Pinia stream state. Feature-gated by `VITE_CHAT_STREAM`. Existing `POST /api/chat` JSON path untouched and remains the default.

## Task 10: Alembic migration — messages.status + cancelled_at

**Files:**
- Create: `backend/db/alembic/versions/0003_messages_status_cancelled_at.py`
- Modify: `backend/db/models.py` (add `status` and `cancelled_at` columns to `Message`)
- Test: `backend/tests/test_message_cancelled_columns.py`

- [ ] **Step 1: Locate the Message model**

Run: `grep -n "class Message" backend/db/models.py`
Expected: one match. Note the existing columns.

- [ ] **Step 2: Write the failing test**

```python
# backend/tests/test_message_cancelled_columns.py
from sqlalchemy import inspect

def test_message_has_status_column(db_engine):
    insp = inspect(db_engine)
    cols = {c['name']: c for c in insp.get_columns('messages')}
    assert 'status' in cols
    assert cols['status']['nullable'] is False

def test_message_has_cancelled_at_column(db_engine):
    insp = inspect(db_engine)
    cols = {c['name']: c for c in insp.get_columns('messages')}
    assert 'cancelled_at' in cols
    assert cols['cancelled_at']['nullable'] is True

def test_existing_rows_backfill_to_complete(db_engine):
    from sqlalchemy import text
    with db_engine.connect() as conn:
        rows = conn.execute(text("SELECT DISTINCT status FROM messages")).all()
        # If any messages exist, they must all have status='complete' after migration.
        for r in rows:
            assert r[0] == 'complete'
```

The test uses a `db_engine` fixture. Check `backend/tests/conftest.py` for the existing fixture pattern. If `db_engine` is not yet defined, add it:

```python
# add to backend/tests/conftest.py if missing
import pytest
from sqlalchemy import create_engine
from backend.db.database import DATABASE_URL

@pytest.fixture(scope='session')
def db_engine():
    return create_engine(DATABASE_URL)
```

- [ ] **Step 3: Run test to verify it fails**

Run from `backend/`: `pytest tests/test_message_cancelled_columns.py -v`
Expected: FAIL — columns missing.

- [ ] **Step 4: Write the Alembic migration**

```python
# backend/db/alembic/versions/0003_messages_status_cancelled_at.py
"""messages.status + cancelled_at

Revision ID: 0003_messages_status_cancelled_at
Revises: 0002_chunk_embeddings
Create Date: 2026-05-24

"""
from alembic import op
import sqlalchemy as sa

revision = '0003_messages_status_cancelled_at'
down_revision = '0002_chunk_embeddings'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'messages',
        sa.Column(
            'status',
            sa.String(length=16),
            nullable=False,
            server_default='complete',
        ),
    )
    op.add_column(
        'messages',
        sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        'messages_status_check',
        'messages',
        "status IN ('complete', 'cancelled', 'error')",
    )


def downgrade() -> None:
    op.drop_constraint('messages_status_check', 'messages', type_='check')
    op.drop_column('messages', 'cancelled_at')
    op.drop_column('messages', 'status')
```

- [ ] **Step 5: Update the SQLAlchemy model**

In `backend/db/models.py`, inside `class Message`, add (place near other column declarations):

```python
status = Column(String(16), nullable=False, server_default='complete')
cancelled_at = Column(DateTime(timezone=True), nullable=True)
```

If `String` and `DateTime` are not imported, add them to the existing `from sqlalchemy import ...` line.

- [ ] **Step 6: Run migration**

Run from `backend/`: `alembic upgrade head`
Expected: `INFO ... Running upgrade 0002_chunk_embeddings -> 0003_messages_status_cancelled_at`

- [ ] **Step 7: Run test to verify it passes**

Run: `pytest tests/test_message_cancelled_columns.py -v`
Expected: PASS — all 3 tests green.

- [ ] **Step 8: Run full backend test suite**

Run: `pytest`
Expected: no regressions.

- [ ] **Step 9: Commit**

```bash
git add backend/db/alembic/versions/0003_messages_status_cancelled_at.py \
        backend/db/models.py \
        backend/tests/test_message_cancelled_columns.py \
        backend/tests/conftest.py
git commit -m "feat(db): messages.status + cancelled_at for stream-cancel persistence"
```

## Task 11: Cost meter — MODEL_RATES + estimate_cancelled_cost

**Files:**
- Modify: `backend/services/cost_meter.py`
- Test: `backend/tests/test_cost_meter_estimate.py`

- [ ] **Step 1: Inspect the existing cost meter**

Run: `cat backend/services/cost_meter.py`
Note the existing functions and where to add new ones.

- [ ] **Step 2: Write the failing test**

```python
# backend/tests/test_cost_meter_estimate.py
from decimal import Decimal
import pytest

from backend.services.cost_meter import (
    estimate_cancelled_cost,
    MODEL_RATES,
)

def test_model_rates_has_default_model():
    # The currently-configured tutor model must have a rate entry.
    from backend.agent.tutor import DEFAULT_MODEL
    assert DEFAULT_MODEL in MODEL_RATES
    rates = MODEL_RATES[DEFAULT_MODEL]
    assert 'input_per_1k' in rates
    assert 'output_per_1k' in rates
    assert isinstance(rates['input_per_1k'], Decimal)
    assert isinstance(rates['output_per_1k'], Decimal)

def test_estimate_cancelled_cost_returns_decimal():
    from backend.agent.tutor import DEFAULT_MODEL
    cost = estimate_cancelled_cost(
        model=DEFAULT_MODEL,
        delta_text='Hello world this is a partial reply',
        prompt_tokens=100,
    )
    assert isinstance(cost, Decimal)
    assert cost > Decimal('0')

def test_estimate_grows_with_delta_length():
    from backend.agent.tutor import DEFAULT_MODEL
    short = estimate_cancelled_cost(
        model=DEFAULT_MODEL, delta_text='short', prompt_tokens=10
    )
    long = estimate_cancelled_cost(
        model=DEFAULT_MODEL,
        delta_text='this is a much longer delta text ' * 20,
        prompt_tokens=10,
    )
    assert long > short

def test_estimate_zero_delta_only_charges_prompt():
    from backend.agent.tutor import DEFAULT_MODEL
    rates = MODEL_RATES[DEFAULT_MODEL]
    cost = estimate_cancelled_cost(
        model=DEFAULT_MODEL, delta_text='', prompt_tokens=1000
    )
    expected_prompt_cost = (Decimal(1000) * rates['input_per_1k']) / Decimal(1000)
    assert cost == expected_prompt_cost

def test_estimate_raises_for_unknown_model():
    with pytest.raises(KeyError):
        estimate_cancelled_cost(
            model='nonexistent/model', delta_text='x', prompt_tokens=1
        )
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/test_cost_meter_estimate.py -v`
Expected: FAIL — `MODEL_RATES` and `estimate_cancelled_cost` not defined.

- [ ] **Step 4: Add MODEL_RATES + estimator**

Append to `backend/services/cost_meter.py`:

```python
from decimal import Decimal
import litellm

# Per-1000-token USD rates. Keep in sync manually when models swap or pricing
# changes. LiteLLM does not expose pricing programmatically in a stable form.
MODEL_RATES: dict[str, dict[str, Decimal]] = {
    # The Phase 7 tutor model; adjust if DEFAULT_MODEL in agent/tutor.py changes.
    'gemini/gemini-2.0-flash': {
        'input_per_1k': Decimal('0.000075'),
        'output_per_1k': Decimal('0.0003'),
    },
    'anthropic/claude-sonnet-4-6': {
        'input_per_1k': Decimal('0.003'),
        'output_per_1k': Decimal('0.015'),
    },
}


def estimate_cancelled_cost(
    model: str,
    delta_text: str,
    prompt_tokens: int,
) -> Decimal:
    """Estimate USD cost for a cancelled streaming call.

    The user has already incurred the prompt-token cost. Output tokens
    consumed before cancellation are counted from the streamed delta text
    via LiteLLM's tokenizer.
    """
    if model not in MODEL_RATES:
        raise KeyError(f"no rate entry for model: {model}")
    rates = MODEL_RATES[model]
    output_tokens = litellm.token_counter(model=model, text=delta_text or '')
    prompt_cost = Decimal(prompt_tokens) * rates['input_per_1k']
    output_cost = Decimal(output_tokens) * rates['output_per_1k']
    return (prompt_cost + output_cost) / Decimal(1000)
```

If the actual `DEFAULT_MODEL` in `backend/agent/tutor.py` is different from `gemini/gemini-2.0-flash`, update the dict key to match. Run `grep -n DEFAULT_MODEL backend/agent/tutor.py` to confirm.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_cost_meter_estimate.py -v`
Expected: PASS — all 5 tests green.

- [ ] **Step 6: Commit**

```bash
git add backend/services/cost_meter.py backend/tests/test_cost_meter_estimate.py
git commit -m "feat(cost): MODEL_RATES + estimate_cancelled_cost for cancelled streams"
```

## Task 12: TutorAgent.run_streaming()

A new async generator method on `TutorAgent`. Iterates the same tool loop as `run()` but yields events as it goes. On the final `acompletion`, uses `stream=True` and yields per-chunk `assistant_delta` events. On `asyncio.CancelledError`, persists a `status='cancelled'` message with the accumulated delta text and estimated cost, then re-raises.

**Files:**
- Modify: `backend/agent/tutor.py` (add `run_streaming` alongside existing `run`)
- Create: `backend/agent/stream_events.py` (event dataclass)
- Test: `backend/tests/test_tutor_stream.py`

- [ ] **Step 1: Define the event dataclass**

```python
# backend/agent/stream_events.py
from dataclasses import dataclass, field
from typing import Any
import json


@dataclass
class StreamEvent:
    type: str  # 'tool_call_start' | 'tool_call_done' | 'assistant_delta' | 'citations' | 'cost_warning' | 'done' | 'error' | 'cancelled'
    data: Any

    def to_sse(self) -> str:
        return f"event: {self.type}\ndata: {json.dumps(self.data)}\n\n"
```

- [ ] **Step 2: Write the failing test**

```python
# backend/tests/test_tutor_stream.py
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from backend.agent.tutor import TutorAgent
from backend.agent.stream_events import StreamEvent

@pytest.mark.asyncio
async def test_run_streaming_yields_tool_then_delta_then_done(monkeypatch, db_session, fake_user_id):
    """Happy path: tool call → assistant deltas → done."""
    agent = TutorAgent(db=db_session)

    # Fake the LLM: first response returns a tool call; second streams deltas.
    fake_tool_resp = MagicMock()
    fake_tool_resp.choices = [MagicMock(message=MagicMock(
        content=None,
        tool_calls=[MagicMock(
            id='call_1',
            function=MagicMock(name='retrieve_chunks', arguments='{"query":"x"}'),
        )],
    ))]

    async def fake_stream():
        for chunk_text in ['Hello ', 'world']:
            chunk = MagicMock()
            chunk.choices = [MagicMock(delta=MagicMock(content=chunk_text))]
            yield chunk

    monkeypatch.setattr(
        'backend.agent.tutor.litellm.acompletion',
        AsyncMock(side_effect=[fake_tool_resp, fake_stream()]),
    )
    # Stub the tool dispatcher to return synthetic citations.
    monkeypatch.setattr(
        'backend.agent.tutor.dispatch_tool',
        AsyncMock(return_value={'ok': True, 'citations': [{'doc_id': 'd', 'page': 1}]}),
    )

    events = []
    async for ev in agent.run_streaming(
        session_id='s1', user_id=fake_user_id, message='question'
    ):
        events.append(ev)

    types = [e.type for e in events]
    assert 'tool_call_start' in types
    assert 'tool_call_done' in types
    assert types.count('assistant_delta') == 2
    assert types[-1] == 'done'

@pytest.mark.asyncio
async def test_run_streaming_persists_cancelled_on_cancel(monkeypatch, db_session, fake_user_id):
    """When cancelled mid-stream, persists status='cancelled' with partial text."""
    agent = TutorAgent(db=db_session)

    async def slow_stream():
        chunk = MagicMock()
        chunk.choices = [MagicMock(delta=MagicMock(content='partial '))]
        yield chunk
        await asyncio.sleep(10)  # long enough that the test can cancel
        yield chunk

    monkeypatch.setattr(
        'backend.agent.tutor.litellm.acompletion',
        AsyncMock(return_value=slow_stream()),
    )

    gen = agent.run_streaming(session_id='s2', user_id=fake_user_id, message='q')
    received = []
    async def consume():
        async for ev in gen:
            received.append(ev)

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.05)  # let first delta land
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    # Inspect DB: a cancelled message row should exist.
    from backend.db.models import Message
    cancelled = db_session.query(Message).filter_by(
        session_id='s2', status='cancelled'
    ).first()
    assert cancelled is not None
    assert 'partial' in cancelled.content
    assert cancelled.cancelled_at is not None

@pytest.mark.asyncio
async def test_run_streaming_emits_error_on_cost_cap(monkeypatch, db_session, fake_user_id):
    """Pre-call hard-cap breach emits an error event and halts."""
    agent = TutorAgent(db=db_session)
    from backend.services.cost_cap import DailyCostCapReached
    monkeypatch.setattr(
        'backend.agent.tutor.check_cost_cap',
        MagicMock(side_effect=DailyCostCapReached(used_usd='3.10', soft_cap_usd='2.0', hard_cap_usd='3.0')),
    )
    events = []
    async for ev in agent.run_streaming(
        session_id='s3', user_id=fake_user_id, message='q'
    ):
        events.append(ev)
    assert events[-1].type == 'error'
    assert events[-1].data['code'] == 'daily_cost_cap_reached'
```

Note: the test uses `db_session` and `fake_user_id` fixtures — confirm they exist in `backend/tests/conftest.py`; if not, add minimal ones. Also `check_cost_cap` and `dispatch_tool` are placeholders for whatever the existing tutor uses — adjust the monkeypatch paths to the real symbols (`grep -n 'def check\|def dispatch' backend/agent/tutor.py`).

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_tutor_stream.py -v`
Expected: FAIL — `run_streaming` not defined.

- [ ] **Step 4: Read the existing `run()` to understand the loop**

Run: `grep -n "def run\|async def" backend/agent/tutor.py`
Trace the existing tool-loop control flow. The new `run_streaming` mirrors it but yields events and uses `stream=True` on the final `acompletion`.

- [ ] **Step 5: Implement `run_streaming`**

Add to `backend/agent/tutor.py`:

```python
import asyncio
from datetime import datetime, timezone
from typing import AsyncIterator
from backend.agent.stream_events import StreamEvent
from backend.services.cost_meter import estimate_cancelled_cost
from backend.services.cost_cap import check_cost_cap, DailyCostCapReached, record_cost
import litellm


class TutorAgent:
    # ... existing __init__ and run() preserved ...

    async def run_streaming(
        self,
        *,
        session_id: str,
        user_id: str,
        message: str,
    ) -> AsyncIterator[StreamEvent]:
        accumulated_text = ''
        prompt_tokens_total = 0
        messages = self._build_initial_messages(session_id, message)
        try:
            for iteration in range(self.MAX_ITERS):
                try:
                    check_cost_cap(self.db, user_id)
                except DailyCostCapReached as e:
                    yield StreamEvent('error', {
                        'code': 'daily_cost_cap_reached',
                        'used_usd': str(e.used_usd),
                        'soft_cap_usd': str(e.soft_cap_usd),
                        'hard_cap_usd': str(e.hard_cap_usd),
                    })
                    return

                # Count prompt tokens for cancel-cost estimation later.
                prompt_tokens_total += litellm.token_counter(
                    model=self.model, messages=messages
                )

                non_stream_resp = await litellm.acompletion(
                    model=self.model,
                    messages=messages,
                    tools=self.TOOL_SCHEMAS,
                    tool_choice='auto',
                )
                record_cost(self.db, user_id, litellm.completion_cost(non_stream_resp))

                msg = non_stream_resp.choices[0].message
                tool_calls = getattr(msg, 'tool_calls', None) or []
                if not tool_calls:
                    # No tools — stream the final answer.
                    stream = await litellm.acompletion(
                        model=self.model,
                        messages=messages + [{'role': 'assistant', 'content': msg.content or ''}],
                        stream=True,
                    )
                    if msg.content:
                        accumulated_text += msg.content
                        yield StreamEvent('assistant_delta', {'text': msg.content})
                    async for chunk in stream:
                        delta = chunk.choices[0].delta
                        token = getattr(delta, 'content', None)
                        if token:
                            accumulated_text += token
                            yield StreamEvent('assistant_delta', {'text': token})
                    # Persist complete row.
                    msg_id = self._persist_message(
                        session_id, accumulated_text, 'complete', None
                    )
                    yield StreamEvent('done', {'message_id': str(msg_id)})
                    return

                # Otherwise: emit tool events, dispatch, loop.
                for tc in tool_calls:
                    yield StreamEvent('tool_call_start', {
                        'id': tc.id,
                        'name': tc.function.name,
                        'args': tc.function.arguments,
                    })
                    try:
                        result = await dispatch_tool(
                            self.db, session_id, user_id, tc
                        )
                        yield StreamEvent('tool_call_done', {
                            'id': tc.id,
                            'status': 'ok',
                            'summary': self._summarize(tc.function.name, result),
                        })
                        if 'citations' in result and result['citations']:
                            yield StreamEvent('citations', result['citations'])
                    except Exception as exc:
                        yield StreamEvent('tool_call_done', {
                            'id': tc.id, 'status': 'error', 'error': str(exc),
                        })
                        # continue loop without injecting tool result
                    messages.append({
                        'role': 'tool', 'tool_call_id': tc.id,
                        'content': str(result),
                    })
            # MAX_ITERS exhausted
            yield StreamEvent('error', {'code': 'max_iters_reached'})
        except asyncio.CancelledError:
            cost = estimate_cancelled_cost(
                self.model, accumulated_text, prompt_tokens_total
            )
            record_cost(self.db, user_id, cost)
            msg_id = self._persist_message(
                session_id, accumulated_text, 'cancelled',
                cancelled_at=datetime.now(timezone.utc),
            )
            yield StreamEvent('cancelled', {
                'message_id': str(msg_id),
                'partial_content_chars': len(accumulated_text),
                'estimated_cost_usd': str(cost),
            })
            raise

    def _persist_message(self, session_id, content, status, cancelled_at):
        from backend.db.models import Message
        m = Message(
            session_id=session_id, role='assistant', content=content,
            status=status, cancelled_at=cancelled_at,
        )
        self.db.add(m)
        self.db.commit()
        return m.id

    def _summarize(self, tool_name, result):
        if tool_name == 'retrieve_chunks':
            n = len(result.get('chunks', []))
            return f"Found {n} passages"
        if tool_name == 'update_topic_profile':
            return 'Profile updated'
        if tool_name == 'record_learning_event':
            return 'Answer recorded'
        return 'ok'
```

If `_build_initial_messages` is not a method on the existing `TutorAgent`, factor it out from the existing `run()` so both paths share message construction. Same for `MAX_ITERS`, `TOOL_SCHEMAS`, `self.model`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_tutor_stream.py -v`
Expected: PASS — all 3 tests green.

- [ ] **Step 7: Run full backend tests**

Run: `pytest`
Expected: no regressions in existing tutor / chat / cost-cap tests.

- [ ] **Step 8: Commit**

```bash
git add backend/agent/tutor.py \
        backend/agent/stream_events.py \
        backend/tests/test_tutor_stream.py
git commit -m "feat(agent): TutorAgent.run_streaming async generator w/ cancel persistence"
```

## Task 13: POST /api/chat/stream route

**Files:**
- Modify: `backend/routes/chat.py` (add the new `/chat/stream` endpoint alongside the existing `/chat`)
- Test: `backend/tests/test_chat_stream_route.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_chat_stream_route.py
import pytest
from httpx import AsyncClient
from backend.main import app

@pytest.mark.asyncio
async def test_chat_stream_returns_event_stream_content_type(auth_headers, seeded_session_id):
    async with AsyncClient(app=app, base_url='http://test') as client:
        async with client.stream(
            'POST', '/api/chat/stream',
            json={'session_id': seeded_session_id, 'message': 'hi'},
            headers=auth_headers,
        ) as resp:
            assert resp.status_code == 200
            assert resp.headers['content-type'].startswith('text/event-stream')

@pytest.mark.asyncio
async def test_chat_stream_emits_done_for_simple_reply(monkeypatch, auth_headers, seeded_session_id):
    """End-to-end with a mocked tutor: events parse to expected types in order."""
    from backend.agent.stream_events import StreamEvent
    async def fake_run_streaming(*args, **kwargs):
        yield StreamEvent('assistant_delta', {'text': 'Hi'})
        yield StreamEvent('done', {'message_id': 'm1'})
    monkeypatch.setattr(
        'backend.agent.tutor.TutorAgent.run_streaming',
        fake_run_streaming,
    )
    async with AsyncClient(app=app, base_url='http://test') as client:
        async with client.stream(
            'POST', '/api/chat/stream',
            json={'session_id': seeded_session_id, 'message': 'hi'},
            headers=auth_headers,
        ) as resp:
            chunks = []
            async for line in resp.aiter_lines():
                chunks.append(line)
    blob = '\n'.join(chunks)
    assert 'event: assistant_delta' in blob
    assert 'event: done' in blob

@pytest.mark.asyncio
async def test_chat_stream_cancels_inner_task_on_disconnect(monkeypatch, auth_headers, seeded_session_id):
    """When the client disconnects, the inner run_streaming task is cancelled."""
    import asyncio
    cancelled_marker = {}
    from backend.agent.stream_events import StreamEvent
    async def hanging_run(*args, **kwargs):
        try:
            yield StreamEvent('assistant_delta', {'text': 'start'})
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            cancelled_marker['ok'] = True
            raise
    monkeypatch.setattr(
        'backend.agent.tutor.TutorAgent.run_streaming',
        hanging_run,
    )
    async with AsyncClient(app=app, base_url='http://test') as client:
        async with client.stream(
            'POST', '/api/chat/stream',
            json={'session_id': seeded_session_id, 'message': 'hi'},
            headers=auth_headers,
            timeout=1.0,
        ) as resp:
            try:
                async for _ in resp.aiter_lines():
                    pass
            except Exception:
                pass  # client-side timeout / disconnect
    # Give the server a moment to process the disconnect.
    await asyncio.sleep(0.2)
    assert cancelled_marker.get('ok') is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_chat_stream_route.py -v`
Expected: FAIL — endpoint not found.

- [ ] **Step 3: Implement the endpoint**

Add to `backend/routes/chat.py`:

```python
import asyncio
from fastapi import Request
from fastapi.responses import StreamingResponse
from backend.agent.tutor import TutorAgent
from backend.agent.stream_events import StreamEvent


@router.post('/chat/stream')
async def chat_stream(
    req: ChatRequest,
    request: Request,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()
        agent = TutorAgent(db=db)

        async def produce():
            try:
                async for event in agent.run_streaming(
                    session_id=req.session_id,
                    user_id=user_id,
                    message=req.message,
                ):
                    await queue.put(event)
            except asyncio.CancelledError:
                # run_streaming yields a 'cancelled' event before re-raising;
                # nothing more to do here.
                raise
            finally:
                await queue.put(None)  # sentinel

        task = asyncio.create_task(produce())
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=0.25)
                except asyncio.TimeoutError:
                    continue
                if event is None:
                    break
                yield event.to_sse()
                if event.type in ('done', 'error', 'cancelled'):
                    break
        finally:
            if not task.done():
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

    return StreamingResponse(event_stream(), media_type='text/event-stream')
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_chat_stream_route.py -v`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Run full backend tests**

Run: `pytest`
Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/chat.py backend/tests/test_chat_stream_route.py
git commit -m "feat(api): POST /api/chat/stream with disconnect-aware cancellation"
```

## Task 14: OpenAPI extension for SSE events

Document the SSE event schemas in `docs/api/openapi.yaml` under an `x-sse-events` extension so contracts stay version-controlled. The codegen script need not consume these (OpenAPI itself does not model SSE), but they serve as the contract reference and are checked by a contract test.

**Files:**
- Modify: `docs/api/openapi.yaml`
- Test: `backend/tests/test_sse_event_schemas.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_sse_event_schemas.py
import yaml
from pathlib import Path

SPEC_PATH = Path(__file__).parent.parent.parent / 'docs' / 'api' / 'openapi.yaml'

def test_openapi_has_x_sse_events():
    doc = yaml.safe_load(SPEC_PATH.read_text())
    assert 'x-sse-events' in doc
    events = doc['x-sse-events']
    expected = {
        'tool_call_start', 'tool_call_done', 'assistant_delta',
        'citations', 'cost_warning', 'done', 'cancelled', 'error',
    }
    assert set(events.keys()) == expected

def test_each_event_has_data_schema():
    doc = yaml.safe_load(SPEC_PATH.read_text())
    for name, ev in doc['x-sse-events'].items():
        assert 'data' in ev, f"{name} missing data schema"
        assert isinstance(ev['data'], dict)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_sse_event_schemas.py -v`
Expected: FAIL — `x-sse-events` missing.

- [ ] **Step 3: Add `x-sse-events` block to `docs/api/openapi.yaml`**

Append after the existing top-level keys (`openapi`, `info`, `paths`, `components`):

```yaml
x-sse-events:
  tool_call_start:
    data:
      type: object
      required: [id, name]
      properties:
        id: { type: string }
        name: { type: string }
        args:
          type: object
          additionalProperties: true
  tool_call_done:
    data:
      type: object
      required: [id, status]
      properties:
        id: { type: string }
        status: { type: string, enum: [ok, error] }
        summary: { type: string }
        error: { type: string }
  assistant_delta:
    data:
      type: object
      required: [text]
      properties:
        text: { type: string }
  citations:
    data:
      type: array
      items:
        type: object
        required: [doc_id]
        properties:
          doc_id: { type: string }
          doc_name: { type: string }
          page: { type: integer }
          text: { type: string }
  cost_warning:
    data:
      type: object
      required: [used_usd, soft_cap_usd, hard_cap_usd]
      properties:
        used_usd: { type: string }
        soft_cap_usd: { type: string }
        hard_cap_usd: { type: string }
  done:
    data:
      type: object
      required: [message_id]
      properties:
        message_id: { type: string }
        total_cost_usd: { type: string }
  cancelled:
    data:
      type: object
      required: [message_id, partial_content_chars, estimated_cost_usd]
      properties:
        message_id: { type: string }
        partial_content_chars: { type: integer }
        estimated_cost_usd: { type: string }
  error:
    data:
      type: object
      required: [code, message]
      properties:
        code: { type: string }
        message: { type: string }
```

- [ ] **Step 4: Regenerate Pydantic contracts**

Run from repo root: `python backend/scripts/gen_contracts.py`
Expected: codegen runs without errors. The `x-sse-events` block is an extension, not part of standard OpenAPI, so it should be passed through without affecting generated models.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_sse_event_schemas.py -v`
Expected: PASS.

Run: `pytest tests/test_contracts.py -v` (existing drift test)
Expected: PASS — no contract drift.

- [ ] **Step 6: Commit**

```bash
git add docs/api/openapi.yaml backend/tests/test_sse_event_schemas.py
git commit -m "docs(api): document SSE event schemas under x-sse-events"
```

## Task 15: Frontend SSE parser

Pure JS module that consumes a `ReadableStream` of bytes from a `fetch` response and yields parsed SSE events. Independent of the chat-specific service so it can be unit-tested in isolation.

**Files:**
- Create: `frontend/src/lib/sseParser.js`
- Test: `frontend/src/__tests__/sseParser.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/__tests__/sseParser.test.js
import { describe, it, expect } from 'vitest'
import { parseSSEStream } from '../lib/sseParser.js'

function readableFromChunks(chunks) {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) { controller.close(); return }
      controller.enqueue(encoder.encode(chunks[i++]))
    },
  })
}

describe('parseSSEStream', () => {
  it('parses a single complete event', async () => {
    const stream = readableFromChunks(['event: foo\ndata: {"x":1}\n\n'])
    const events = []
    await parseSSEStream(stream, (ev) => events.push(ev))
    expect(events).toEqual([{ event: 'foo', data: { x: 1 } }])
  })

  it('parses multiple events in one chunk', async () => {
    const stream = readableFromChunks([
      'event: a\ndata: 1\n\nevent: b\ndata: 2\n\n',
    ])
    const events = []
    await parseSSEStream(stream, (ev) => events.push(ev))
    expect(events).toEqual([
      { event: 'a', data: 1 },
      { event: 'b', data: 2 },
    ])
  })

  it('parses an event split across multiple chunks', async () => {
    const stream = readableFromChunks(['event: a\nda', 'ta: 1\n\n'])
    const events = []
    await parseSSEStream(stream, (ev) => events.push(ev))
    expect(events).toEqual([{ event: 'a', data: 1 }])
  })

  it('parses non-JSON data as a string', async () => {
    const stream = readableFromChunks(['event: hello\ndata: world\n\n'])
    const events = []
    await parseSSEStream(stream, (ev) => events.push(ev))
    expect(events).toEqual([{ event: 'hello', data: 'world' }])
  })

  it('handles multi-line data fields (joined by newline)', async () => {
    const stream = readableFromChunks(['event: m\ndata: line1\ndata: line2\n\n'])
    const events = []
    await parseSSEStream(stream, (ev) => events.push(ev))
    expect(events).toEqual([{ event: 'm', data: 'line1\nline2' }])
  })

  it('handles trailing whitespace and bare events', async () => {
    const stream = readableFromChunks([':comment\nevent: a\ndata: 1\n\n'])
    const events = []
    await parseSSEStream(stream, (ev) => events.push(ev))
    expect(events).toEqual([{ event: 'a', data: 1 }])
  })

  it('aborts cleanly via AbortSignal', async () => {
    const ctrl = new AbortController()
    const stream = new ReadableStream({
      pull() { /* never resolves */ },
    })
    const promise = parseSSEStream(stream, () => {}, { signal: ctrl.signal })
    ctrl.abort()
    await expect(promise).rejects.toThrow(/abort/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run sseParser`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

```javascript
// frontend/src/lib/sseParser.js
//
// Consume a ReadableStream<Uint8Array> of Server-Sent Events bytes and call
// onEvent({ event, data }) for each complete frame. Supports multi-line
// data: fields per the SSE spec, JSON or string payloads, and AbortSignal.

function tryParseJSON(s) {
  try { return JSON.parse(s) } catch { return s }
}

export async function parseSSEStream(stream, onEvent, { signal } = {}) {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  if (signal) {
    signal.addEventListener('abort', () => {
      reader.cancel(new Error('aborted')).catch(() => {})
    })
  }

  try {
    while (true) {
      if (signal?.aborted) throw new Error('aborted')
      const { done, value } = await reader.read()
      if (done) {
        if (buffer.trim()) flushFrame(buffer, onEvent)
        return
      }
      buffer += decoder.decode(value, { stream: true })
      let sep
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        flushFrame(frame, onEvent)
      }
    }
  } finally {
    try { reader.releaseLock() } catch { /* already released */ }
  }
}

function flushFrame(frame, onEvent) {
  let eventName = 'message'
  const dataLines = []
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue
    if (line.startsWith('event:')) eventName = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (!dataLines.length) return
  const joined = dataLines.join('\n')
  onEvent({ event: eventName, data: tryParseJSON(joined) })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run sseParser`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/sseParser.js frontend/src/__tests__/sseParser.test.js
git commit -m "feat(chat): SSE stream parser w/ abort support"
```

## Task 16: chatStreamService.js

Wraps `fetch('/api/chat/stream')` + the SSE parser + AbortController. Calls back into store actions for each event type.

**Files:**
- Create: `frontend/src/services/chatStreamService.js`
- Test: `frontend/src/__tests__/chatStreamService.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/__tests__/chatStreamService.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { streamChat } from '../services/chatStreamService.js'
import { useAuthStore } from '../stores/auth.js'
import { setActivePinia, createPinia } from 'pinia'

function mockResponse(sseBody) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseBody))
        controller.close()
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )
}

describe('streamChat', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.token = 'tok-123'
  })

  it('POSTs to /api/chat/stream with bearer token and JSON body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse('event: done\ndata: {}\n\n'))
    global.fetch = fetchSpy
    await streamChat({ sessionId: 's1', message: 'hi', onEvent: () => {} })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/chat/stream')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok-123')
    expect(JSON.parse(init.body)).toEqual({ session_id: 's1', message: 'hi' })
  })

  it('invokes onEvent for each parsed SSE event', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse(
      'event: assistant_delta\ndata: {"text":"Hi"}\n\n' +
      'event: done\ndata: {"message_id":"m1"}\n\n'
    ))
    const events = []
    await streamChat({ sessionId: 's1', message: 'hi', onEvent: (e) => events.push(e) })
    expect(events).toEqual([
      { event: 'assistant_delta', data: { text: 'Hi' } },
      { event: 'done', data: { message_id: 'm1' } },
    ])
  })

  it('passes signal through and aborts cleanly', async () => {
    const ctrl = new AbortController()
    const fetchSpy = vi.fn().mockImplementation((url, init) => {
      expect(init.signal).toBe(ctrl.signal)
      return Promise.resolve(mockResponse('event: done\ndata: {}\n\n'))
    })
    global.fetch = fetchSpy
    await streamChat({
      sessionId: 's1',
      message: 'hi',
      onEvent: () => {},
      signal: ctrl.signal,
    })
    expect(fetchSpy).toHaveBeenCalled()
  })

  it('throws on non-2xx response with parsed error body', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'bad' }), { status: 400 })
    )
    await expect(
      streamChat({ sessionId: 's1', message: 'hi', onEvent: () => {} })
    ).rejects.toMatchObject({ status: 400 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run chatStreamService`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```javascript
// frontend/src/services/chatStreamService.js
import { parseSSEStream } from '@/lib/sseParser.js'
import { useAuthStore } from '@/stores/auth.js'

export async function streamChat({ sessionId, message, onEvent, signal }) {
  const auth = useAuthStore()
  const resp = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify({ session_id: sessionId, message }),
    signal,
  })
  if (!resp.ok) {
    let body = null
    try { body = await resp.json() } catch { /* ignore */ }
    const err = new Error(`HTTP ${resp.status}`)
    err.status = resp.status
    err.body = body
    throw err
  }
  await parseSSEStream(resp.body, onEvent, { signal })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run chatStreamService`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/chatStreamService.js \
        frontend/src/__tests__/chatStreamService.test.js
git commit -m "feat(chat): chatStreamService — fetch + SSE parse + abort"
```

## Task 17: Pinia store streaming state

Extend `frontend/src/stores/session.js` with the streaming state/actions defined in spec §6.

**Files:**
- Modify: `frontend/src/stores/session.js`
- Modify: `frontend/src/__tests__/sessionStore.test.js`

- [ ] **Step 1: Write failing tests in `sessionStore.test.js`**

Append (or place alongside existing tests):

```javascript
// frontend/src/__tests__/sessionStore.test.js (additions)
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSessionStore } from '../stores/session.js'
import * as streamSvc from '../services/chatStreamService.js'

describe('session store — streaming', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('starts in idle stream state with no streaming message', () => {
    const s = useSessionStore()
    expect(s.streamState).toBe('idle')
    expect(s.streamingMessage).toBeNull()
  })

  it('appendAssistantDelta accumulates text on streamingMessage', () => {
    const s = useSessionStore()
    s.streamingMessage = { role: 'assistant', content: '', tool_calls: [], citations: [] }
    s.appendAssistantDelta('Hello ')
    s.appendAssistantDelta('world')
    expect(s.streamingMessage.content).toBe('Hello world')
  })

  it('recordToolCall (start) appends to streamingMessage.tool_calls and flips state', () => {
    const s = useSessionStore()
    s.streamingMessage = { role: 'assistant', content: '', tool_calls: [], citations: [] }
    s.streamState = 'streaming'
    s.recordToolCall({ kind: 'start', tool_call: { id: 't1', name: 'retrieve_chunks' } })
    expect(s.streamState).toBe('tool_running')
    expect(s.streamingMessage.tool_calls).toHaveLength(1)
    expect(s.streamingMessage.tool_calls[0].state).toBe('running')
  })

  it('recordToolCall (done) marks the existing chip done and returns state to streaming', () => {
    const s = useSessionStore()
    s.streamingMessage = {
      role: 'assistant', content: '', citations: [],
      tool_calls: [{ id: 't1', name: 'retrieve_chunks', state: 'running' }],
    }
    s.streamState = 'tool_running'
    s.recordToolCall({ kind: 'done', tool_call: { id: 't1', summary: '5 found' } })
    expect(s.streamingMessage.tool_calls[0].state).toBe('done')
    expect(s.streamingMessage.tool_calls[0].summary).toBe('5 found')
    expect(s.streamState).toBe('streaming')
  })

  it('finalizeMessage moves streamingMessage to messages[] and clears state', () => {
    const s = useSessionStore()
    s.streamingMessage = { role: 'assistant', content: 'done', tool_calls: [], citations: [] }
    s.streamState = 'streaming'
    s.finalizeMessage('msg_xyz')
    expect(s.streamingMessage).toBeNull()
    expect(s.streamState).toBe('idle')
    expect(s.messages.at(-1)).toMatchObject({
      role: 'assistant', content: 'done', message_id: 'msg_xyz', status: 'complete',
    })
  })

  it('handleCancelled persists partial as status=cancelled', () => {
    const s = useSessionStore()
    s.streamingMessage = { role: 'assistant', content: 'partial', tool_calls: [], citations: [] }
    s.streamState = 'stopping'
    s.handleCancelled('msg_x', 7, '0.0019')
    expect(s.streamingMessage).toBeNull()
    expect(s.streamState).toBe('idle')
    expect(s.messages.at(-1)).toMatchObject({
      status: 'cancelled', content: 'partial',
    })
  })

  it('sendMessageStreaming wires through streamChat and dispatches events', async () => {
    const s = useSessionStore()
    s.currentSessionId = 's1'
    const spy = vi.spyOn(streamSvc, 'streamChat').mockImplementation(
      async ({ onEvent }) => {
        onEvent({ event: 'assistant_delta', data: { text: 'Hi' } })
        onEvent({ event: 'done', data: { message_id: 'm1' } })
      }
    )
    await s.sendMessageStreaming({ text: 'q' })
    expect(spy).toHaveBeenCalled()
    expect(s.messages.at(-1)).toMatchObject({ message_id: 'm1' })
  })

  it('stopStream invokes abortController.abort() and transitions to stopping', () => {
    const s = useSessionStore()
    const abort = vi.fn()
    s.abortController = { abort }
    s.streamState = 'streaming'
    s.stopStream()
    expect(abort).toHaveBeenCalled()
    expect(s.streamState).toBe('stopping')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run sessionStore`
Expected: FAIL — new actions/state not defined.

- [ ] **Step 3: Extend the store**

Add to `frontend/src/stores/session.js` inside `defineStore('session', () => { ... })`:

```javascript
import { streamChat } from '../services/chatStreamService.js'

const streamingMessage = ref(null)
const streamState = ref('idle') // 'idle' | 'streaming' | 'tool_running' | 'stopping'
const abortController = ref(null)

function appendAssistantDelta(text) {
  if (!streamingMessage.value) return
  streamingMessage.value.content += text
}

function recordToolCall({ kind, tool_call }) {
  if (!streamingMessage.value) return
  if (kind === 'start') {
    streamingMessage.value.tool_calls.push({
      ...tool_call,
      state: 'running',
    })
    streamState.value = 'tool_running'
  } else if (kind === 'done') {
    const tc = streamingMessage.value.tool_calls.find((t) => t.id === tool_call.id)
    if (tc) {
      tc.state = tool_call.status === 'error' ? 'error' : 'done'
      tc.summary = tool_call.summary
    }
    streamState.value = 'streaming'
  }
}

function setCitations(citations) {
  if (!streamingMessage.value) return
  streamingMessage.value.citations = citations
}

function finalizeMessage(message_id) {
  if (!streamingMessage.value) return
  messages.value.push({
    ...streamingMessage.value,
    message_id,
    status: 'complete',
  })
  streamingMessage.value = null
  streamState.value = 'idle'
  abortController.value = null
}

function handleCancelled(message_id, partial_chars, estimated_cost_usd) {
  if (!streamingMessage.value) return
  messages.value.push({
    ...streamingMessage.value,
    message_id,
    status: 'cancelled',
    partial_content_chars: partial_chars,
    estimated_cost_usd,
  })
  streamingMessage.value = null
  streamState.value = 'idle'
  abortController.value = null
}

function stopStream() {
  if (abortController.value) {
    abortController.value.abort()
    streamState.value = 'stopping'
  }
}

async function sendMessageStreaming({ text }) {
  if (!currentSessionId.value) throw new Error('no active session')
  const trimmed = (text || '').trim()
  if (!trimmed) return null
  messages.value.push({ role: 'user', content: trimmed })
  streamingMessage.value = {
    role: 'assistant', content: '', tool_calls: [], citations: [],
  }
  streamState.value = 'streaming'
  const ctrl = new AbortController()
  abortController.value = ctrl
  error.value = null
  try {
    await streamChat({
      sessionId: currentSessionId.value,
      message: trimmed,
      signal: ctrl.signal,
      onEvent: ({ event, data }) => {
        switch (event) {
          case 'tool_call_start':
            recordToolCall({ kind: 'start', tool_call: data })
            break
          case 'tool_call_done':
            recordToolCall({ kind: 'done', tool_call: data })
            break
          case 'assistant_delta':
            appendAssistantDelta(data.text)
            break
          case 'citations':
            setCitations(data)
            break
          case 'done':
            finalizeMessage(data.message_id)
            break
          case 'cancelled':
            handleCancelled(
              data.message_id,
              data.partial_content_chars,
              data.estimated_cost_usd,
            )
            break
          case 'error':
            error.value = data.message || data.code
            streamingMessage.value = null
            streamState.value = 'idle'
            abortController.value = null
            break
        }
      },
    })
  } catch (e) {
    if (e.name === 'AbortError') {
      // Cancelled — the 'cancelled' SSE event (if delivered before abort) handles state.
      // If abort raced ahead of the event, fall back to a synthetic handleCancelled.
      if (streamingMessage.value) {
        handleCancelled('pending', streamingMessage.value.content.length, '0')
      }
      return
    }
    streamingMessage.value = null
    streamState.value = 'idle'
    abortController.value = null
    _setError(e)
  }
}
```

Export the new state and actions at the bottom of the store:

```javascript
return {
  // ... existing ...
  streamingMessage,
  streamState,
  abortController,
  appendAssistantDelta,
  recordToolCall,
  setCitations,
  finalizeMessage,
  handleCancelled,
  stopStream,
  sendMessageStreaming,
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run sessionStore`
Expected: PASS — all new + existing tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/session.js frontend/src/__tests__/sessionStore.test.js
git commit -m "feat(chat): Pinia stream state + sendMessageStreaming"
```

## Task 18: Feature flag VITE_CHAT_STREAM — opt-in wire-up in SessionView

Read `import.meta.env.VITE_CHAT_STREAM` at session view mount; if true, call `sendMessageStreaming`; otherwise the existing `sendMessage`. Render the in-flight `streamingMessage` between the rest of `messages[]` and the composer.

**Files:**
- Modify: `frontend/src/views/SessionView.vue`
- Modify: `frontend/.env.example` (document the flag)

- [ ] **Step 1: Add the flag to `.env.example`**

Append to `frontend/.env.example`:

```
# Enable streaming chat (SSE). Default false; PR 3 will flip the default to true.
VITE_CHAT_STREAM=false
```

- [ ] **Step 2: Modify SessionView's send handler**

Locate the composer send wiring (`grep -n "sendMessage" frontend/src/views/SessionView.vue`). Wrap:

```vue
<script setup>
// ... existing imports
const streamEnabled = import.meta.env.VITE_CHAT_STREAM === 'true'

async function onSend(text) {
  if (streamEnabled) {
    await sessionStore.sendMessageStreaming({ text })
  } else {
    await sessionStore.sendMessage({ text })
  }
}
</script>
```

Where the template currently calls `sendMessage` directly, replace with `onSend`.

- [ ] **Step 3: Render the in-flight streaming message**

After the `v-for` over `messages` and before the composer, add:

```vue
<div
  v-if="sessionStore.streamingMessage"
  class="message message-assistant streaming"
>
  <span
    v-for="tc in sessionStore.streamingMessage.tool_calls"
    :key="tc.id"
    class="tool-call-row"
  >
    <ToolCallChip :tool_call="tc" :state="tc.state" />
  </span>
  <MarkdownContent :text="sessionStore.streamingMessage.content" streaming />
  <CitationsList :citations="sessionStore.streamingMessage.citations" />
</div>
```

- [ ] **Step 4: Run frontend tests**

Run: `npm run test:unit -- --run`
Expected: all tests pass.

- [ ] **Step 5: Manual smoke**

Run from `frontend/`: `VITE_CHAT_STREAM=true npm run dev`
Open a session and send a message. Confirm the streaming flow renders deltas progressively.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/SessionView.vue frontend/.env.example
git commit -m "feat(chat): VITE_CHAT_STREAM feature flag for SSE chat"
```

## Task 19: Phase 2 PR

- [ ] **Step 1: Push branch**

```bash
git push
```

- [ ] **Step 2: Open PR against `dev`**

```bash
gh pr create --base dev --title "feat(chat): SSE backend + stream service (Phase 2 of chat redesign)" --body "$(cat <<'EOF'
## Summary
- New POST /api/chat/stream with disconnect-aware cancellation
- TutorAgent.run_streaming async generator + cancelled-message persistence
- Cost-cap pre/post + cancel-cost estimator (MODEL_RATES)
- Frontend SSE parser, chatStreamService, Pinia stream state
- Feature flag VITE_CHAT_STREAM (default false)
- Schema: messages.status + cancelled_at + check constraint
- OpenAPI x-sse-events for SSE contract reference

## Spec
docs/superpowers/specs/2026-05-24-chat-surface-redesign-design.md

## Test plan
- [ ] All vitest + pytest suites pass
- [ ] Manual: VITE_CHAT_STREAM=true npm run dev — streaming renders progressively
- [ ] Manual: click Stop mid-stream — partial reply persists as status='cancelled'
- [ ] Manual: VITE_CHAT_STREAM=false — JSON path still works (no regression)
- [ ] Alembic upgrade clean on a fresh DB and on an existing DB with messages rows
EOF
)"
```

- [ ] **Step 3: Address review, merge into `dev`, sync feature branch**

```bash
git checkout dev && git pull --ff-only origin dev
git checkout feat/chat-surface-redesign && git merge dev
```

---

# PHASE 3 — Component Split + Claude.ai Polish + Stop Button (PR 3)

Phase 3 extracts the remaining 7 chat components, applies the Claude.ai visual style end-to-end, wires the Stop button, and flips `VITE_CHAT_STREAM` default to true.

## Task 20: ChatHeader.vue extract

**Files:**
- Create: `frontend/src/components/chat/ChatHeader.vue`
- Modify: `frontend/src/views/SessionView.vue` (remove header block, replace with `<ChatHeader />`)
- Test: `frontend/src/__tests__/chatHeader.test.js`

- [ ] **Step 1: Identify the header markup**

Run: `grep -n "session-header\|chat-header\|profile link" frontend/src/views/SessionView.vue`
Note the exact lines that own the title + profile link + end-session button.

- [ ] **Step 2: Write the failing test**

```javascript
// frontend/src/__tests__/chatHeader.test.js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatHeader from '../components/chat/ChatHeader.vue'

const session = { id: 's1', topic: 'Algorithms' }

describe('ChatHeader', () => {
  it('renders the session topic as the title', () => {
    const w = mount(ChatHeader, { props: { session } })
    expect(w.text()).toContain('Algorithms')
  })

  it('emits end-session when end button clicked', async () => {
    const w = mount(ChatHeader, { props: { session } })
    await w.find('[data-end-session]').trigger('click')
    expect(w.emitted('end-session')).toBeTruthy()
  })

  it('shows a profile link', () => {
    const w = mount(ChatHeader, { props: { session } })
    expect(w.find('[data-profile-link]').exists()).toBe(true)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:unit -- --run chatHeader`
Expected: FAIL.

- [ ] **Step 4: Implement the component**

```vue
<!-- frontend/src/components/chat/ChatHeader.vue -->
<script setup>
defineProps({ session: { type: Object, required: true } })
const emit = defineEmits(['end-session'])
</script>

<template>
  <header class="chat-header">
    <div class="chat-header-title">{{ session.topic || 'Session' }}</div>
    <nav class="chat-header-actions">
      <router-link
        :to="{ name: 'session-profile', params: { id: session.id } }"
        class="chat-header-link"
        data-profile-link
      >
        Profile
      </router-link>
      <button
        type="button"
        class="chat-header-end"
        data-end-session
        @click="emit('end-session')"
      >
        End session
      </button>
    </nav>
  </header>
</template>

<style scoped>
.chat-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  background: var(--color-bg, #faf7f2);
}
.chat-header-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: var(--fs-h3);
}
.chat-header-actions { display: inline-flex; gap: 12px; align-items: center; }
.chat-header-link { font-size: 13px; color: var(--color-accent); text-decoration: none; }
.chat-header-end {
  border: 1px solid rgba(0,0,0,0.1); background: transparent; padding: 4px 10px;
  border-radius: 6px; font-size: 12px; cursor: pointer;
}
</style>
```

If `session-profile` is not the actual route name, fix it. Run `grep -n "name: 'session" frontend/src/router/index.js` to confirm.

- [ ] **Step 5: Replace the markup in SessionView.vue**

Remove the existing header markup. Insert `<ChatHeader :session="currentSession" @end-session="onEndSession" />` at the top. Add the import. Wire the end-session handler to the existing endSession action.

- [ ] **Step 6: Run all tests**

Run: `npm run test:unit -- --run`
Expected: PASS — including unchanged `sessionView` test (header-related assertions may need to switch to checking `ChatHeader` is present).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/chat/ChatHeader.vue \
        frontend/src/views/SessionView.vue \
        frontend/src/__tests__/chatHeader.test.js \
        frontend/src/__tests__/sessionView.test.js
git commit -m "refactor(chat): extract ChatHeader from SessionView"
```

## Task 21: CapBanners.vue extract

**Files:**
- Create: `frontend/src/components/chat/CapBanners.vue`
- Modify: `frontend/src/views/SessionView.vue`
- Test: `frontend/src/__tests__/capBanners.test.js`

- [ ] **Step 1: Locate the banner markup in SessionView**

Run: `grep -n "dailyCap\|costCap\|cap-banner" frontend/src/views/SessionView.vue`

- [ ] **Step 2: Write the failing test**

```javascript
// frontend/src/__tests__/capBanners.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useSessionStore } from '../stores/session.js'
import CapBanners from '../components/chat/CapBanners.vue'

describe('CapBanners', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('renders nothing when no caps reached', () => {
    const w = mount(CapBanners)
    expect(w.text().trim()).toBe('')
  })

  it('renders daily-cap banner when dailyCapReached', () => {
    const s = useSessionStore()
    s.dailyCapInfo = { cap: 30, used: 30, resets_at: '2026-05-25T00:00:00Z' }
    const w = mount(CapBanners)
    expect(w.text()).toMatch(/daily limit|daily cap/i)
  })

  it('renders cost-cap banner when costCapReached', () => {
    const s = useSessionStore()
    s.costCapInfo = { used_usd: '3.10', soft_cap_usd: '2.0', hard_cap_usd: '3.0', resets_at: '2026-05-25T00:00:00Z' }
    const w = mount(CapBanners)
    expect(w.text()).toMatch(/cost cap|spending cap/i)
  })

  it('renders both when both reached', () => {
    const s = useSessionStore()
    s.dailyCapInfo = { cap: 30, used: 30 }
    s.costCapInfo = { used_usd: '3.10', hard_cap_usd: '3.0' }
    const w = mount(CapBanners)
    expect(w.text()).toMatch(/daily/i)
    expect(w.text()).toMatch(/cost/i)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:unit -- --run capBanners`
Expected: FAIL — component not found.

- [ ] **Step 4: Implement the component**

```vue
<!-- frontend/src/components/chat/CapBanners.vue -->
<script setup>
import { useSessionStore } from '@/stores/session.js'
const sessionStore = useSessionStore()
</script>

<template>
  <div class="cap-banners">
    <div v-if="sessionStore.dailyCapReached" class="cap-banner cap-banner--daily">
      <strong>Daily cap reached.</strong>
      You've used {{ sessionStore.dailyCapInfo?.used }} of
      {{ sessionStore.dailyCapInfo?.cap }} messages today.
      Resets at {{ sessionStore.dailyCapInfo?.resets_at }}.
    </div>
    <div v-if="sessionStore.costCapReached" class="cap-banner cap-banner--cost">
      <strong>Cost cap reached.</strong>
      You've spent ${{ sessionStore.costCapInfo?.used_usd }} of
      ${{ sessionStore.costCapInfo?.hard_cap_usd }} today.
      Resets at {{ sessionStore.costCapInfo?.resets_at }}.
    </div>
  </div>
</template>

<style scoped>
.cap-banner {
  background: rgba(255,107,91,0.08);
  border: 1px solid rgba(255,107,91,0.2);
  color: #c44;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  margin: 8px 0;
}
.cap-banner strong { font-weight: 600; }
</style>
```

- [ ] **Step 5: Replace markup in SessionView.vue**

Remove the existing two banner blocks. Add `<CapBanners />` near the top of the chat shell. Add the import.

- [ ] **Step 6: Run tests**

Run: `npm run test:unit -- --run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/chat/CapBanners.vue \
        frontend/src/views/SessionView.vue \
        frontend/src/__tests__/capBanners.test.js
git commit -m "refactor(chat): extract CapBanners"
```

## Task 22: chat/EmptyState.vue (chat-specific)

The existing `frontend/src/components/EmptyState.vue` is a *generic* component used across views — keep it untouched. The chat-specific empty state with quick prompts lives at `chat/EmptyState.vue` and is composed *on top of* the generic one.

**Files:**
- Create: `frontend/src/components/chat/EmptyState.vue`
- Modify: `frontend/src/views/SessionView.vue`
- Test: `frontend/src/__tests__/chatEmptyState.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/__tests__/chatEmptyState.test.js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatEmptyState from '../components/chat/EmptyState.vue'

describe('chat/EmptyState', () => {
  it('renders the welcome headline', () => {
    const w = mount(ChatEmptyState, { props: { topic: 'Algorithms' } })
    expect(w.text()).toMatch(/Algorithms/i)
  })

  it('renders quick-prompt buttons', () => {
    const w = mount(ChatEmptyState, { props: { topic: 'X' } })
    expect(w.findAll('[data-quick-prompt]').length).toBeGreaterThan(0)
  })

  it('emits quick-prompt with the button text', async () => {
    const w = mount(ChatEmptyState, { props: { topic: 'X' } })
    const btn = w.find('[data-quick-prompt]')
    await btn.trigger('click')
    expect(w.emitted('quick-prompt')).toBeTruthy()
    expect(w.emitted('quick-prompt')[0][0]).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run chatEmptyState`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

```vue
<!-- frontend/src/components/chat/EmptyState.vue -->
<script setup>
import GenericEmptyState from '@/components/EmptyState.vue'

defineProps({ topic: { type: String, default: '' } })
const emit = defineEmits(['quick-prompt'])

const prompts = [
  'Quiz me on the basics',
  'What did we cover last session?',
  'Walk me through the hardest part of this topic',
]
</script>

<template>
  <GenericEmptyState tone="celebrate">
    <template #eyebrow>Ready when you are</template>
    <template #headline>Studying {{ topic || 'this topic' }}</template>
    <template #subtext>Pick a prompt or type your own.</template>
    <template #cta>
      <button
        v-for="p in prompts"
        :key="p"
        type="button"
        class="quick-prompt"
        data-quick-prompt
        @click="emit('quick-prompt', p)"
      >
        {{ p }}
      </button>
    </template>
  </GenericEmptyState>
</template>

<style scoped>
.quick-prompt {
  background: var(--user-bubble-bg, #ff6b5b);
  color: var(--user-bubble-text, #fff);
  border: none;
  padding: 6px 12px;
  border-radius: 12px;
  font-size: 12px;
  cursor: pointer;
  margin: 2px;
}
</style>
```

- [ ] **Step 4: Replace markup in SessionView.vue**

Find the existing empty-state block (`grep -n "messages.length === 0\|empty" frontend/src/views/SessionView.vue`). Replace with:

```vue
<ChatEmptyState
  v-if="!messages.length && !streamingMessage"
  :topic="currentSession?.topic"
  @quick-prompt="onSend"
/>
```

Add the import as `import ChatEmptyState from '@/components/chat/EmptyState.vue'`.

- [ ] **Step 5: Run tests**

Run: `npm run test:unit -- --run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/chat/EmptyState.vue \
        frontend/src/views/SessionView.vue \
        frontend/src/__tests__/chatEmptyState.test.js
git commit -m "refactor(chat): extract chat/EmptyState w/ quick prompts"
```

## Task 23: UploadStatus.vue extract

**Files:**
- Create: `frontend/src/components/chat/UploadStatus.vue`
- Modify: `frontend/src/views/SessionView.vue`
- Test: `frontend/src/__tests__/uploadStatus.test.js`

- [ ] **Step 1: Locate the upload-pill markup**

Run: `grep -n "upload\|pending\|ready\|failed" frontend/src/views/SessionView.vue | head -10`

- [ ] **Step 2: Write the failing test**

```javascript
// frontend/src/__tests__/uploadStatus.test.js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import UploadStatus from '../components/chat/UploadStatus.vue'

describe('UploadStatus', () => {
  it('renders nothing when upload is null', () => {
    const w = mount(UploadStatus, { props: { upload: null } })
    expect(w.html().trim()).toBe('<!--v-if-->')
  })

  it('shows pending label for pending state', () => {
    const w = mount(UploadStatus, {
      props: { upload: { status: 'pending', filename: 'doc.pdf' } },
    })
    expect(w.text()).toMatch(/pending|uploading|processing/i)
    expect(w.text()).toContain('doc.pdf')
  })

  it('shows ready label for ready state', () => {
    const w = mount(UploadStatus, {
      props: { upload: { status: 'ready', filename: 'doc.pdf' } },
    })
    expect(w.text()).toMatch(/ready|indexed|done/i)
  })

  it('shows failed label and error for failed state', () => {
    const w = mount(UploadStatus, {
      props: { upload: { status: 'failed', filename: 'doc.pdf', error: 'too big' } },
    })
    expect(w.text()).toMatch(/failed|error/i)
    expect(w.text()).toContain('too big')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:unit -- --run uploadStatus`
Expected: FAIL.

- [ ] **Step 4: Implement the component**

```vue
<!-- frontend/src/components/chat/UploadStatus.vue -->
<script setup>
defineProps({
  upload: { type: Object, default: null },
})
</script>

<template>
  <div v-if="upload" class="upload-status" :data-status="upload.status">
    <span class="upload-dot" :data-status="upload.status" aria-hidden="true"></span>
    <span class="upload-name">{{ upload.filename }}</span>
    <span class="upload-label">
      <template v-if="upload.status === 'pending'">Processing…</template>
      <template v-else-if="upload.status === 'ready'">Ready</template>
      <template v-else-if="upload.status === 'failed'">Failed — {{ upload.error }}</template>
    </span>
  </div>
</template>

<style scoped>
.upload-status {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 4px 10px; border-radius: 12px; font-size: 11px;
  background: rgba(0,0,0,0.04);
}
.upload-dot { width: 6px; height: 6px; border-radius: 50%; background: #888; }
.upload-dot[data-status="ready"] { background: #0a7; }
.upload-dot[data-status="failed"] { background: #c33; }
.upload-name { font-weight: 600; }
</style>
```

- [ ] **Step 5: Replace markup in SessionView.vue**

Substitute existing upload-pill block with `<UploadStatus :upload="currentUpload" />`. Add the import.

- [ ] **Step 6: Run tests**

Run: `npm run test:unit -- --run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/chat/UploadStatus.vue \
        frontend/src/views/SessionView.vue \
        frontend/src/__tests__/uploadStatus.test.js
git commit -m "refactor(chat): extract UploadStatus"
```

## Task 24: Composer.vue extract + Stop button

**Files:**
- Create: `frontend/src/components/chat/Composer.vue`
- Modify: `frontend/src/views/SessionView.vue`
- Test: `frontend/src/__tests__/composer.test.js`

- [ ] **Step 1: Locate the composer markup in SessionView**

Run: `grep -n "textarea\|composer" frontend/src/views/SessionView.vue`

- [ ] **Step 2: Write the failing test**

```javascript
// frontend/src/__tests__/composer.test.js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Composer from '../components/chat/Composer.vue'

describe('Composer', () => {
  it('emits send with trimmed text', async () => {
    const w = mount(Composer, { props: { disabled: false, streamState: 'idle' } })
    await w.find('textarea').setValue('  hello  ')
    await w.find('[data-send]').trigger('click')
    expect(w.emitted('send')[0]).toEqual(['hello'])
  })

  it('does not emit send on empty text', async () => {
    const w = mount(Composer, { props: { disabled: false, streamState: 'idle' } })
    await w.find('textarea').setValue('   ')
    await w.find('[data-send]').trigger('click')
    expect(w.emitted('send')).toBeFalsy()
  })

  it('shows Stop button in streaming state', () => {
    const w = mount(Composer, { props: { disabled: false, streamState: 'streaming' } })
    expect(w.find('[data-stop]').exists()).toBe(true)
    expect(w.find('[data-send]').exists()).toBe(false)
  })

  it('emits stop when Stop button clicked', async () => {
    const w = mount(Composer, { props: { disabled: false, streamState: 'streaming' } })
    await w.find('[data-stop]').trigger('click')
    expect(w.emitted('stop')).toBeTruthy()
  })

  it('disables textarea and send when disabled prop is true', () => {
    const w = mount(Composer, { props: { disabled: true, streamState: 'idle' } })
    expect(w.find('textarea').attributes('disabled')).toBeDefined()
    expect(w.find('[data-send]').attributes('disabled')).toBeDefined()
  })

  it('emits attach on file input change', async () => {
    const w = mount(Composer, { props: { disabled: false, streamState: 'idle' } })
    const file = new File(['hi'], 'doc.pdf', { type: 'application/pdf' })
    const input = w.find('[data-attach]').element
    Object.defineProperty(input, 'files', { value: [file] })
    await w.find('[data-attach]').trigger('change')
    expect(w.emitted('attach')[0][0]).toBe(file)
  })

  it('sends on Cmd/Ctrl+Enter', async () => {
    const w = mount(Composer, { props: { disabled: false, streamState: 'idle' } })
    await w.find('textarea').setValue('hi')
    await w.find('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true })
    expect(w.emitted('send')[0]).toEqual(['hi'])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:unit -- --run composer`
Expected: FAIL.

- [ ] **Step 4: Implement the component**

```vue
<!-- frontend/src/components/chat/Composer.vue -->
<script setup>
import { ref } from 'vue'

const props = defineProps({
  disabled: { type: Boolean, default: false },
  streamState: { type: String, required: true },
})
const emit = defineEmits(['send', 'stop', 'attach'])

const text = ref('')
const fileInput = ref(null)

function onSend() {
  const trimmed = text.value.trim()
  if (!trimmed) return
  emit('send', trimmed)
  text.value = ''
}

function onStop() { emit('stop') }

function onAttach(event) {
  const file = event.target.files?.[0]
  if (file) emit('attach', file)
}

function onKeydown(event) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    onSend()
  }
}
</script>

<template>
  <div class="composer">
    <label class="composer-attach">
      <input
        ref="fileInput"
        type="file"
        accept="application/pdf"
        data-attach
        @change="onAttach"
      />
      <span aria-hidden="true">+</span>
    </label>
    <textarea
      v-model="text"
      :disabled="disabled || streamState !== 'idle'"
      placeholder="Ask anything…"
      class="composer-input"
      @keydown="onKeydown"
    />
    <button
      v-if="streamState === 'idle'"
      type="button"
      class="composer-send"
      :disabled="disabled || !text.trim()"
      data-send
      @click="onSend"
    >
      Send
    </button>
    <button
      v-else
      type="button"
      class="composer-stop"
      data-stop
      @click="onStop"
    >
      Stop
    </button>
  </div>
</template>

<style scoped>
.composer {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 12px 20px;
  border-top: 1px solid rgba(0,0,0,0.06);
  background: var(--color-bg, #faf7f2);
  position: sticky;
  bottom: 0;
}
.composer-attach {
  width: 32px; height: 32px;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.composer-attach input[type="file"] { display: none; }
.composer-input {
  resize: none;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 18px;
  padding: 8px 14px;
  font-family: inherit;
  font-size: 14px;
  min-height: 36px;
  max-height: 200px;
}
.composer-input:focus {
  outline: 2px solid var(--color-accent, #ff6b5b);
  outline-offset: 1px;
}
.composer-send, .composer-stop {
  padding: 8px 16px;
  border-radius: 18px;
  border: none;
  font-weight: 600;
  cursor: pointer;
}
.composer-send {
  background: var(--user-bubble-bg, #ff6b5b);
  color: var(--user-bubble-text, #fff);
}
.composer-send:disabled { opacity: 0.4; cursor: not-allowed; }
.composer-stop {
  background: transparent;
  border: 1px solid var(--user-bubble-bg, #ff6b5b);
  color: var(--user-bubble-bg, #ff6b5b);
}
</style>
```

- [ ] **Step 5: Replace markup in SessionView.vue**

Remove the existing composer block and replace with:

```vue
<Composer
  :disabled="sessionStore.dailyCapReached || sessionStore.costCapReached"
  :stream-state="sessionStore.streamState"
  @send="onSend"
  @stop="sessionStore.stopStream"
  @attach="onAttachFile"
/>
```

Wire `onAttachFile` to the existing upload handler.

- [ ] **Step 6: Run tests**

Run: `npm run test:unit -- --run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/chat/Composer.vue \
        frontend/src/views/SessionView.vue \
        frontend/src/__tests__/composer.test.js
git commit -m "refactor(chat): extract Composer w/ Send/Stop swap"
```

## Task 25: UserBubble.vue extract

**Files:**
- Create: `frontend/src/components/chat/UserBubble.vue`
- Test: `frontend/src/__tests__/userBubble.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/__tests__/userBubble.test.js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import UserBubble from '../components/chat/UserBubble.vue'

describe('UserBubble', () => {
  it('renders the message content', () => {
    const w = mount(UserBubble, { props: { content: 'Hi there' } })
    expect(w.text()).toContain('Hi there')
  })

  it('renders markdown in user messages too', () => {
    const w = mount(UserBubble, { props: { content: '**bold** here' } })
    expect(w.html()).toContain('<strong>bold</strong>')
  })

  it('has the user bubble class', () => {
    const w = mount(UserBubble, { props: { content: 'x' } })
    expect(w.classes()).toContain('user-bubble')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run userBubble`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

```vue
<!-- frontend/src/components/chat/UserBubble.vue -->
<script setup>
import MarkdownContent from './MarkdownContent.vue'
defineProps({ content: { type: String, required: true } })
</script>

<template>
  <div class="user-bubble">
    <MarkdownContent :text="content" />
  </div>
</template>

<style scoped>
.user-bubble {
  align-self: flex-end;
  background: var(--user-bubble-bg);
  color: var(--user-bubble-text);
  border-radius: var(--user-bubble-radius);
  padding: 10px 16px;
  max-width: 75%;
  font-size: 13px;
}
.user-bubble :deep(.markdown-content) { line-height: 1.5; }
.user-bubble :deep(.md-rendered p:last-child) { margin: 0; }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run userBubble`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/chat/UserBubble.vue \
        frontend/src/__tests__/userBubble.test.js
git commit -m "refactor(chat): extract UserBubble"
```

## Task 26: AssistantBubble.vue extract + Claude.ai polish

**Files:**
- Create: `frontend/src/components/chat/AssistantBubble.vue`
- Test: `frontend/src/__tests__/assistantBubble.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/__tests__/assistantBubble.test.js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AssistantBubble from '../components/chat/AssistantBubble.vue'

describe('AssistantBubble', () => {
  const baseMessage = {
    content: 'Hello',
    tool_calls: [],
    citations: [],
    status: 'complete',
  }

  it('renders markdown content', () => {
    const w = mount(AssistantBubble, {
      props: { message: { ...baseMessage, content: '**bold**' }, streaming: false },
    })
    expect(w.html()).toContain('<strong>bold</strong>')
  })

  it('renders tool-call chips above content', () => {
    const w = mount(AssistantBubble, {
      props: {
        message: {
          ...baseMessage,
          tool_calls: [{ id: 't1', name: 'retrieve_chunks', state: 'done', summary: 'Found 5' }],
        },
        streaming: false,
      },
    })
    expect(w.text()).toContain('Found 5')
  })

  it('renders citations below content', () => {
    const w = mount(AssistantBubble, {
      props: {
        message: {
          ...baseMessage,
          citations: [{ doc_id: 'd', doc_name: 'Doc', page: 1 }],
        },
        streaming: false,
      },
    })
    expect(w.text()).toContain('Doc')
  })

  it('shows cancelled marker when status=cancelled', () => {
    const w = mount(AssistantBubble, {
      props: { message: { ...baseMessage, status: 'cancelled', content: 'partial' }, streaming: false },
    })
    expect(w.text()).toMatch(/stopped|cancelled/i)
  })

  it('passes streaming flag to MarkdownContent', () => {
    const w = mount(AssistantBubble, {
      props: { message: baseMessage, streaming: true },
    })
    const md = w.findComponent({ name: 'MarkdownContent' })
    expect(md.props('streaming')).toBe(true)
  })

  it('has the assistant bubble class', () => {
    const w = mount(AssistantBubble, {
      props: { message: baseMessage, streaming: false },
    })
    expect(w.classes()).toContain('assistant-bubble')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run assistantBubble`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

```vue
<!-- frontend/src/components/chat/AssistantBubble.vue -->
<script setup>
import MarkdownContent from './MarkdownContent.vue'
import ToolCallChip from './ToolCallChip.vue'
import CitationsList from './CitationsList.vue'

defineProps({
  message: { type: Object, required: true },
  streaming: { type: Boolean, default: false },
})
</script>

<template>
  <div class="assistant-bubble">
    <div v-if="message.tool_calls?.length" class="tool-chips">
      <ToolCallChip
        v-for="tc in message.tool_calls"
        :key="tc.id"
        :tool_call="tc"
        :state="tc.state || 'done'"
      />
    </div>
    <MarkdownContent :text="message.content" :streaming="streaming" />
    <CitationsList :citations="message.citations || []" />
    <span v-if="message.status === 'cancelled'" class="cancelled-marker">
      (stopped)
    </span>
  </div>
</template>

<style scoped>
.assistant-bubble {
  align-self: flex-start;
  background: var(--chat-bubble-bg);
  border: 1px solid var(--chat-bubble-border);
  box-shadow: var(--chat-bubble-shadow);
  border-radius: var(--chat-bubble-radius);
  padding: 16px 18px;
  max-width: 92%;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text, #1a1a1a);
}
.tool-chips {
  display: flex; flex-wrap: wrap; gap: 6px;
  margin-bottom: 8px;
}
.cancelled-marker {
  font-size: 11px;
  color: var(--color-text-muted, #888);
  margin-left: 6px;
  font-style: italic;
}
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run assistantBubble`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/chat/AssistantBubble.vue \
        frontend/src/__tests__/assistantBubble.test.js
git commit -m "feat(chat): AssistantBubble w/ Claude.ai polish + cancelled marker"
```

## Task 27: MessageList.vue extract + typing indicator

**Files:**
- Create: `frontend/src/components/chat/MessageList.vue`
- Test: `frontend/src/__tests__/messageList.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/__tests__/messageList.test.js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MessageList from '../components/chat/MessageList.vue'

const userMsg = { role: 'user', content: 'q' }
const asstMsg = { role: 'assistant', content: 'a', tool_calls: [], citations: [], status: 'complete' }

describe('MessageList', () => {
  it('renders user and assistant messages in order', () => {
    const w = mount(MessageList, {
      props: { messages: [userMsg, asstMsg], streamingMessage: null, streamState: 'idle' },
    })
    expect(w.findAllComponents({ name: 'UserBubble' })).toHaveLength(1)
    expect(w.findAllComponents({ name: 'AssistantBubble' })).toHaveLength(1)
  })

  it('renders streamingMessage as an extra assistant bubble at the end', () => {
    const w = mount(MessageList, {
      props: {
        messages: [userMsg],
        streamingMessage: { role: 'assistant', content: 'stream', tool_calls: [], citations: [] },
        streamState: 'streaming',
      },
    })
    const bubbles = w.findAllComponents({ name: 'AssistantBubble' })
    expect(bubbles).toHaveLength(1)
    expect(bubbles[0].props('streaming')).toBe(true)
  })

  it('renders typing indicator when streamState is streaming and no streamingMessage yet', () => {
    const w = mount(MessageList, {
      props: { messages: [userMsg], streamingMessage: null, streamState: 'streaming' },
    })
    expect(w.find('[data-typing]').exists()).toBe(true)
  })

  it('renders nothing typing-related in idle state', () => {
    const w = mount(MessageList, {
      props: { messages: [userMsg, asstMsg], streamingMessage: null, streamState: 'idle' },
    })
    expect(w.find('[data-typing]').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run messageList`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

```vue
<!-- frontend/src/components/chat/MessageList.vue -->
<script setup>
import UserBubble from './UserBubble.vue'
import AssistantBubble from './AssistantBubble.vue'

defineProps({
  messages: { type: Array, required: true },
  streamingMessage: { type: Object, default: null },
  streamState: { type: String, required: true },
})
</script>

<template>
  <div class="message-list">
    <template v-for="(m, i) in messages" :key="m.message_id || i">
      <UserBubble v-if="m.role === 'user'" :content="m.content" />
      <AssistantBubble v-else :message="m" :streaming="false" />
    </template>
    <AssistantBubble
      v-if="streamingMessage"
      :message="streamingMessage"
      :streaming="true"
    />
    <div
      v-if="streamState === 'streaming' && !streamingMessage"
      class="typing-indicator"
      data-typing
    >
      <span></span><span></span><span></span>
    </div>
  </div>
</template>

<style scoped>
.message-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  overflow-y: auto;
  flex: 1 1 auto;
}
.typing-indicator {
  align-self: flex-start;
  display: inline-flex;
  gap: 4px;
  padding: 12px;
}
.typing-indicator span {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--color-text-muted, #888);
  animation: typing-bounce 1.2s infinite ease-in-out;
}
.typing-indicator span:nth-child(2) { animation-delay: 0.15s; }
.typing-indicator span:nth-child(3) { animation-delay: 0.3s; }
@keyframes typing-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-6px); opacity: 1; }
}
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run messageList`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/chat/MessageList.vue \
        frontend/src/__tests__/messageList.test.js
git commit -m "feat(chat): MessageList w/ streaming bubble + typing indicator"
```

## Task 28: Shrink SessionView.vue to ~150-line shell

**Files:**
- Modify: `frontend/src/views/SessionView.vue`
- Modify: `frontend/src/__tests__/sessionView.test.js` (re-target assertions at the shell)

- [ ] **Step 1: Read the current SessionView.vue to plan the rewrite**

Run: `wc -l frontend/src/views/SessionView.vue`
Expected: still > 800 lines after Tasks 20-27 removed individual blocks but inline CSS lingers.

- [ ] **Step 2: Rewrite the view as a thin shell**

Replace the entire file contents with:

```vue
<!-- frontend/src/views/SessionView.vue -->
<script setup>
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useSessionStore } from '@/stores/session.js'
import { useUploadStore } from '@/stores/upload.js'
import ChatHeader from '@/components/chat/ChatHeader.vue'
import CapBanners from '@/components/chat/CapBanners.vue'
import ChatEmptyState from '@/components/chat/EmptyState.vue'
import MessageList from '@/components/chat/MessageList.vue'
import Composer from '@/components/chat/Composer.vue'
import UploadStatus from '@/components/chat/UploadStatus.vue'

const route = useRoute()
const router = useRouter()
const sessionStore = useSessionStore()
const uploadStore = useUploadStore?.() ?? null  // upload store name varies; check repo

const { currentSession, messages, streamingMessage, streamState, error } =
  storeToRefs(sessionStore)

const streamEnabled = import.meta.env.VITE_CHAT_STREAM !== 'false'  // default true after PR3

onMounted(async () => {
  await sessionStore.loadSession(route.params.id)
})

watch(() => route.params.id, async (newId) => {
  if (newId) await sessionStore.loadSession(newId)
})

async function onSend(text) {
  if (streamEnabled) {
    await sessionStore.sendMessageStreaming({ text })
  } else {
    await sessionStore.sendMessage({ text })
  }
}

async function onEndSession() {
  await sessionStore.endSession()
}

async function onAttachFile(file) {
  if (uploadStore) await uploadStore.uploadFile(file)
}

const composerDisabled = computed(() =>
  sessionStore.dailyCapReached || sessionStore.costCapReached
)
</script>

<template>
  <div class="session-view">
    <ChatHeader v-if="currentSession" :session="currentSession" @end-session="onEndSession" />
    <CapBanners />
    <UploadStatus v-if="uploadStore?.currentUpload" :upload="uploadStore.currentUpload" />
    <ChatEmptyState
      v-if="!messages.length && !streamingMessage"
      :topic="currentSession?.topic"
      @quick-prompt="onSend"
    />
    <MessageList
      v-else
      :messages="messages"
      :streaming-message="streamingMessage"
      :stream-state="streamState"
    />
    <div v-if="error" class="session-error">{{ error }}</div>
    <Composer
      :disabled="composerDisabled"
      :stream-state="streamState"
      @send="onSend"
      @stop="sessionStore.stopStream"
      @attach="onAttachFile"
    />
  </div>
</template>

<style scoped>
.session-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--color-bg, #faf7f2);
}
.session-error {
  background: rgba(200, 50, 50, 0.08);
  color: #c33;
  padding: 8px 12px;
  font-size: 13px;
  border-top: 1px solid rgba(200, 50, 50, 0.15);
}
</style>
```

- [ ] **Step 3: Re-target the existing sessionView tests**

The test file at `frontend/src/__tests__/sessionView.test.js` was originally written against the monolithic view. After the split, many assertions should be retargeted to either (a) check that the right child component is present, or (b) be moved into the per-component test files (which now exist). Walk through each test:

- For assertions about header content → assert `ChatHeader` is present with the expected `session` prop.
- For assertions about banners → assert `CapBanners` is present.
- For assertions about empty state → assert `ChatEmptyState` is present.
- For assertions about message rendering → assert `MessageList` is present with the expected messages prop.
- For assertions about send/composer → assert `Composer` is present.

Delete assertions duplicated by the new per-component tests (Tasks 20-27).

- [ ] **Step 4: Confirm new shell size**

Run: `wc -l frontend/src/views/SessionView.vue`
Expected: ≤ 200 lines (target ~150).

- [ ] **Step 5: Run all tests**

Run: `npm run test:unit -- --run`
Expected: PASS — all suites green.

- [ ] **Step 6: Manual smoke**

Run: `npm run dev`
Open a session, send messages with markdown / math / code blocks, watch streaming, click Stop mid-stream. Confirm the partial reply shows `(stopped)`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/views/SessionView.vue \
        frontend/src/__tests__/sessionView.test.js
git commit -m "refactor(chat): shrink SessionView to thin shell"
```

## Task 29: Final visual-token pass + e2e Playwright spec

**Files:**
- Modify: `frontend/src/assets/aura-tokens.css` (final pass — tune values against the rendered UI)
- Create: `frontend/tests/e2e/chat-stream.spec.js`

- [ ] **Step 1: Run the dev server and walk through a session**

Run: `npm run dev`
Verify visually:
- User pill is coral right-aligned with correct radius
- Assistant bubble is soft white with subtle border + shadow
- Code blocks show language tag and Copy button; copy works
- Inline math + display math render through KaTeX
- Tool pill animates while running, shows summary on done
- Citations footer dashed border, doc + page list
- Empty state shows quick prompts
- Stop button replaces Send during stream; pressing Stop shows `(stopped)` and persists the partial

Tweak token values in `aura-tokens.css` as needed (e.g., shadow strength, math accent saturation). Keep changes inside the token file — no per-component CSS edits at this stage.

- [ ] **Step 2: Add a Playwright e2e spec**

```javascript
// frontend/tests/e2e/chat-stream.spec.js
import { test, expect } from '@playwright/test'

test.describe('chat stream', () => {
  test('renders streaming reply with markdown', async ({ page }) => {
    // Assumes a logged-in fixture; adapt to your existing playwright auth setup.
    await page.goto('/sessions/new')
    await page.getByPlaceholder('Ask anything…').fill('Explain Big-O in two sentences')
    await page.getByRole('button', { name: /send/i }).click()
    await expect(page.locator('.assistant-bubble').first()).toBeVisible({ timeout: 30_000 })
    // Final reply should have rendered markdown elements (assistant tends to use them).
    // Looser assertion: at least the bubble has some content.
    await expect(page.locator('.assistant-bubble').first()).not.toBeEmpty()
  })

  test('stop button cancels and shows (stopped) marker', async ({ page }) => {
    await page.goto('/sessions/new')
    await page.getByPlaceholder('Ask anything…').fill('Write a long essay on operating systems history')
    await page.getByRole('button', { name: /send/i }).click()
    await page.getByRole('button', { name: /stop/i }).click({ timeout: 5_000 })
    await expect(page.locator('.cancelled-marker')).toBeVisible({ timeout: 5_000 })
  })
})
```

This spec is gated by the existing `continue-on-error: true` on `.github/workflows/e2e.yml` until Phase 6's e2e-gating decision lands.

- [ ] **Step 3: Run e2e locally**

Run from `frontend/`: `npm run test:e2e` (or `npm run test:e2e:ui` for the UI runner).
Expected: PASS or skipped gracefully.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/assets/aura-tokens.css \
        frontend/tests/e2e/chat-stream.spec.js
git commit -m "feat(chat): final visual polish + e2e stream/stop spec"
```

## Task 30: Flip VITE_CHAT_STREAM default to true

**Files:**
- Modify: `frontend/.env.example`
- Modify: `frontend/src/views/SessionView.vue` (already defaults true after Task 28 rewrite — verify)
- Modify: `frontend/.env` (if it exists locally — but **do not commit** it; secrets file)
- Modify: `frontend/vite.config.js` (only if it sets `define` for env defaults — likely no change needed)

- [ ] **Step 1: Update .env.example**

Change the line:

```
VITE_CHAT_STREAM=false
```

to:

```
# Streaming chat (SSE). Default true. Set to "false" to fall back to JSON path.
VITE_CHAT_STREAM=true
```

- [ ] **Step 2: Verify the shell defaults to streaming**

In `SessionView.vue`, the line:

```javascript
const streamEnabled = import.meta.env.VITE_CHAT_STREAM !== 'false'
```

means streaming is on unless an env explicitly sets it false. Confirm this line is present.

- [ ] **Step 3: Run frontend tests**

Run: `npm run test:unit -- --run`
Expected: all tests pass.

- [ ] **Step 4: Manual smoke without setting VITE_CHAT_STREAM**

Run: `npm run dev` (no flag override).
Send a message. Confirm streaming is active by default.

- [ ] **Step 5: Commit**

```bash
git add frontend/.env.example
git commit -m "feat(chat): flip VITE_CHAT_STREAM default to true"
```

## Task 31: Phase 3 PR + final sign-off

- [ ] **Step 1: Push**

```bash
git push
```

- [ ] **Step 2: Open PR against `dev`**

```bash
gh pr create --base dev --title "feat(chat): component split + Claude.ai polish + Stop (Phase 3 of chat redesign)" --body "$(cat <<'EOF'
## Summary
- Extract 10 chat components from SessionView (now a ~150-line shell)
- Apply Claude.ai-style soft assistant bubble + warm code block + coral math accent
- Stop button swaps with Send during stream; cancelled messages show (stopped)
- VITE_CHAT_STREAM default flipped to true
- Playwright e2e spec for stream + stop

## Spec
docs/superpowers/specs/2026-05-24-chat-surface-redesign-design.md

## Test plan
- [ ] All vitest + pytest suites pass
- [ ] Manual: send a message — streaming with markdown, code, math
- [ ] Manual: tool calls show pills (Searching → Found N passages)
- [ ] Manual: click Stop mid-stream — (stopped) marker, partial persists
- [ ] Manual: reload session — cancelled message persists with marker on resume
- [ ] Manual: daily/cost cap banner appears when limits hit
- [ ] e2e: chat-stream.spec.js green (or expected-skip if gated)
EOF
)"
```

- [ ] **Step 3: Wait for CI, address review, merge**

After merge, the chat surface redesign is complete. Delete the branch:

```bash
git checkout dev && git pull --ff-only origin dev
git branch -d feat/chat-surface-redesign
git push origin --delete feat/chat-surface-redesign
```

---

## Self-Review

Run this checklist mentally before declaring the plan done.

**Spec coverage:**

| Spec section | Plan task(s) |
|---|---|
| §1 Problem (raw markdown) | Task 3 + Task 7 |
| §2 Goals 1-7 | Goals 1-3 → Tasks 2-6, 15-18, 11-13; Goal 4 → Tasks 20-29; Goal 5 → Tasks 17, 24; Goal 6 → Tasks 20-28; Goal 7 → preserved throughout (no changes to `POST /api/chat`) |
| §3 Non-goals | Not implemented — confirm none accidentally added |
| §4 Architecture | Tasks 11-13 backend, Tasks 15-17 frontend |
| §5 Component decomposition | Tasks 20-28 |
| §5.1 Component contracts | Tasks 20-27 each implement the props/emits listed |
| §6 Frontend state | Task 17 |
| §7 Markdown pipeline (libs, config, delimiter buffer, code-block chrome) | Tasks 1, 2, 3, 4 |
| §8 SSE protocol | Tasks 13, 14, 15, 16, 17 |
| §9 Cost-cap semantics | Tasks 11, 12 |
| §9.1 Cancel-cost estimation | Task 11 |
| §10 Stop/cancel | Tasks 12, 13, 17, 24 |
| §10.3 DB schema | Task 10 |
| §11 Tool-call surfacing | Tasks 6, 17, 26 |
| §12 Visual style (Aura tokens) | Tasks 8, 29 |
| §13 Error handling | Tasks 12 (server error event), 17 (store error path), 26 (cancelled marker) |
| §14 Testing strategy | Each task ships unit + component tests; Task 13 ships route integration; Task 29 ships e2e |
| §15 Migration / 3-PR sequencing | Phase 1 (Tasks 0-9), Phase 2 (Tasks 10-19), Phase 3 (Tasks 20-31) |

**Placeholder scan:** No "TBD" / "TODO" / "implement later" strings. Every code block contains real, executable code or shell. Type names (`StreamEvent`, `TutorAgent.run_streaming`, `streamChat`, `splitSafePrefix`, `MODEL_RATES`) appear consistently across tasks.

**Type consistency:** `streamingMessage` shape `{ role, content, tool_calls, citations, message_id?, status? }` matches between Task 17 (store) and Tasks 25-27 (consumers). `StreamEvent` fields `{ type, data }` consistent between Task 12 (backend) and Task 15 (parser). `MODEL_RATES` keys (`gemini/gemini-2.0-flash`, `anthropic/claude-sonnet-4-6`) appear once in Task 11 — confirm the actual `DEFAULT_MODEL` in `backend/agent/tutor.py` matches; if not, update at Task 11 step 4.

**Open clarifications resolved inline:**
- `chat/EmptyState.vue` was renamed in the plan to import the existing generic `EmptyState.vue` as a building block (Task 22), avoiding namespace ambiguity.
- `dispatch_tool` and `check_cost_cap` symbol paths in Task 12 must be verified against the real `backend/agent/tutor.py` before writing tests — note included.
