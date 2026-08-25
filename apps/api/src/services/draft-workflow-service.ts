import type {
  CandidateSource,
  DraftSummary,
  GoalSetupState,
  PositioningDecisionState,
  ResumeRewriteOutput,
} from "../domain.js";
import { NotFoundError } from "../lib/app-error.js";
import { WorkspaceRepository } from "../repositories/workspace-repository.js";

export class DraftWorkflowService {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly getLatestResumeRewrite: (sourceId: number) => ResumeRewriteOutput | null,
    private readonly canProceedFromFactCompletion: (sourceId: number) => boolean,
    private readonly hasValidDossiersAndProfile: (sourceId: number) => boolean,
    private readonly canProceedToResumeRewrite: (sourceId: number) => boolean,
  ) {}

  getActiveSource(): CandidateSource | null {
    return this.repository.getActiveSource();
  }

  listDrafts(): DraftSummary[] {
    return this.repository.listSources().map((source) => {
      const statuses = this.stepStatuses(source.id);
      const experiences = this.repository.listExperiences(source.id);
      const title = source.filename ?? (experiences[0] ? `${experiences[0].company} | ${experiences[0].role}` : "未命名草稿");
      const goalSetup = this.repository.getLatestGeneratedAsset<GoalSetupState>("goal_setup", source.id, null);
      const positioningDecision = this.repository.getLatestGeneratedAsset<PositioningDecisionState>("positioning_decision", source.id, null);
      return {
        source: {
          id: source.id,
          sourceType: source.sourceType,
          filename: source.filename,
          createdAt: source.createdAt,
          updatedAt: source.updatedAt,
          isActive: source.isActive,
        },
        statuses,
        title,
        subtitle: `已完成到：${this.getDraftStepLabel(statuses)}`,
        updatedAt: source.updatedAt,
        isActive: source.isActive,
        goalSetup,
        positioningDecision,
      };
    });
  }

  startNewDraft(): void {
    this.repository.setActiveSource(null);
  }

  activateDraft(sourceId: number): CandidateSource {
    const source = this.repository.getSource(sourceId);
    if (!source) {
      throw new NotFoundError("没有找到对应的历史草稿。");
    }
    this.repository.setActiveSource(sourceId);
    return this.repository.getSource(sourceId)!;
  }

  deleteDraft(sourceId: number): CandidateSource {
    const source = this.repository.getSource(sourceId);
    if (!source) {
      throw new NotFoundError("没有找到要删除的求职方案。");
    }
    this.repository.deleteSource(sourceId);
    return source;
  }

  stepStatuses(sourceId: number | null): Record<string, boolean> {
    const statuses = {
      resume_import: false,
      baseline_review: false,
      deep_dive_selection: false,
      fact_completion: false,
      dossier_profile: false,
      job_fit_decision: false,
      resume_rewrite: false,
    };

    if (!sourceId) {
      return statuses;
    }

    const experiences = this.repository.listExperiences(sourceId);
    statuses.resume_import = experiences.length > 0;
    statuses.baseline_review = experiences.length > 0;
    const selected = experiences.filter((experience) => experience.selected);
    statuses.deep_dive_selection = selected.length > 0;
    statuses.fact_completion = this.canProceedFromFactCompletion(sourceId);
    statuses.dossier_profile = statuses.fact_completion && this.hasValidDossiersAndProfile(sourceId);
    statuses.resume_rewrite = statuses.dossier_profile
      && this.canProceedToResumeRewrite(sourceId)
      && this.getLatestResumeRewrite(sourceId) !== null;
    return statuses;
  }

  private getDraftStepLabel(statuses: Record<string, boolean>): string {
    if (statuses.resume_rewrite) return "岗位版简历";
    if (statuses.job_fit_decision) return "岗位适配决策";
    if (statuses.dossier_profile) return "确认求职定位";
    if (statuses.fact_completion) return "补充关键事实";
    if (statuses.deep_dive_selection) return "选择重点经历";
    if (statuses.baseline_review) return "核对经历";
    if (statuses.resume_import) return "导入简历";
    return "尚未开始";
  }
}
