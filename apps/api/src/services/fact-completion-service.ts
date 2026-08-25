import type { ChatTurn, EvidenceGap, ExperienceRecord, FactCompletion, OverallCompletion } from "../domain.js";
import { ConflictError, NotFoundError } from "../lib/app-error.js";
import { utcNow } from "../lib/time.js";
import { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { EvidenceGapService } from "./evidence-gap-service.js";
import { ExperienceParserService } from "./experience-parser-service.js";
import { FactCompletionChatService } from "./fact-completion-chat-service.js";
import { FactCompletionDecisionService } from "./fact-completion-decision-service.js";
import { FollowupQuestionService } from "./followup-question-service.js";

const LEGACY_FACT_COMPLETION_MARKERS = [
  "为什么不是另一个方案",
  "有没有哪里一开始没做对",
  "我继续追问几个关键问题",
];

export type FactCompletionStreamEvent =
  | { type: "delta"; delta: string }
  | {
      type: "complete";
      assistantMessage: string;
      experience: ExperienceRecord;
      questions: string[];
      gaps: EvidenceGap[];
      conversation: ChatTurn[];
      completion: FactCompletion;
      overallCompletion: OverallCompletion;
    };

export class FactCompletionService {
  private readonly inFlightExperienceIds = new Set<number>();

  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly parserService: ExperienceParserService,
    private readonly factCompletionChatService: FactCompletionChatService,
    private readonly followupQuestionService: FollowupQuestionService,
    private readonly evidenceGapService: EvidenceGapService,
    private readonly decisionService: FactCompletionDecisionService,
  ) {}

  analyzeSelectedExperience(experienceId: number) {
    const snapshot = this.getFactCompletionSnapshot(experienceId);
    return {
      signal: snapshot.signal,
      questions: this.followupQuestionService.buildTargetedQuestions(
        snapshot.visibleGaps.length ? snapshot.visibleGaps : this.evidenceGapService.analyze(snapshot.experience),
      ),
    };
  }

  getFactCompletionSnapshot(experienceId: number) {
    const experience = this.requireExperience(experienceId);
    const gaps = this.evidenceGapService.analyze(experience);
    const storedTurns = this.repository.listChatTurns("fact_completion", experience.id);
    const hasUserTurn = storedTurns.some((turn) => turn.role === "user");
    const completion = this.decisionService.getCompletion(experience.id);
    return {
      signal: this.followupQuestionService.buildLightSignal(experience, gaps),
      panelNote: hasUserTurn
        ? "求职顾问正在整理你刚刚补充的内容，并提示还需要说明的事实。"
        : "我会先陪你回到当时的工作场景，再慢慢整理这段经历里的主线、角色和结果线索。",
      visibleGaps: hasUserTurn ? gaps : [],
      conversation: this.getFactCompletionConversation(experience, storedTurns),
      entryChoices: this.followupQuestionService.buildEntryChoices(experience),
      experience,
      completion,
      overallCompletion: this.decisionService.getOverallCompletion(experience.sourceId),
    };
  }

  async submitFactCompletionAnswer(experienceId: number, answer: string) {
    let completed: Extract<FactCompletionStreamEvent, { type: "complete" }> | null = null;
    for await (const event of this.streamFactCompletionAnswer(experienceId, answer)) {
      if (event.type === "complete") {
        completed = event;
      }
    }
    if (!completed) {
      throw new Error("这次回复没有完整生成，请重新发送。");
    }
    return completed;
  }

  async *streamFactCompletionAnswer(experienceId: number, answer: string): AsyncGenerator<FactCompletionStreamEvent> {
    if (this.inFlightExperienceIds.has(experienceId)) {
      throw new ConflictError("上一条内容仍在处理中，请等待求职顾问回复后再发送。");
    }
    this.inFlightExperienceIds.add(experienceId);

    try {
      const experience = this.requireExperience(experienceId);
      this.decisionService.getCompletion(experienceId);
      this.ensureFactCompletionChatSeed(experience);
      const previousTurns = this.getSafeConversation(
        this.repository.listChatTurns("fact_completion", experienceId),
      );
      const lastAssistantMessage = [...previousTurns].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
      const focusedGapType = this.followupQuestionService.inferFocusedGapType(lastAssistantMessage);
      const normalizedAnswer = this.followupQuestionService.annotateAnswerForGap(answer, focusedGapType);
      this.repository.createChatTurn("fact_completion", "user", answer, experienceId);

      const analyzed = await this.mergeFactAnswer(experience, normalizedAnswer, previousTurns, answer);
      const updated: ExperienceRecord = analyzed.experience;
      this.repository.updateExperience(updated);

      const gaps = this.evidenceGapService.analyze(updated);
      this.repository.replaceEvidenceGaps(experienceId, gaps);
      const questions = this.followupQuestionService.buildTargetedQuestions(gaps);
      const completion = this.decisionService.noteFactsChanged(experienceId);
      const systemReady = completion.systemReady;
      this.repository.saveGeneratedAsset("fact_completion_notes", { experienceId, notes: updated.evidenceNotes }, updated.sourceId, experienceId);

      const conversationWithAnswer = this.getSafeConversation(
        this.repository.listChatTurns("fact_completion", experienceId),
      );
      const modelStream = this.factCompletionChatService.streamAssistantReply({
        experience: updated,
        answer,
        conversation: conversationWithAnswer,
        gaps,
        nextQuestion: questions[0],
        systemReady,
      });
      let assistantMessage = "";

      if (modelStream) {
        for await (const delta of modelStream) {
          assistantMessage += delta;
        }
      }

      if (!assistantMessage.trim()) {
        assistantMessage = await this.buildAssistantMessage({
          updated,
          answer,
          gaps,
          focusedGapType,
          nextQuestion: questions[0],
          systemReady,
          llmAssistantMessage: analyzed.assistantMessage,
        });
      }

      assistantMessage = this.sanitizeAssistantMessage(assistantMessage);
      for (const delta of this.chunkFallbackMessage(assistantMessage)) {
        yield { type: "delta", delta };
      }
      this.repository.createChatTurn("fact_completion", "assistant", assistantMessage, experienceId);
      this.repository.invalidateAssets(["company_dossier", "candidate_profile", "resume_summary", "resume_bullets"], updated.sourceId);
      this.repository.touchSource(updated.sourceId);

      yield {
        type: "complete",
        assistantMessage,
        experience: updated,
        questions,
        gaps,
        conversation: this.getSafeConversation(
          this.repository.listChatTurns("fact_completion", experienceId),
        ),
        completion,
        overallCompletion: this.decisionService.getOverallCompletion(updated.sourceId),
      };
    } finally {
      this.inFlightExperienceIds.delete(experienceId);
    }
  }

  listFactCompletionChat(experienceId: number) {
    return this.getSafeConversation(
      this.repository.listChatTurns("fact_completion", experienceId),
    );
  }

  shouldRevealFactCompletionGaps(experienceId: number): boolean {
    return this.repository.listChatTurns("fact_completion", experienceId).some((turn) => turn.role === "user");
  }

  getFactCompletionPanelNote(experienceId: number): string {
    return this.shouldRevealFactCompletionGaps(experienceId)
      ? "求职顾问正在整理你刚刚补充的内容，并提示还需要说明的事实。"
      : "我会先陪你回到当时的工作场景，再慢慢整理这段经历里的主线、角色和结果线索。";
  }

  getVisibleFactCompletionGaps(experienceId: number): EvidenceGap[] {
    if (!this.shouldRevealFactCompletionGaps(experienceId)) {
      return [];
    }
    return this.evidenceGapService.analyze(this.requireExperience(experienceId));
  }

  getFactCompletionEntryChoices(experienceId: number) {
    return this.followupQuestionService.buildEntryChoices(this.requireExperience(experienceId));
  }

  private requireExperience(experienceId: number): ExperienceRecord {
    const experience = this.repository.getExperience(experienceId);
    if (!experience) throw new NotFoundError("没有找到对应的经历记录。");
    return experience;
  }

  private looksVague(answer: string): boolean {
    const cleaned = answer.trim();
    return cleaned.length < 24 || ["做一个项目", "推进一下", "差不多", "大概", "一些事情", "很多内容"].some((phrase) => cleaned.includes(phrase));
  }

  private chunkFallbackMessage(message: string): string[] {
    const chunks = message.match(/.{1,24}(?:[，。！？；：\n]|$)/gu);
    return chunks?.filter(Boolean) ?? [message];
  }

  private ensureFactCompletionChatSeed(experience: ExperienceRecord): void {
    const turns = this.repository.listChatTurns("fact_completion", experience.id);
    if (turns.length === 0 || this.isLegacyFactCompletionChat(turns)) {
      if (turns.length > 0) {
        this.repository.deleteChatTurns("fact_completion", experience.id);
      }
      this.repository.createChatTurn("fact_completion", "assistant", this.followupQuestionService.buildWarmStart(experience), experience.id);
    }
  }

  private getFactCompletionConversation(experience: ExperienceRecord, turns: ChatTurn[]): ChatTurn[] {
    if (turns.length === 0 || this.isLegacyFactCompletionChat(turns)) {
      return [
        {
          role: "assistant",
          content: this.followupQuestionService.buildWarmStart(experience),
          createdAt: utcNow(),
        },
      ];
    }
    return this.getSafeConversation(turns);
  }

  private getSafeConversation(turns: ChatTurn[]): ChatTurn[] {
    return turns.flatMap((turn) => {
      if (turn.role === "user") {
        return [turn];
      }
      const content = this.sanitizeAssistantMessage(turn.content);
      return content ? [{ ...turn, content }] : [];
    });
  }

  private isLegacyFactCompletionChat(turns: Array<{ role: "assistant" | "user"; content: string }>): boolean {
    if (turns.some((turn) => turn.role === "user")) return false;
    if (turns.length > 1) return true;
    const first = turns[0]?.content ?? "";
    return !first.includes("开始回忆") && LEGACY_FACT_COMPLETION_MARKERS.some((marker) => first.includes(marker));
  }

  private async mergeFactAnswer(
    experience: ExperienceRecord,
    normalizedAnswer: string,
    previousTurns: Array<{ role: "assistant" | "user"; content: string; createdAt: string }>,
    rawAnswer: string,
  ): Promise<{ experience: ExperienceRecord; assistantMessage: string | null }> {
    const llmAnalysis = await this.factCompletionChatService.analyzeAnswer(experience, rawAnswer, previousTurns);
    if (llmAnalysis) {
      return llmAnalysis;
    }
    return {
      experience: this.parserService.mergeFactAnswer(experience, normalizedAnswer),
      assistantMessage: null,
    };
  }

  private async buildAssistantMessage(params: {
    updated: ExperienceRecord;
    answer: string;
    gaps: EvidenceGap[];
    focusedGapType?: string | null;
    nextQuestion?: string;
    systemReady: boolean;
    llmAssistantMessage?: string | null;
  }): Promise<string> {
    const { updated, answer, gaps, focusedGapType, nextQuestion, systemReady, llmAssistantMessage } = params;
    if (llmAssistantMessage) {
      return llmAssistantMessage;
    }

    if (systemReady) {
      return this.followupQuestionService.buildReflection(updated, focusedGapType);
    }

    let fallback = this.followupQuestionService.buildReflection(updated, focusedGapType);
    if (this.looksVague(answer)) {
      fallback += `\n\n${this.followupQuestionService.buildSentenceScaffold()}`;
    } else if (nextQuestion) {
      fallback += `\n\n下一步我只想轻轻补一个点：\n- ${nextQuestion}`;
    }
    fallback += `\n\n${this.followupQuestionService.buildGapReveal(gaps)}`;
    return fallback;
  }

  private sanitizeAssistantMessage(message: string): string {
    return message
      .replace(/(?:这段|当前|现在|流程)(?:事实补全)?(?:已经|已)完成(?:了|流程)?(?=[，。！？；\n]|$)[。！]?/gu, "")
      .replace(/(^|[，。！？；\n])\s*(?:已经|已)完成(?:了|流程)?(?=[，。！？；\n]|$)/gu, "$1")
      .replace(/(?:现在|已经|当前)?可以(?:继续)?进入下一步[。！]?/gu, "")
      .replace(/可以继续生成\s*dossier[。！]?/giu, "")
      .replace(/可以(?:直接)?生成(?:经历)?档案[。！]?/gu, "")
      .replace(/(?:下一步|后续流程)(?:已经|已)(?:解锁|开放)[。！]?/gu, "")
      .replace(/(?:已经|已)达到[^。！？\n]*(?:阈值|门槛)[。！？]?/gu, "")
      .replace(/\bhiring\b/giu, "招聘方")
      .replace(/\bownership\b/giu, "个人贡献")
      .replace(/\btrade[ -]?off\b/giu, "关键取舍")
      .replace(/\binfluence\b/giu, "协作推进")
      .replace(/\bevidence\b/giu, "事实依据")
      .replace(/\boverclaim\b/giu, "可能夸大")
      .replace(/[，,]{2,}/gu, "，")
      .replace(/^[，,；\s]+|[，,；\s]+$/gu, "")
      .replace(/\n{3,}/gu, "\n\n")
      .trim();
  }
}
