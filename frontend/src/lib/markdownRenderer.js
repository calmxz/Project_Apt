import MarkdownIt from 'markdown-it'
// NOTE: @mdit/plugin-katex replaces @vscode/markdown-it-katex (itself a
// replacement for markdown-it-katex@2 and its unfixable XSS,
// GHSA-5ff8-jcf9-fw62). The vscode fork is CJS-only and pins katex ^0.16;
// both Vite's dev prebundle and the rolldown prod build mis-convert it so
// KaTeX's macro table ends up empty in the browser and every \command renders
// as literal "undefined control sequence" text (node/vitest render fine,
// which is why CI missed it). @mdit/plugin-katex is ESM-native and peers on
// markdown-it 15 + katex 0.18.
import { katex as mdKatex } from '@mdit/plugin-katex'
// KaTeX CSS rides this async chunk (only lazy routes import the renderer),
// keeping its webfont family out of the entry bundle on /login.
import 'katex/dist/katex.min.css'
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

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

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
