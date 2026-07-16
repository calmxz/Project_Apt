import logging
import re
from pathlib import Path

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from sqlalchemy.orm import Session

from config import settings
from contracts import UploadResponse, UploadStatus
from db.database import get_db
from db.models import Document, Session as SessionModel
from lib.error_codes import DAILY_CAP_REACHED
from services import ingestion_service, object_store, rate_limit
from services.auth import current_user_id


router = APIRouter(prefix="/api")

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB
ALLOWED_EXTENSIONS = {".pdf", ".pptx", ".txt", ".md", ".markdown"}

log = logging.getLogger(__name__)

READ_CHUNK = 1024 * 1024  # 1 MiB


def _read_bounded(fh, max_bytes: int) -> bytes:
    """Read fh incrementally, aborting with 413 as soon as the running total
    exceeds max_bytes (F-40: the Content-Length header is client-controlled,
    so the pre-gate above is advisory only)."""
    data = bytearray()
    while True:
        chunk = fh.read(READ_CHUNK)
        if not chunk:
            return bytes(data)
        data.extend(chunk)
        if len(data) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail={"code": "FILE_TOO_LARGE", "max_bytes": max_bytes},
            )


@router.post(
    "/upload",
    response_model=UploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def upload_file(
    request: Request,
    background_tasks: BackgroundTasks,
    session_id: str = Form(...),
    file: UploadFile = File(...),
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    allowed, used = rate_limit.check_and_increment(db, user_id)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "code": DAILY_CAP_REACHED,
                "cap": settings.daily_cap,
                "used": used,
                "resets_at": rate_limit.midnight_utc_iso(),
            },
        )

    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) > MAX_UPLOAD_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail={"code": "FILE_TOO_LARGE", "max_bytes": MAX_UPLOAD_BYTES},
                )
        except ValueError:
            pass

    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "UNSUPPORTED_FILE_TYPE",
                "message": "file type not supported; use PDF, PPTX, TXT, or MD",
            },
        )

    sess = db.get(SessionModel, session_id)
    if sess is None or sess.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")

    raw_name = Path(file.filename or "upload.pdf").name
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", raw_name)
    if not safe_name or safe_name in {".", ".."}:
        raise HTTPException(status_code=400, detail={"code": "INVALID_FILENAME"})

    data = _read_bounded(file.file, MAX_UPLOAD_BYTES)

    doc = Document(session_id=session_id, filename=safe_name, status="pending")
    db.add(doc)
    db.commit()
    db.refresh(doc)

    # F-29: a failed blob write must not strand a permanent "pending" row.
    # Mark the row failed (visible in the UI banner) and report 507.
    # get_store() itself is inside the try (final-review fix wave, Finding
    # 2): a bad R2 config can raise on construction, before put() is ever
    # called, and that must route through the same mark-failed + 507 path.
    try:
        store = object_store.get_store()
        store.put(object_store.key_for(doc.id, doc.filename), data)
    except Exception:
        log.error(
            "upload storage write failed",
            extra={"doc_id": doc.id},
            exc_info=settings.env != "prod",
        )
        try:
            doc.status = "failed"
            doc.error = "storage write failed"
            db.commit()
        except Exception:
            db.rollback()
            log.error("could not mark upload row failed", extra={"doc_id": doc.id})
        raise HTTPException(
            status_code=507,
            detail={"code": "STORAGE_WRITE_FAILED"},
        )

    background_tasks.add_task(ingestion_service.run, doc.id)

    return UploadResponse(
        document_id=doc.id,
        session_id=session_id,
        filename=doc.filename,
        status="pending",
    )


@router.get("/upload/{document_id}", response_model=UploadStatus)
def get_upload_status(
    document_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    doc = db.get(Document, document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="document not found")
    sess = db.get(SessionModel, doc.session_id)
    if sess is None or sess.user_id != user_id:
        raise HTTPException(status_code=404, detail="document not found")
    return UploadStatus(id=doc.id, status=doc.status, error=doc.error)
