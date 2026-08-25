import { describe, expect, it } from "vitest";

import {
  factCompletionReviewPayloadSchema,
  factCompletionStateSchema,
  overallCompletionSchema,
  jobFitAnalysisSchema,
} from "./index.js";

describe("fact completion contracts", () => {
  it("accepts only canonical completion states and versioned confirmation actions", () => {
    expect(factCompletionStateSchema.options).toEqual([
      "not_started",
      "collecting",
      "review_ready",
      "limits_review",
      "completed",
      "completed_with_limits",
      "stale",
    ]);
    expect(factCompletionReviewPayloadSchema.parse({
      action: "finish_with_limits",
      expectedFactVersion: 3,
    })).toEqual({
      action: "finish_with_limits",
      expectedFactVersion: 3,
    });
  });

  it("keeps quality separate from the overall proceed gate", () => {
    const parsed = overallCompletionSchema.parse({
      selectedExperienceIds: [1],
      items: [{ experienceId: 1, status: "completed_with_limits", quality: "limited", isTerminal: true }],
      completedCount: 1,
      totalCount: 1,
      hasStale: false,
      canProceed: true,
      nextAction: {
        type: "proceed_to_dossier",
        label: "进入画像与档案（1/1）",
        prompt: null,
        experienceId: null,
      },
    });

    expect(parsed.items[0]?.quality).toBe("limited");
    expect(parsed.canProceed).toBe(true);
  });
});

describe("job fit contracts", () => {
  const base = {
    id: 1,
    jobTargetId: 2,
    version: 1,
    runState: "succeeded",
    decision: "apply",
    validity: "current",
    insufficientReason: null,
    summary: "建议投递",
    evidence: [{ requirement: "负责 AI 产品", confirmedFact: "负责 AI 产品", experienceId: 3, company: "Acme", role: "产品经理", factVersion: 2 }],
    gaps: [],
    criticalMismatches: [],
    recommendedExperiences: [],
    claimRestrictions: [],
    inputSnapshot: {
      jdId: 2,
      jdRevision: 1,
      sourceId: 4,
      positioningVersion: 1,
      positioningFingerprint: "positioning",
      selectedExperienceIds: [3],
      experiences: [{
        experienceId: 3,
        company: "Acme",
        role: "产品经理",
        factVersion: 2,
        factSummary: { context: ["AI 产品"], ownership: ["负责 AI 产品"], outcome: [], depth: [] },
        claimRestrictions: [],
        factSummaryHash: "facts",
        claimRestrictionsHash: "restrictions",
      }],
      createdAt: "2026-08-03T00:00:00.000Z",
    },
    inputFingerprint: "fingerprint",
    errorMessage: null,
    createdAt: "2026-08-03T00:00:00.000Z",
  } as const;

  it("rejects scores and enforces bounded evidence collections", () => {
    expect(jobFitAnalysisSchema.safeParse({ ...base, score: 92 }).success).toBe(false);
    expect(jobFitAnalysisSchema.safeParse({ ...base, evidence: Array.from({ length: 4 }, () => base.evidence[0]) }).success).toBe(false);
  });

  it("enforces valid run-state and decision combinations", () => {
    expect(jobFitAnalysisSchema.safeParse({ ...base, runState: "failed", decision: "apply" }).success).toBe(false);
    expect(jobFitAnalysisSchema.safeParse({ ...base, decision: "conditional", evidence: [], gaps: [] }).success).toBe(false);
    expect(jobFitAnalysisSchema.safeParse({ ...base, decision: "no_go", evidence: [], criticalMismatches: [] }).success).toBe(false);
    expect(jobFitAnalysisSchema.safeParse({ ...base, decision: "insufficient", evidence: [], insufficientReason: null }).success).toBe(false);
  });
});
