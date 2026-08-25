import type { EvidenceGap, ExperienceRecord, GoalSetupState } from "../domain.js";

export class HiringJudgmentService {
  evaluateExperience(experience: ExperienceRecord, gaps: EvidenceGap[]) {
    const highRisks = gaps.filter((gap) => gap.severity === "high").map((gap) => gap.gapType);
    const riskLabels: Record<string, string> = {
      result: "实际结果",
      ownership: "个人贡献",
      overclaim: "可能夸大的内容",
      contradiction: "前后不一致的事实",
    };
    const strengths: string[] = [];
    if (experience.outcomes.length > 0) strengths.push("已经有可以说明价值的实际结果");
    if (experience.responsibilities.length >= 3) strengths.push("个人贡献和具体行动比较清楚");
    if (experience.evidenceNotes.length > 0) strengths.push("已经补充了简历之外的事实依据");
    if (strengths.length === 0) strengths.push("这段经历有可挖掘的内容，但目前还没有讲清楚主要价值");

    const doNotClaim: string[] = [];
    if (highRisks.includes("result")) doNotClaim.push("暂时不要把这段写成结果突出的案例，先补充实际结果");
    if (highRisks.includes("ownership")) doNotClaim.push("暂时不要写成由你全程主导，先讲清楚你亲自完成或推动的部分");

    return {
      strengths,
      currentRisk: highRisks.length > 0
        ? `${highRisks.map((risk) => riskLabels[risk] ?? "关键信息").join("、")}还不够清楚，目前不宜下过强结论。`
        : "现有信息足以形成第一版素材；如能补充关键取舍和协作推进，会更有说服力。",
      doNotClaim,
      conservativeFraming: highRisks.length > 0
        ? `${experience.company} 这段经历可以先突出你明确做过的工作和已有结果，暂时不要写成最强案例。`
        : `${experience.company} 这段经历可以作为重点案例，同时保留能够核对的细节，避免夸大。`,
    };
  }

  evaluatePositioning(experiences: ExperienceRecord[], goalSetup?: GoalSetupState | null) {
    const text = experiences
      .flatMap((experience) => [
        ...experience.projects,
        ...experience.responsibilities,
        ...experience.outcomes,
        ...experience.evidenceNotes,
      ])
      .join(" ")
      .toLowerCase();
    const aiSignals = ["ai", "llm", "prompt", "automation", "assistant"].filter((keyword) => text.includes(keyword)).length;
    const growthSignals = ["growth", "增长", "retention", "留存", "conversion", "转化"].filter((keyword) => text.includes(keyword)).length;
    const opsSignals = ["operation", "运营", "process", "workflow"].filter((keyword) => text.includes(keyword)).length;

    const recommendedMainLane = aiSignals >= Math.max(growthSignals, opsSignals)
      ? "AI / Agent / 工作流产品"
      : growthSignals >= opsSignals
        ? "增长 / 商业化 / 用户增长产品"
        : "产品运营 / 复杂流程产品";

    const targetRole = goalSetup?.targetRole.trim() ?? "";
    const normalizedTargetRole = targetRole.toLowerCase();
    const targetMatchesRecommended =
      (!targetRole) ||
      (recommendedMainLane.includes("AI") && ["ai", "agent", "工作流", "workflow"].some((keyword) => normalizedTargetRole.includes(keyword))) ||
      (recommendedMainLane.includes("增长") && ["增长", "growth", "commercial", "商业化", "用户增长"].some((keyword) => normalizedTargetRole.includes(keyword))) ||
      (recommendedMainLane.includes("运营") && ["运营", "流程", "operation", "process"].some((keyword) => normalizedTargetRole.includes(keyword)));

    return {
      recommendedMainLane: targetMatchesRecommended ? (targetRole || recommendedMainLane) : recommendedMainLane,
      conservativeTargetStrategy: targetRole && !targetMatchesRecommended
        ? `你这次想投「${targetRole}」，但现有事实更能支持「${recommendedMainLane}」。更稳妥的方式是先突出 ${recommendedMainLane} 相关经验，再说明这些能力如何迁移到 ${targetRole}，不要直接写成完全匹配。`
        : "如果目标方向和现有经历不完全一致，先突出事实依据最充分的主线，再说明其他方向可以迁移的能力，不必写成完全匹配。",
    };
  }
}
