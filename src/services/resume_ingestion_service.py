from __future__ import annotations

from io import BytesIO


class ResumeIngestionService:
    def extract_from_text(self, raw_text: str) -> str:
        text = raw_text.strip().replace("\r\n", "\n")
        if not text:
            raise ValueError("导入文本为空，无法开始 onboarding。")
        return self._clean_text(text)

    def extract_from_pdf(self, file_bytes: bytes) -> str:
        try:
            from pypdf import PdfReader
        except ModuleNotFoundError as exc:
            raise RuntimeError("缺少 pypdf，请先安装 requirements.txt 中的依赖。") from exc

        try:
            reader = PdfReader(BytesIO(file_bytes))
            pages = [page.extract_text() or "" for page in reader.pages]
        except Exception as exc:  # pragma: no cover - library-specific branch
            raise ValueError("PDF 解析失败，请尝试重新上传或改用文本粘贴。") from exc

        text = self._clean_text("\n".join(pages))
        if not text:
            raise ValueError("PDF 中没有提取到可用文本，请改用文本粘贴。")
        return text

    def _clean_text(self, text: str) -> str:
        lines = [line.strip() for line in text.splitlines()]
        kept: list[str] = []
        previous_blank = False
        for line in lines:
            is_blank = line == ""
            if is_blank and previous_blank:
                continue
            kept.append(line)
            previous_blank = is_blank
        return "\n".join(kept).strip()
