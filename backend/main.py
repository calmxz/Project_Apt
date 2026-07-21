import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import assert_prod_database, settings
from db.database import SessionLocal, create_tables
from routes import chat, documents, health, me, profile, review, sessions, upload, usage
from services import ingestion_service
from services.auth import validate_jwks_startup


log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    assert_prod_database(settings.env, settings.database_url)
    if settings.env == "prod" and not settings.supabase_url:
        raise RuntimeError("SUPABASE_URL is required when ENV=prod")
    validate_jwks_startup()
    create_tables()
    db = SessionLocal()
    try:
        # Best-effort startup cleanup (F-26): a transient DB error reaping
        # stale pending documents must not prevent the app from booting
        # (final-review fix wave, Finding 3).
        try:
            ingestion_service.reap_stale_pending(db)
        except Exception as e:  # noqa: BLE001 - startup must not be gated on this
            log.warning("startup reap_stale_pending failed: %s", e)
    finally:
        db.close()
    yield


app = FastAPI(title="Crux", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Accept", "Authorization", "If-Match"],
    expose_headers=["X-Cost-Warning"],
)

app.include_router(health.router)
app.include_router(chat.router)
app.include_router(profile.router)
app.include_router(sessions.router)
app.include_router(upload.router)
app.include_router(documents.router)
app.include_router(review.router)
app.include_router(usage.router)
app.include_router(me.router)
