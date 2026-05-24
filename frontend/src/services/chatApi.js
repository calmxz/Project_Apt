import { apiPost } from './apiClient.js'

export const postChat = ({ sessionId, message }) =>
  apiPost('/chat', {
    session_id: sessionId,
    message,
  })
