import { ref } from 'vue'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

// P1: markdown-it and DOMPurify are eager (every tutor turn and both legal
// pages need them). KaTeX and highlight.js are ~154 KB gzip between them and
// are only needed when a reply actually contains math or a fenced block, so
// they are dynamic-imported on first sight of one. Until a plugin lands the
// content renders in its plain fallback; `markdownAssetsVersion` bumps when it
// arrives so MarkdownContent.vue re-renders the same text with it.
//
// NOTE: @mdit/plugin-katex replaces @vscode/markdown-it-katex (itself a
// replacement for markdown-it-katex@2 and its unfixable XSS,
// GHSA-5ff8-jcf9-fw62). The vscode fork is CJS-only and pins katex ^0.16;
// both Vite's dev prebundle and the rolldown prod build mis-convert it so
// KaTeX's macro table ends up empty in the browser and every \command renders
// as literal "undefined control sequence" text (node/vitest render fine,
// which is why CI missed it). @mdit/plugin-katex is ESM-native and peers on
// markdown-it 15 + katex 0.18.
//
// Rendered HTML is always passed through DOMPurify below, lazy plugins
// included: the KaTeX chunk arriving later does not widen the sanitizer.

// Bumped each time a lazy plugin lands. Consumers read it to re-render.
export const markdownAssetsVersion = ref(0)

let _md = null
let _mdKatex = null
let _hljs = null

// 'idle' | 'loading' | 'ready' | 'failed'. A failed load stays failed: the
// plain fallback is correct output, not an error state, and retrying on every
// keystroke of a streaming reply would hammer a dead network.
let _katexState = 'idle'
let _hljsState = 'idle'

// Promises still in flight, so tests and callers can await the settle point.
let _pending = []

function _track(p) {
  // Never rejects: a failed asset degrades to the fallback, it does not throw
  // out of a render or leave `whenRendererReady()` hanging.
  _pending.push(p)
}

/**
 * Resolves once every lazy asset load started so far has settled (loaded or
 * failed). Loads started while awaiting are awaited too.
 */
export async function whenRendererReady() {
  while (_pending.length) {
    const batch = _pending
    _pending = []
    await Promise.all(batch)
  }
}

function _landed() {
  _md = null
  markdownAssetsVersion.value += 1
}

function ensureKatex() {
  if (_katexState !== 'idle') return
  _katexState = 'loading'
  _track(
    Promise.all([
      import('@mdit/plugin-katex'),
      // The stylesheet rides the same chunk boundary as the plugin, so the
      // KaTeX webfonts are never referenced on a page without math.
      import('katex/dist/katex.min.css'),
    ])
      .then(([mod]) => {
        _mdKatex = mod.katex
        _katexState = 'ready'
        _landed()
      })
      .catch(() => {
        _katexState = 'failed'
      }),
  )
}

function ensureHljs() {
  if (_hljsState !== 'idle') return
  _hljsState = 'loading'
  _track(
    Promise.all([
      import('highlight.js/lib/core'),
      import('highlight.js/lib/languages/python'),
      import('highlight.js/lib/languages/javascript'),
      import('highlight.js/lib/languages/typescript'),
      import('highlight.js/lib/languages/sql'),
      import('highlight.js/lib/languages/bash'),
      import('highlight.js/lib/languages/json'),
      import('highlight.js/lib/languages/yaml'),
      import('highlight.js/lib/languages/markdown'),
    ])
      .then(([core, ...langs]) => {
        const hljs = core.default
        const names = [
          'python',
          'javascript',
          'typescript',
          'sql',
          'bash',
          'json',
          'yaml',
          'markdown',
        ]
        names.forEach((name, i) => hljs.registerLanguage(name, langs[i].default))
        _hljs = hljs
        _hljsState = 'ready'
        _landed()
      })
      .catch(() => {
        _hljsState = 'failed'
      }),
  )
}

// Cheap pre-parse sniffs. A false positive costs one extra chunk fetch; a
// false negative only means the plain fallback stands, which is why they are
// deliberately loose.
const FENCE_RE = /(^|\n)[ \t]{0,3}(```|~~~)/

function requestAssets(text) {
  if (text.includes('$')) ensureKatex()
  if (FENCE_RE.test(text)) ensureHljs()
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function build() {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: false,
    highlight: (str, lang) => {
      if (_hljs && lang && _hljs.getLanguage(lang)) {
        try {
          return _hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
        } catch {
          return ''
        }
      }
      return ''
    },
  })
  if (_mdKatex) {
    md.use(_mdKatex, { throwOnError: false, errorColor: 'var(--math-accent, #ff6b5b)' })
  }

  // Harden generated/linkified anchors: add rel="noopener nofollow".
  // No target is added (links open in place); html:false is unchanged.
  const defaultLinkOpen =
    md.renderer.rules.link_open ||
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const existing = tokens[idx].attrGet('rel') || ''
    const merged = [
      ...new Set([...existing.split(/\s+/), 'noopener', 'nofollow'].filter(Boolean)),
    ].join(' ')
    tokens[idx].attrSet('rel', merged)
    return defaultLinkOpen(tokens, idx, options, env, self)
  }

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx]
    const langRaw = token.info.trim().split(/\s+/)[0] || ''
    const lang = langRaw || 'plain'
    let body
    if (_hljs && langRaw && _hljs.getLanguage(langRaw)) {
      body = _hljs.highlight(token.content, { language: langRaw, ignoreIllegals: true }).value
    } else {
      // Plain fallback: escaped source, identical chrome and classes, so the
      // copy button and the pitch snapper behave the same before and after
      // highlight.js lands.
      body = md.utils.escapeHtml(token.content)
    }
    const langClass = langRaw ? `language-${escapeAttr(langRaw)} hljs` : 'hljs'
    return (
      `<pre class="code-block">` +
      `<div class="code-block-header">` +
      `<span class="code-block-lang">${escapeAttr(lang)}</span>` +
      `<button type="button" class="code-block-copy hit-44" data-copy-button>copy</button>` +
      `</div>` +
      `<code class="${langClass}">${body}</code>` +
      `</pre>`
    )
  }

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
  requestAssets(text)
  const md = getRenderer()
  const raw = md.render(text)
  return DOMPurify.sanitize(raw, PURIFY_CONFIG)
}
