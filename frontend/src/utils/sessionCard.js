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

// Narrative line for home/library cards. Ended: summary (auto-stripped) -> 'Completed'.
// Active: trimmed preview or '' (caller renders its own placeholder).
// Structured signals (focus/mastered) never appear here — they are chips.
export function cardStory(session) {
  if (session.ended_at) {
    return stripAutoPrefix(session.last_session_summary) || 'Completed'
  }
  return (session.last_message_preview || '').trim()
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
