"""ChromaDB HTTP client singleton. Tests override get_chroma() via monkeypatch."""

import chromadb

from config import settings


_client = None


def get_chroma():
    global _client
    if _client is None:
        _client = chromadb.HttpClient(host=settings.chroma_host, port=settings.chroma_port)
    return _client


def collection_name(session_id: str) -> str:
    return f"session_{session_id}"
