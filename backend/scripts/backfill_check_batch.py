"""Backfill ChatMessage.check_batch_json for legacy asking-messages.

Idempotent: only touches messages whose check_batch_json is NULL and that carry
an ask_check_questions tool call. Reuses the live reconstruction logic so the
persisted recap matches what the API would render. Safe to re-run.

Run from backend/:  python scripts/backfill_check_batch.py
"""
import json

from sqlalchemy import select

from db.database import SessionLocal
from db.models import ChatMessage
from services import check_question_service


def main() -> int:
    db = SessionLocal()
    try:
        rows = db.execute(
            select(ChatMessage).where(ChatMessage.check_batch_json.is_(None))
        ).scalars().all()
        # Group by session so events load once per session, not per message.
        by_session: dict[str, list[ChatMessage]] = {}
        for m in rows:
            by_session.setdefault(m.session_id, []).append(m)

        updated = 0
        for session_id, msgs in by_session.items():
            events = check_question_service.load_session_learning_events(db, session_id)
            for m in msgs:
                batch = check_question_service.reconstruct_check_batch(db, m, events)
                if batch is not None:
                    m.check_batch_json = json.dumps(batch)
                    updated += 1
        db.commit()
        print(f"backfilled {updated} message(s) across {len(by_session)} session(s)")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
