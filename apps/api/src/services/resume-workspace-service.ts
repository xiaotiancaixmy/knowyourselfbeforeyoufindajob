import type { CandidateSource, ExperienceRecord } from "../domain.js";
import { BadRequestError } from "../lib/app-error.js";
import { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { ExperienceParserService } from "./experience-parser-service.js";
import { ResumeIngestionService } from "./resume-ingestion-service.js";
import { DOWNSTREAM_ASSETS } from "./workflow-assets.js";

export class ResumeWorkspaceService {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly parserService: ExperienceParserService,
    private readonly ingestionService: ResumeIngestionService,
  ) {}

  async importTextResume(rawText: string): Promise<CandidateSource> {
    const cleaned = this.ingestionService.extractFromText(rawText);
    return this.createSourceFromRawText("text", null, cleaned);
  }

  async importPdfResume(filename: string, fileBytes: Buffer): Promise<CandidateSource> {
    const cleaned = await this.ingestionService.extractFromPdf(fileBytes);
    return this.createSourceFromRawText("pdf", filename, cleaned);
  }

  getExperiences(sourceId: number): ExperienceRecord[] {
    return this.repository.listExperiences(sourceId);
  }

  async recognizeExperiences(sourceId: number): Promise<ExperienceRecord[]> {
    const source = this.repository.getSource(sourceId);
    if (!source) {
      throw new BadRequestError("没有找到这份简历草稿，请重新导入。");
    }

    const recognized = await this.parserService.parse(source.rawText);
    const existing = this.repository.listExperiences(sourceId);
    const matchedIds = new Set<number>();

    return recognized.map((experience, index) => {
      const match = existing.find((candidate) => {
        if (matchedIds.has(candidate.id)) return false;
        const sameCompany = this.comparable(candidate.company) === this.comparable(experience.company);
        const sameTimeframe = this.comparable(candidate.timeframe) === this.comparable(experience.timeframe);
        const sameRole = this.comparable(candidate.role) === this.comparable(experience.role);
        return sameCompany && (sameTimeframe || sameRole);
      });
      if (match) matchedIds.add(match.id);

      return {
        ...experience,
        id: match?.id ?? -(index + 1),
        sourceId,
        selected: match?.selected ?? false,
        status: match?.status ?? "draft",
      };
    });
  }

  saveBaselineExperiences(sourceId: number, experiences: ExperienceRecord[]): ExperienceRecord[] {
    const saved = this.repository.replaceExperiences(sourceId, experiences);
    this.repository.saveGeneratedAsset("baseline_experience_list", saved, sourceId, null);
    this.repository.invalidateAssets(DOWNSTREAM_ASSETS, sourceId);
    this.repository.touchSource(sourceId);
    return this.repository.listExperiences(sourceId);
  }

  selectExperiences(sourceId: number, selectedIds: number[]): void {
    if (selectedIds.length === 0) throw new BadRequestError("请至少选择 1 段重点经历。");
    if (selectedIds.length > 3) throw new BadRequestError("一次最多选择 3 段重点经历。");
    const currentSelectedIds = this.repository
      .listExperiences(sourceId)
      .filter((experience) => experience.selected)
      .map((experience) => experience.id)
      .sort((left, right) => left - right);
    const nextSelectedIds = [...new Set(selectedIds)].sort((left, right) => left - right);
    const selectionChanged = currentSelectedIds.length !== nextSelectedIds.length
      || currentSelectedIds.some((id, index) => id !== nextSelectedIds[index]);
    if (!selectionChanged) {
      return;
    }
    this.repository.setSelectedExperiences(sourceId, nextSelectedIds);
    this.repository.invalidateAssets(DOWNSTREAM_ASSETS, sourceId);
    this.repository.touchSource(sourceId);
  }

  private async createSourceFromRawText(
    sourceType: CandidateSource["sourceType"],
    filename: string | null,
    rawText: string,
  ): Promise<CandidateSource> {
    const experiences = await this.parserService.parse(rawText);
    const source = this.repository.createSource({ sourceType, filename, rawText });
    const saved = this.repository.replaceExperiences(source.id, experiences);
    this.repository.saveGeneratedAsset("baseline_experience_list", saved, source.id, null);
    this.repository.touchSource(source.id);
    return source;
  }

  private comparable(value: string): string {
    return value.toLowerCase().replace(/[\s|()（）.,，·_-]+/gu, "");
  }
}
