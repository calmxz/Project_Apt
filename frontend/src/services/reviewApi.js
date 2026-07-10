import { apiGet } from './apiClient.js'

// params: { limit?: number, offset?: number }
export const getReviewQueue = (params) => apiGet('/review/queue', params)
