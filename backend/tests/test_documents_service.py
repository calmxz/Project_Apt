"""TDD: services.documents_service aggregate status + ready gate."""

from contracts import TopicProfile
from db.models import Document, Session as SessionModel, User
from services import documents_service


SID = "sess_docs"
UID = "u_docs"


def _seed_session(db):
    db.add(User(id=UID))
    db.flush()
    db.add(
        SessionModel(
            id=SID,
            user_id=UID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db.commit()


def _add_doc(db, status):
    doc = Document(session_id=SID, filename=f"{status}.pdf", status=status)
    db.add(doc)
    db.commit()


def test_status_none_when_no_documents(db_session):
    _seed_session(db_session)
    assert documents_service.session_ingestion_status(db_session, SID) is None
    assert documents_service.has_ready_document(db_session, SID) is False


def test_status_pending_when_any_pending(db_session):
    _seed_session(db_session)
    _add_doc(db_session, "ready")
    _add_doc(db_session, "pending")
    assert documents_service.session_ingestion_status(db_session, SID) == "pending"


def test_status_ready_when_any_ready_and_none_pending(db_session):
    _seed_session(db_session)
    _add_doc(db_session, "ready")
    _add_doc(db_session, "failed")
    assert documents_service.session_ingestion_status(db_session, SID) == "ready"
    assert documents_service.has_ready_document(db_session, SID) is True


def test_status_failed_when_all_failed(db_session):
    _seed_session(db_session)
    _add_doc(db_session, "failed")
    _add_doc(db_session, "failed")
    assert documents_service.session_ingestion_status(db_session, SID) == "failed"
    assert documents_service.has_ready_document(db_session, SID) is False


def test_list_document_statuses_orders_oldest_first(db_session):
    _seed_session(db_session)
    _add_doc(db_session, "ready")
    _add_doc(db_session, "pending")
    docs = documents_service.list_document_statuses(db_session, SID)
    assert [d.status for d in docs] == ["ready", "pending"]
