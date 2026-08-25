import { describe, expect, it } from "vitest";

import { fixedJobFitDecisionPolicy } from "../src/services/job-fit-decision-policy.js";
import { isAllowedDirectEvidence, type ConfirmedFactCandidate } from "../src/services/job-fit-claim-validator.js";
import type { RequirementMapping } from "../src/services/job-fit-model-mapper.js";

const fact: ConfirmedFactCandidate = {
  category: "ownership",
  fact: "负责 AI 产品从需求到上线",
  experienceId: 7,
  company: "Acme",
  role: "产品经理",
  factVersion: 3,
  restrictions: [],
};

function decide(mappings: RequirementMapping[], facts = [fact]) {
  return fixedJobFitDecisionPolicy({
    mappings,
    facts,
    jdSufficient: true,
    factsSufficient: true,
    returnAnalysisId: 9,
    selectedExperienceIds: [7],
  });
}

describe("fixed job fit decision policy", () => {
  it("turns an unmet hard gate into No-Go", () => {
    expect(decide([{ requirement: "必须带过十人团队", importance: "hard", assessment: "unmet", evidence: null, rationale: "确认没有管理职责" }]).decision).toBe("no_go");
  });

  it("treats unknown as Conditional and routes to fact completion", () => {
    const result = decide([{ requirement: "必须有商业化经验", importance: "hard", assessment: "unknown", evidence: null, rationale: "缺少事实" }]);
    expect(result.decision).toBe("conditional");
    expect(result.gaps[0]).toMatchObject({ remediationTarget: "step_4", targetExperienceId: 7, returnAnalysisId: 9 });
  });

  it("does not use preferred requirements as hard gates", () => {
    const result = decide([
      { requirement: "必须有 AI 产品经验", importance: "hard", assessment: "met", evidence: fact, rationale: "有事实" },
      { requirement: "有海外经验优先", importance: "preferred", assessment: "unknown", evidence: null, rationale: "未知" },
    ]);
    expect(result.decision).toBe("apply");
  });

  it("never uses a restricted claim as direct evidence", () => {
    expect(isAllowedDirectEvidence({
      ...fact,
      restrictions: [{ code: "ownership_limited", description: "只能表达参与，不得表达负责或主导。" }],
    })).toBe(false);
  });

  it("does not emit an encouraging Apply with no evidence", () => {
    expect(decide([{ requirement: "了解 AI", importance: "preferred", assessment: "unknown", evidence: null, rationale: "未知" }]).decision).toBe("conditional");
  });
});
