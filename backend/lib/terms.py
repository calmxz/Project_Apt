"""Single source of truth for the accepted terms/privacy policy version.

Bump this string whenever terms-of-service.md or privacy-policy.md change in a
way users must re-consent to. The frontend mirror lives in
frontend/src/legal/version.js and must be kept equal to this value.
"""

CURRENT_TERMS_VERSION = "2026-07-03"
