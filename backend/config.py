from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


REPO_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    gemini_api_key: str = ""
    model: str = "gemini/gemini-2.5-pro"
    daily_cap: int = 50
    database_url: str = f"sqlite:///{(REPO_ROOT / 'data' / 'app.db').as_posix()}"
    embedding_model: str = "text-embedding-3-small"
    chroma_path: str = str(REPO_ROOT / "data" / "chroma")
    uploads_path: str = str(REPO_ROOT / "data" / "uploads")

    # Deterministic LLM stub for e2e and offline dev. Trigger by setting
    # LLM_STUB=1 in env, or by setting GEMINI_API_KEY=test.
    llm_stub: bool = False

    @property
    def llm_stub_enabled(self) -> bool:
        return self.llm_stub or self.gemini_api_key == "test"


settings = Settings()

# Ensure data dirs exist on import so callers can rely on them.
Path(settings.chroma_path).mkdir(parents=True, exist_ok=True)
Path(settings.uploads_path).mkdir(parents=True, exist_ok=True)
