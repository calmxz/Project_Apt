"""TDD: profile_service.apply_patch + focus-clear guard rail."""

import json
from datetime import datetime, timezone

import pytest

from agent.types import ToolContext
from contracts import ConceptEntry, TopicProfile, UpdateTopicProfileArgs
from db.models import Session as SessionModel, User
from services import profile_service
from services.profile_service import concept_names


SESSION_ID = "sess_1"
USER_ID = "u1"


@pytest.fixture
def session_row(db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    db_session.add(
        SessionModel(
            id=SESSION_ID,
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()
    return db_session.get(SessionModel, SESSION_ID)


@pytest.fixture
def ctx(db_session):
    return ToolContext(
        db=db_session,
        session_id=SESSION_ID,
        user_id=USER_ID,
        turn_started_at=datetime.now(timezone.utc),
    )


SEEDED_SESSION_ID = "sess_seeded"
SEEDED_USER_ID = "u_seeded"


@pytest.fixture
def seeded_session_id(db_session):
    db_session.add(User(id=SEEDED_USER_ID))
    db_session.flush()
    db_session.add(
        SessionModel(
            id=SEEDED_SESSION_ID,
            user_id=SEEDED_USER_ID,
            topic_profile_json="{}",
        )
    )
    db_session.commit()
    return SEEDED_SESSION_ID


def _patch(**kw) -> UpdateTopicProfileArgs:
    kw.setdefault("session_id", SESSION_ID)
    kw.setdefault("evidence_type", "declared")
    return UpdateTopicProfileArgs(**kw)


def test_declared_mastery_promotes(session_row, ctx, db_session):
    result = profile_service.apply_patch(
        db_session, ctx, _patch(add_mastered_concept="joins", evidence_type="declared")
    )
    assert result.ok is True
    assert result.status == "ok"
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert "joins" in concept_names(profile.mastered_concepts)


def test_inferred_mastery_ignored(session_row, ctx, db_session):
    result = profile_service.apply_patch(
        db_session, ctx, _patch(add_mastered_concept="joins", evidence_type="inferred")
    )
    assert result.ok is True
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert "joins" not in concept_names(profile.mastered_concepts)


def test_tested_mastery_promotes(session_row, ctx, db_session):
    result = profile_service.apply_patch(
        db_session, ctx, _patch(add_mastered_concept="joins", evidence_type="tested")
    )
    assert result.ok is True
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert "joins" in concept_names(profile.mastered_concepts)


def test_duplicate_gap_is_noop(session_row, ctx, db_session):
    profile_service.apply_patch(
        db_session, ctx, _patch(add_confirmed_gap="foreign_keys", evidence_type="declared")
    )
    profile_service.apply_patch(
        db_session, ctx, _patch(add_confirmed_gap="foreign_keys", evidence_type="declared")
    )
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert concept_names(profile.confirmed_gaps).count("foreign_keys") == 1


def test_knowledge_level_overwrites(session_row, ctx, db_session):
    profile_service.apply_patch(
        db_session, ctx, _patch(knowledge_level="beginner", evidence_type="declared")
    )
    profile_service.apply_patch(
        db_session, ctx, _patch(knowledge_level="intermediate", evidence_type="declared")
    )
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert profile.knowledge_level == "intermediate"


def test_focus_target_gap_set_from_none(session_row, ctx, db_session):
    result = profile_service.apply_patch(
        db_session, ctx, _patch(focus_target_gap="joins", evidence_type="inferred")
    )
    assert result.ok is True
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert profile.focus_target_gap == "joins"


def _set_focus(db_session, ctx, gap: str):
    profile_service.apply_patch(
        db_session, ctx, _patch(focus_target_gap=gap, evidence_type="inferred")
    )


def test_focus_clear_without_reason_fails(session_row, ctx, db_session):
    _set_focus(db_session, ctx, "joins")
    result = profile_service.apply_patch(
        db_session, ctx, _patch(focus_target_gap=None, evidence_type="inferred")
    )
    assert result.ok is False
    assert result.status == "failed"
    assert "focus_clear_reason" in (result.error or "")
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert profile.focus_target_gap == "joins"


def test_focus_clear_tested_correct_no_event_succeeds(session_row, ctx, db_session):
    # Guard removed: tested_correct clears focus even with no in-turn LearningEvent.
    # Previously this asserted ok=False; inverted because the guard is gone.
    _set_focus(db_session, ctx, "joins")
    result = profile_service.apply_patch(
        db_session,
        ctx,
        _patch(
            focus_target_gap=None,
            focus_clear_reason="tested_correct",
            evidence_type="tested",
        ),
    )
    assert result.ok is True
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert profile.focus_target_gap is None


def test_focus_clear_tested_correct_ok(session_row, ctx, db_session):
    # Guard removed: event setup was only needed to satisfy the old in-turn evidence
    # check, which no longer exists. Clear still succeeds; focus is cleared.
    _set_focus(db_session, ctx, "joins")
    result = profile_service.apply_patch(
        db_session,
        ctx,
        _patch(
            focus_target_gap=None,
            focus_clear_reason="tested_correct",
            evidence_type="tested",
        ),
    )
    assert result.ok is True
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert profile.focus_target_gap is None


def test_focus_clear_user_redirected_ok(session_row, ctx, db_session):
    _set_focus(db_session, ctx, "joins")
    result = profile_service.apply_patch(
        db_session,
        ctx,
        _patch(
            focus_target_gap=None,
            focus_clear_reason="user_redirected",
            evidence_type="inferred",
        ),
    )
    assert result.ok is True
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert profile.focus_target_gap is None


def test_load_profile_tolerates_legacy_fields(session_row, db_session):
    """Regression (review #2): a topic_profile_json written under an older schema
    (carrying since-removed fields) must not raise ValidationError -> 500 on load.
    Unknown keys are dropped; known data is preserved. TopicProfile has
    extra="forbid", and load_profile re-parses the stored column, so without the
    tolerant parser this row would 500 every read (and the /profile aggregate)."""
    row = db_session.get(SessionModel, SESSION_ID)
    row.topic_profile_json = json.dumps(
        {
            "knowledge_level": "intermediate",
            "mastered_concepts": ["joins"],
            "mastered_candidates": ["legacy"],     # retired field
            "interaction_preferences": {"hints": True},  # retired field
        }
    )
    db_session.commit()

    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert profile.knowledge_level == "intermediate"
    assert concept_names(profile.mastered_concepts) == ["joins"]
    assert not hasattr(profile, "mastered_candidates")


def test_focus_only_patch_without_evidence_type_succeeds(session_row, ctx, db_session):
    args = UpdateTopicProfileArgs(
        session_id=SESSION_ID,
        focus_target_gap="calvin_cycle",
        evidence_type=None,
    )
    result = profile_service.apply_patch(db_session, ctx, args)
    assert result.ok is True
    assert profile_service.load_profile(db_session, SESSION_ID).focus_target_gap == "calvin_cycle"


def test_mastered_concept_requires_evidence_type(session_row, ctx, db_session):
    args = UpdateTopicProfileArgs(
        session_id=SESSION_ID,
        add_mastered_concept="light_reactions",
        evidence_type=None,
    )
    result = profile_service.apply_patch(db_session, ctx, args)
    assert result.ok is False
    assert "evidence_type" in (result.error or "")


def test_mastered_concept_with_declared_promotes(session_row, ctx, db_session):
    args = UpdateTopicProfileArgs(
        session_id=SESSION_ID,
        add_mastered_concept="light_reactions",
        evidence_type="declared",
    )
    result = profile_service.apply_patch(db_session, ctx, args)
    assert result.ok is True
    assert "light_reactions" in concept_names(
        profile_service.load_profile(db_session, SESSION_ID).mastered_concepts
    )


def test_load_profile_falls_back_on_unparseable_blob(session_row, db_session):
    """Regression (review #2): a non-JSON / corrupt blob degrades to an empty
    profile rather than raising."""
    row = db_session.get(SessionModel, SESSION_ID)
    row.topic_profile_json = "not valid json {"
    db_session.commit()

    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert profile == TopicProfile()


def test_save_profile_commit_false_defers_write(session_row, db_session):
    """commit=False leaves the write in the open transaction so a caller can
    batch it into one atomic commit (used by record_from_answer to close the
    double-grade window). A rollback before commit must revert it."""
    profile = profile_service.load_profile(db_session, SESSION_ID)
    profile.mastered_concepts = [ConceptEntry(name="deferred_gap")]
    profile_service.save_profile(db_session, SESSION_ID, profile, commit=False)

    # Visible within the same uncommitted transaction...
    assert "deferred_gap" in concept_names(
        profile_service.load_profile(db_session, SESSION_ID).mastered_concepts
    )
    # ...but not yet committed: a rollback drops it.
    db_session.rollback()
    assert "deferred_gap" not in concept_names(
        profile_service.load_profile(db_session, SESSION_ID).mastered_concepts or []
    )


def test_profile_etag_is_stable_and_changes_with_content():
    a = TopicProfile(mastered_concepts=[{"name": "x"}])
    b = TopicProfile(mastered_concepts=[{"name": "x"}])
    c = TopicProfile(mastered_concepts=[{"name": "y"}])
    assert profile_service.profile_etag(a) == profile_service.profile_etag(b)
    assert profile_service.profile_etag(a) != profile_service.profile_etag(c)


def test_apply_user_patch_adds_and_sets_level(db_session, seeded_session_id):
    p = profile_service.apply_user_patch(
        db_session, seeded_session_id, add_mastered="loops", knowledge_level="advanced"
    )
    assert "loops" in concept_names(p.mastered_concepts)
    assert p.knowledge_level == "advanced"
    # persisted
    assert "loops" in concept_names(
        profile_service.load_profile(db_session, seeded_session_id).mastered_concepts
    )


def test_apply_user_patch_strips_whitespace(db_session, seeded_session_id):
    profile_service.apply_user_patch(db_session, seeded_session_id, add_mastered="  loops  ")
    reloaded = profile_service.load_profile(db_session, seeded_session_id)
    names = concept_names(reloaded.mastered_concepts)
    assert "loops" in names
    assert "  loops  " not in names


def test_apply_user_patch_whitespace_only_raises_value_error(db_session, seeded_session_id):
    with pytest.raises(ValueError):
        profile_service.apply_user_patch(db_session, seeded_session_id, add_mastered="   ")


def test_apply_user_patch_mutual_exclusion_moves_item(db_session, seeded_session_id):
    profile_service.apply_user_patch(db_session, seeded_session_id, add_gap="recursion")
    p = profile_service.apply_user_patch(db_session, seeded_session_id, add_mastered="recursion")
    assert "recursion" in concept_names(p.mastered_concepts)
    assert "recursion" not in concept_names(p.confirmed_gaps)
    # persisted
    reloaded = profile_service.load_profile(db_session, seeded_session_id)
    assert "recursion" in concept_names(reloaded.mastered_concepts)
    assert "recursion" not in concept_names(reloaded.confirmed_gaps)


def test_add_mastered_nulls_focus_when_it_was_the_focused_gap(db_session, seeded_session_id):
    profile_service.save_profile(
        db_session, seeded_session_id,
        TopicProfile(confirmed_gaps=[{"name": "recursion"}], focus_target_gap="recursion"),
    )
    p = profile_service.apply_user_patch(db_session, seeded_session_id, add_mastered="recursion")
    assert p.focus_target_gap is None
    # persisted
    reloaded = profile_service.load_profile(db_session, seeded_session_id)
    assert reloaded.focus_target_gap is None


def test_remove_profile_item_removes_and_persists(db_session, seeded_session_id):
    profile_service.apply_user_patch(db_session, seeded_session_id, add_mastered="loops")
    p = profile_service.remove_profile_item(db_session, seeded_session_id, "mastered_concepts", "loops")
    assert "loops" not in concept_names(p.mastered_concepts)
    # persisted
    reloaded = profile_service.load_profile(db_session, seeded_session_id)
    assert "loops" not in concept_names(reloaded.mastered_concepts)


def test_remove_confirmed_gap_nulls_focus(db_session, seeded_session_id):
    profile_service.save_profile(
        db_session, seeded_session_id,
        TopicProfile(confirmed_gaps=[{"name": "recursion"}], focus_target_gap="recursion"),
    )
    p = profile_service.remove_profile_item(db_session, seeded_session_id, "confirmed_gaps", "recursion")
    assert "recursion" not in concept_names(p.confirmed_gaps)
    assert p.focus_target_gap is None
    # persisted
    reloaded = profile_service.load_profile(db_session, seeded_session_id)
    assert "recursion" not in concept_names(reloaded.confirmed_gaps)
    assert reloaded.focus_target_gap is None


def test_remove_missing_item_raises_keyerror(db_session, seeded_session_id):
    with pytest.raises(KeyError):
        profile_service.remove_profile_item(db_session, seeded_session_id, "mastered_concepts", "nope")


def test_apply_user_patch_missing_session_raises_value_error(db_session):
    with pytest.raises(ValueError):
        profile_service.apply_user_patch(db_session, "nonexistent-session-id", add_mastered="x")


def test_profile_from_row_parses_without_db(db_session):
    row = SessionModel(user_id="u", topic="t",
                       topic_profile_json='{"knowledge_level": "beginner"}')
    profile = profile_service.profile_from_row(row)
    assert profile.knowledge_level == "beginner"


def test_profile_from_row_tolerates_null_json():
    row = SessionModel(user_id="u", topic="t", topic_profile_json=None)
    assert profile_service.profile_from_row(row) is not None


from services.profile_service import (  # noqa: E402
    _parse_profile,
    canon,
    find_entry,
    upsert_entry,
)


def test_parse_upgrades_legacy_string_elements():
    raw = '{"knowledge_level": "beginner", "mastered_concepts": ["limits"], "confirmed_gaps": ["chain rule", "u-sub"]}'
    p = _parse_profile(raw)
    assert p.mastered_concepts[0] == ConceptEntry(
        name="limits", evidence_type=None, last_event_at=None
    )
    assert concept_names(p.confirmed_gaps) == ["chain rule", "u-sub"]
    assert p.knowledge_level == "beginner"


def test_parse_accepts_mixed_legacy_and_new_elements():
    raw = (
        '{"mastered_concepts": ["limits", {"name": "derivatives",'
        ' "evidence_type": "tested", "last_event_at": null}]}'
    )
    p = _parse_profile(raw)
    assert concept_names(p.mastered_concepts) == ["limits", "derivatives"]
    assert p.mastered_concepts[1].evidence_type == "tested"


def test_parse_still_drops_unknown_keys_and_never_raises():
    raw = '{"mastered_concepts": ["limits"], "retired_field": 1}'
    p = _parse_profile(raw)
    assert concept_names(p.mastered_concepts) == ["limits"]
    assert _parse_profile("not json").mastered_concepts == []
    assert _parse_profile('{"mastered_concepts": [42]}').mastered_concepts == []


def test_parse_defaults_subtopic_levels_empty():
    assert _parse_profile("{}").subtopic_levels == {}


def test_entry_helpers():
    entries = [ConceptEntry(name="Limits")]
    assert canon("  LIMITS ") == "limits"
    assert find_entry(entries, "limits").name == "Limits"
    assert find_entry(entries, "derivatives") is None
    stamp = datetime.now(timezone.utc)
    out = upsert_entry(entries, "limits", evidence_type="tested", stamp=stamp)
    assert len(out) == 1 and out[0].evidence_type == "tested" and out[0].last_event_at == stamp
    out2 = upsert_entry(out, "chain rule", evidence_type=None, stamp=stamp)
    assert concept_names(out2) == ["Limits", "chain rule"]


def test_apply_patch_stamps_provenance(session_row, db_session):
    from agent.types import ToolContext
    from contracts import UpdateTopicProfileArgs
    from services import profile_service

    ctx = ToolContext(
        db=db_session,
        session_id=session_row.id,
        user_id=session_row.user_id,
        turn_started_at=datetime.now(timezone.utc),
    )
    res = profile_service.apply_patch(
        db_session, ctx,
        UpdateTopicProfileArgs(
            session_id=session_row.id,
            add_mastered_concept="limits",
            evidence_type="declared",
        ),
    )
    assert res.ok
    p = profile_service.load_profile(db_session, session_row.id)
    entry = p.mastered_concepts[0]
    assert entry.name == "limits"
    assert entry.evidence_type == "declared"
    assert entry.last_event_at is not None

    # repeat with tested evidence upgrades in place, no duplicate
    profile_service.apply_patch(
        db_session, ctx,
        UpdateTopicProfileArgs(
            session_id=session_row.id,
            add_mastered_concept="LIMITS",
            evidence_type="tested",
        ),
    )
    p = profile_service.load_profile(db_session, session_row.id)
    assert len(p.mastered_concepts) == 1
    assert p.mastered_concepts[0].evidence_type == "tested"


def test_user_patch_and_delete_are_entry_aware(session_row, db_session):
    from services import profile_service

    profile_service.apply_user_patch(db_session, session_row.id, add_gap="chain rule")
    p = profile_service.load_profile(db_session, session_row.id)
    assert p.confirmed_gaps[0].name == "chain rule"
    assert p.confirmed_gaps[0].evidence_type is None
    assert p.confirmed_gaps[0].last_event_at is not None

    p = profile_service.remove_profile_item(
        db_session, session_row.id, "confirmed_gaps", "Chain Rule"
    )
    assert p.confirmed_gaps == []


def _ctx_args(db_session, session_row, **kw):
    from agent.types import ToolContext
    from contracts import UpdateTopicProfileArgs

    ctx = ToolContext(
        db=db_session,
        session_id=session_row.id,
        user_id=session_row.user_id,
        turn_started_at=datetime.now(timezone.utc),
    )
    return ctx, UpdateTopicProfileArgs(session_id=session_row.id, **kw)


def test_apply_patch_sets_subtopic_level(session_row, db_session):
    from services import profile_service

    ctx, args = _ctx_args(
        db_session, session_row, subtopic="  Integration BY Parts ", subtopic_level="beginner"
    )
    res = profile_service.apply_patch(db_session, ctx, args)
    assert res.ok
    p = profile_service.load_profile(db_session, session_row.id)
    assert p.subtopic_levels == {"integration by parts": "beginner"}


def test_apply_patch_subtopic_requires_pair(session_row, db_session):
    from services import profile_service

    ctx, args = _ctx_args(db_session, session_row, subtopic="chain rule")
    res = profile_service.apply_patch(db_session, ctx, args)
    assert not res.ok
    assert "together" in res.error


def test_apply_patch_subtopic_cap(session_row, db_session):
    from services import profile_service

    p = profile_service.load_profile(db_session, session_row.id)
    p.subtopic_levels = {f"topic {i}": "beginner" for i in range(20)}
    profile_service.save_profile(db_session, session_row.id, p)

    ctx, args = _ctx_args(db_session, session_row, subtopic="one more", subtopic_level="advanced")
    res = profile_service.apply_patch(db_session, ctx, args)
    assert not res.ok and "full" in res.error

    # updating an existing key is always allowed
    ctx, args = _ctx_args(db_session, session_row, subtopic="topic 3", subtopic_level="advanced")
    assert profile_service.apply_patch(db_session, ctx, args).ok


def test_apply_patch_subtopic_empty_after_strip(session_row, db_session):
    from services import profile_service

    ctx, args = _ctx_args(db_session, session_row, subtopic="   ", subtopic_level="beginner")
    res = profile_service.apply_patch(db_session, ctx, args)
    assert not res.ok
    assert "empty" in res.error


def test_null_focus_if_removed_matches_canonically():
    profile = TopicProfile(focus_target_gap="Chain Rule")
    profile_service._null_focus_if_removed(profile, "  chain rule ")
    assert profile.focus_target_gap is None


def test_null_focus_if_removed_leaves_unrelated_focus():
    profile = TopicProfile(focus_target_gap="Chain Rule")
    profile_service._null_focus_if_removed(profile, "product rule")
    assert profile.focus_target_gap == "Chain Rule"


def test_add_exclusive_is_public_and_clears_canon_focus():
    profile = TopicProfile(
        focus_target_gap="chain rule",
        confirmed_gaps=[ConceptEntry(name="Chain Rule")],
    )
    profile_service.add_exclusive(profile, "mastered_concepts", "CHAIN RULE")
    assert profile_service.concept_names(profile.confirmed_gaps) == []
    assert profile.focus_target_gap is None
    assert profile_service.concept_names(profile.mastered_concepts) == ["CHAIN RULE"]
