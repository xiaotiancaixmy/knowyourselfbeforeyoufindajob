import type {
  CandidateProfile,
  ExperienceRecord,
  GoalSetupState,
  PositioningDecisionState,
  ResumeRewriteOutput,
} from "../domain.js";
import { DeepSeekClient } from "../lib/deepseek-client.js";
import {
  isRewriteClaimSafe,
  makeResponsibilitySafe,
  type ClaimRestrictionsByExperienceId,
} from "./claim-safety.js";

interface RewriteExtraction {
  professionalSummary?: string;
  experienceBulletsByExperienceId?: Record<string, string[]>;
}

function asOptionalString(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : undefined;
}

function asBulletsByExperienceId(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, bullets]) => [
        key,
        Array.isArray(bullets) ? bullets.map((item) => String(item).trim()).filter(Boolean) : [],
      ])
      .filter(([, bullets]) => bullets.length > 0),
  );
}

export class ResumeRewriteService {
  constructor(private readonly llm: DeepSeekClient) {}

  rewrite(
    experiences: ExperienceRecord[],
    profile: CandidateProfile,
    positioningDecision?: PositioningDecisionState | null,
    goalSetup?: GoalSetupState | null,
    restrictionsByExperienceId: ClaimRestrictionsByExperienceId = {},
  ): Promise<ResumeRewriteOutput> {
    return this.rewriteWithFallback(
      experiences,
      profile,
      positioningDecision,
      goalSetup,
      restrictionsByExperienceId,
    );
  }

  private async rewriteWithFallback(
    experiences: ExperienceRecord[],
    profile: CandidateProfile,
    positioningDecision?: PositioningDecisionState | null,
    goalSetup?: GoalSetupState | null,
    restrictionsByExperienceId: ClaimRestrictionsByExperienceId = {},
  ): Promise<ResumeRewriteOutput> {
    const llmRewrite = await this.rewriteWithLlm(
      experiences,
      profile,
      positioningDecision,
      goalSetup,
      restrictionsByExperienceId,
    );
    if (llmRewrite && isRewriteClaimSafe({
      rewrite: llmRewrite,
      experiences,
      restrictionsByExperienceId,
      goalSetup,
      positioningDecision,
    })) {
      return llmRewrite;
    }
    return this.buildRuleBasedRewrite(
      experiences,
      profile,
      positioningDecision,
      goalSetup,
      restrictionsByExperienceId,
    );
  }

