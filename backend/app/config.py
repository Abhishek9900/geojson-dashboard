"""
Application configuration using Pydantic Settings.
"""

from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # API
    app_name: str = "GeoJSON Dashboard API"
    debug: bool = False

    # CORS
    allowed_origins: List[str] = [
        "http://localhost:3000",
        "http://frontend:3000",
    ]

    # File upload limits
    max_upload_size_mb: int = 100  # 100 MB max

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
