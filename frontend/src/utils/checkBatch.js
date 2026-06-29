// Mastery signal for the Subjects/Lessons mark-done suggestion. A check batch
// counts as cleared only when every item was answered (not skipped, not pending)
// AND graded correct. Reused by SessionView's live pendingCheck watcher and its
// resume scan over store.messages -- both carry the same item shape.
export function checkBatchAllCorrect(items) {
  return Boolean(
    items?.length && items.every((it) => it.status === 'answered' && it.correct === true),
  )
}
