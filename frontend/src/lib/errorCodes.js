// Backend error-code strings carried inside HTTPException `detail.code`.
// Kept in sync with backend/lib/error_codes.py.
export const ERR_DAILY_CAP_REACHED = 'daily_cap_reached'
export const ERR_DAILY_COST_CAP_REACHED = 'daily_cost_cap_reached'
// Copy: "The service has reached its daily budget. Please try again tomorrow."
export const ERR_GLOBAL_COST_CAP_REACHED = 'global_cost_cap_reached'
// Copy: "This document is too large to ingest. Try splitting it into smaller files."
export const ERR_CHUNK_LIMIT_EXCEEDED = 'chunk_limit_exceeded'
