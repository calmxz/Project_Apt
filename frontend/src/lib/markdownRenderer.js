import MarkdownIt from 'markdown-it'
// NOTE: @vscode/markdown-it-katex replaces the plan's markdown-it-katex@2,
// which carries an unfixable high-sev XSS (GHSA-5ff8-jcf9-fw62). The fork is
// Microsoft-maintained with the same md.use(plugin, kaTeXOptions) API. Its
// default export is double-wrapped across Node/Vite interop, hence the unwrap.
import mdKatexImport from '@vscode/markdown-it-katex'
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

const mdKatex = mdKatexImport.default ?? mdKatexImport

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
