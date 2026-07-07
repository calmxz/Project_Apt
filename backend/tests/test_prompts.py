"""Tests for agent/prompts.py -- IMMUTABLE_RULES and build_dynamic_context."""

from agent import prompts


def test_dynamic_context_includes_pending_check():
    state = {
        "topic": "Photosynthesis",
        "profile": {},
        "pending_check": {
            "gap": "calvin_cycle",
            "current_index": 0,
            "items": [
                {"question": "Inputs?", "options": ["a", "b"], "status": "pending"},
            ],
        },
    }
    out = prompts.build_dynamic_context(state)
    assert "PENDING_CHECK" in out
    assert "calvin_cycle" in out


def test_dynamic_context_pending_check_none():
    out = prompts.build_dynamic_context({"topic": "x", "profile": {}})
    assert "PENDING_CHECK: none" in out


def test_immutable_rules_mention_ask_check_questions():
    assert "ask_check_questions" in prompts.IMMUTABLE_RULES


def test_immutable_rules_no_singular_ask_check_question():
    # The singular (no-s) name must not appear in IMMUTABLE_RULES
    import re
    # Match "ask_check_question" not followed by "s"
    assert not re.search(r"ask_check_question(?!s)", prompts.IMMUTABLE_RULES)


def test_pending_check_render_is_batch_aware():
    state = {
        "pending_check": {
            "gap": "atp",
            "current_index": 1,
            "items": [
                {"question": "Q1", "options": ["a", "b"], "status": "answered"},
                {"question": "Q2", "options": ["a", "b"], "status": "pending"},
            ],
        }
    }
    ctx = prompts.build_dynamic_context(state)
    assert '"gap": "atp"' in ctx
    assert '"answered": 1' in ctx
    assert '"total": 2' in ctx
    # must NOT crash on missing top-level "question" and must not render null
    assert "null" not in ctx.split("PENDING_CHECK:")[1]


def test_prompt_describes_mc_and_drops_self_grading():
    from agent.prompts import IMMUTABLE_RULES
    assert "record_learning_event" not in IMMUTABLE_RULES
    assert "options" in IMMUTABLE_RULES
    # no instruction to grade the learner's typed answer next turn
    assert "Grade it by calling" not in IMMUTABLE_RULES


def test_quiz_readiness_ready_when_no_cooldown():
    out = prompts.build_dynamic_context({"topic": "x"})
    assert "QUIZ_READINESS: ready" in out


def test_quiz_readiness_cooling_down_with_cooldown():
    state = {
        "topic": "x",
        "quiz_cooldown": {"gap": "derivatives", "last_score": "1/2", "missed": ["q1"]},
    }
    out = prompts.build_dynamic_context(state)
    assert '"status": "cooling_down"' in out
    assert '"gap": "derivatives"' in out
    assert '"last_score": "1/2"' in out


def test_immutable_rules_has_post_quiz_protocol():
    rules = prompts.IMMUTABLE_RULES
    assert "POST-QUIZ PROTOCOL" in rules
    # all-correct must end the loop
    assert "do NOT re-quiz the same gap" in rules
    # insist overrides the nudge
    assert "insist" in rules.lower()


def test_immutable_rules_has_knowledge_diagnostic_protocol():
    rules = prompts.IMMUTABLE_RULES
    assert "KNOWLEDGE DIAGNOSTIC" in rules
    assert "ask_check_questions" in rules.split("KNOWLEDGE DIAGNOSTIC:")[1].split("RETRIEVAL POLICY:")[0]


def test_dynamic_context_diagnostic_required():
    from agent.prompts import build_dynamic_context
    s = build_dynamic_context({"topic": "Recursion", "diagnostic_required": True})
    assert "DIAGNOSTIC: REQUIRED" in s


def test_dynamic_context_diagnostic_off_by_default():
    from agent.prompts import build_dynamic_context
    s = build_dynamic_context({"topic": "Recursion"})
    assert "DIAGNOSTIC: OFF" in s


def test_dynamic_context_renders_review_gaps_target():
    from agent.prompts import build_dynamic_context
    ctx = build_dynamic_context({"topic": "Biology", "review_gaps_target": "glycolysis"})
    assert "REVIEW_GAPS: glycolysis" in ctx


def test_dynamic_context_review_gaps_off_by_default():
    from agent.prompts import build_dynamic_context
    ctx = build_dynamic_context({"topic": "Biology"})
    assert "REVIEW_GAPS: OFF" in ctx


def test_immutable_rules_has_review_gaps_mode():
    from agent.prompts import IMMUTABLE_RULES
    assert "REVIEW-GAPS MODE" in IMMUTABLE_RULES
    # The rule must direct the tutor to open on the named gap and pose a check.
    assert "ask_check_questions" in IMMUTABLE_RULES  # already present; sanity


def test_review_gaps_mode_forces_check_same_turn():
    # Live smoke (2026-07-05) found the tutor sometimes recapped the gap and then
    # OFFERED to review first instead of posing the check (card fired turn 1 in only
    # 2/3 trials). The rule must close that escape hatch: mandate the tool call in
    # the same turn and forbid deferring it behind an offer or a readiness question.
    from agent.prompts import IMMUTABLE_RULES
    section = IMMUTABLE_RULES.split("REVIEW-GAPS MODE:")[1].split("RETRIEVAL POLICY:")[0]
    low = section.lower()
    assert "must call ask_check_questions" in low
    assert "do not offer to review" in low
    assert "do not ask whether they are ready" in low


def test_system_prompt_prefix_is_byte_identical_across_turns():
    """Gemini's implicit prefix cache only helps if the prompt head never
    varies. All per-turn material must render strictly after IMMUTABLE_RULES.
    (Roadmap P1 AC2 -- guards the cache-friendliness CLAUDE.md promises.)"""
    state_a = {
        "topic": "photosynthesis",
        "profile": {"knowledge_level": "beginner", "confirmed_gaps": ["light reactions"]},
        "ingestion_status": "ready",
        "retrieval_required": True,
        "seed_mode": "fresh",
    }
    state_b = {
        "topic": "linear algebra",
        "profile": {"knowledge_level": "advanced", "mastered_concepts": ["matrix rank"]},
        "ingestion_status": "none",
        "retrieval_required": False,
        "seed_mode": "resume",
        "quiz_cooldown": {"gap": "eigenvalues", "last_score": "1/3"},
    }
    a = prompts.build_system_prompt(state_a)
    b = prompts.build_system_prompt(state_b)
    n = len(prompts.IMMUTABLE_RULES)
    assert a[:n] == prompts.IMMUTABLE_RULES
    assert b[:n] == prompts.IMMUTABLE_RULES
    assert a[:n] == b[:n]
    # No per-turn material may leak into the stable prefix.
    assert "photosynthesis" not in a[:n]
    assert "linear algebra" not in b[:n]
