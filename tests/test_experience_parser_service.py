from __future__ import annotations

import unittest

from src.services.experience_parser_service import ExperienceParserService


class FakeDeepSeekClient:
    def complete_text(self, system_prompt: str, user_prompt: str) -> str | None:
        return None

    def complete_json(self, system_prompt: str, user_prompt: str) -> dict | None:
        return None


class ExperienceParserServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.service = ExperienceParserService(FakeDeepSeekClient())

    def test_parse_structured_text_resume(self) -> None:
        raw_text = """
Acme | Senior Product Manager | 2022-2024
- Led onboarding redesign for a B2B workflow tool
- Improved conversion by 18% and cut drop-off by 12%

Beta | Product Manager | 2020-2022
- Built retention experiments for a consumer app
- Increased 30-day retention by 9%
""".strip()
        experiences = self.service.parse(raw_text)
        self.assertEqual(len(experiences), 2)
        self.assertEqual(experiences[0].company, "Acme")
        self.assertIn("Improved conversion by 18% and cut drop-off by 12%", experiences[0].outcomes)

    def test_merge_fact_answer_adds_outcomes_and_notes(self) -> None:
        experience = self.service.parse(
            "Acme | Product Manager | 2023\n- Led onboarding optimization"
        )[0]
        updated = self.service.merge_fact_answer(
            experience,
            "我主导了注册转化优化，最终让首周激活率提升 15%。",
        )
        self.assertTrue(updated.evidence_notes)
        self.assertTrue(any("15%" in item for item in updated.outcomes))


if __name__ == "__main__":
    unittest.main()
