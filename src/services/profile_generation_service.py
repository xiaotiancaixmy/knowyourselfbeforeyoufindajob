from __future__ import annotations

from collections import Counter

from src.models.domain import CandidateProfile, CompanyDossier, EvidenceGap, ExperienceRecord
from src.services.hiring_judgment_service import HiringJudgmentService


class ProfileGenerationService:
    def __init__(self, hiring_judgment_service: HiringJudgmentService):
        self.hiring_judgment_service = hiring_judgment_service

    def generate(
        self,
        experiences: list[ExperienceRecord],
        dossiers: list[CompanyDossier],
        gaps_by_experience_id: dict[int, list[EvidenceGap]],
    ) -> CandidateProfile:
        themes = self._extract_themes(experiences)
        weak_spots = self._extract_weak_spots(gaps_by_experience_id)
        positioning = self.hiring_judgment_service.evaluate_positioning(experiences)
        companies = ", ".join(experience.company for experience in experiences[:3])
        return CandidateProfile(
            career_arc=(
                f"当前主线经历集中在 {companies}，整体更像一个能把复杂项目往前推的产品型候选人，"
                "但竞争力高低取决于关键案例里的证据密度。"
            ),
            strongest_themes=themes,
            weak_spots=weak_spots,
            positioning_boundary=(
                "适合把证据最强的方向作为主卖点，不建议在没有结果和 ownership 证据的情况下，"
                "直接把自己包装成全能型候选人。"
            ),
            recommended_main_lane=positioning["recommended_main_lane"],
            conservative_target_strategy=positioning["conservative_target_strategy"],
        )

    def _extract_themes(self, experiences: list[ExperienceRecord]) -> list[str]:
        counter: Counter[str] = Counter()
        joined = " ".join(
            " ".join(experience.projects + experience.responsibilities + experience.outcomes).lower()
            for experience in experiences
        )
        theme_rules = {
            "AI / Agent / workflow": ["ai", "agent", "workflow", "llm", "automation"],
            "Growth / retention": ["growth", "retention", "留存", "转化", "用户增长"],
            "Cross-functional execution": ["跨团队", "stakeholder", "alignment", "协同", "推动"],
            "Data-driven product work": ["sql", "data", "metric", "roi", "ab test", "实验"],
        }
        for theme, keywords in theme_rules.items():
            counter[theme] = sum(keyword in joined for keyword in keywords)
        ranked = [theme for theme, score in counter.most_common() if score > 0]
        return ranked[:3] or ["Complex product execution"]

    def _extract_weak_spots(self, gaps_by_experience_id: dict[int, list[EvidenceGap]]) -> list[str]:
        counter: Counter[str] = Counter()
        labels = {
            "result": "结果证据偏弱",
            "ownership": "ownership 叙事不够扎实",
            "scope": "项目范围和业务上下文不够清楚",
            "decision": "关键判断与取舍不够具体",
            "tradeoff": "tradeoff 讲法还不成熟",
            "failure": "失败与调整案例偏少",
            "influence": "影响他人协作的证据不足",
        }
        for gaps in gaps_by_experience_id.values():
            for gap in gaps:
                counter[labels[gap.gap_type]] += 1
        return [label for label, _ in counter.most_common(3)] or ["表达基础还行，但需要更多结果和决策证据"]
