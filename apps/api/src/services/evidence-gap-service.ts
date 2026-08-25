import type { EvidenceGap, ExperienceRecord } from "../domain.js";

export class EvidenceGapService {
  analyze(experience: ExperienceRecord): EvidenceGap[] {
    const gaps: EvidenceGap[] = [];
    if (experience.outcomes.length === 0) {
      gaps.push(this.buildGap(experience.id, "result", "high", "还需要补充这项工作带来的实际变化。"));
    }
    if (experience.responsibilities.length < 2) {
      gaps.push(this.buildGap(experience.id, "ownership", "high", "还需要讲清楚哪些部分是你亲自完成或推动的。"));
    }
    if (!experience.businessContext && experience.projects.length === 0) {
      gaps.push(this.buildGap(experience.id, "scope", "medium", "还可以补充这项工作的业务背景和影响范围。"));
    }
    if (!this.containsSignal(experience.responsibilities.concat(experience.evidenceNotes), ["decision", "取舍", "判断", "why", "方案"])) {
      gaps.push(this.buildGap(experience.id, "decision", "medium", "还可以补充你当时做过的关键判断。"));
    }
    if (!this.containsSignal(experience.evidenceNotes.concat(experience.projects), ["tradeoff", "平衡", "资源", "优先级", "时间", "质量"])) {
      gaps.push(this.buildGap(experience.id, "tradeoff", "medium", "还可以补充你当时做过的关键取舍。"));
    }
    if (!this.containsSignal(experience.evidenceNotes, ["失败", "问题", "阻力", "调整", "mistake", "learn"])) {
      gaps.push(this.buildGap(experience.id, "failure", "medium", "还可以补充推进不顺时你做了哪些调整。"));
    }
    if (!this.containsSignal(experience.responsibilities.concat(experience.evidenceNotes), ["推动", "协调", "说服", "stakeholder", "cross-functional", "alignment"])) {
      gaps.push(this.buildGap(experience.id, "influence", "low", "还可以补充你如何与他人协作并推动事情落地。"));
    }
    if (this.containsSignal(experience.evidenceNotes, ["overclaim", "夸大"])) {
      gaps.push(this.buildGap(experience.id, "overclaim", "high", "这里可能把个人贡献说得过大，需要按你能确认的部分表达。"));
    }
    if (this.containsSignal(experience.evidenceNotes, ["事实矛盾", "前后矛盾", "contradiction"])) {
      gaps.push(this.buildGap(experience.id, "contradiction", "high", "这里的前后说法不一致，需要先确认你能确定的部分。"));
    }
    return gaps;
  }

  private buildGap(experienceId: number, gapType: string, severity: EvidenceGap["severity"], rationale: string): EvidenceGap {
    return {
      id: -1,
      experienceId,
      gapType,
      severity,
      status: "open",
      rationale,
      nextQuestion: QUESTION_BANK[gapType] ?? "你可以继续补一点更具体的细节。",
    };
  }

  private containsSignal(values: string[], keywords: string[]): boolean {
    const joined = values.join(" ").toLowerCase();
    return keywords.some((keyword) => joined.includes(keyword.toLowerCase()));
  }
}

export const QUESTION_LADDERS: Record<string, string[]> = {
  result: [
    "这件事做完以后，你最先感受到的变化是什么？",
    "如果先不追求特别精确的数据，这段经历最后至少带来了什么方向性的变化？",
  ],
  ownership: [
    "如果把整件事拆开，你自己最主要盯的是哪一块？",
    "哪些部分最明显是你亲自负责推进的？",
  ],
  scope: [
    "当时这件事大概影响的是哪一块业务、哪类用户，或者哪个团队？",
    "如果你回头概括一下，这更像单点优化、核心链路，还是跨团队项目？",
  ],
  decision: [
    "当时你最先抓住、最想优先处理的重点是什么？",
    "如果回头看，这里面有没有一个比较关键的判断是你自己做的？",
  ],
  tradeoff: [
    "推进这件事时，你最常在两件什么事情之间来回平衡？",
    "如果再往下讲一步，这里面有没有一次比较关键的取舍？",
  ],
  failure: [
    "当时推进过程中，哪一部分最不顺？",
    "有没有哪个地方比你原来想的更难，后来你怎么调过来的？",
  ],
  influence: [
    "这件事推进时，你主要需要跟哪些人配合？",
    "如果别人一开始不完全同频，你通常是怎么把事情往前推的？",
  ],
  overclaim: [
    "如果只保留你能确定的部分，这件事里哪些明确是你亲自负责的？",
  ],
  contradiction: [
    "前后两个说法里，你现在更确定哪一个？如果都不确定，也可以直接标记为暂时无法确认。",
  ],
};

export const QUESTION_BANK = Object.fromEntries(
  Object.entries(QUESTION_LADDERS).map(([gapType, ladder]) => [gapType, ladder[0]]),
) as Record<string, string>;
