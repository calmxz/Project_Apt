const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

export const formatDate = (iso) => (iso ? DATE_FMT.format(new Date(iso)) : '')

const SHORT_FMT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'short',
  timeStyle: 'short',
})

export const formatShortDateTime = (iso) =>
  iso ? SHORT_FMT.format(new Date(iso)) : ''

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

const STEPS = [
  { limit: 60, divisor: 1, unit: 'second' },
  { limit: 3600, divisor: 60, unit: 'minute' },
  { limit: 86400, divisor: 3600, unit: 'hour' },
  { limit: 604800, divisor: 86400, unit: 'day' },
  { limit: 2629800, divisor: 604800, unit: 'week' },
  { limit: 31557600, divisor: 2629800, unit: 'month' },
  { limit: Infinity, divisor: 31557600, unit: 'year' },
]

export const formatRelative = (iso) => {
  if (!iso) return ''
  const diffSec = (new Date(iso).getTime() - Date.now()) / 1000
  const absSec = Math.abs(diffSec)
  for (const { limit, divisor, unit } of STEPS) {
    if (absSec < limit) {
      return RTF.format(Math.round(diffSec / divisor), unit)
    }
  }
  return RTF.format(Math.round(diffSec / 31557600), 'year')
}

const SHORT_UNITS = { second: 's', minute: 'm', hour: 'h', day: 'd', week: 'w', month: 'mo', year: 'y' }

// Compact rail variant of formatRelative: "5m ago", "2h ago", "3d ago".
// Same STEPS thresholds; sub-minute renders as "now".
export const formatRelativeShort = (iso) => {
  if (!iso) return ''
  const absSec = Math.abs((Date.now() - new Date(iso).getTime()) / 1000)
  if (isNaN(absSec)) return ''
  if (absSec < 60) return 'now'
  for (const { limit, divisor, unit } of STEPS) {
    if (absSec < limit) {
      return `${Math.round(absSec / divisor)}${SHORT_UNITS[unit]} ago`
    }
  }
  return `${Math.round(absSec / 31557600)}y ago`
}

export const shortId = (id) => (typeof id === 'string' ? id.slice(0, 8) : '')

export const normalizeTopicKey = (topic) => (topic || '').toLowerCase().trim()

export const findActiveSessionByTopic = (sessions, topic) => {
  const key = normalizeTopicKey(topic)
  if (!key) return null
  return (
    sessions.find((s) => !s.ended_at && normalizeTopicKey(s.topic) === key) ||
    null
  )
}
