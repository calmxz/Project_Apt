"""
Hand-crafted profile fixtures for Phase 0 validation spike.

Three pairs per DevPlan §Phase 0 task 2:
  - knowledge: knowledge level contrast (beginner vs advanced)
  - guidance:  guidance_preference contrast (hints vs direct_answers)
  - engagement: engagement_preference contrast (quiz_as_we_go vs absorb_then_test)

Each profile dict has:
  - interaction_preferences  (Spec §3.1)
  - topic_profile            (Spec §3.2)
"""

# Neutral topic profile — no mastered or gap signal — used for guidance + engagement pairs.
_NEUTRAL_TOPIC_PROFILE = {
    "knowledge_level": "intermediate",
    "mastered_concepts": [],
    "mastered_candidates": [],
    "confirmed_gaps": [],
    "observed_gaps": [],
    "focus_target_gap": None,
    "last_session_summary": None,
    "last_session_summary_draft": None,
    "summary": None,
}

# Neutral interaction preferences — used for the knowledge pair.
_NEUTRAL_PREFS = {
    "guidance_preference": "hints",
    "engagement_preference": "quiz_as_we_go",
}

# ---------------------------------------------------------------------------
# Pair 1 — Knowledge level
# ---------------------------------------------------------------------------

KNOWLEDGE_A = {
    "interaction_preferences": _NEUTRAL_PREFS.copy(),
    "topic_profile": {
        "knowledge_level": "beginner",
        "mastered_concepts": [],
        "mastered_candidates": [],
        "confirmed_gaps": [
            "what a foreign key is",
            "why data duplication causes update anomalies",
        ],
        "observed_gaps": [],
        "focus_target_gap": None,
        "last_session_summary": None,
        "last_session_summary_draft": None,
        "summary": None,
    },
}

KNOWLEDGE_B = {
    "interaction_preferences": _NEUTRAL_PREFS.copy(),
    "topic_profile": {
        "knowledge_level": "advanced",
        "mastered_concepts": [
            "first normal form (1NF)",
            "second normal form (2NF)",
            "functional dependencies",
        ],
        "mastered_candidates": [],
        "confirmed_gaps": [],
        "observed_gaps": [],
        "focus_target_gap": None,
        "last_session_summary": None,
        "last_session_summary_draft": None,
        "summary": None,
    },
}

# ---------------------------------------------------------------------------
# Pair 2 — Guidance preference
# ---------------------------------------------------------------------------

GUIDANCE_A = {
    "interaction_preferences": {
        "guidance_preference": "hints",
        "engagement_preference": "quiz_as_we_go",
    },
    "topic_profile": _NEUTRAL_TOPIC_PROFILE.copy(),
}

GUIDANCE_B = {
    "interaction_preferences": {
        "guidance_preference": "direct_answers",
        "engagement_preference": "quiz_as_we_go",
    },
    "topic_profile": _NEUTRAL_TOPIC_PROFILE.copy(),
}

# ---------------------------------------------------------------------------
# Pair 3 — Engagement preference
# ---------------------------------------------------------------------------

ENGAGEMENT_A = {
    "interaction_preferences": {
        "guidance_preference": "hints",
        "engagement_preference": "quiz_as_we_go",
    },
    "topic_profile": _NEUTRAL_TOPIC_PROFILE.copy(),
}

ENGAGEMENT_B = {
    "interaction_preferences": {
        "guidance_preference": "hints",
        "engagement_preference": "absorb_then_test",
    },
    "topic_profile": _NEUTRAL_TOPIC_PROFILE.copy(),
}

# ---------------------------------------------------------------------------
# Session state — same for all six runs (no ingested PDF, no prior session)
# ---------------------------------------------------------------------------

BASE_SESSION = {
    "topic": "database normalization",
    "ingestion_status": "none",
    "retrieval_required": False,
    "seeded": False,
    "days_since_seed": None,
    "seed_mode": None,
    "seed_mode_default": None,
    "seed_mode_was_overridden": False,
    "last_session_summary": None,
}

# Ordered for iteration: (pair_name, side_label, profile)
PAIRS = [
    ("knowledge", "A", KNOWLEDGE_A),
    ("knowledge", "B", KNOWLEDGE_B),
    ("guidance",  "A", GUIDANCE_A),
    ("guidance",  "B", GUIDANCE_B),
    ("engagement", "A", ENGAGEMENT_A),
    ("engagement", "B", ENGAGEMENT_B),
]
