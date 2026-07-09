from __future__ import annotations

from src.models.domain import CandidateProfile, ExperienceRecord, ResumeRewriteOutput


class ResumeRewriteService:
    def rewrite(
        self,
        experiences: list[ExperienceRecord],
        profile: CandidateProfile,
    ) -> ResumeRewriteOutput:
        summary = (
            f"候选人更适合以 `{profile.recommended_main_lane}` 为主线，"
            f"核心优势集中在 {', '.join(profile.strongest_themes[:2])}。"
            " 简历表达上应优先强调可验证结果、清晰 ownership 和关键判断，而不是泛泛描述职责。"
        )
        bullets: dict[int, list[str]] = {}
        for experience in experiences:
            items: list[str] = []
            if experience.business_context:
                items.append(f"在 {experience.company} 负责 {experience.role}，围绕 {experience.business_context} 推进关键项目。")
            for responsibility in experience.responsibilities[:2]:
                items.append(f"主导 / 负责：{responsibility}")
            for outcome in experience.outcomes[:2]:
                items.append(f"结果：{outcome}")
            if not items:
                items.append(f"在 {experience.company} 的经历需要先补充更多证据，再继续改写。")
            bullets[experience.id or -1] = items[:4]
        return ResumeRewriteOutput(
            professional_summary=summary,
            experience_bullets_by_experience_id=bullets,
        )
