from __future__ import annotations

from src.models.domain import EvidenceGap, ExperienceRecord


class HiringJudgmentService:
    def evaluate_experience(self, experience: ExperienceRecord, gaps: list[EvidenceGap]) -> dict[str, object]:
        high_risks = [gap.gap_type for gap in gaps if gap.severity == "high"]
        strengths: list[str] = []
        if experience.outcomes:
            strengths.append("有可讲的结果信号")
        if len(experience.responsibilities) >= 3:
            strengths.append("职责和动作层次比较完整")
        if experience.evidence_notes:
            strengths.append("已经补进了额外证据，不只是静态简历")

        if not strengths:
            strengths.append("这段经历有潜力，但目前主要价值还没被讲清楚")

        do_not_claim = []
        if "result" in high_risks:
            do_not_claim.append("不要把这段包装成强结果案例，先补结果证据")
        if "ownership" in high_risks:
            do_not_claim.append("不要把这段写成端到端 owner，先补清楚你亲自负责的部分")

        current_risk = (
            "、".join(high_risks) + " 还不够扎实，站在招聘视角看，目前说服力不足。"
            if high_risks
            else "基础说服力已经够形成第一版素材，但仍然建议继续补 tradeoff 和 influence 细节。"
        )
        return {
            "strengths": strengths,
            "current_risk": current_risk,
            "do_not_claim": do_not_claim,
            "conservative_framing": self._conservative_framing(experience, high_risks),
        }

    def evaluate_positioning(self, experiences: list[ExperienceRecord]) -> dict[str, str]:
        text = " ".join(
            " ".join(exp.projects + exp.responsibilities + exp.outcomes + exp.evidence_notes)
            for exp in experiences
        ).lower()
        ai_signals = sum(keyword in text for keyword in ["ai", "llm", "prompt", "automation", "assistant"])
        growth_signals = sum(keyword in text for keyword in ["growth", "增长", "retention", "留存", "conversion", "转化"])
        ops_signals = sum(keyword in text for keyword in ["operation", "运营", "process", "workflow"])

        if ai_signals >= max(growth_signals, ops_signals):
            recommended = "AI / Agent / 工作流产品"
        elif growth_signals >= ops_signals:
            recommended = "增长 / 商业化 / 用户增长产品"
        else:
            recommended = "产品运营 / 复杂流程产品"

        return {
            "recommended_main_lane": recommended,
            "conservative_target_strategy": (
                "如果当前目标方向和已有证据不完全一致，先用证据最强的主线作为主卖点，"
                "再把其他方向降成可迁移能力，而不是硬讲完全匹配。"
            ),
        }

    def _conservative_framing(self, experience: ExperienceRecord, high_risks: list[str]) -> str:
        if high_risks:
            return (
                f"更稳妥的写法是把 `{experience.company}` 这段先定位成有潜力的项目经历，"
                "强调你明确负责的动作和已有结果，不要先把它包装成最强案例。"
            )
        return f"`{experience.company}` 这段可以作为一线案例，但仍建议保留可验证细节，避免过度包装。"
