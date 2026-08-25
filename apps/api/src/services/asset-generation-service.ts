import {
  candidateProfileSchema,
  companyDossierSchema,
  positioningDecisionStateSchema,
  resumeRewriteOutputSchema,
} from "@kys/shared";

import type {
  CandidateProfile,
  ClaimRestriction,
  CompanyDossier,
  EvidenceGap,
  ExperienceRecord,
  GoalSetupState,
  PositioningDecisionState,
  ResumeRewriteOutput,
} from "../domain.js";
import { BadRequestError, ConflictError } from "../lib/app-error.js";
import { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { DossierGenerationService } from "./dossier-generation-service.js";
import { EvidenceGapService } from "./evidence-gap-service.js";
import { FactCompletionDecisionService } from "./fact-completion-decision-service.js";
import { ProfileGenerationService } from "./profile-generation-service.js";
import { ResumeRewriteService } from "./resume-rewrite-service.js";
import {
  isRewriteClaimSafe,
  type ClaimRestrictionsByExperienceId,
} from "./claim-safety.js";

export class AssetGenerationService {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly evidenceGapService: EvidenceGapService,
    private readonly dossierService: DossierGenerationService,
    private readonly profileService: ProfileGenerationService,
    private readonly rewriteService: ResumeRewriteService,
    private readonly factCompletionDecisionService: FactCompletionDecisionService,
  ) {}

  generateDossiersAndProfile(sourceId: number): { dossiers: CompanyDossier[]; profile: CandidateProfile } {
    const experiences = this.repository.listExperiences(sourceId).filter((experience) => experience.selected);
    if (experiences.length === 0) throw new BadRequestError("请先选择至少一段经历。");
    const overallCompletion = this.factCompletionDecisionService.getOverallCompletion(sourceId);
    if (!overallCompletion.canProceed) {
      throw new ConflictError("请先确认每段已选经历的事实；有些信息暂时缺失，也需要确认后再继续。");
    }
    const goalSetup = this.getGoalSetup(sourceId);
    const positioningDecision = this.getPositioningDecision(sourceId);
    const restrictionsByExperienceId: ClaimRestrictionsByExperienceId = Object.fromEntries(
      experiences.map((experience) => [
        experience.id,
        this.factCompletionDecisionService.getCompletion(experience.id).claimRestrictions,
      ]),
    );

    const gapsByExperienceId: Record<number, EvidenceGap[]> = {};
    const dossiers = experiences.map((experience) => {
      const gaps = this.evidenceGapService.analyze(experience);
      this.repository.replaceEvidenceGaps(experience.id, gaps);
      gapsByExperienceId[experience.id] = gaps;
      const dossier = this.dossierService.generate(
        experience,
        gaps,
        goalSetup,
        positioningDecision,
        restrictionsByExperienceId[experience.id],
      );
      this.repository.saveGeneratedAsset("company_dossier", dossier, sourceId, experience.id);
      return dossier;
    });

    const profile = this.profileService.generate(
      experiences,
      dossiers,
      gapsByExperienceId,
      goalSetup,
      restrictionsByExperienceId,
    );
    this.repository.saveGeneratedAsset("candidate_profile", profile, sourceId, null);
    this.repository.touchSource(sourceId);
    return { dossiers, profile };
  }

  async rewriteResume(sourceId: number): Promise<ResumeRewriteOutput> {
    const {
      experiences,
      profile,
      positioningDecision,
      restrictionsByExperienceId,
    } = this.requireResumeRewritePrerequisites(sourceId);
    const rewrite = await this.rewriteService.rewrite(
      experiences,
      profile,
      positioningDecision,
      this.getGoalSetup(sourceId),
      restrictionsByExperienceId,
    );
    return this.saveResumeRewrite(sourceId, rewrite);
  }

  saveResumeRewrite(sourceId: number, rewrite: ResumeRewriteOutput): ResumeRewriteOutput {
    const {
      experiences,
      positioningDecision,
      restrictionsByExperienceId,
    } = this.requireResumeRewritePrerequisites(sourceId);
    if (!isRewriteClaimSafe({
      rewrite,
      experiences,
      restrictionsByExperienceId,
      goalSetup: this.getGoalSetup(sourceId),
      positioningDecision,
    })) {
      throw new ConflictError("简历中有些内容无法从当前经历中确认。请检查数字和个人贡献，只保留有事实依据的表述。");
    }
    this.repository.saveGeneratedAsset("resume_summary", { professionalSummary: rewrite.professionalSummary }, sourceId, null);
    this.repository.saveGeneratedAsset("resume_bullets", rewrite.experienceBulletsByExperienceId, sourceId, null);
    this.repository.touchSource(sourceId);
    return rewrite;
  }

  getLatestProfile(sourceId: number): CandidateProfile | null {
    const parsed = candidateProfileSchema.safeParse(
      this.repository.getLatestGeneratedAsset<unknown>("candidate_profile", sourceId, null),
    );
    return parsed.success ? parsed.data : null;
  }

  getLatestDossiers(sourceId: number, experiences: ExperienceRecord[]): CompanyDossier[] {
    return experiences
      .map((experience) => {
        const parsed = companyDossierSchema.safeParse(
          this.repository.getLatestGeneratedAsset<unknown>("company_dossier", sourceId, experience.id),
        );
        return parsed.success && parsed.data.experienceId === experience.id ? parsed.data : null;
      })
      .filter((item): item is CompanyDossier => item !== null);
  }

  getLatestResumeRewrite(sourceId: number): ResumeRewriteOutput | null {
    const summary = this.repository.getLatestGeneratedAsset<{ professionalSummary: string }>("resume_summary", sourceId, null);
    const bullets = this.repository.getLatestGeneratedAsset<Record<string, string[]>>("resume_bullets", sourceId, null);
    const parsed = resumeRewriteOutputSchema.safeParse(
      summary && bullets
        ? { professionalSummary: summary.professionalSummary, experienceBulletsByExperienceId: bullets }
        : null,
    );
    return parsed.success ? parsed.data : null;
  }

  hasValidDossiersAndProfile(sourceId: number): boolean {
    const experiences = this.repository.listExperiences(sourceId).filter((experience) => experience.selected);
    return experiences.length > 0
      && this.getLatestProfile(sourceId) !== null
      && this.getLatestDossiers(sourceId, experiences).length === experiences.length;
  }

  canProceedToResumeRewrite(sourceId: number): boolean {
    const positioningDecision = positioningDecisionStateSchema.safeParse(
      this.repository.getLatestGeneratedAsset<unknown>("positioning_decision", sourceId, null),
    );
    return this.factCompletionDecisionService.getOverallCompletion(sourceId).canProceed
      && this.hasValidDossiersAndProfile(sourceId)
      && positioningDecision.success
      && Boolean(positioningDecision.data.selectedOptionId)
      && Boolean(positioningDecision.data.confirmedOptionTitle.trim());
  }

  saveGoalSetup(sourceId: number, goalSetup: GoalSetupState): GoalSetupState {
    this.repository.saveGeneratedAsset("goal_setup", goalSetup, sourceId, null);
    this.repository.touchSource(sourceId);
    return goalSetup;
  }

  getGoalSetup(sourceId: number): GoalSetupState | null {
    return this.repository.getLatestGeneratedAsset<GoalSetupState>("goal_setup", sourceId, null);
  }

  savePositioningDecision(sourceId: number, decision: PositioningDecisionState): PositioningDecisionState {
    this.repository.saveGeneratedAsset("positioning_decision", decision, sourceId, null);
    this.repository.touchSource(sourceId);
    return decision;
  }

  getPositioningDecision(sourceId: number): PositioningDecisionState | null {
    const parsed = positioningDecisionStateSchema.safeParse(
      this.repository.getLatestGeneratedAsset<unknown>("positioning_decision", sourceId, null),
    );
    return parsed.success ? parsed.data : null;
  }

  private requireResumeRewritePrerequisites(sourceId: number): {
    experiences: ExperienceRecord[];
    profile: CandidateProfile;
    positioningDecision: PositioningDecisionState;
    restrictionsByExperienceId: Record<number, ClaimRestriction[]>;
  } {
    const experiences = this.repository.listExperiences(sourceId).filter((experience) => experience.selected);
    const overallCompletion = this.factCompletionDecisionService.getOverallCompletion(sourceId);
    if (!overallCompletion.canProceed) {
      throw new ConflictError("请先重新确认每段已选经历的事实，再进入简历改写。");
    }

    const profile = this.getLatestProfile(sourceId);
    const hasEveryDossier = experiences.length > 0
      && this.getLatestDossiers(sourceId, experiences).length === experiences.length;
    if (!profile || !hasEveryDossier) {
      throw new ConflictError("求职定位或经历分析需要更新，请重新生成后再改写简历。");
    }

    const positioningDecision = this.getPositioningDecision(sourceId);
    if (!positioningDecision?.selectedOptionId || !positioningDecision.confirmedOptionTitle.trim()) {
      throw new ConflictError("请先确认这轮简历的主打方向，再进入改写。");
    }

    return {
      experiences,
      profile,
      positioningDecision,
      restrictionsByExperienceId: Object.fromEntries(
        experiences.map((experience) => [
          experience.id,
          this.factCompletionDecisionService.getCompletion(experience.id).claimRestrictions,
        ]),
      ),
    };
  }
}
