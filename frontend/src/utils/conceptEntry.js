// ConceptEntry is { name, evidence_type, last_event_at }; legacy blobs and the
// gap-picker path hand over bare strings.
export function entryName(e) {
  return typeof e === 'string' ? e : (e?.name ?? '')
}

export function entryNames(list) {
  return (list ?? []).map(entryName)
}
