// Mastery signal: a check batch counts as cleared only when every item was
// answered (not skipped, not pending) AND graded correct.
export function checkBatchAllCorrect(items) {
  return Boolean(
    items?.length && items.every((it) => it.status === 'answered' && it.correct === true),
  )
}
