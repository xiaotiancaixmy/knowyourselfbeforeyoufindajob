from __future__ import annotations

import sys
import types
import unittest
from unittest.mock import patch

from src.services.resume_ingestion_service import ResumeIngestionService


class ResumeIngestionServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.service = ResumeIngestionService()

    def test_extract_from_text_strips_extra_blank_lines(self) -> None:
        text = "Line 1\n\n\nLine 2\n"
        result = self.service.extract_from_text(text)
        self.assertEqual(result, "Line 1\n\nLine 2")

    def test_extract_from_text_rejects_empty_input(self) -> None:
        with self.assertRaisesRegex(ValueError, "导入文本为空"):
            self.service.extract_from_text("   ")

    def test_extract_from_pdf_uses_pypdf_reader(self) -> None:
        fake_page = types.SimpleNamespace(extract_text=lambda: "Company | Role | 2023-2024")
        fake_reader = lambda _stream: types.SimpleNamespace(pages=[fake_page])
        fake_module = types.SimpleNamespace(PdfReader=fake_reader)

        with patch.dict(sys.modules, {"pypdf": fake_module}):
            result = self.service.extract_from_pdf(b"fake-pdf")

        self.assertIn("Company | Role | 2023-2024", result)


if __name__ == "__main__":
    unittest.main()
