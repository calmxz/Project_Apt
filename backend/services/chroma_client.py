"""ChromaDB client singleton. Tests override get_chroma() via monkeypatch."""

import chromadb

from config import settings


_client = None


def get_chroma():
    global _client
    if _client is None:
        _client = chromadb.PersistentClient(path=settings.chroma_path)
    return _client


def collection_name(session_id: str) -> str:
    return f"session_{session_id}"
