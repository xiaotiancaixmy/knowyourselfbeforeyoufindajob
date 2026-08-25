import { createHash } from "node:crypto";

import type {
  ClaimRestriction,
  ExperienceRecord,
  FactCompletion,
  FactCompletionReviewPayload,
  FactCompletionStateRecord,
  FactCompletionStatus,
  FactSummary,
  OverallCompletion,
} from "../domain.js";
import { ConflictError, NotFoundError } from "../lib/app-error.js";
import { utcNow } from "../lib/time.js";
import { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { EvidenceGapService } from "./evidence-gap-service.js";

const TERMINAL_STATES = new Set<FactCompletionStatus>(["completed", "completed_with_limits"]);
const DEPTH_KEYWORDS = [
  "decision",
  "判断",
  "取舍",
  "tradeoff",
  "失败",
  "问题",
  "阻力",
  "调整",
  "influence",
  "推动",
  "协调",
  "说服",
  "stakeholder",
];
const BLOCKING_CLAIM_KEYWORDS = ["overclaim", "夸大", "contradiction", "事实矛盾", "前后矛盾"];
const LIMITED_OWNERSHIP_KEYWORDS = ["参与", "协助", "配合", "支持"];
const STRONG_OWNERSHIP_KEYWORDS = ["主导", "负责", "牵头", "统筹", "owner", "owned", "led"];

export class FactCompletionDecisionService {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly evidenceGapService: EvidenceGapService,
  ) {}

  ensureSelectedStates(sourceId: number): void {
    for (const experience of this.repository.listExperiences(sourceId).filter((item) => item.selected)) {
      this.getCompletion(experience.id);
    }
  }

  getCompletion(experienceId: number): FactCompletion {
    const experience = this.requireExperience(experienceId);
    let state = this.repository.getFactCompletionState(experienceId) ?? this.createInitialState(experience);
    const fingerprint = this.fingerprint(experience);

    if (state.factFingerprint !== fingerprint) {
      const coverage = this.coverage(experience);
      const nextStatus = TERMINAL_STATES.has(state.status)
        ? "stale"
        : this.systemReady(coverage)
          ? "review_ready"
          : state.status === "not_started"
            ? "not_started"
            : "collecting";
      state = {
        ...state,
        status: nextStatus,
        factVersion: state.factVersion + 1,
        factFingerprint: fingerprint,
        confirmedSummary: null,
        claimRestrictions: [],
        confirmedAt: null,
        updatedAt: utcNow(),
      };
      this.repository.saveFactCompletionState(state);
    }

    return this.toCompletion(experience, state);
  }

  getOverallCompletion(sourceId: number | null): OverallCompletion {
    const selected = sourceId
      ? this.repository.listExperiences(sourceId).filter((experience) => experience.selected)
      : [];
    const completions = selected.map((experience) => this.getCompletion(experience.id));
    const items = completions.map((completion) => ({
      experienceId: completion.experienceId,
      status: completion.status,
      quality: completion.quality,
      isTerminal: completion.isTerminal,
    }));
    const completedCount = items.filter((item) => item.isTerminal).length;
    const hasStale = items.some((item) => item.status === "stale");
    const canProceed = items.length > 0 && completedCount === items.length && !hasStale;
    const firstPending = completions.find((completion) => !completion.isTerminal);

    return {
      selectedExperienceIds: selected.map((experience) => experience.id),
      items,
      completedCount,
      totalCount: items.length,
      hasStale,
      canProceed,
      nextAction: canProceed
        ? {
            type: "proceed_to_dossier",
            label: `进入求职定位（${completedCount}/${items.length}）`,
            prompt: null,
            experienceId: null,
          }
        : {
            type: firstPending?.status === "stale" ? "reconfirm" : "switch_experience",
            label: firstPending?.status === "stale" ? "重新确认有变化的经历" : "继续补充未确认的经历",
            prompt: firstPending?.nextAction.prompt ?? null,
            experienceId: firstPending?.experienceId ?? null,
          },
    };
  }

  noteFactsChanged(experienceId: number): FactCompletion {
    return this.getCompletion(experienceId);
  }

  review(
    experienceId: number,
    payload: FactCompletionReviewPayload,
  ): { completion: FactCompletion; overallCompletion: OverallCompletion } {
    const current = this.getCompletion(experienceId);
    if (payload.expectedFactVersion !== current.factVersion) {
      throw new ConflictError("这段经历的内容已经变化，请刷新后重新确认。");
    }

    const experience = this.requireExperience(experienceId);
    const currentState = this.repository.getFactCompletionState(experienceId)!;
    let nextState: FactCompletionStateRecord;

    if (payload.action === "request_review") {
      nextState = {
        ...currentState,
        status: current.systemReady ? "review_ready" : "limits_review",
        updatedAt: utcNow(),
      };
    } else if (payload.action === "confirm") {
      if (!current.systemReady || current.status !== "review_ready") {
        throw new ConflictError("这段经历暂时还不能确认，请先补充关键事实，或说明哪些信息暂时想不起来。");
      }
      nextState = {
        ...currentState,
        status: "completed",
        confirmedSummary: this.buildFactSummary(experience),
        claimRestrictions: [],
        confirmedAt: utcNow(),
        updatedAt: utcNow(),
      };
    } else {
      if (current.status !== "limits_review") {
        throw new ConflictError("请先查看已整理的事实和仍缺少的信息。");
      }
      nextState = {
        ...currentState,
        status: "completed_with_limits",
        confirmedSummary: this.buildFactSummary(experience),
        claimRestrictions: this.buildClaimRestrictions(current),
        confirmedAt: utcNow(),
        updatedAt: utcNow(),
      };
    }

    this.repository.saveFactCompletionState(nextState);
    this.repository.touchSource(experience.sourceId);
    return {
      completion: this.toCompletion(experience, nextState),
      overallCompletion: this.getOverallCompletion(experience.sourceId),
    };
  }

  private createInitialState(experience: ExperienceRecord): FactCompletionStateRecord {
    const hasUserTurn = this.repository
      .listChatTurns("fact_completion", experience.id)
      .some((turn) => turn.role === "user");
    const status: FactCompletionStatus = experience.status === "ready_for_dossier"
      ? "review_ready"
      : hasUserTurn
        ? "collecting"
        : "not_started";
    const state: FactCompletionStateRecord = {
      experienceId: experience.id,
      status,
      factVersion: 0,
      factFingerprint: this.fingerprint(experience),
      confirmedSummary: null,
      claimRestrictions: [],
      confirmedAt: null,
      updatedAt: utcNow(),
    };
    this.repository.saveFactCompletionState(state);
    return state;
  }

  private toCompletion(experience: ExperienceRecord, state: FactCompletionStateRecord): FactCompletion {
    const gaps = this.evidenceGapService.analyze(experience);
    const coverage = this.coverage(experience);
    const systemReady = this.systemReady(coverage);
    const isTerminal = TERMINAL_STATES.has(state.status);
    const quality = state.status === "completed_with_limits"
      ? "limited"
      : systemReady
        ? "standard"
        : "insufficient";
    const factSummary = state.confirmedSummary ?? this.buildFactSummary(experience);

    return {
      experienceId: experience.id,
      status: state.status,
      factVersion: state.factVersion,
      quality,
      systemReady,
      isTerminal,
      canProceed: isTerminal,
      coverage,
      factSummary,
      gaps,
      claimRestrictions: state.claimRestrictions,
      nextAction: this.nextAction(state.status, gaps[0]?.nextQuestion, experience.id),
      confirmedAt: state.confirmedAt,
    };
  }

  private coverage(experience: ExperienceRecord) {
    const joined = [
      ...experience.responsibilities,
      ...experience.evidenceNotes,
      ...experience.projects,
    ].join(" ").toLowerCase();
    const claimText = experience.evidenceNotes.join(" ").toLowerCase();
    return {
      context: Boolean(experience.businessContext.trim() || experience.projects.some(Boolean)),
      ownership: experience.responsibilities.some((item) => item.trim().length > 0),
      outcome: experience.outcomes.some((item) => item.trim().length > 0),
      depth: DEPTH_KEYWORDS.some((keyword) => joined.includes(keyword.toLowerCase())),
      noBlockingClaims: !BLOCKING_CLAIM_KEYWORDS.some((keyword) => claimText.includes(keyword.toLowerCase())),
    };
  }

  private systemReady(coverage: ReturnType<FactCompletionDecisionService["coverage"]>): boolean {
    return coverage.context
      && coverage.ownership
      && coverage.outcome
      && coverage.depth
      && coverage.noBlockingClaims;
  }

  private buildFactSummary(experience: ExperienceRecord): FactSummary {
    const depth = experience.evidenceNotes.filter((note) =>
      DEPTH_KEYWORDS.some((keyword) => note.toLowerCase().includes(keyword.toLowerCase())),
    );
    return {
      context: [experience.businessContext, ...experience.projects].map((item) => item.trim()).filter(Boolean),
      ownership: experience.responsibilities.map((item) => item.trim()).filter(Boolean),
      outcome: experience.outcomes.map((item) => item.trim()).filter(Boolean),
      depth,
    };
  }

  private buildClaimRestrictions(completion: FactCompletion): ClaimRestriction[] {
    const restrictions: ClaimRestriction[] = [];
    if (!completion.coverage.context) {
      restrictions.push({ code: "context_unverified", description: "不延伸未确认的业务背景或影响范围。" });
    }
    if (!completion.coverage.ownership) {
      restrictions.push({ code: "ownership_unverified", description: "不把团队成果表述为个人主导。" });
    } else if (this.hasOnlyLimitedOwnership(completion.factSummary.ownership)) {
      restrictions.push({ code: "ownership_limited", description: "只保留参与或协助口径，不升级为主导、牵头或负责。" });
    }
    if (!completion.coverage.outcome) {
      restrictions.push({ code: "outcome_unverified", description: "不补写未经确认的结果或数据。" });
    }
    if (!completion.coverage.depth) {
      restrictions.push({ code: "depth_unverified", description: "不虚构决策、取舍、失败或协同细节。" });
    }
    if (!completion.coverage.noBlockingClaims) {
      restrictions.push({ code: "claim_blocked", description: "不使用存在夸大或前后矛盾的表述。" });
    }
    return restrictions;
  }

  private hasOnlyLimitedOwnership(ownership: string[]): boolean {
    const text = ownership.join(" ").toLowerCase();
    return LIMITED_OWNERSHIP_KEYWORDS.some((keyword) => text.includes(keyword))
      && !STRONG_OWNERSHIP_KEYWORDS.some((keyword) => text.includes(keyword));
  }

  private nextAction(status: FactCompletionStatus, prompt: string | undefined, experienceId: number) {
    const base = { prompt: prompt ?? null, experienceId };
    switch (status) {
      case "not_started":
        return { type: "start" as const, label: "开始补充这段经历", ...base };
      case "collecting":
        return { type: "request_review" as const, label: "我想先整理到这里", ...base };
      case "review_ready":
        return { type: "confirm" as const, label: "确认以上事实", prompt: null, experienceId };
      case "limits_review":
        return { type: "finish_with_limits" as const, label: "这些信息暂时想不起来", ...base };
      case "completed":
      case "completed_with_limits":
        return { type: "switch_experience" as const, label: "换一段经历", prompt: null, experienceId };
      case "stale":
        return { type: "reconfirm" as const, label: "内容有变化，重新确认", prompt: null, experienceId };
    }
  }

  private fingerprint(experience: ExperienceRecord): string {
    return createHash("sha256")
      .update(JSON.stringify({
        company: experience.company,
        role: experience.role,
        timeframe: experience.timeframe,
        businessContext: experience.businessContext,
        projects: experience.projects,
        responsibilities: experience.responsibilities,
        outcomes: experience.outcomes,
        evidenceNotes: experience.evidenceNotes,
      }))
      .digest("hex");
  }

  private requireExperience(experienceId: number): ExperienceRecord {
    const experience = this.repository.getExperience(experienceId);
    if (!experience) throw new NotFoundError("没有找到对应的经历记录。");
    return experience;
  }
}