  private async rewriteWithLlm(
    experiences: ExperienceRecord[],
    profile: CandidateProfile,
    positioningDecision?: PositioningDecisionState | null,
    goalSetup?: GoalSetupState | null,
    restrictionsByExperienceId: ClaimRestrictionsByExperienceId = {},
  ): Promise<ResumeRewriteOutput | null> {
    const result = await this.llm.completeJson(
      [
        "你是一位熟悉中国互联网、科技公司和大中型企业招聘标准的资深招聘官，同时也是一名专业的简历顾问。",
        "你的任务不是把简历写得更夸张，而是基于候选人已经确认的真实经历，帮助候选人明确职业定位、提炼有招聘价值的能力和成果，并将零散、口语化的工作内容整理成清晰、可信、便于招聘方快速理解的简历表达。",
        "",
        "基本原则：",
        "- 只能使用输入材料中已经明确出现或得到用户确认的信息。",
        "- 不得编造数据、职责、项目结果、团队规模、管理范围或业务影响。",
        "- 必须逐条遵守输入中的写作限制；信息有限时只能使用已确认的参与或协助口径。",
        "- 如果原始事实只写了“参与/协助”，不得升级成“主导/负责/牵头/统筹”。",
        "- 输出中的所有数字都必须能在已确认经历、目标或定位输入中找到原始依据。",
        "- 如果事实依据不足，使用更克制的表达，不要自行补充结论。",
        "- 不因为候选人使用了“主导”“负责”“从 0 到 1”等词语，就默认这些判断成立。",
        "- 改写后的内容应符合中国招聘市场的阅读习惯，避免英文翻译腔。",
        "- 不强行套用 STAR、CAR 等固定结构。",
        "- 不要为了显得专业而堆砌行业黑话、抽象概念或空泛形容词。",
        "- 不使用“赋能”“抓手”“闭环”“全面提升”“显著增强”等缺乏具体含义的表达，除非原始材料能够明确支撑。",
        "- 优先呈现候选人解决了什么问题、承担了什么角色、做了哪些关键工作，以及产生了什么结果。",
        "- 同一段经历中的简历要点应各有重点，避免重复描述同一件事。",
        "- 仅保留公司名、产品名、行业惯用词和无法自然翻译的术语；其他内容优先使用自然中文，避免中英文混杂。",
        "",
        "职业总结：",
        "- 生成一段 100-160 字的中文职业总结。",
        "- 帮助招聘方快速理解候选人的职业方向和经验主线、最有竞争力的 2-3 项能力、主要行业或业务场景经验，以及与目标岗位最相关的价值。",
        "- 提及具体公司、项目或经历时，数字只能使用该段经历中已确认的事实；总览句不要使用归属不清的数字。",
        "- 不使用第一人称。",
        "- 不写“热爱学习”“沟通能力强”“抗压能力强”等无法验证的自我评价。",
        "- 不罗列所有经历，不写成求职信或个人宣传文案。",
        "- 不直接暴露“能力边界”“保守定位”等内部判断。",
        "- 如果目标岗位与现有事实存在距离，应通过克制的定位表达控制风险，而不是直接否定用户。",
        "",
        "经历要点：",
        "- 为每段已选经历生成 2-4 条中文简历要点。",
        "- 每条优先包含以下信息中的两项或以上，但不要求固定顺序：业务问题或产品背景、实际职责、关键行动或判断、协作或落地过程、可确认的业务或产品结果。",
        "- 每条只表达一个主要信息，保持简洁、清楚、容易扫读。",
        "- 开头直接使用有意义的行动表达，例如“设计”“搭建”“推动”“优化”“建立”“分析”“协调”。",
        "- 谨慎使用“主导”“负责整体”“从 0 到 1”等强调个人贡献的表达，只有事实明确时才使用。",
        "- 有可靠数据时优先呈现数据；没有数据时，不虚构量化结果。",
        "- 没有直接业务结果时，可以表达阶段性产出、决策价值、流程改进或协作结果。",
        "- 避免使用“负责：”“项目背景：”“项目成果：”等模板化前缀。",
        "- 不重复公司、岗位、时间等基本信息。",
        "- 不把所有经历都强行包装成相同能力；每段经历应突出其最有价值的部分。",
        "",
        "输出要求：",
        "- 只输出合法 JSON 对象，不要输出 Markdown、解释或额外文字。",
        "- professionalSummary: 中文职业总结。",
        "- experienceBulletsByExperienceId: 对象，key 是 experience id 字符串，value 是 2-4 条中文 bullet 数组。",
      ].join("\n"),
      [
        `目标岗位与起始判断：${JSON.stringify(goalSetup ?? null)}`,
        `已确认定位：${JSON.stringify(positioningDecision ?? null)}`,
        `求职定位分析：${JSON.stringify(profile)}`,
        `已选经历：${JSON.stringify(experiences)}`,
        `各段经历的写作限制：${JSON.stringify(restrictionsByExperienceId)}`,
      ].join("\n\n"),
    );

    if (!result) {
      return null;
    }

    const extraction: RewriteExtraction = {
      professionalSummary: asOptionalString(result.professionalSummary),
      experienceBulletsByExperienceId: asBulletsByExperienceId(result.experienceBulletsByExperienceId),
    };

    if (!extraction.professionalSummary) {
      return null;
    }

    const fallback = this.buildRuleBasedRewrite(
      experiences,
      profile,
      positioningDecision,
      goalSetup,
      restrictionsByExperienceId,
    );
    return {
      professionalSummary: extraction.professionalSummary,
      experienceBulletsByExperienceId: Object.fromEntries(
        experiences.map((experience) => {
          const fromLlm = extraction.experienceBulletsByExperienceId?.[String(experience.id)] ?? [];
          return [String(experience.id), fromLlm.length > 0 ? fromLlm.slice(0, 4) : fallback.experienceBulletsByExperienceId[String(experience.id)]];
        }),
      ),
    };
  }

  private buildRuleBasedRewrite(
    experiences: ExperienceRecord[],
    profile: CandidateProfile,
    positioningDecision?: PositioningDecisionState | null,
    goalSetup?: GoalSetupState | null,
    restrictionsByExperienceId: ClaimRestrictionsByExperienceId = {},
  ): ResumeRewriteOutput {
    const focus = positioningDecision?.keepFocus.trim() || goalSetup?.mainSellingPoint.trim() || profile.strongestThemes.slice(0, 2).join(", ");
    const avoid = positioningDecision?.avoidEmphasis.trim() || goalSetup?.doNotOversell.trim();
    const targetRole = goalSetup?.targetRole.trim();
    const confirmedLane = positioningDecision?.confirmedOptionTitle.trim() || profile.recommendedMainLane;
    const professionalSummary = [
      targetRole ? `这轮简历先按「${targetRole}」去组织主线。` : null,
      `更适合以「${confirmedLane}」为主线，重点突出 ${focus}。`,
      avoid ? `不要夸大「${avoid}」，优先呈现可核对的结果、个人贡献和关键判断。` : "简历应优先呈现可核对的结果、个人贡献和关键判断，避免泛泛描述职责。",
    ].filter(Boolean).join("");
    const experienceBulletsByExperienceId = Object.fromEntries(
      experiences.map((experience) => {
        const bullets: string[] = [];
        const claimRestrictions = restrictionsByExperienceId[experience.id] ?? [];
        if (experience.businessContext) {
          bullets.push(`在 ${experience.company} 担任 ${experience.role}，工作背景为：${experience.businessContext}`);
        }
        if (positioningDecision?.keepFocus.trim()) {
          bullets.push(`这段经历要重点服务「${positioningDecision.keepFocus.trim()}」这条主线。`);
        }
        bullets.push(
          ...experience.responsibilities
            .slice(0, 2)
            .map((value) => makeResponsibilitySafe(value, claimRestrictions)),
        );
        bullets.push(...experience.outcomes.slice(0, 2).map((value) => `结果：${value}`));
        if (bullets.length === 0) {
          bullets.push(`${experience.company} 这段经历需要先补充更多事实，再继续改写。`);
        }
        return [String(experience.id), bullets.slice(0, 4)];
      }),
    );
    return {
      professionalSummary,
      experienceBulletsByExperienceId,
    };
  }
}
