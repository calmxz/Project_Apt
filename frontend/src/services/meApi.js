import { apiDelete } from './apiClient.js'

// R2-54/55/56: DELETE /api/me removes every row, the uploaded files, and the
// Supabase auth user itself, in that order. silent: true -- AccountView's
// delete dialog is the sole error surface (an inline error line), so the
// generic errorBus toast must not also fire.
export const deleteAccount = () => apiDelete('/me', { silent: true })
