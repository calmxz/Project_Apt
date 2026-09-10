import { formatRelative } from '@/utils/formatDate.js'

const AUTO_RE = /^\[auto\]\s*/

export function stripAutoPrefix(s) {
  return (s || '').replace(AUTO_RE, '')
}

// Secondary meta line: "<n> messages · last active <rel>".
export function cardMeta(session) {
  const count = session.message_count || 0
  const noun = count === 1 ? 'message' : 'messages'
  const ts = session.last_activity_at || session.created_at
  const left = `${count} ${noun}`
  return ts ? `${left} · last active ${formatRelative(ts)}` : left
}

const DISPLAY_MATH_RE = /\$\$[\s\S]*?\$\$/g
const INLINE_MATH_RE = /\$[^$\n]+?\$/g
const SHORT_PREVIEW = 12

// Strips LaTeX source (display and inline math) down to a placeholder so card
// previews never show raw formula syntax.
export function cleanPreview(text) {
  return (text || '')
    .replace(DISPLAY_MATH_RE, '[formula]')
    .replace(INLINE_MATH_RE, '[formula]')
    .replace(/\s+/g, ' ')
    .trim()
}

// Narrative line for home/library cards. Ended: summary (auto-stripped) -> 'Completed'.
// Active: cleaned preview, falling back to the summary when the preview is too
// short to be useful (e.g. a one-word reply). Structured signals (focus/mastered)
// never appear here — they are chips.
export function cardStory(session) {
  if (session.ended_at) {
    return stripAutoPrefix(session.last_session_summary) || 'Completed'
  }
  const preview = cleanPreview(session.last_message_preview)
  const summary = stripAutoPrefix(session.last_session_summary)
  if (preview.length < SHORT_PREVIEW && summary) return summary
  return preview
}

// Structured signals for chip rendering on both surfaces. Focus first, mastered second.
// Chip appears only when its signal is meaningful (focus set / mastered > 0).
export function cardChips(session) {
  const chips = []
  const progress = session.progress
  if (progress && progress.focus_target_gap) {
    chips.push({ type: 'focus', label: progress.focus_target_gap })
  }
  const mastered = (progress && progress.mastered_count) || 0
  if (mastered > 0) {
    chips.push({ type: 'mastered', label: `${mastered} mastered`, count: mastered })
  }
  return chips
}
