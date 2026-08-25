import type { ClaimRestrictionDto, FactSummaryDto, JobFitEvidenceDto } from "@kys/shared";

import { hasOwnershipRestriction } from "./claim-safety.js";

export interface ConfirmedFactCandidate {
  category: keyof FactSummaryDto;
  fact: string;
  experienceId: number;
  company: string;
  role: string;
  factVersion: number;
  restrictions: ClaimRestrictionDto[];
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s，。；、,.!?！？：:()（）]/gu, "");
}

export function isAllowedDirectEvidence(candidate: ConfirmedFactCandidate): boolean {
  if (candidate.restrictions.some((restriction) => restriction.code === "claim_blocked")) return false;
  if (candidate.category === "ownership" && hasOwnershipRestriction(candidate.restrictions)) return false;
  const fact = normalized(candidate.fact);
  return !candidate.restrictions.some((restriction) => {
    const description = normalized(restriction.description);
    return description.length >= 4 && (description.includes(fact) || fact.includes(description));
  });
}

export function validateEvidence(
  evidence: JobFitEvidenceDto[],
  allowedFacts: ConfirmedFactCandidate[],
): JobFitEvidenceDto[] {
  return evidence.filter((item) => allowedFacts.some((candidate) =>
    isAllowedDirectEvidence(candidate)
    && candidate.experienceId === item.experienceId
    && candidate.factVersion === item.factVersion
    && candidate.fact === item.confirmedFact
  ));
}
