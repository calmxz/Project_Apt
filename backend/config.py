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
    model: str = "gemini/gemini-2.5-pro"
    embedding_model: str = "gemini/text-embedding-004"
    daily_cap: int = 50
    database_url: str = f"sqlite:///{(_DATA_DIR / 'app.db').as_posix()}"
    chroma_path: str = (_DATA_DIR / "chroma").as_posix()
    uploads_path: str = (_DATA_DIR / "uploads").as_posix()


settings = Settings()

# Ensure runtime directories exist (data/, data/chroma/, data/uploads/, and
# parent of the sqlite file). SQLite creates the file but not its parent dir.
for _p in (
    Path(settings.chroma_path),
    Path(settings.uploads_path),
    Path(settings.database_url.replace("sqlite:///", "", 1)).parent
    if settings.database_url.startswith("sqlite:///")
    else None,
):
    if _p is not None:
        _p.mkdir(parents=True, exist_ok=True)
