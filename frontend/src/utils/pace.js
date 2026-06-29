// Display-only duration derivations (never stored). Spec A/B.
// "By deadline": pin timeline_days, derive lessons-per-week.
export function derivePace(lessonCount, timelineDays) {
  const weeks = Math.max((timelineDays || 0) / 7, 1)
  return Math.ceil((lessonCount || 0) / weeks)
}

// "By pace": pin pace_per_week, derive finish horizon in weeks.
export function deriveHorizonWeeks(lessonCount, pacePerWeek) {
  return Math.ceil((lessonCount || 0) / Math.max(pacePerWeek || 0, 1))
}
