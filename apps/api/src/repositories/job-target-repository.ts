import { and, desc, eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  JobFitDecision,
  JobFitInsufficientReason,
  JobFitInputSnapshotDto,
  JobFitValidity,
  JobTargetResumeRewriteDto,
  JobTargetStatus,
  ResumeRewriteOutputDto,
} from "@kys/shared";

import {
  candidateSources,
  chatTurns,
  evidenceGaps,
  experienceRecords,
  factCompletionStates,
  generatedAssets,
  jobFitAnalyses,
  jobTargetResumeRewrites,
  jobTargets,
} from "../db/schema.js";
import type { JobTarget } from "../domain.js";
import { utcNow } from "../lib/time.js";

type AppDb = BetterSQLite3Database<{
  candidateSources: typeof candidateSources;
  experienceRecords: typeof experienceRecords;
  chatTurns: typeof chatTurns;
  evidenceGaps: typeof evidenceGaps;
  factCompletionStates: typeof factCompletionStates;
  generatedAssets: typeof generatedAssets;
  jobTargets: typeof jobTargets;
  jobFitAnalyses: typeof jobFitAnalyses;
  jobTargetResumeRewrites: typeof jobTargetResumeRewrites;
}>;

export interface JobFitAnalysisRow {
  id: number;
  jobTargetId: number;
  version: number;
  runState: "pending" | "succeeded" | "failed";
  decision: JobFitDecision | null;
  validity: JobFitValidity;
  insufficientReason: JobFitInsufficientReason | null;
  inputFingerprint: string;
  inputSnapshot: JobFitInputSnapshotDto;
  output: Record<string, unknown> | null;
  errorMessage: string | null;
  diagnostics: Record<string, unknown> | null;
  createdAt: string;
}

