from __future__ import annotations

from src.models.domain import CompanyDossier, EvidenceGap, ExperienceRecord
from src.services.hiring_judgment_service import HiringJudgmentService


class DossierGenerationService:
    def __init__(self, hiring_judgment_service: HiringJudgmentService):
        self.hiring_judgment_service = hiring_judgment_service

    def generate(self, experience: ExperienceRecord, gaps: list[EvidenceGap]) -> CompanyDossier:
        judgment = self.hiring_judgment_service.evaluate_experience(experience, gaps)
        factual_record = "\n".join(
            [
                f"公司：{experience.company}",
                f"岗位：{experience.role}",
                f"时间：{experience.timeframe}",
                f"业务背景：{experience.business_context or '待补充'}",
                f"项目：{'; '.join(experience.projects) if experience.projects else '待补充'}",
                f"职责：{'; '.join(experience.responsibilities) if experience.responsibilities else '待补充'}",
                f"结果：{'; '.join(experience.outcomes) if experience.outcomes else '待补充'}",
            ]
        )
        evaluative_judgment = "\n".join(
            [
                "亮点：" + "；".join(judgment["strengths"]),
                "招聘风险：" + str(judgment["current_risk"]),
                "保守打法：" + str(judgment["conservative_framing"]),
            ]
        )
        reusable_assets = []
        for responsibility in experience.responsibilities[:2]:
            reusable_assets.append(f"STAR-ready hook: 我负责 {responsibility}")
        for outcome in experience.outcomes[:2]:
            reusable_assets.append(f"Evidence line: {outcome}")
        reusable_assets.extend(str(value) for value in judgment["do_not_claim"])
        return CompanyDossier(
            experience_id=experience.id or -1,
            factual_record=factual_record,
            evaluative_judgment=evaluative_judgment,
            reusable_interview_assets=reusable_assets,
        )
