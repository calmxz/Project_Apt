import { apiPost } from './apiClient.js'

export const postChat = ({ sessionId, userId, message }) =>
  apiPost('/chat', {
    session_id: sessionId,
    user_id: userId,
    message,
  })
