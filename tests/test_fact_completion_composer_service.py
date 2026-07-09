from __future__ import annotations

import unittest

from src.services.fact_completion_composer_service import (
    build_fact_completion_composer_config,
    normalize_fact_completion_submission,
)


class FactCompletionComposerServiceTest(unittest.TestCase):
    def test_builds_stable_composer_config(self) -> None:
        config = build_fact_completion_composer_config(42)

        self.assertEqual(config.experience_id, 42)
        self.assertEqual(config.draft_key, "fact_completion_draft_42")
        self.assertEqual(config.textarea_label, "Fact Completion Composer 42")
        self.assertEqual(config.mic_button_id, "fact-composer-mic-42")
        self.assertEqual(config.status_id, "fact-composer-status-42")

    def test_normalize_submission_rejects_blank_text(self) -> None:
        self.assertIsNone(normalize_fact_completion_submission("   \n  "))

    def test_normalize_submission_trims_outer_whitespace(self) -> None:
        self.assertEqual(
            normalize_fact_completion_submission("  先说下当时发生了什么  \n"),
            "先说下当时发生了什么",
        )


if __name__ == "__main__":
    unittest.main()
