import os

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from sqlalchemy.orm import Session

from config import settings
from contracts import UploadResponse
from db.database import get_db
from db.models import Document, Session as SessionModel
from services import ingestion_service


router = APIRouter(prefix="/api")


@router.post(
    "/upload",
    response_model=UploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def upload_pdf(
    background_tasks: BackgroundTasks,
    session_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if (file.content_type or "").split(";")[0].strip() != "application/pdf":
        raise HTTPException(status_code=400, detail="file must be application/pdf")

    if db.get(SessionModel, session_id) is None:
        raise HTTPException(status_code=400, detail="session not found")

    doc = Document(session_id=session_id, filename=file.filename or "upload.pdf", status="pending")
    db.add(doc)
    db.commit()
    db.refresh(doc)

    os.makedirs(settings.uploads_path, exist_ok=True)
    dest = os.path.join(settings.uploads_path, f"{doc.id}_{doc.filename}")
    with open(dest, "wb") as fh:
        fh.write(file.file.read())

    background_tasks.add_task(ingestion_service.run, doc.id)

    return UploadResponse(
        document_id=doc.id,
        session_id=session_id,
        filename=doc.filename,
        status="pending",
    )
