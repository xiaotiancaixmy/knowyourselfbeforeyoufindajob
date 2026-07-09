from __future__ import annotations

import re

from src.models.domain import ExperienceRecord
from src.services.deepseek_client import DeepSeekClient


HEADER_SEPARATORS = ["|", " - ", " — ", " – ", " @ "]
DATE_PATTERN = re.compile(
    r"(?P<time>(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|\d{4}|现在|至今|Present).{0,30})",
    re.IGNORECASE,
)


class ExperienceParserService:
    def __init__(self, llm: DeepSeekClient):
        self.llm = llm

    def parse(self, raw_text: str) -> list[ExperienceRecord]:
        llm_result = self._parse_with_llm(raw_text)
        if llm_result:
            return llm_result
        experiences = self._parse_heuristically(raw_text)
        if not experiences:
            raise ValueError("没有识别出有效经历，请补充更完整的简历文本。")
        return experiences

    def merge_fact_answer(self, experience: ExperienceRecord, answer: str) -> ExperienceRecord:
        cleaned = answer.strip()
        if not cleaned:
            return experience

        experience.evidence_notes.append(cleaned)
        lines = [line.strip("-• ").strip() for line in cleaned.splitlines() if line.strip()]
        for line in lines:
            if any(keyword in line for keyword in ["负责", "主导", "推动", "搭建", "设计", "优化", "协调"]):
                if line not in experience.responsibilities:
                    experience.responsibilities.append(line)
            if any(token in line for token in ["%", "倍", "提升", "增长", "降低", "留存", "转化", "ROI", "DAU", "GMV"]):
                if line not in experience.outcomes:
                    experience.outcomes.append(line)
            if any(keyword in line for keyword in ["背景", "业务", "目标", "场景", "用户"]):
                if line not in experience.projects:
                    experience.projects.append(line)
        return experience

    def _parse_with_llm(self, raw_text: str) -> list[ExperienceRecord]:
        result = self.llm.complete_json(
            system_prompt=(
                "你是一个简历结构化解析器。"
                "请把简历文本解析成 experiences 数组。"
                "每个 experience 需要包含 company, role, timeframe, business_context, projects, responsibilities, outcomes。"
            ),
            user_prompt=raw_text[:12000],
        )
        if not result or "experiences" not in result:
            return []
        experiences: list[ExperienceRecord] = []
        for item in result["experiences"]:
            company = str(item.get("company", "")).strip()
            role = str(item.get("role", "")).strip()
            timeframe = str(item.get("timeframe", "")).strip()
            if not company or not role:
                continue
            experiences.append(
                ExperienceRecord(
                    company=company,
                    role=role,
                    timeframe=timeframe or "Unknown",
                    business_context=str(item.get("business_context", "")).strip(),
                    projects=[str(value).strip() for value in item.get("projects", []) if str(value).strip()],
                    responsibilities=[str(value).strip() for value in item.get("responsibilities", []) if str(value).strip()],
                    outcomes=[str(value).strip() for value in item.get("outcomes", []) if str(value).strip()],
                )
            )
        return experiences

    def _parse_heuristically(self, raw_text: str) -> list[ExperienceRecord]:
        blocks = [block.strip() for block in re.split(r"\n\s*\n", raw_text) if block.strip()]
        experiences: list[ExperienceRecord] = []
        for block in blocks:
            lines = [line.strip() for line in block.splitlines() if line.strip()]
            if len(lines) < 2:
                continue
            header = lines[0]
            company, role, timeframe = self._parse_header(header)
            if not company or not role:
                if len(lines) > 1:
                    company, role, timeframe = self._parse_header(f"{lines[0]} | {lines[1]}")
            if not company or not role:
                continue

            bullets = [line.strip("-• ").strip() for line in lines[1:] if line.strip()]
            responsibilities = [line for line in bullets if line]
            outcomes = [line for line in bullets if self._looks_like_outcome(line)]
            business_context = bullets[0] if bullets else ""
            experiences.append(
                ExperienceRecord(
                    company=company,
                    role=role,
                    timeframe=timeframe,
                    business_context=business_context,
                    projects=bullets[:2],
                    responsibilities=responsibilities[:6],
                    outcomes=outcomes[:4],
                )
            )

        if not experiences and raw_text.strip():
            snippet = raw_text.strip().splitlines()[0][:80]
            experiences.append(
                ExperienceRecord(
                    company="Unknown company",
                    role="Unknown role",
                    timeframe="Unknown timeframe",
                    business_context=snippet,
                    responsibilities=[snippet],
                )
            )
        return experiences

    def _parse_header(self, header: str) -> tuple[str, str, str]:
        for separator in HEADER_SEPARATORS:
            if separator in header:
                parts = [part.strip() for part in header.split(separator) if part.strip()]
                if len(parts) >= 3:
                    return parts[0], parts[1], parts[2]
                if len(parts) == 2:
                    timeframe = self._extract_timeframe(header)
                    return parts[0], parts[1], timeframe
        timeframe = self._extract_timeframe(header)
        cleaned = header.replace(timeframe, "").strip(" |-—–")
        if not cleaned:
            return "", "", timeframe
        tokens = [token.strip() for token in re.split(r"[-|—–@]", cleaned) if token.strip()]
        if len(tokens) >= 2:
            return tokens[0], tokens[1], timeframe
        return "", "", timeframe

    def _extract_timeframe(self, text: str) -> str:
        match = DATE_PATTERN.search(text)
        return match.group("time").strip() if match else "Unknown timeframe"

    def _looks_like_outcome(self, text: str) -> bool:
        keywords = ["%", "增长", "提升", "降低", "减少", "留存", "转化", "ROI", "DAU", "GMV", "revenue", "users"]
        return any(keyword.lower() in text.lower() for keyword in keywords)