function parseTarget(row: typeof jobTargets.$inferSelect): JobTarget {
  return {
    id: row.id,
    sourceId: row.sourceId,
    title: row.title,
    jdText: row.jdText,
    revision: row.revision,
    status: row.status as JobTargetStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseAnalysis(row: typeof jobFitAnalyses.$inferSelect): JobFitAnalysisRow {
  return {
    id: row.id,
    jobTargetId: row.jobTargetId,
    version: row.version,
    runState: row.runState as JobFitAnalysisRow["runState"],
    decision: row.decision as JobFitDecision | null,
    validity: row.validity as JobFitValidity,
    insufficientReason: row.insufficientReason as JobFitInsufficientReason | null,
    inputFingerprint: row.inputFingerprint,
    inputSnapshot: JSON.parse(row.inputSnapshotJson) as JobFitInputSnapshotDto,
    output: row.outputJson ? JSON.parse(row.outputJson) as Record<string, unknown> : null,
    errorMessage: row.errorMessage,
    diagnostics: row.diagnosticsJson ? JSON.parse(row.diagnosticsJson) as Record<string, unknown> : null,
    createdAt: row.createdAt,
  };
}

export class JobTargetRepository {
  constructor(private readonly db: AppDb) {}

  create(sourceId: number, title: string, jdText: string): JobTarget {
    const now = utcNow();
    const result = this.db.insert(jobTargets).values({
      sourceId,
      title,
      jdText,
      revision: 1,
      status: "current",
      createdAt: now,
      updatedAt: now,
    }).run();
    return this.get(Number(result.lastInsertRowid))!;
  }

  get(id: number): JobTarget | null {
    const row = this.db.select().from(jobTargets).where(eq(jobTargets.id, id)).get();
    return row ? parseTarget(row) : null;
  }

  listBySource(sourceId: number): JobTarget[] {
    return this.db.select().from(jobTargets)
      .where(eq(jobTargets.sourceId, sourceId))
      .orderBy(desc(jobTargets.updatedAt), desc(jobTargets.id))
      .all()
      .map(parseTarget);
  }

  update(id: number, expectedRevision: number, values: { title: string; jdText: string }): JobTarget | null {
    const result = this.db.update(jobTargets).set({
      title: values.title,
      jdText: values.jdText,
      revision: expectedRevision + 1,
      updatedAt: utcNow(),
    }).where(and(eq(jobTargets.id, id), eq(jobTargets.revision, expectedRevision))).run();
    return result.changes === 1 ? this.get(id) : null;
  }

  setStatus(id: number, expectedRevision: number, status: JobTargetStatus): JobTarget | null {
    const result = this.db.update(jobTargets).set({
      status,
      revision: expectedRevision + 1,
      updatedAt: utcNow(),
    }).where(and(eq(jobTargets.id, id), eq(jobTargets.revision, expectedRevision))).run();
    return result.changes === 1 ? this.get(id) : null;
  }

  touch(id: number): void {
    this.db.update(jobTargets).set({ updatedAt: utcNow() })
      .where(eq(jobTargets.id, id))
      .run();
  }

  getAnalysisByVersion(jobTargetId: number, version: number): JobFitAnalysisRow | null {
    const row = this.db.select().from(jobFitAnalyses).where(and(
      eq(jobFitAnalyses.jobTargetId, jobTargetId),
      eq(jobFitAnalyses.version, version),
    )).get();
    return row ? parseAnalysis(row) : null;
  }

  getLatestAnalysis(jobTargetId: number): JobFitAnalysisRow | null {
    const row = this.db.select().from(jobFitAnalyses)
      .where(eq(jobFitAnalyses.jobTargetId, jobTargetId))
      .orderBy(desc(jobFitAnalyses.version))
      .get();
    return row ? parseAnalysis(row) : null;
  }

  findAnalysisByFingerprint(jobTargetId: number, inputFingerprint: string): JobFitAnalysisRow | null {
    const row = this.db.select().from(jobFitAnalyses).where(and(
      eq(jobFitAnalyses.jobTargetId, jobTargetId),
      eq(jobFitAnalyses.inputFingerprint, inputFingerprint),
    )).orderBy(desc(jobFitAnalyses.version)).get();
    return row ? parseAnalysis(row) : null;
  }

  recoverInterruptedAnalyses(): number {
    const result = this.db.update(jobFitAnalyses).set({
      runState: "failed",
      decision: null,
      insufficientReason: null,
      outputJson: null,
      errorMessage: "上次岗位分析因服务中断而未完成，请重试。",
      diagnosticsJson: JSON.stringify({
        failureStage: "interrupted",
        errorCode: "ANALYSIS_INTERRUPTED",
        statusCode: null,
        schemaIssues: [],
      }),
    }).where(eq(jobFitAnalyses.runState, "pending")).run();
    return result.changes;
  }

  createPendingAnalysis(jobTargetId: number, inputFingerprint: string, inputSnapshot: JobFitInputSnapshotDto): JobFitAnalysisRow {
    const latest = this.db.select({ version: sql<number>`coalesce(max(${jobFitAnalyses.version}), 0)` })
      .from(jobFitAnalyses)
      .where(eq(jobFitAnalyses.jobTargetId, jobTargetId))
      .get();
    const result = this.db.insert(jobFitAnalyses).values({
      jobTargetId,
      version: (latest?.version ?? 0) + 1,
      runState: "pending",
      decision: null,
      validity: "current",
      insufficientReason: null,
      inputFingerprint,
      inputSnapshotJson: JSON.stringify(inputSnapshot),
      outputJson: null,
      errorMessage: null,
      diagnosticsJson: null,
      createdAt: utcNow(),
    }).run();
    return parseAnalysis(this.db.select().from(jobFitAnalyses).where(eq(jobFitAnalyses.id, Number(result.lastInsertRowid))).get()!);
  }

  retryFailedAnalysis(id: number, inputSnapshot: JobFitInputSnapshotDto): JobFitAnalysisRow {
    this.db.update(jobFitAnalyses).set({
      runState: "pending",
      decision: null,
      validity: "current",
      insufficientReason: null,
      inputSnapshotJson: JSON.stringify(inputSnapshot),
      outputJson: null,
      errorMessage: null,
      diagnosticsJson: null,
      createdAt: utcNow(),
    }).where(eq(jobFitAnalyses.id, id)).run();
    return parseAnalysis(this.db.select().from(jobFitAnalyses).where(eq(jobFitAnalyses.id, id)).get()!);
  }

  completeAnalysis(id: number, decision: JobFitDecision, insufficientReason: JobFitInsufficientReason | null, output: Record<string, unknown>): void {
    this.db.transaction((transaction) => {
      const current = transaction.select().from(jobFitAnalyses).where(eq(jobFitAnalyses.id, id)).get()!;
      const latest = transaction.select().from(jobFitAnalyses)
        .where(eq(jobFitAnalyses.jobTargetId, current.jobTargetId))
        .orderBy(desc(jobFitAnalyses.version))
        .get()!;
      if (latest.version > current.version) {
        transaction.update(jobFitAnalyses).set({
          runState: "succeeded",
          decision,
          validity: "superseded",
          insufficientReason,
          outputJson: JSON.stringify(output),
          errorMessage: null,
          diagnosticsJson: null,
        }).where(eq(jobFitAnalyses.id, id)).run();
        return;
      }
      transaction.update(jobFitAnalyses).set({ validity: "superseded" })
        .where(and(eq(jobFitAnalyses.jobTargetId, current.jobTargetId), eq(jobFitAnalyses.validity, "current")))
        .run();
      transaction.update(jobFitAnalyses).set({
        runState: "succeeded",
        decision,
        validity: "current",
        insufficientReason,
        outputJson: JSON.stringify(output),
        errorMessage: null,
        diagnosticsJson: null,
      }).where(eq(jobFitAnalyses.id, id)).run();
    });
  }

  failAnalysis(id: number, errorMessage: string, diagnostics: Record<string, unknown>): void {
    this.db.update(jobFitAnalyses).set({
      runState: "failed",
      decision: null,
      insufficientReason: null,
      outputJson: null,
      errorMessage,
      diagnosticsJson: JSON.stringify(diagnostics),
    }).where(eq(jobFitAnalyses.id, id)).run();
  }

  getResumeRewrite(jobTargetId: number): JobTargetResumeRewriteDto | null {
    const row = this.db.select().from(jobTargetResumeRewrites)
      .where(eq(jobTargetResumeRewrites.jobTargetId, jobTargetId)).get();
    return row ? {
      jobTargetId: row.jobTargetId,
      analysisVersion: row.analysisVersion,
      revision: row.revision,
      content: JSON.parse(row.contentJson) as ResumeRewriteOutputDto,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    } : null;
  }

  saveResumeRewrite(jobTargetId: number, analysisVersion: number, expectedRevision: number, content: ResumeRewriteOutputDto): JobTargetResumeRewriteDto | null {
    const existing = this.getResumeRewrite(jobTargetId);
    const now = utcNow();
    if (!existing && expectedRevision === 0) {
      this.db.insert(jobTargetResumeRewrites).values({
        jobTargetId,
        analysisVersion,
        revision: 1,
        contentJson: JSON.stringify(content),
        createdAt: now,
        updatedAt: now,
      }).run();
      return this.getResumeRewrite(jobTargetId);
    }
    if (!existing || existing.revision !== expectedRevision) return null;
    this.db.update(jobTargetResumeRewrites).set({
      analysisVersion,
      revision: expectedRevision + 1,
      contentJson: JSON.stringify(content),
      updatedAt: now,
    }).where(and(
      eq(jobTargetResumeRewrites.jobTargetId, jobTargetId),
      eq(jobTargetResumeRewrites.revision, expectedRevision),
    )).run();
    return this.getResumeRewrite(jobTargetId);
  }
}
