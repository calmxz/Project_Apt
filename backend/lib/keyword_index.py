"""Per-session keyword index for retrieval arbitration (Spec §3.1, §4.1).

Lowercase -> token boundary on non-letters -> drop stopwords + tokens shorter
than 3 -> Snowball/Porter stem. Stored as a JSON-encoded list on
Session.kw_index_json.

The index is populated at ingestion time from each chunk's text and used at
chat time to compute a boolean `retrieval_required` flag for prompt injection.
"""

import json
import re

import snowballstemmer
from sqlalchemy.orm import Session

from db.models import Session as SessionModel


STEMMER = snowballstemmer.stemmer("english")

STOPWORDS = frozenset(
    """
    the and for are but not you all any can had her was one our out his
    has she will with this that have from they their what when where who
    would there been being were than then them these those into which
    such only also some more most than too very does done about over
    before after between under above below while because each both other
    same different something nothing anything every here come came went
    """.split()
)

_TOKEN_RE = re.compile(r"[a-z]{3,}")


def build_from_text(text: str) -> set[str]:
    if not text:
        return set()
    tokens = _TOKEN_RE.findall(text.lower())
    keep = [t for t in tokens if t not in STOPWORDS]
    return set(STEMMER.stemWords(keep))


def merge_into_session(db: Session, session_id: str, new_stems: set[str]) -> None:
    row = db.get(SessionModel, session_id)
    if row is None:
        raise ValueError(f"session not found: {session_id}")
    current = set(json.loads(row.kw_index_json or "[]"))
    merged = current | set(new_stems)
    row.kw_index_json = json.dumps(sorted(merged))
    db.commit()


def match_required(query: str, kw_index) -> bool:
    if not kw_index:
        return False
    if isinstance(kw_index, list):
        kw_index = set(kw_index)
    return bool(build_from_text(query) & kw_index)
