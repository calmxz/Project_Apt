import { apiGet } from './apiClient.js'

// params: { limit?: number, offset?: number }
export const getReviewQueue = (params, opts) => apiGet('/review/queue', params, opts)
