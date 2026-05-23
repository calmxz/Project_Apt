from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT = Path(__file__).resolve().parent.parent
_DATA_DIR = _REPO_ROOT / "data"


REPO_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    gemini_api_key: str = ""
    model: str = "gemini-3.1-flash-lite"
    embedding_model: str = "gemini-embedding-2"
    daily_cap: int = 50
    database_url: str = f"sqlite:///{(_DATA_DIR / 'app.db').as_posix()}"
    chroma_host: str = "localhost"
    chroma_port: int = 8001
    uploads_path: str = (_DATA_DIR / "uploads").as_posix()
    llm_stub: bool = False
    cors_origins: str = "http://localhost:5173"
    env: str = "dev"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def llm_stub_enabled(self) -> bool:
        return self.llm_stub or self.gemini_api_key == "test"


settings = Settings()

# Ensure runtime directories exist (data/uploads/ and parent of the sqlite file).
# Chroma persistence lives in the chromadb container's bind mount, not on the backend host.
for _p in (
    Path(settings.uploads_path),
    Path(settings.database_url.replace("sqlite:///", "", 1)).parent
    if settings.database_url.startswith("sqlite:///")
    else None,
):
    if _p is not None:
        _p.mkdir(parents=True, exist_ok=True)
