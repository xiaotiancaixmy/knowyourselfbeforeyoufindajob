import type {
  ClaimRestrictionDto,
  JobFitCriticalMismatchDto,
  JobFitDecision,
  JobFitEvidenceDto,
  JobFitGapDto,
  JobFitInsufficientReason,
  JobFitRecommendedExperienceDto,
} from "@kys/shared";

import type { RequirementMapping } from "./job-fit-model-mapper.js";
import { validateEvidence, type ConfirmedFactCandidate } from "./job-fit-claim-validator.js";

export interface JobFitPolicyResult {
  decision: JobFitDecision;
  insufficientReason: JobFitInsufficientReason | null;
  summary: string;
  evidence: JobFitEvidenceDto[];
  gaps: JobFitGapDto[];
  criticalMismatches: JobFitCriticalMismatchDto[];
  recommendedExperiences: JobFitRecommendedExperienceDto[];
  claimRestrictions: ClaimRestrictionDto[];
}

export function fixedJobFitDecisionPolicy(params: {
  mappings: RequirementMapping[];
  facts: ConfirmedFactCandidate[];
  jdSufficient: boolean;
  factsSufficient: boolean;
  returnAnalysisId: number;
  selectedExperienceIds: number[];
}): JobFitPolicyResult {
  const { mappings, facts, jdSufficient, factsSufficient, returnAnalysisId, selectedExperienceIds } = params;
  const restrictions = [...new Map(facts.flatMap((fact) => fact.restrictions).map((item) => [`${item.code}:${item.description}`, item])).values()];
  const empty = {
    evidence: [] as JobFitEvidenceDto[],
    gaps: [] as JobFitGapDto[],
    criticalMismatches: [] as JobFitCriticalMismatchDto[],
    recommendedExperiences: [] as JobFitRecommendedExperienceDto[],
    claimRestrictions: restrictions,
  };

  let result: JobFitPolicyResult;

  if (!jdSufficient || !factsSufficient) {
    const insufficientReason = !jdSufficient && !factsSufficient ? "both" : !jdSufficient ? "jd_insufficient" : "facts_insufficient";
    result = {
      decision: "insufficient",
      insufficientReason,
      summary: insufficientReason === "jd_insufficient"
        ? "JD 信息不足，暂时无法形成投递决策。"
        : insufficientReason === "facts_insufficient"
          ? "已确认事实不足，暂时无法形成投递决策。"
          : "JD 与已确认事实都不足，暂时无法形成投递决策。",
      ...empty,
    };
    return result;
  }

  const rawEvidence = mappings.flatMap<JobFitEvidenceDto>((mapping) => mapping.assessment === "met" && mapping.evidence ? [{
    requirement: mapping.requirement,
    confirmedFact: mapping.evidence.fact,
    experienceId: mapping.evidence.experienceId,
    company: mapping.evidence.company,
    role: mapping.evidence.role,
    factVersion: mapping.evidence.factVersion,
  }] : []);
  const evidence = validateEvidence(rawEvidence, facts).slice(0, 3);
  const hardUnmet = mappings.filter((mapping) => mapping.importance === "hard" && mapping.assessment === "unmet");
  if (hardUnmet.length > 0) {
    result = {
      decision: "no_go",
      insufficientReason: null,
      summary: "当前岗位存在关键不匹配。",
      ...empty,
      evidence,
      criticalMismatches: hardUnmet.slice(0, 3).map((mapping) => ({
        requirement: mapping.requirement,
        reason: mapping.rationale,
      })),
    };
    return result;
  }

  const hardUnknown = mappings.filter((mapping) => mapping.importance === "hard" && mapping.assessment === "unknown");
  if (hardUnknown.length > 0 || evidence.length === 0) {
    const targets = hardUnknown.length > 0 ? hardUnknown : mappings.slice(0, 1);
    result = {
      decision: "conditional",
      insufficientReason: null,
      summary: "先补齐指定信息，再决定是否投递。",
      ...empty,
      evidence,
      gaps: targets.slice(0, 3).map((mapping) => ({
        requirement: mapping.requirement,
        reason: mapping.rationale || "需要补充可核对的事实。",
        importance: mapping.importance,
        remediationTarget: selectedExperienceIds.length > 0 ? "step_4" : "step_3",
        targetExperienceId: selectedExperienceIds[0] ?? null,
        returnAnalysisId,
      })),
    };
    return result;
  }

  const recommendedExperiences = [...new Map(evidence.map((item) => [item.experienceId, item])).values()].slice(0, 3).map((item) => ({
    experienceId: item.experienceId,
    company: item.company,
    role: item.role,
    factVersion: item.factVersion,
    rationale: `这段经历可直接支撑「${item.requirement}」。`,
  }));

  result = {
    decision: "apply",
    insufficientReason: null,
    summary: "建议投递，可以进入岗位版简历。",
    ...empty,
    evidence,
    recommendedExperiences,
  };
  return result;
}
