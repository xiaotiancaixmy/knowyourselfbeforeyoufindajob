from __future__ import annotations

from src.models.domain import EvidenceGap, ExperienceRecord
from src.services.followup_question_service import QUESTION_BANK


class EvidenceGapService:
    def analyze(self, experience: ExperienceRecord) -> list[EvidenceGap]:
        gaps: list[EvidenceGap] = []

        if not experience.outcomes:
            gaps.append(self._gap(experience, "result", "high", "还可以继续补一个更明确的结果变化。"))
        if len(experience.responsibilities) < 2:
            gaps.append(self._gap(experience, "ownership", "high", "还需要再讲清楚一点你亲自负责推进的部分。"))
        if not experience.business_context and not experience.projects:
            gaps.append(self._gap(experience, "scope", "medium", "这段经历的业务背景和影响范围还可以更具体一点。"))
        if not self._contains_decision_signal(experience):
            gaps.append(self._gap(experience, "decision", "medium", "还可以继续补你自己做判断的部分。"))
        if not self._contains_tradeoff_signal(experience):
            gaps.append(self._gap(experience, "tradeoff", "medium", "还可以继续补你当时如何做平衡和取舍。"))
        if not self._contains_failure_signal(experience):
            gaps.append(self._gap(experience, "failure", "medium", "还可以继续补推进不顺时你怎么调整。"))
        if not self._contains_influence_signal(experience):
            gaps.append(self._gap(experience, "influence", "low", "还可以继续补你怎么带动别人一起配合。"))
        return gaps

    def ready_for_dossier(self, experience: ExperienceRecord, gaps: list[EvidenceGap]) -> bool:
        high_risks = [gap for gap in gaps if gap.severity == "high"]
        medium_risks = [gap for gap in gaps if gap.severity == "medium"]
        return len(high_risks) == 0 and len(medium_risks) <= 1

    def _gap(self, experience: ExperienceRecord, gap_type: str, severity: str, rationale: str) -> EvidenceGap:
        return EvidenceGap(
            experience_id=experience.id or -1,
            gap_type=gap_type,
            severity=severity,
            status="open",
            rationale=rationale,
            next_question=QUESTION_BANK[gap_type],
        )

    def _contains_decision_signal(self, experience: ExperienceRecord) -> bool:
        tokens = " ".join(experience.responsibilities + experience.evidence_notes).lower()
        return any(keyword in tokens for keyword in ["decision", "取舍", "判断", "why", "方案"])

    def _contains_tradeoff_signal(self, experience: ExperienceRecord) -> bool:
        tokens = " ".join(experience.evidence_notes + experience.projects).lower()
        return any(keyword in tokens for keyword in ["tradeoff", "平衡", "资源", "优先级", "时间", "质量"])

    def _contains_failure_signal(self, experience: ExperienceRecord) -> bool:
        tokens = " ".join(experience.evidence_notes).lower()
        return any(keyword in tokens for keyword in ["失败", "问题", "阻力", "调整", "mistake", "learn"])

    def _contains_influence_signal(self, experience: ExperienceRecord) -> bool:
        tokens = " ".join(experience.responsibilities + experience.evidence_notes).lower()
        return any(keyword in tokens for keyword in ["推动", "协调", "说服", "stakeholder", "cross-functional", "alignment"])
