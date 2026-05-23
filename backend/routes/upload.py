import os
import re
from pathlib import Path

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
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
from services import ingestion_service, rate_limit


router = APIRouter(prefix="/api")

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB


@router.post(
    "/upload",
    response_model=UploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def upload_pdf(
    request: Request,
    background_tasks: BackgroundTasks,
    user_id: str = Form(...),
    session_id: str = Form(...),
    file: UploadFile = File(...),
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

    if (file.content_type or "").split(";")[0].strip() != "application/pdf":
        raise HTTPException(status_code=400, detail="file must be application/pdf")

    if db.get(SessionModel, session_id) is None:
        raise HTTPException(status_code=400, detail="session not found")

    raw_name = Path(file.filename or "upload.pdf").name
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", raw_name)
    if not safe_name or safe_name in {".", ".."}:
        raise HTTPException(status_code=400, detail={"code": "INVALID_FILENAME"})

    doc = Document(session_id=session_id, filename=safe_name, status="pending")
    db.add(doc)
    db.commit()
    db.refresh(doc)

    data = file.file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        db.delete(doc)
        db.commit()
        raise HTTPException(
            status_code=413,
            detail={"code": "FILE_TOO_LARGE", "max_bytes": MAX_UPLOAD_BYTES},
        )

    os.makedirs(settings.uploads_path, exist_ok=True)
    dest = os.path.join(settings.uploads_path, f"{doc.id}_{doc.filename}")
    with open(dest, "wb") as fh:
        fh.write(data)

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
    user_id: str = Query(...),
    db: Session = Depends(get_db),
):
    doc = db.get(Document, document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="document not found")
    sess = db.get(SessionModel, doc.session_id)
    if sess is None or sess.user_id != user_id:
        raise HTTPException(status_code=404, detail="document not found")
    return UploadStatus(id=doc.id, status=doc.status, error=doc.error)
