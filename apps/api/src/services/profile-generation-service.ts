import type { CandidateProfile, CompanyDossier, EvidenceGap, ExperienceRecord, GoalSetupState } from "../domain.js";
import {
  hasConfirmedStrongOwnership,
  hasOwnershipRestriction,
  type ClaimRestrictionsByExperienceId,
} from "./claim-safety.js";
import { HiringJudgmentService } from "./hiring-judgment-service.js";

export class ProfileGenerationService {
  constructor(private readonly hiringJudgmentService: HiringJudgmentService) {}

  generate(
    experiences: ExperienceRecord[],
    _dossiers: CompanyDossier[],
    gapsByExperienceId: Record<number, EvidenceGap[]>,
    goalSetup?: GoalSetupState | null,
    restrictionsByExperienceId: ClaimRestrictionsByExperienceId = {},
  ): CandidateProfile {
    const strongestThemes = this.extractThemes(experiences);
    const weakSpots = this.extractWeakSpots(gapsByExperienceId);
    const positioning = this.hiringJudgmentService.evaluatePositioning(experiences, goalSetup);
    const companies = experiences.slice(0, 3).map((experience) => experience.company).join(", ");
    const targetRoleHint = goalSetup?.targetRole.trim()
      ? `这次求职先按「${goalSetup.targetRole.trim()}」来梳理，`
      : "";
    const sellingPointHint = goalSetup?.mainSellingPoint.trim()
      ? `建议重点突出「${goalSetup.mainSellingPoint.trim()}」。`
      : "建议重点突出事实依据最充分的能力。";
    const claimRestrictions = Object.values(restrictionsByExperienceId)
      .flat()
      .filter((restriction, index, all) =>
        all.findIndex((candidate) => candidate.code === restriction.code) === index,
      );
    const hasSafeStrongOwnership = experiences.some((experience) =>
      hasConfirmedStrongOwnership(experience)
      && !hasOwnershipRestriction(restrictionsByExperienceId[experience.id] ?? []),
    );
    const careerEvidence = hasSafeStrongOwnership
      ? "现有经历能说明你有推动复杂项目落地的能力"
      : "现有材料能确认你参与过相关项目，但个人贡献暂时不宜写得过重";
    const baseBoundary = goalSetup?.doNotOversell.trim()
      ? `这次明确不要夸大「${goalSetup.doNotOversell.trim()}」。没有明确结果或个人贡献依据的内容，也不宜写成你的核心优势。`
      : "适合重点突出事实依据最充分的方向；没有明确结果或个人贡献依据的内容，不宜写成核心优势。";
    const restrictionBoundary = claimRestrictions.length > 0
      ? ` 写作时还需注意：${claimRestrictions.map((restriction) => restriction.description).join("；")}`
      : "";
    return {
      careerArc: `${targetRoleHint}主要经历集中在 ${companies}，${careerEvidence}。关键案例中的事实越具体，表达越有说服力。${sellingPointHint}`,
      strongestThemes,
      weakSpots,
      positioningBoundary: `${baseBoundary}${restrictionBoundary}`,
      recommendedMainLane: positioning.recommendedMainLane,
      conservativeTargetStrategy: positioning.conservativeTargetStrategy,
    };
  }

  private extractThemes(experiences: ExperienceRecord[]): string[] {
    const joined = experiences.flatMap((experience) => [...experience.projects, ...experience.responsibilities, ...experience.outcomes]).join(" ").toLowerCase();
    const rules = {
      "AI、智能体与工作流产品": ["ai", "agent", "workflow", "llm", "automation"],
      "增长与留存": ["growth", "retention", "留存", "转化", "用户增长"],
      "跨团队协作与推进": ["跨团队", "stakeholder", "alignment", "协同", "推动"],
      "数据驱动的产品工作": ["sql", "data", "metric", "roi", "ab test", "实验"],
    };
    return Object.entries(rules)
      .map(([theme, keywords]) => ({
        theme,
        score: keywords.filter((keyword) => joined.includes(keyword.toLowerCase())).length,
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map((item) => item.theme);
  }

  private extractWeakSpots(gapsByExperienceId: Record<number, EvidenceGap[]>): string[] {
    const labels: Record<string, string> = {
      result: "实际结果还不够明确",
      ownership: "个人贡献还不够清楚",
      scope: "项目背景和影响范围还不够清楚",
      decision: "关键判断与取舍不够具体",
      tradeoff: "关键取舍还不够具体",
      failure: "问题与调整过程较少",
      influence: "协作推进的事实依据不足",
    };
    const counts = new Map<string, number>();
    for (const gaps of Object.values(gapsByExperienceId)) {
      for (const gap of gaps) {
        const label = labels[gap.gapType];
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label]) => label);
  }
}
