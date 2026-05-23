from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from db.database import create_tables
from routes import chat, health, profile, sessions, upload


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_tables()
    yield


app = FastAPI(title="AdaptLearn", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Accept", "Authorization"],
)

app.include_router(health.router)
app.include_router(chat.router)
app.include_router(profile.router)
app.include_router(sessions.router)
app.include_router(upload.router)
