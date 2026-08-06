from datetime import datetime, timedelta, timezone

import worker
from db.models import Document, Session as SessionModel, User


def _seed_doc(db, status="pending", claimed_at=None, sid="s_w", uid="u_w"):
    if db.get(User, uid) is None:
        db.add(User(id=uid))
        db.flush()
        db.add(
            SessionModel(
                id=sid, user_id=uid, topic="t", topic_profile_json="{}"
            )
        )
    doc = Document(
        session_id=sid, filename="a.txt", status=status, claimed_at=claimed_at
    )
    db.add(doc)
    db.commit()
    return doc


def test_claim_next_claims_oldest_pending(db_session):
    d1 = _seed_doc(db_session)
    d2 = _seed_doc(db_session)
    got = worker.claim_next(db_session)
    assert got == d1.id
    db_session.expire_all()
    assert db_session.get(Document, d1.id).status == "processing"
    assert db_session.get(Document, d1.id).claimed_at is not None
    assert db_session.get(Document, d2.id).status == "pending"


def test_claim_next_returns_none_when_empty(db_session):
    assert worker.claim_next(db_session) is None


def test_recover_stuck_resets_old_processing(db_session):
    old = datetime.now(timezone.utc) - timedelta(minutes=45)
    d = _seed_doc(db_session, status="processing", claimed_at=old)
    fresh = _seed_doc(db_session, status="processing",
                      claimed_at=datetime.now(timezone.utc))
    n = worker.recover_stuck(db_session)
    assert n == 1
    db_session.expire_all()
    assert db_session.get(Document, d.id).status == "pending"
    assert db_session.get(Document, fresh.id).status == "processing"


def test_main_loop_recovers_stale_claim_mid_run_without_restart(db_session, monkeypatch):
    """PR-4 Finding 2: recover_stuck must not run only at boot. A worker
    that claims a doc and then dies leaves it "processing" with a stale
    claimed_at; the SAME running loop (no restart) must eventually recover
    it once it goes stale, not just at process start."""
    from sqlalchemy.orm import sessionmaker

    d = _seed_doc(db_session, status="pending")

    test_engine = db_session.get_bind()
    monkeypatch.setattr(
        "worker.SessionLocal",
        sessionmaker(autocommit=False, autoflush=False, bind=test_engine),
    )
    monkeypatch.setattr("worker.time", type("T", (), {
        "sleep": staticmethod(lambda s: None)
    }))
    monkeypatch.setattr("worker.RECOVER_EVERY_ITERATIONS", 2)

    call_count = {"n": 0}

    def fake_claim_next(db):
        call_count["n"] += 1
        if call_count["n"] == 1:
            # Simulate a worker that claimed the doc and died immediately --
            # by the next iteration its claim is already stale.
            doc = db.get(Document, d.id)
            doc.status = "processing"
            doc.claimed_at = datetime.now(timezone.utc) - timedelta(minutes=45)
            db.commit()
        return None

    monkeypatch.setattr("worker.claim_next", fake_claim_next)

    worker.main_loop(max_iterations=3)

    db_session.expire_all()
    assert db_session.get(Document, d.id).status == "pending"


def test_main_loop_processes_then_exits(db_session, monkeypatch):
    d = _seed_doc(db_session)
    processed = []
    monkeypatch.setattr(
        "worker.ingestion_service", type("M", (), {
            "run": staticmethod(lambda doc_id: processed.append(doc_id))
        }),
    )
    from sqlalchemy.orm import sessionmaker

    test_engine = db_session.get_bind()
    monkeypatch.setattr(
        "worker.SessionLocal",
        sessionmaker(autocommit=False, autoflush=False, bind=test_engine),
    )
    monkeypatch.setattr("worker.time", type("T", (), {
        "sleep": staticmethod(lambda s: None)
    }))
    worker.main_loop(max_iterations=2)
    assert processed == [d.id]
