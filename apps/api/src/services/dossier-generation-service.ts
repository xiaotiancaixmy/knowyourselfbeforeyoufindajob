import type {
  ClaimRestriction,
  CompanyDossier,
  EvidenceGap,
  ExperienceRecord,
  GoalSetupState,
  PositioningDecisionState,
} from "../domain.js";
import { makeResponsibilitySafe } from "./claim-safety.js";
import { HiringJudgmentService } from "./hiring-judgment-service.js";

export class DossierGenerationService {
  constructor(private readonly hiringJudgmentService: HiringJudgmentService) {}

  generate(
    experience: ExperienceRecord,
    gaps: EvidenceGap[],
    goalSetup?: GoalSetupState | null,
    positioningDecision?: PositioningDecisionState | null,
    claimRestrictions: ClaimRestriction[] = [],
  ): CompanyDossier {
    const judgment = this.hiringJudgmentService.evaluateExperience(experience, gaps);
    const targetRole = goalSetup?.targetRole.trim();
    const focus = positioningDecision?.keepFocus.trim() || goalSetup?.mainSellingPoint.trim();
    const avoid = positioningDecision?.avoidEmphasis.trim() || goalSetup?.doNotOversell.trim();
    return {
      experienceId: experience.id,
      factualRecord: [
        `公司：${experience.company}`,
        `岗位：${experience.role}`,
        `时间：${experience.timeframe}`,
        `业务背景：${experience.businessContext || "待补充"}`,
        `项目：${experience.projects.join("; ") || "待补充"}`,
        `职责：${experience.responsibilities.join("; ") || "待补充"}`,
        `结果：${experience.outcomes.join("; ") || "待补充"}`,
      ].join("\n"),
      evaluativeJudgment: [
        targetRole ? `目标方向：说明这段经历如何支持「${targetRole}」。` : null,
        `可以突出：${judgment.strengths.join("；")}`,
        `需要注意：${judgment.currentRisk}`,
        `稳妥表达：${judgment.conservativeFraming}`,
        focus ? `建议重点：这段经历更适合说明「${focus}」。` : null,
        avoid ? `不要夸大：不要把这段经历往「${avoid}」上过度延伸。` : null,
        ...claimRestrictions.map((restriction) => `仅使用已确认事实：${restriction.description}`),
      ].filter(Boolean).join("\n"),
      reusableInterviewAssets: [
        ...experience.responsibilities
          .slice(0, 2)
          .map((value) => `可用于面试：${makeResponsibilitySafe(value, claimRestrictions)}`),
        ...experience.outcomes.slice(0, 2).map((value) => `实际结果：${value}`),
        ...judgment.doNotClaim,
        ...claimRestrictions.map((restriction) => `表达注意：${restriction.description}`),
      ],
    };
  }
}
