from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from src.models.domain import StepKey
from src.services.workflow_service import WorkflowService
from src.storage.repository import SQLiteRepository


class FakeDeepSeekClient:
    def complete_text(self, system_prompt: str, user_prompt: str) -> str | None:
        return None

    def complete_json(self, system_prompt: str, user_prompt: str) -> dict | None:
        return None


class WorkflowServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        repository = SQLiteRepository(Path(self.tmpdir.name) / "workflow.db")
        self.workflow = WorkflowService(repository, FakeDeepSeekClient())

    def tearDown(self) -> None:
        self.tmpdir.cleanup()

    def _create_selected_experience(self) -> int:
        source = self.workflow.import_text_resume(
            """
Acme | Senior Product Manager | 2022-2024
- Led onboarding redesign for a workflow product
- Improved activation by 18%
""".strip()
        )
        experiences = self.workflow.get_experiences(source.id or -1)
        experience = experiences[0]
        self.workflow.select_experiences(source.id or -1, [experience.id or -1])
        return experience.id or -1

    def test_text_import_to_profile_and_rewrite_flow(self) -> None:
        source = self.workflow.import_text_resume(
            """
Acme | Senior Product Manager | 2022-2024
- Led onboarding redesign for a workflow product
- Improved activation by 18%

Beta | Product Manager | 2020-2022
- Built retention experiments
- Increased 30-day retention by 9%
""".strip()
        )
        experiences = self.workflow.get_experiences(source.id or -1)
        self.assertEqual(len(experiences), 2)

        self.workflow.select_experiences(source.id or -1, [experiences[0].id, experiences[1].id])
        for experience in self.workflow.get_experiences(source.id or -1):
            if not experience.selected:
                continue
            self.workflow.submit_fact_completion_answer(
                experience.id or -1,
                "我亲自负责需求推进和跨团队协调，最终让该项目拿到了明确业务结果，并且中间做过优先级取舍。",
            )

        statuses = self.workflow.step_statuses(source.id or -1)
        self.assertTrue(statuses[StepKey.DEEP_DIVE_SELECTION])

        dossiers, profile = self.workflow.generate_dossiers_and_profile(source.id or -1)
        self.assertEqual(len(dossiers), 2)
        self.assertTrue(profile.recommended_main_lane)

        rewrite = self.workflow.rewrite_resume(source.id or -1)
        self.assertTrue(rewrite.professional_summary)
        self.assertEqual(len(rewrite.experience_bullets_by_experience_id), 2)

    def test_fact_completion_starts_with_warm_recall_prompt(self) -> None:
        experience_id = self._create_selected_experience()

        signal, questions = self.workflow.analyze_selected_experience(experience_id)

        turns = self.workflow.list_fact_completion_chat(experience_id)
        self.assertEqual(len(turns), 1)
        self.assertIn("回到当时", turns[0]["content"])
        self.assertNotIn("为什么不是另一个方案", turns[0]["content"])
        self.assertFalse(self.workflow.should_reveal_fact_completion_gaps(experience_id))
        self.assertTrue(signal)
        self.assertTrue(questions)

    def test_fact_completion_reflects_before_deeper_follow_up(self) -> None:
        experience_id = self._create_selected_experience()
        self.workflow.analyze_selected_experience(experience_id)

        _, assistant_message, _ = self.workflow.submit_fact_completion_answer(
            experience_id,
            "这个项目当时主要是为了解决新用户第一次进入产品时不知道怎么开始的问题。"
            "我主要负责梳理 onboarding 主线，并推动设计和研发一起调整核心路径。",
        )

        self.assertTrue(self.workflow.should_reveal_fact_completion_gaps(experience_id))
        self.assertIn("如果用 hiring 的语言", assistant_message)
        self.assertIn("ownership", assistant_message)
        self.assertIn("下一步", assistant_message)
        self.assertNotIn("为什么不是另一个方案", assistant_message)
        self.assertNotIn("有没有哪里一开始没做对", assistant_message)

    def test_fact_completion_adds_sentence_scaffolds_for_vague_answers(self) -> None:
        experience_id = self._create_selected_experience()
        self.workflow.analyze_selected_experience(experience_id)

        _, assistant_message, _ = self.workflow.submit_fact_completion_answer(
            experience_id,
            "主要是做一个项目，然后和大家一起推进。",
        )

        self.assertIn("你可以顺着这些半句继续讲", assistant_message)
        self.assertIn("这个项目当时主要是为了解决", assistant_message)

    def test_fact_completion_replaces_legacy_assistant_only_chat(self) -> None:
        experience_id = self._create_selected_experience()
        self.workflow.repository.create_chat_turn(
            StepKey.FACT_COMPLETION,
            "assistant",
            "`Acme` 这段基础不错，但还有几个细节补上之后会更能打。 我继续追问几个关键问题。",
            experience_id,
        )
        self.workflow.repository.create_chat_turn(
            StepKey.FACT_COMPLETION,
            "assistant",
            "这段经历里你做过什么关键判断或取舍？为什么不是另一个方案？",
            experience_id,
        )

        self.workflow.analyze_selected_experience(experience_id)

        turns = self.workflow.list_fact_completion_chat(experience_id)
        self.assertEqual(len(turns), 1)
        self.assertIn("回到当时", turns[0]["content"])


if __name__ == "__main__":
    unittest.main()
