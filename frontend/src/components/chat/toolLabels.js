export const TOOL_LABELS = {
  retrieve_chunks: {
    running: 'Searching your document…',
    done: 'Search complete',
    error: 'Search failed — continuing',
  },
  update_topic_profile: {
    running: 'Updating profile…',
    done: 'Profile updated',
    error: 'Profile update failed',
  },
  record_learning_event: {
    running: 'Recording answer…',
    done: 'Answer recorded',
    error: 'Recording failed',
  },
  ask_check_question: {
    running: 'Asking a question…',
    done: 'Question asked',
    error: 'Could not ask question',
  },
}

export function labelFor(toolName, state) {
  const labels = TOOL_LABELS[toolName]
  if (!labels) return toolName
  return labels[state] || toolName
}
