from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    gemini_api_key: str = ""
    model: str = "gemini/gemini-2.5-pro"
    embedding_model: str = "gemini/text-embedding-004"
    daily_cap: int = 50
    database_url: str = "sqlite:///./data/app.db"
    chroma_path: str = "./data/chroma"
    uploads_path: str = "./data/uploads"


settings = Settings()
