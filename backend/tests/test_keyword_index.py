"""TDD: lib.keyword_index — Porter-stem build, match, persist."""

import json

from contracts import TopicProfile
from db.models import Session as SessionModel, User
from lib import keyword_index


def test_build_from_text_drops_stopwords_and_stems():
    stems = keyword_index.build_from_text(
        "The runners are running quickly along the river."
    )
    assert "run" in stems or "runner" in stems
    assert "the" not in stems
    assert "are" not in stems


def test_match_required_overlap_vs_disjoint():
    index = keyword_index.build_from_text("Database indexes accelerate queries")
    assert keyword_index.match_required("how does indexing work?", index) is True
    assert keyword_index.match_required("what is recursion?", index) is False
    assert keyword_index.match_required("any query at all", set()) is False


def test_merge_into_session_persists_union(db_session):
    db_session.add(User(id="u1"))
    db_session.flush()
    db_session.add(
        SessionModel(
            id="s1",
            user_id="u1",
            topic="t",
            topic_profile_json=TopicProfile().model_dump_json(),
            kw_index_json=json.dumps(["existing"]),
        )
    )
    db_session.commit()

    keyword_index.merge_into_session(db_session, "s1", {"new_stem", "existing"})
    row = db_session.get(SessionModel, "s1")
    stored = set(json.loads(row.kw_index_json))
    assert stored == {"existing", "new_stem"}
