import type { ChatTurn, EvidenceGap, ExperienceRecord } from "../domain.js";
import { DeepSeekClient } from "../lib/deepseek-client.js";

interface FactCompletionExtraction {
  businessContext?: string;
  projects?: string[];
  responsibilities?: string[];
  outcomes?: string[];
  evidenceNotes?: string[];
  assistantMessage?: string;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function asOptionalString(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : undefined;
}

export class FactCompletionChatService {
  constructor(private readonly llm: DeepSeekClient) {}

  get enabled(): boolean {
    return this.llm.enabled;
  }

  async analyzeAnswer(
    experience: ExperienceRecord,
    answer: string,
    conversation: ChatTurn[],
  ): Promise<{ experience: ExperienceRecord; assistantMessage: string | null } | null> {
    const result = await this.llm.completeJson(
      [
        "你的角色名是“求职顾问”，具备资深招聘官视角。",
        "你的任务不是润色，而是从用户的最新回答里提取可以确认的事实，并给出一轮有价值的回复。",
        "严禁编造数据、职责、结果或项目。",
        "你只能总结事实和提出问题，不能宣布流程已经完成、可以进入下一步、可以解锁或可以生成档案。",
        "如果用户没有明确说出某个信息，就不要补。",
        "输出 JSON 对象，不要 markdown。",
        "字段要求：",
        '- businessContext: 如果这次回答让业务背景更清楚，给一段简洁中文；否则给空字符串。',
        '- projects: 这次回答里新增的项目/工作流线索数组。',
        '- responsibilities: 这次回答里新增的、可写进简历的职责数组，尽量用“主导/推动/设计/协调/优化”等动词开头。',
        '- outcomes: 这次回答里新增的结果数组，只保留用户明确提到的结果或方向性变化。',
        '- evidenceNotes: 这次回答里值得保留的事实依据数组。优先显式写出“关键判断：”“关键取舍：”“遇到的问题：”“调整动作：”“协同推进：”“实际结果：”这些标签，方便后续判断。',
        '- 如果最新回答与已有事实冲突，或把团队成果明显扩大为个人成果，在 evidenceNotes 中写“事实矛盾：”或“可能夸大：”，不要替用户消解。',
        '- assistantMessage: 给用户的这一轮回复。先总结刚刚变清楚的内容，再指出一个从招聘方角度已经成立的亮点；如仍需补充，最后只追问一个最关键的问题。语气循序渐进，不要审问感。禁止宣布流程完成或下一步权限。',
        '- assistantMessage 必须使用自然中文，不出现 hiring、ownership、trade-off、gap、evidence、overclaim、canonical、claim restriction 等内部术语。',
      ].join("\n"),
      [
        `当前经历基线：${JSON.stringify(experience)}`,
        `最近对话：${JSON.stringify(conversation.slice(-6))}`,
        `用户最新回答：${answer}`,
      ].join("\n\n"),
    );

    if (!result) {
      return null;
    }

    const extraction: FactCompletionExtraction = {
      businessContext: asOptionalString(result.businessContext),
      projects: asStringArray(result.projects),
      responsibilities: asStringArray(result.responsibilities),
      outcomes: asStringArray(result.outcomes),
      evidenceNotes: asStringArray(result.evidenceNotes),
      assistantMessage: asOptionalString(result.assistantMessage),
    };

    const merged: ExperienceRecord = {
      ...experience,
      businessContext: this.mergeBusinessContext(experience.businessContext, extraction.businessContext),
      projects: uniqueStrings([...experience.projects, ...(extraction.projects ?? [])]),
      responsibilities: uniqueStrings([...experience.responsibilities, ...(extraction.responsibilities ?? [])]),
      outcomes: uniqueStrings([...experience.outcomes, ...(extraction.outcomes ?? [])]),
      evidenceNotes: uniqueStrings([...experience.evidenceNotes, answer.trim(), ...(extraction.evidenceNotes ?? [])]),
    };

    return {
      experience: merged,
      assistantMessage: extraction.assistantMessage ?? null,
    };
  }

  streamAssistantReply(params: {
    experience: ExperienceRecord;
    answer: string;
    conversation: ChatTurn[];
    gaps: EvidenceGap[];
    nextQuestion?: string;
    systemReady: boolean;
  }): AsyncIterable<string> | null {
    if (!this.llm.enabled || typeof this.llm.streamText !== "function") {
      return null;
    }
    const { experience, answer, conversation, gaps, nextQuestion, systemReady } = params;
    return this.llm.streamText(
      [
        "你的角色名是“求职顾问”，帮助中国求职者梳理工作经历，也具备资深招聘官视角。",
        "直接输出一条面向用户的中文回复，不要输出 JSON，也不要解释你的工作过程。",
        "先用自己的话总结用户这一轮新讲清楚的内容，再指出一个从招聘视角已经成立的亮点。",
        "不要大段复述用户原话，不要重复上一轮已经总结过的角度。",
        "如果证据还不够，只追问一个最关键、容易回忆的问题；语气循序渐进，不要像面试拷问。",
        "如果事实已足够形成摘要，只做事实总结，不再追加问题。",
        "禁止说“已经完成”“可以进入下一步”“可以解锁”“可以生成档案”或任何流程宣告。流程行动只由界面的结构化 nextAction 呈现。",
        "不要编造数据、职责、结果或影响范围，不要顺着用户可能夸大的说法往下写。",
        "使用自然中文，不出现 hiring、ownership、trade-off、gap、evidence、overclaim、canonical、claim restriction 等内部术语。",
        "回复控制在 180-320 字，允许自然分段。",
      ].join("\n"),
      [
        `当前经历：${JSON.stringify(experience)}`,
        `最近对话：${JSON.stringify(conversation.slice(-8))}`,
        `用户最新回答：${answer}`,
        `当前证据缺口：${JSON.stringify(gaps)}`,
        `下一条建议追问：${nextQuestion ?? "无"}`,
        `是否已足够形成待确认事实摘要：${systemReady ? "是" : "否"}`,
      ].join("\n\n"),
    );
  }

  private mergeBusinessContext(current: string, incoming?: string): string {
    if (!incoming) {
      return current;
    }
    if (!current.trim()) {
      return incoming;
    }
    return incoming.length > current.length ? incoming : current;
  }
}
