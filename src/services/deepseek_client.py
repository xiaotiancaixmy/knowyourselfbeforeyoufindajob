from __future__ import annotations

import json
from typing import Any

from openai import OpenAI

from src.config import AppConfig


class DeepSeekClient:
    def __init__(self, config: AppConfig):
        self.config = config
        self._client: OpenAI | None = None
        if config.llm_enabled:
            self._client = OpenAI(
                api_key=config.deepseek_api_key,
                base_url=config.deepseek_base_url,
            )

    @property
    def enabled(self) -> bool:
        return self._client is not None

    def complete_text(self, system_prompt: str, user_prompt: str) -> str | None:
        if not self._client:
            return None
        response = self._client.chat.completions.create(
            model=self.config.deepseek_model,
            temperature=0.3,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        return response.choices[0].message.content or None

    def complete_json(self, system_prompt: str, user_prompt: str) -> dict[str, Any] | None:
        raw = self.complete_text(
            system_prompt=system_prompt + "\n输出必须是 JSON 对象，不要加 markdown。",
            user_prompt=user_prompt,
        )
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None
