from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


@dataclass(frozen=True)
class AppConfig:
    database_path: Path = BASE_DIR / "app.db"
    deepseek_api_key: str | None = os.environ.get("DEEPSEEK_API_KEY")
    deepseek_base_url: str = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    deepseek_model: str = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")

    @property
    def llm_enabled(self) -> bool:
        value = self.deepseek_api_key
        return bool(value and value != "your_deepseek_api_key_here")


CONFIG = AppConfig()
