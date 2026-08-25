import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type {
  CandidateSource,
  ChatTurn,
  EvidenceGap,
  ExperienceRecord,
  FactCompletionStateRecord,
} from "../domain.js";
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

function parseExperience(row: typeof experienceRecords.$inferSelect): ExperienceRecord {
  const payload = JSON.parse(row.rawSummaryJson) as {
    businessContext?: string;
    projects?: string[];
    responsibilities?: string[];
    outcomes?: string[];
    evidenceNotes?: string[];
  };
  return {
    id: row.id,
    sourceId: row.sourceId,
    company: row.company,
    role: row.role,
    timeframe: row.timeframe,
    businessContext: payload.businessContext ?? "",
    projects: payload.projects ?? [],
    responsibilities: payload.responsibilities ?? [],
    outcomes: payload.outcomes ?? [],
    evidenceNotes: payload.evidenceNotes ?? [],
    selected: row.selected,
    status: row.status,
  };
}

function experiencePayload(experience: ExperienceRecord): string {
  return JSON.stringify({
    company: experience.company,
    role: experience.role,
    timeframe: experience.timeframe,
    businessContext: experience.businessContext,
    projects: experience.projects,
    responsibilities: experience.responsibilities,
    outcomes: experience.outcomes,
    evidenceNotes: experience.evidenceNotes,
  });
}

export class WorkspaceRepository {
  constructor(private readonly db: AppDb) {}

  resetWorkspace(): void {
    this.db.delete(jobTargetResumeRewrites).run();
    this.db.delete(jobFitAnalyses).run();
    this.db.delete(jobTargets).run();
    this.db.delete(chatTurns).run();
    this.db.delete(evidenceGaps).run();
    this.db.delete(factCompletionStates).run();
    this.db.delete(generatedAssets).run();
    this.db.delete(experienceRecords).run();
    this.db.delete(candidateSources).run();
  }

  deleteSource(sourceId: number): void {
    const experienceIds = this.db
      .select({ id: experienceRecords.id })
      .from(experienceRecords)
      .where(eq(experienceRecords.sourceId, sourceId))
      .all()
      .map((row) => row.id);

    this.db.transaction((transaction) => {
      const targetIds = transaction
        .select({ id: jobTargets.id })
        .from(jobTargets)
        .where(eq(jobTargets.sourceId, sourceId))
        .all()
        .map((row) => row.id);
      if (targetIds.length > 0) {
        transaction.delete(jobTargetResumeRewrites).where(inArray(jobTargetResumeRewrites.jobTargetId, targetIds)).run();
        transaction.delete(jobFitAnalyses).where(inArray(jobFitAnalyses.jobTargetId, targetIds)).run();
        transaction.delete(jobTargets).where(inArray(jobTargets.id, targetIds)).run();
      }
      if (experienceIds.length > 0) {
        transaction.delete(chatTurns).where(inArray(chatTurns.experienceId, experienceIds)).run();
        transaction.delete(evidenceGaps).where(inArray(evidenceGaps.experienceId, experienceIds)).run();
        transaction.delete(factCompletionStates).where(inArray(factCompletionStates.experienceId, experienceIds)).run();
        transaction.delete(generatedAssets).where(inArray(generatedAssets.experienceId, experienceIds)).run();
      }
      transaction.delete(generatedAssets).where(eq(generatedAssets.sourceId, sourceId)).run();
      transaction.delete(experienceRecords).where(eq(experienceRecords.sourceId, sourceId)).run();
      transaction.delete(candidateSources).where(eq(candidateSources.id, sourceId)).run();
    });
  }

  createSource(source: Omit<CandidateSource, "id" | "createdAt" | "updatedAt" | "isActive">): CandidateSource {
    const now = utcNow();
    this.db.update(candidateSources).set({ isActive: false }).run();
    const result = this.db
      .insert(candidateSources)
      .values({
        sourceType: source.sourceType,
        filename: source.filename,
        rawText: source.rawText,
        createdAt: now,
        updatedAt: now,
        isActive: true,
      })
      .run();
    return {
      id: Number(result.lastInsertRowid),
      sourceType: source.sourceType,
      filename: source.filename,
      rawText: source.rawText,
      createdAt: now,
      updatedAt: now,
      isActive: true,
    };
  }

