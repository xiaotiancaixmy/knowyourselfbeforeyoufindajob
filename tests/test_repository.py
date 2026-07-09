from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from src.models.domain import CandidateSource, ExperienceRecord, StepKey
from src.storage.repository import SQLiteRepository


class SQLiteRepositoryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.repo = SQLiteRepository(Path(self.tmpdir.name) / "test.db")

    def tearDown(self) -> None:
        self.tmpdir.cleanup()

    def test_create_source_and_replace_experiences(self) -> None:
        source = self.repo.create_candidate_source(
            CandidateSource(source_type="text", raw_text="resume text")
        )
        experiences = [
            ExperienceRecord(company="Acme", role="PM", timeframe="2022-2024", responsibilities=["A"]),
            ExperienceRecord(company="Beta", role="Growth PM", timeframe="2020-2022", responsibilities=["B"]),
        ]
        self.repo.replace_experiences(source.id or -1, experiences)
        stored = self.repo.list_experiences(source.id or -1)
        self.assertEqual(len(stored), 2)
        self.assertEqual(stored[1].company, "Beta")

    def test_chat_turns_and_assets_roundtrip(self) -> None:
        source = self.repo.create_candidate_source(
            CandidateSource(source_type="text", raw_text="resume text")
        )
        self.repo.create_chat_turn(StepKey.FACT_COMPLETION, "assistant", "hello", 1)
        turns = self.repo.list_chat_turns(StepKey.FACT_COMPLETION, 1)
        self.assertEqual(turns[0]["content"], "hello")

        self.repo.save_generated_asset("candidate_profile", {"career_arc": "arc"}, source_id=source.id)
        payload = self.repo.get_latest_generated_asset("candidate_profile", source_id=source.id)
        self.assertEqual(payload["career_arc"], "arc")


if __name__ == "__main__":
    unittest.main()
