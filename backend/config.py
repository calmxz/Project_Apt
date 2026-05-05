from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    gemini_api_key: str = ""
    model: str = "gemini/gemini-2.5-pro"
    daily_cap: int = 50
    database_url: str = "sqlite:///./data/app.db"


settings = Settings()