  listSources(): CandidateSource[] {
    return this.db
      .select()
      .from(candidateSources)
      .orderBy(desc(candidateSources.updatedAt), desc(candidateSources.id))
      .all()
      .map((row) => ({
        id: row.id,
        sourceType: row.sourceType as CandidateSource["sourceType"],
        filename: row.filename,
        rawText: row.rawText,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        isActive: row.isActive,
      }));
  }

  getSource(sourceId: number): CandidateSource | null {
    const row = this.db.select().from(candidateSources).where(eq(candidateSources.id, sourceId)).get();
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      sourceType: row.sourceType as CandidateSource["sourceType"],
      filename: row.filename,
      rawText: row.rawText,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      isActive: row.isActive,
    };
  }

  getActiveSource(): CandidateSource | null {
    const row = this.db
      .select()
      .from(candidateSources)
      .where(eq(candidateSources.isActive, true))
      .orderBy(desc(candidateSources.updatedAt), desc(candidateSources.id))
      .get();
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      sourceType: row.sourceType as CandidateSource["sourceType"],
      filename: row.filename,
      rawText: row.rawText,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      isActive: row.isActive,
    };
  }

  setActiveSource(sourceId: number | null): void {
    this.db.update(candidateSources).set({ isActive: false }).run();
    if (sourceId === null) {
      return;
    }
    this.db
      .update(candidateSources)
      .set({
        isActive: true,
        updatedAt: utcNow(),
      })
      .where(eq(candidateSources.id, sourceId))
      .run();
  }

  touchSource(sourceId: number): void {
    this.db
      .update(candidateSources)
      .set({ updatedAt: utcNow() })
      .where(eq(candidateSources.id, sourceId))
      .run();
  }

  replaceExperiences(sourceId: number, experiences: Array<Omit<ExperienceRecord, "id" | "sourceId"> & Partial<Pick<ExperienceRecord, "id" | "sourceId">>>): ExperienceRecord[] {
    const existingById = new Map(this.listExperiences(sourceId).map((experience) => [experience.id, experience]));
    const retainedIds = new Set<number>();
    const createdAt = utcNow();
    const saved = experiences.map((experience) => {
      const existing = experience.id ? existingById.get(experience.id) : null;
      if (existing) {
        const updated: ExperienceRecord = {
          ...existing,
          ...experience,
          id: existing.id,
          sourceId,
          selected: Boolean(experience.selected),
          status: experience.status ?? existing.status,
        };
        this.db
          .update(experienceRecords)
          .set({
            company: updated.company,
            role: updated.role,
            timeframe: updated.timeframe,
            rawSummaryJson: experiencePayload(updated),
            selected: updated.selected,
            status: updated.status,
            updatedAt: createdAt,
          })
          .where(eq(experienceRecords.id, existing.id))
          .run();
        retainedIds.add(existing.id);
        return updated;
      }

      const result = this.db
        .insert(experienceRecords)
        .values({
          sourceId,
          company: experience.company,
          role: experience.role,
          timeframe: experience.timeframe,
          rawSummaryJson: experiencePayload({
            ...experience,
            id: experience.id ?? -1,
            sourceId,
          } as ExperienceRecord),
          selected: Boolean(experience.selected),
          status: experience.status ?? "draft",
          createdAt,
          updatedAt: createdAt,
        })
        .run();
      const created = {
        id: Number(result.lastInsertRowid),
        sourceId,
        company: experience.company,
        role: experience.role,
        timeframe: experience.timeframe,
        businessContext: experience.businessContext,
        projects: experience.projects,
        responsibilities: experience.responsibilities,
        outcomes: experience.outcomes,
        evidenceNotes: experience.evidenceNotes,
        selected: Boolean(experience.selected),
        status: experience.status ?? "draft",
      };
      retainedIds.add(created.id);
      return created;
    });

    const removedIds = [...existingById.keys()].filter((id) => !retainedIds.has(id));
    if (removedIds.length > 0) {
      this.deleteArtifactsForExperienceIds(removedIds);
      this.db.delete(experienceRecords).where(inArray(experienceRecords.id, removedIds)).run();
    }
    this.touchSource(sourceId);
    return saved;
  }

  listExperiences(sourceId: number): ExperienceRecord[] {
    return this.db
      .select()
      .from(experienceRecords)
      .where(eq(experienceRecords.sourceId, sourceId))
      .orderBy(experienceRecords.id)
      .all()
      .map(parseExperience);
  }

  getExperience(experienceId: number): ExperienceRecord | null {
    const row = this.db.select().from(experienceRecords).where(eq(experienceRecords.id, experienceId)).get();
    return row ? parseExperience(row) : null;
  }

  updateExperience(experience: ExperienceRecord): void {
    this.db
      .update(experienceRecords)
      .set({
        company: experience.company,
        role: experience.role,
        timeframe: experience.timeframe,
        rawSummaryJson: experiencePayload(experience),
        selected: experience.selected,
        status: experience.status,
        updatedAt: utcNow(),
      })
      .where(eq(experienceRecords.id, experience.id))
      .run();
    this.touchSource(experience.sourceId);
  }

  setSelectedExperiences(sourceId: number, selectedIds: number[]): void {
    const rows = this.listExperiences(sourceId);
    for (const experience of rows) {
      this.updateExperience({
        ...experience,
        selected: selectedIds.includes(experience.id),
      });
    }
    this.touchSource(sourceId);
  }

  createChatTurn(step: string, role: ChatTurn["role"], content: string, experienceId: number | null = null): void {
    this.db.insert(chatTurns).values({
      step,
      experienceId,
      role,
      content,
      createdAt: utcNow(),
    }).run();
  }

  deleteChatTurns(step: string, experienceId: number | null = null): void {
    const condition = experienceId === null
      ? and(eq(chatTurns.step, step), isNull(chatTurns.experienceId))
      : and(eq(chatTurns.step, step), eq(chatTurns.experienceId, experienceId));
    this.db.delete(chatTurns).where(condition!).run();
  }

  listChatTurns(step: string, experienceId: number | null = null): ChatTurn[] {
    const condition = experienceId === null
      ? and(eq(chatTurns.step, step), isNull(chatTurns.experienceId))
      : and(eq(chatTurns.step, step), eq(chatTurns.experienceId, experienceId));
    return this.db
      .select({
        role: chatTurns.role,
        content: chatTurns.content,
        createdAt: chatTurns.createdAt,
      })
      .from(chatTurns)
      .where(condition!)
      .orderBy(chatTurns.id)
      .all() as ChatTurn[];
  }

  replaceEvidenceGaps(experienceId: number, gaps: Omit<EvidenceGap, "id">[]): EvidenceGap[] {
    this.db.delete(evidenceGaps).where(eq(evidenceGaps.experienceId, experienceId)).run();
    const createdAt = utcNow();
    return gaps.map((gap) => {
      const result = this.db.insert(evidenceGaps).values({
        experienceId,
        gapType: gap.gapType,
        severity: gap.severity,
        status: gap.status,
        rationale: gap.rationale,
        nextQuestion: gap.nextQuestion,
        createdAt,
        updatedAt: createdAt,
      }).run();
      return { ...gap, id: Number(result.lastInsertRowid) };
    });
  }

  listEvidenceGaps(experienceId: number): EvidenceGap[] {
    return this.db
      .select()
      .from(evidenceGaps)
      .where(eq(evidenceGaps.experienceId, experienceId))
      .orderBy(evidenceGaps.id)
      .all()
      .map((row) => ({
        id: row.id,
        experienceId: row.experienceId,
        gapType: row.gapType,
        severity: row.severity as EvidenceGap["severity"],
        status: row.status,
        rationale: row.rationale,
        nextQuestion: row.nextQuestion,
      }));
  }

  getFactCompletionState(experienceId: number): FactCompletionStateRecord | null {
    const row = this.db
      .select()
      .from(factCompletionStates)
      .where(eq(factCompletionStates.experienceId, experienceId))
      .get();
    if (!row) return null;
    return {
      experienceId: row.experienceId,
      status: row.status as FactCompletionStateRecord["status"],
      factVersion: row.factVersion,
      factFingerprint: row.factFingerprint,
      confirmedSummary: row.confirmedSummaryJson ? JSON.parse(row.confirmedSummaryJson) : null,
      claimRestrictions: JSON.parse(row.claimRestrictionsJson),
      confirmedAt: row.confirmedAt,
      updatedAt: row.updatedAt,
    };
  }

  saveFactCompletionState(state: FactCompletionStateRecord): void {
    this.db
      .insert(factCompletionStates)
      .values({
        experienceId: state.experienceId,
        status: state.status,
        factVersion: state.factVersion,
        factFingerprint: state.factFingerprint,
        confirmedSummaryJson: state.confirmedSummary ? JSON.stringify(state.confirmedSummary) : null,
        claimRestrictionsJson: JSON.stringify(state.claimRestrictions),
        confirmedAt: state.confirmedAt,
        updatedAt: state.updatedAt,
      })
      .onConflictDoUpdate({
        target: factCompletionStates.experienceId,
        set: {
          status: state.status,
          factVersion: state.factVersion,
          factFingerprint: state.factFingerprint,
          confirmedSummaryJson: state.confirmedSummary ? JSON.stringify(state.confirmedSummary) : null,
          claimRestrictionsJson: JSON.stringify(state.claimRestrictions),
          confirmedAt: state.confirmedAt,
          updatedAt: state.updatedAt,
        },
      })
      .run();
  }

  saveGeneratedAsset(assetType: string, content: unknown, sourceId: number | null = null, experienceId: number | null = null): number {
    const latest = this.db
      .select({ version: sql<number>`coalesce(max(${generatedAssets.version}), 0)` })
      .from(generatedAssets)
      .where(
        and(
          eq(generatedAssets.assetType, assetType),
          sourceId === null ? isNull(generatedAssets.sourceId) : eq(generatedAssets.sourceId, sourceId),
          experienceId === null ? isNull(generatedAssets.experienceId) : eq(generatedAssets.experienceId, experienceId),
        )!,
      )
      .get();
    const result = this.db.insert(generatedAssets).values({
      sourceId,
      assetType,
      experienceId,
      contentJson: JSON.stringify(content),
      version: (latest?.version ?? 0) + 1,
      createdAt: utcNow(),
    }).run();
    return Number(result.lastInsertRowid);
  }

  getLatestGeneratedAsset<T>(assetType: string, sourceId: number | null = null, experienceId: number | null = null): T | null {
    const row = this.db
      .select()
      .from(generatedAssets)
      .where(
        and(
          eq(generatedAssets.assetType, assetType),
          sourceId === null ? isNull(generatedAssets.sourceId) : eq(generatedAssets.sourceId, sourceId),
          experienceId === null ? isNull(generatedAssets.experienceId) : eq(generatedAssets.experienceId, experienceId),
        )!,
      )
      .orderBy(desc(generatedAssets.version))
      .get();
    return row ? JSON.parse(row.contentJson) as T : null;
  }

  getLatestGeneratedAssetVersion(assetType: string, sourceId: number | null = null, experienceId: number | null = null): number {
    const row = this.db
      .select({ version: generatedAssets.version })
      .from(generatedAssets)
      .where(
        and(
          eq(generatedAssets.assetType, assetType),
          sourceId === null ? isNull(generatedAssets.sourceId) : eq(generatedAssets.sourceId, sourceId),
          experienceId === null ? isNull(generatedAssets.experienceId) : eq(generatedAssets.experienceId, experienceId),
        )!,
      )
      .orderBy(desc(generatedAssets.version))
      .get();
    return row?.version ?? 0;
  }

  invalidateAssets(assetTypes: string[], sourceId: number | null = null): void {
    if (assetTypes.length === 0) {
      return;
    }
    const condition = sourceId === null
      ? and(inArray(generatedAssets.assetType, assetTypes), isNull(generatedAssets.sourceId))
      : and(inArray(generatedAssets.assetType, assetTypes), eq(generatedAssets.sourceId, sourceId));
    this.db.delete(generatedAssets).where(condition!).run();
  }

  private deleteExperienceArtifacts(sourceId: number): void {
    const experienceIds = this.db
      .select({ id: experienceRecords.id })
      .from(experienceRecords)
      .where(eq(experienceRecords.sourceId, sourceId))
      .all()
      .map((row) => row.id);

    if (experienceIds.length === 0) {
      return;
    }

    this.deleteArtifactsForExperienceIds(experienceIds);
  }

  private deleteArtifactsForExperienceIds(experienceIds: number[]): void {
    this.db.delete(chatTurns).where(inArray(chatTurns.experienceId, experienceIds)).run();
    this.db.delete(evidenceGaps).where(inArray(evidenceGaps.experienceId, experienceIds)).run();
    this.db.delete(factCompletionStates).where(inArray(factCompletionStates.experienceId, experienceIds)).run();
    this.db.delete(generatedAssets).where(inArray(generatedAssets.experienceId, experienceIds)).run();
  }
}
