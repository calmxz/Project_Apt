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
    model: str = "gemini/gemini-3.1-flash-lite"
    embedding_model: str = "gemini/gemini-embedding-2"
    daily_cap: int = 50
    database_url: str = f"sqlite:///{(_DATA_DIR / 'app.db').as_posix()}"
    embedding_dim: int = 768
    uploads_path: str = (_DATA_DIR / "uploads").as_posix()
    llm_stub: bool = False
    cors_origins: str = "http://localhost:5173"
    env: str = "dev"

    supabase_url: str = ""
    supabase_publishable_key: str = ""
    supabase_jwks_url_override: str = ""
    supabase_secret_key: str = ""
    llm_soft_cap_usd: float = 2.00
    llm_hard_cap_usd: float = 3.00

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def supabase_jwks_url(self) -> str:
        if self.supabase_jwks_url_override:
            return self.supabase_jwks_url_override
        if not self.supabase_url:
            return ""
        return self.supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json"

    @property
    def llm_stub_enabled(self) -> bool:
        return self.llm_stub or self.gemini_api_key == "test"


settings = Settings()


def assert_prod_database(env: str, database_url: str) -> None:
    if env == "prod" and database_url.startswith("sqlite"):
        raise RuntimeError(
            "database_url must be a Postgres URL when env=prod (got sqlite). "
            "Set DATABASE_URL to the Supabase Postgres connection string."
        )


# Ensure runtime directories exist (data/uploads/ and parent of the sqlite file).
for _p in (
    Path(settings.uploads_path),
    Path(settings.database_url.replace("sqlite:///", "", 1)).parent
    if settings.database_url.startswith("sqlite:///")
    else None,
):
    if _p is not None:
        _p.mkdir(parents=True, exist_ok=True)
