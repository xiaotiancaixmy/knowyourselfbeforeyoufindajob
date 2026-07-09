from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FactCompletionComposerConfig:
    experience_id: int
    draft_key: str
    textarea_label: str
    mic_button_id: str
    status_id: str


def build_fact_completion_composer_config(experience_id: int) -> FactCompletionComposerConfig:
    return FactCompletionComposerConfig(
        experience_id=experience_id,
        draft_key=f"fact_completion_draft_{experience_id}",
        textarea_label=f"Fact Completion Composer {experience_id}",
        mic_button_id=f"fact-composer-mic-{experience_id}",
        status_id=f"fact-composer-status-{experience_id}",
    )


def normalize_fact_completion_submission(value: str) -> str | None:
    cleaned = value.strip()
    return cleaned or None
