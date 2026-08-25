import type { EvidenceGap, ExperienceRecord } from "../domain.js";
import { QUESTION_LADDERS } from "./evidence-gap-service.js";

export interface FactCompletionEntryChoice {
  label: string;
  draft: string;
}

const SCAFFOLD_LINES = [
  "这个项目当时主要是为了解决……",
  "我当时主要负责的是……",
  "当时最难的是……",
];

const GAP_PRIORITIES = ["result", "ownership", "scope", "decision", "tradeoff", "failure", "influence"];
const GAP_LABELS: Record<string, string> = {
  result: "结果",
  ownership: "你亲自负责的部分",
  scope: "业务范围",
  decision: "关键判断",
  tradeoff: "取舍和平衡",
  failure: "卡点和调整",
  influence: "协同推进",
};

export class FollowupQuestionService {
  buildLightSignal(experience: ExperienceRecord, gaps: EvidenceGap[]): string {
    if (gaps.length === 0) {
      return `${experience.company} 这段经历已经比较完整，接下来可以确认最值得保留的亮点。`;
    }
    const highRisk = gaps.filter((gap) => gap.severity === "high");
    if (highRisk.length > 0) {
      return `${experience.company} 这段经历先不急着下结论。我们先把当时的场景、你的个人贡献和实际结果讲清楚。`;
    }
    return `${experience.company} 这段经历已经有基础，接下来会一边整理亮点，一边补充还缺的细节。`;
  }

  buildWarmStart(experience: ExperienceRecord): string {
    return (
      `我们先回忆你在 ${experience.company} 做过什么。` +
      " 不用一次讲完整，从你记得最清楚的部分开始就可以。" +
      " 你可以自由讲，也可以先选一个提示。"
    );
  }

  buildReflection(experience: ExperienceRecord, focusedGapType?: string | null): string {
    const opening = focusedGapType ? this.buildGapSpecificOpening(focusedGapType) : "你刚刚已经把这段经历的场景往前带出来了。";
    return [
      opening,
      "",
      this.buildPlainSignal(experience),
      `站在招聘方的角度，这里已经能体现出：${this.buildHiringSignal(experience)}。`,
    ].join("\n");
  }

  buildTargetedQuestions(gaps: EvidenceGap[], limit = 1): string[] {
    const byType = new Map(gaps.map((gap) => [gap.gapType, gap]));
    const questions: string[] = [];
    for (const gapType of GAP_PRIORITIES) {
      const gap = byType.get(gapType);
      if (!gap) continue;
      questions.push(gap.nextQuestion);
      if (questions.length >= limit) break;
    }
    return questions;
  }

  buildSentenceScaffold(): string {
    return `你可以顺着这些半句继续讲：\n- ${SCAFFOLD_LINES.join("\n- ")}`;
  }

  buildGapReveal(gaps: EvidenceGap[]): string {
    const [question] = this.buildTargetedQuestions(gaps, 1);
    return question ? `下一步最值得补充的是：${question}` : "这段经历已经比较完整。";
  }

  buildEntryChoices(experience: ExperienceRecord): FactCompletionEntryChoice[] {
    const choices: FactCompletionEntryChoice[] = [];
    if (experience.businessContext.trim()) {
      choices.push({
        label: "先讲当时在做什么",
        draft: `我先从当时在做什么讲起。那时候我们主要在做 ${this.shorten(experience.businessContext, 18)}，我当时被拉进来主要是为了把这件事往前推进。`,
      });
    }
    for (const responsibility of experience.responsibilities.slice(0, 2)) {
      const cleaned = responsibility.trim();
      if (!cleaned) continue;
      choices.push({
        label: `先讲：${cleaned}`,
        draft: `如果先讲我自己做的部分，我会先从「${cleaned}」讲起。这块当时我主要负责的是`,
      });
    }
    if (experience.outcomes[0]) {
      choices.push({
        label: "先讲结果最明显的一段",
        draft: `如果先讲最有结果感的一段，应该是「${this.shorten(experience.outcomes[0], 18)}」背后的那次推进。我当时主要做的是`,
      });
    }
    choices.push({
      label: "先讲最卡的一段",
      draft: "如果先从最卡的一段开始讲，当时最不顺的地方其实是",
    });
    return Array.from(new Map(choices.map((choice) => [choice.label, choice])).values()).slice(0, 4);
  }

  inferFocusedGapType(content: string): string | null {
    for (const gapType of GAP_PRIORITIES) {
      const ladder = QUESTION_LADDERS[gapType] ?? [];
      if (ladder.some((question) => content.includes(question))) {
        return gapType;
      }
    }
    return null;
  }

  annotateAnswerForGap(answer: string, gapType?: string | null): string {
    const cleaned = answer.trim();
    if (!cleaned || !gapType) {
      return cleaned;
    }
    return cleaned.toLowerCase().includes(`${gapType}:`) ? cleaned : `${gapType}: ${cleaned}`;
  }

  private buildGapSpecificOpening(gapType: string): string {
    const label = GAP_LABELS[gapType] ?? "这个点";
    return `这次你已经把「${label}」往前讲了一步。`;
  }

  private buildPlainSignal(experience: ExperienceRecord): string {
    if (experience.outcomes.length > 0 && experience.responsibilities.length >= 2) {
      return "用白话说，这里已经能看出你不是只在执行，而是在把事情往前推，而且开始有结果感了。";
    }
    if (experience.responsibilities.length >= 2) {
      return "用白话说，这里已经能看出你在主动推进事情，不是只在被动接任务。";
    }
    if (experience.outcomes.length > 0) {
      return "用白话说，这里已经开始有结果和影响的轮廓了。";
    }
    return "用白话说，这段已经有主线了，我们接下来把你亲自做过的部分再讲清楚一点。";
  }

  private buildHiringSignal(experience: ExperienceRecord): string {
    const labels: string[] = [];
    if (experience.responsibilities.length >= 2) labels.push("个人贡献比较清楚");
    if (experience.outcomes.length > 0) labels.push("有实际结果");
    if (this.containsAny(experience, ["判断", "取舍", "方案", "优先级", "decision"])) labels.push("有自己的判断");
    if (this.containsAny(experience, ["推动", "协调", "说服", "stakeholder", "cross-functional"])) labels.push("能够推进协作");
    return labels.length > 0 ? labels.slice(0, 3).join("、") : "个人贡献开始清楚了";
  }

  private containsAny(experience: ExperienceRecord, keywords: string[]): boolean {
    const tokens = [
      ...experience.responsibilities,
      ...experience.outcomes,
      ...experience.projects,
      ...experience.evidenceNotes,
      experience.businessContext,
    ].join(" ").toLowerCase();
    return keywords.some((keyword) => tokens.includes(keyword.toLowerCase()));
  }

  private shorten(text: string, limit: number): string {
    return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}...`;
  }
}
