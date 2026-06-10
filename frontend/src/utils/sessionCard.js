import { formatRelative } from '@/utils/formatDate.js'

const AUTO_RE = /^\[auto\]\s*/

export function stripAutoPrefix(s) {
  return (s || '').replace(AUTO_RE, '')
}

// Primary description line. Active: focus -> preview -> mastery -> ''.
// Ended: summary (auto-stripped) -> 'Completed'.
export function cardDescription(session) {
  if (session.ended_at) {
    return stripAutoPrefix(session.last_session_summary) || 'Completed'
  }
  const gap = session.progress && session.progress.focus_target_gap
  if (gap) return `Focus: ${gap}`
  const preview = (session.last_message_preview || '').trim()
  if (preview) return preview
  const mastered = (session.progress && session.progress.mastered_count) || 0
  if (mastered > 0) return `${mastered} concept${mastered === 1 ? '' : 's'} mastered`
  return ''
}

// Secondary meta line: "<n> messages · last active <rel>".
export function cardMeta(session) {
  const count = session.message_count || 0
  const noun = count === 1 ? 'message' : 'messages'
  const ts = session.last_activity_at || session.created_at
  const left = `${count} ${noun}`
  return ts ? `${left} · last active ${formatRelative(ts)}` : left
}
