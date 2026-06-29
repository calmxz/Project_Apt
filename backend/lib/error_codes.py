"""Error-code strings carried inside HTTPException `detail.code`.

Kept in sync with frontend/src/lib/errorCodes.js so a typo on either side
fails loudly instead of silently mis-routing UI behaviour (cap banner,
toast copy).
"""

DAILY_CAP_REACHED = "daily_cap_reached"
DAILY_COST_CAP_REACHED = "daily_cost_cap_reached"

SUBJECT_NOT_FOUND = "subject_not_found"
LESSON_NOT_FOUND = "lesson_not_found"
LESSON_HAS_SESSION = "lesson_has_session"
DURATION_FIELD_REQUIRED = "duration_field_required"
