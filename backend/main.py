import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import assert_prod_database, settings
from db.database import create_tables
from lib.logging_config import configure_logging
from lib.request_id import RequestIdMiddleware
from routes import chat, documents, health, me, profile, review, sessions, upload, usage
from services.auth import validate_jwks_startup
from worker import main_loop

configure_logging()

log = logging.getLogger(__name__)


def start_ingest_loop() -> tuple[threading.Thread | None, threading.Event | None]:
    """2026-08-12 worker-deferral spec: the web process drains the
    ingestion queue in a daemon thread unless a dedicated worker
    deployment disables it via INGEST_IN_PROCESS=false."""
    if not settings.ingest_in_process:
        return None, None
    stop_event = threading.Event()
    thread = threading.Thread(
        target=main_loop,
        kwargs={"stop_event": stop_event},
        daemon=True,
        name="ingest-loop",
    )
    thread.start()
    return thread, stop_event


@asynccontextmanager
async def lifespan(app: FastAPI):
    assert_prod_database(settings.env, settings.database_url)
    if settings.env == "prod" and not settings.supabase_url:
        raise RuntimeError("SUPABASE_URL is required when ENV=prod")
    validate_jwks_startup()
    create_tables()
    ingest_thread, ingest_stop = start_ingest_loop()
    yield
    if ingest_stop is not None:
        ingest_stop.set()
        # Bounded join: an ingest abandoned mid-shutdown is reclaimed by
        # recover_stuck on next boot (idempotent re-run).
        ingest_thread.join(timeout=5)


app = FastAPI(title="Crux", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Accept", "Authorization", "If-Match"],
    expose_headers=["X-Cost-Warning", "X-Request-Id"],
)

app.add_middleware(RequestIdMiddleware)

app.include_router(health.router)
app.include_router(chat.router)
app.include_router(profile.router)
app.include_router(sessions.router)
app.include_router(upload.router)
app.include_router(documents.router)
app.include_router(review.router)
app.include_router(usage.router)
app.include_router(me.router)
