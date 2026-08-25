import {
  jobFitAnalysisSchema,
  jobTargetResumeRewriteSchema,
  jobTargetSchema,
  type JobFitAnalysisDto,
  type JobTargetDto,
  type JobTargetResumeRewriteDto,
  type ResumeRewriteOutputDto,
} from "@kys/shared";

import type { JobTarget } from "../domain.js";
import { ConflictError, NotFoundError } from "../lib/app-error.js";
import { DeepSeekClient } from "../lib/deepseek-client.js";
import { JobTargetRepository, type JobFitAnalysisRow } from "../repositories/job-target-repository.js";
import { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { fixedJobFitDecisionPolicy } from "./job-fit-decision-policy.js";
import { JobFitEvidenceAssembler, fingerprintJobFitSnapshot } from "./job-fit-evidence-assembler.js";
import { isJdSufficient, JobFitModelMapper } from "./job-fit-model-mapper.js";
import { JobFitAnalysisFailure } from "./job-fit-model-mapper.js";
import { JobFitPrerequisite } from "./job-fit-prerequisite.js";

interface JobFitLogger {
  info: (bindings: Record<string, unknown>, message?: string) => void;
  error: (bindings: Record<string, unknown>, message?: string) => void;
}

const silentLogger: JobFitLogger = {
  info: () => undefined,
  error: () => undefined,
};

function failureMessage(stage: string): string {
  if (stage === "timeout") return "岗位分析请求超时，请稍后重试。";
  if (stage === "schema_validation" || stage === "json_parse" || stage === "empty_response") {
    return "岗位分析结果格式异常，请稍后重试。";
  }
  return "岗位分析服务暂时不可用，请稍后重试。";
}

export class JobFitService {
  private readonly prerequisite: JobFitPrerequisite;
  private readonly assembler: JobFitEvidenceAssembler;
  private readonly mapper: JobFitModelMapper;

  constructor(
    private readonly targets: JobTargetRepository,
    private readonly workspace: WorkspaceRepository,
    llm: DeepSeekClient,
    private readonly generateLegacyRewrite: (sourceId: number) => Promise<ResumeRewriteOutputDto>,
    private readonly saveLegacyRewrite: (sourceId: number, content: ResumeRewriteOutputDto) => ResumeRewriteOutputDto,
    private readonly logger: JobFitLogger = silentLogger,
  ) {
    this.prerequisite = new JobFitPrerequisite(workspace);
    this.assembler = new JobFitEvidenceAssembler(workspace);
    this.mapper = new JobFitModelMapper(llm);
  }

  create(sourceId: number, title: string, jdText: string): JobTargetDto {
    if (!this.workspace.getSource(sourceId)) throw new NotFoundError("没有找到对应的求职方案。");
    return jobTargetSchema.parse(this.targets.create(sourceId, title, jdText));
  }

  list(sourceId: number): JobTargetDto[] {
    if (!this.workspace.getSource(sourceId)) throw new NotFoundError("没有找到对应的求职方案。");
    return this.targets.listBySource(sourceId).map((target) => this.withLatestAnalysis(target));
  }

  get(id: number): JobTargetDto {
    const target = this.requireTarget(id);
    return this.withLatestAnalysis(target);
  }

  update(id: number, expectedRevision: number, title: string, jdText: string): JobTargetDto {
    this.requireTarget(id);
    const updated = this.targets.update(id, expectedRevision, { title, jdText });
    if (!updated) throw new ConflictError("JD 已在其他窗口更新，请刷新后继续。");
    return this.withLatestAnalysis(updated);
  }

  setStatus(id: number, expectedRevision: number, status: "current" | "archived"): JobTargetDto {
    this.requireTarget(id);
    const updated = this.targets.setStatus(id, expectedRevision, status);
    if (!updated) throw new ConflictError("岗位状态已变化，请刷新后继续。");
    return this.withLatestAnalysis(updated);
  }

  async analyze(id: number, expectedRevision: number): Promise<JobFitAnalysisDto> {
    const startedAt = Date.now();
    const target = this.prerequisite.require(this.requireTarget(id));
    if (target.status !== "current") throw new ConflictError("已归档岗位不能分析，请先恢复为当前岗位。");
    if (target.revision !== expectedRevision) throw new ConflictError("JD 已更新，请使用最新版本重新分析。");
    const { snapshot, facts } = this.assembler.assemble(target);
    const inputFingerprint = fingerprintJobFitSnapshot(snapshot);
    const duplicate = this.targets.findAnalysisByFingerprint(id, inputFingerprint);
    if (duplicate?.runState === "succeeded" || duplicate?.runState === "pending") {
      return this.toDto(duplicate, target);
    }
    const pending = duplicate
      ? this.targets.retryFailedAnalysis(duplicate.id, snapshot)
      : this.targets.createPendingAnalysis(id, inputFingerprint, snapshot);
    try {
      const mappings = isJdSufficient(target.jdText) ? await this.mapper.map(target.jdText, facts) : [];
      const result = fixedJobFitDecisionPolicy({
        mappings,
        facts,
        jdSufficient: isJdSufficient(target.jdText),
        factsSufficient: snapshot.experiences.length > 0 && facts.length > 0,
        returnAnalysisId: pending.id,
        selectedExperienceIds: snapshot.selectedExperienceIds,
      });
      this.targets.completeAnalysis(pending.id, result.decision, result.insufficientReason, result as unknown as Record<string, unknown>);
      this.targets.touch(id);
      this.logger.info({
        event: "job_fit_analysis_succeeded",
        jobTargetId: id,
        analysisId: pending.id,
        analysisVersion: pending.version,
        elapsedMs: Date.now() - startedAt,
        decision: result.decision,
      }, "Job fit analysis succeeded");
      return this.toDto(this.targets.getAnalysisByVersion(id, pending.version)!, target);
    } catch (error) {
      const attempts = error instanceof JobFitAnalysisFailure ? error.attempts : [{
        failureStage: "unexpected" as const,
        statusCode: null,
        errorCode: "UNEXPECTED_JOB_FIT_ERROR",
        elapsedMs: Date.now() - startedAt,
        attempt: 1,
        schemaIssues: [],
      }];
      const finalAttempt = attempts.at(-1)!;
      const diagnostics = {
        ...finalAttempt,
        totalElapsedMs: Date.now() - startedAt,
        attempts,
      };
      this.targets.failAnalysis(pending.id, failureMessage(finalAttempt.failureStage), diagnostics);
      this.targets.touch(id);
      this.logger.error({
        event: "job_fit_analysis_failed",
        jobTargetId: id,
        analysisId: pending.id,
        analysisVersion: pending.version,
        ...diagnostics,
      }, "Job fit analysis failed");
      throw error;
    }
  }

  getAnalysis(id: number, version: number): JobFitAnalysisDto {
    const target = this.requireTarget(id);
    const analysis = this.targets.getAnalysisByVersion(id, version);
    if (!analysis) throw new NotFoundError("没有找到这个分析版本。");
    return this.toDto(analysis, target);
  }

  getCurrentContext(sourceId: number): { target: JobTargetDto | null; analysis: JobFitAnalysisDto | null } {
    const targets = this.targets.listBySource(sourceId).filter((target) => target.status === "current");
    const target = targets[0] ?? null;
    if (!target) return { target: null, analysis: null };
    const enriched = this.withLatestAnalysis(target);
    return { target: enriched, analysis: enriched.latestAnalysis ?? null };
  }

  hasCurrentAnalysis(sourceId: number): boolean {
    return this.getCurrentContext(sourceId).analysis?.validity === "current";
  }

  async generateResumeRewrite(id: number, analysisVersion: number): Promise<JobTargetResumeRewriteDto> {
    const { target } = this.requireCurrentApply(id, analysisVersion);
    const content = await this.generateLegacyRewrite(target.sourceId);
    const existing = this.targets.getResumeRewrite(id);
    return jobTargetResumeRewriteSchema.parse(
      this.targets.saveResumeRewrite(id, analysisVersion, existing?.revision ?? 0, content),
    );
  }

  getResumeRewrite(id: number, analysisVersion?: number): JobTargetResumeRewriteDto | null {
    this.requireTarget(id);
    const rewrite = this.targets.getResumeRewrite(id);
    if (!rewrite || (analysisVersion && rewrite.analysisVersion !== analysisVersion)) return null;
    return jobTargetResumeRewriteSchema.parse(rewrite);
  }

  saveResumeRewrite(id: number, analysisVersion: number, expectedRevision: number, content: ResumeRewriteOutputDto): JobTargetResumeRewriteDto {
    const { target } = this.requireCurrentApply(id, analysisVersion);
    const existing = this.targets.getResumeRewrite(id);
    if ((existing?.revision ?? 0) !== expectedRevision) {
      throw new ConflictError("岗位版简历已在其他窗口更新，请刷新后继续。");
    }
    const safeContent = this.saveLegacyRewrite(target.sourceId, content);
    const saved = this.targets.saveResumeRewrite(id, analysisVersion, expectedRevision, safeContent);
    if (!saved) throw new ConflictError("岗位版简历已更新，请刷新后继续。");
    return jobTargetResumeRewriteSchema.parse(saved);
  }

  private requireCurrentApply(id: number, analysisVersion: number): { target: JobTarget; analysis: JobFitAnalysisDto } {
    const target = this.requireTarget(id);
    const row = this.targets.getAnalysisByVersion(id, analysisVersion);
    if (!row) throw new NotFoundError("没有找到绑定的岗位分析版本。");
    const analysis = this.toDto(row, target);
    if (target.status !== "current" || analysis.validity !== "current" || analysis.runState !== "succeeded" || analysis.decision !== "apply") {
      throw new ConflictError("结论已过期或当前不建议投递，请回到第 6 步重新分析。");
    }
    const latest = this.targets.getLatestAnalysis(id);
    if (!latest || latest.version !== analysisVersion) {
      throw new ConflictError("只有最新的岗位分析可以生成岗位版简历。");
    }
    return { target, analysis };
  }

  private withLatestAnalysis(target: JobTarget): JobTargetDto {
    const latest = this.targets.getLatestAnalysis(target.id);
    return jobTargetSchema.parse({
      ...target,
      latestAnalysis: latest ? this.toDto(latest, target) : null,
    });
  }

  private toDto(row: JobFitAnalysisRow, target: JobTarget): JobFitAnalysisDto {
    const currentFingerprint = fingerprintJobFitSnapshot(this.assembler.assemble(target).snapshot);
    const validity = row.validity === "superseded"
      ? "superseded"
      : row.inputFingerprint === currentFingerprint ? "current" : "stale";
    const output = row.output ?? {};
    return jobFitAnalysisSchema.parse({
      id: row.id,
      jobTargetId: row.jobTargetId,
      version: row.version,
      runState: row.runState,
      decision: row.decision,
      validity,
      insufficientReason: row.insufficientReason,
      summary: row.runState === "failed" ? "分析失败" : String(output.summary ?? ""),
      evidence: output.evidence ?? [],
      gaps: output.gaps ?? [],
      criticalMismatches: output.criticalMismatches ?? [],
      recommendedExperiences: output.recommendedExperiences ?? [],
      claimRestrictions: output.claimRestrictions ?? row.inputSnapshot.experiences.flatMap((item) => item.claimRestrictions),
      inputSnapshot: row.inputSnapshot,
      inputFingerprint: row.inputFingerprint,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
    });
  }

  private requireTarget(id: number): JobTarget {
    const target = this.targets.get(id);
    if (!target) throw new NotFoundError("没有找到这个岗位记录。");
    return target;
  }
}
