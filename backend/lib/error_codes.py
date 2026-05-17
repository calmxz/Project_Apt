"""Error-code strings carried inside HTTPException `detail.code`.

Kept in sync with frontend/src/lib/errorCodes.js so a typo on either side
fails loudly instead of silently mis-routing UI behaviour (cap banner,
toast copy).
"""

DAILY_CAP_REACHED = "daily_cap_reached"
