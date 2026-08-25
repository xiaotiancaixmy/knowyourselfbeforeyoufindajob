import type {
  CandidateProfile,
  CandidateSource,
  CompanyDossier,
  DraftSummary,
  EvidenceGap,
  ExperienceRecord,
  GoalSetupState,
  PositioningDecisionState,
  ResumeRewriteOutput,
  FactCompletionReviewPayload,
} from "../domain.js";
import { DeepSeekClient } from "../lib/deepseek-client.js";
import { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { AssetGenerationService } from "./asset-generation-service.js";
import { DossierGenerationService } from "./dossier-generation-service.js";
import { DraftWorkflowService } from "./draft-workflow-service.js";
import { EvidenceGapService } from "./evidence-gap-service.js";
import { ExperienceParserService } from "./experience-parser-service.js";
import { FactCompletionChatService } from "./fact-completion-chat-service.js";
import { FactCompletionDecisionService } from "./fact-completion-decision-service.js";
import { FactCompletionService } from "./fact-completion-service.js";
import { FollowupQuestionService } from "./followup-question-service.js";
import { HiringJudgmentService } from "./hiring-judgment-service.js";
import { ProfileGenerationService } from "./profile-generation-service.js";
import { ResumeIngestionService } from "./resume-ingestion-service.js";
import { ResumeRewriteService } from "./resume-rewrite-service.js";
import { ResumeWorkspaceService } from "./resume-workspace-service.js";

export class WorkflowService {
  private readonly ingestionService = new ResumeIngestionService();
  private readonly parserService: ExperienceParserService;
  private readonly factCompletionChatService: FactCompletionChatService;
  private readonly followupQuestionService = new FollowupQuestionService();
  private readonly evidenceGapService = new EvidenceGapService();
  private readonly hiringJudgmentService = new HiringJudgmentService();
  private readonly dossierService = new DossierGenerationService(this.hiringJudgmentService);
  private readonly profileService = new ProfileGenerationService(this.hiringJudgmentService);
  private readonly rewriteService: ResumeRewriteService;
  private readonly resumeWorkspaceService: ResumeWorkspaceService;
  private readonly factCompletionService: FactCompletionService;
  private readonly factCompletionDecisionService: FactCompletionDecisionService;
  private readonly assetGenerationService: AssetGenerationService;
  private readonly draftWorkflowService: DraftWorkflowService;

  constructor(
    private readonly repository: WorkspaceRepository,
    llm: DeepSeekClient,
  ) {
    this.parserService = new ExperienceParserService(llm);
    this.factCompletionChatService = new FactCompletionChatService(llm);
    this.factCompletionDecisionService = new FactCompletionDecisionService(
      this.repository,
      this.evidenceGapService,
    );
    this.rewriteService = new ResumeRewriteService(llm);
    this.resumeWorkspaceService = new ResumeWorkspaceService(
      this.repository,
      this.parserService,
      this.ingestionService,
    );
    this.factCompletionService = new FactCompletionService(
      this.repository,
      this.parserService,
      this.factCompletionChatService,
      this.followupQuestionService,
      this.evidenceGapService,
      this.factCompletionDecisionService,
    );
    this.assetGenerationService = new AssetGenerationService(
      this.repository,
      this.evidenceGapService,
      this.dossierService,
      this.profileService,
      this.rewriteService,
      this.factCompletionDecisionService,
    );
    this.draftWorkflowService = new DraftWorkflowService(
      this.repository,
      (sourceId) => this.assetGenerationService.getLatestResumeRewrite(sourceId),
      (sourceId) => this.factCompletionDecisionService.getOverallCompletion(sourceId).canProceed,
      (sourceId) => this.assetGenerationService.hasValidDossiersAndProfile(sourceId),
      (sourceId) => this.assetGenerationService.canProceedToResumeRewrite(sourceId),
    );
  }

  importTextResume(rawText: string): Promise<CandidateSource> {
    return this.resumeWorkspaceService.importTextResume(rawText);
  }

  importPdfResume(filename: string, fileBytes: Buffer): Promise<CandidateSource> {
    return this.resumeWorkspaceService.importPdfResume(filename, fileBytes);
  }

  getActiveSource(): CandidateSource | null {
    return this.draftWorkflowService.getActiveSource();
  }

  listDrafts(): DraftSummary[] {
    return this.draftWorkflowService.listDrafts();
  }

  startNewDraft(): void {
    this.draftWorkflowService.startNewDraft();
  }

  activateDraft(sourceId: number): CandidateSource {
    return this.draftWorkflowService.activateDraft(sourceId);
  }

  deleteDraft(sourceId: number): CandidateSource {
    return this.draftWorkflowService.deleteDraft(sourceId);
  }

  getExperiences(sourceId: number): ExperienceRecord[] {
    return this.resumeWorkspaceService.getExperiences(sourceId);
  }

  recognizeExperiences(sourceId: number): Promise<ExperienceRecord[]> {
    return this.resumeWorkspaceService.recognizeExperiences(sourceId);
  }

  saveBaselineExperiences(sourceId: number, experiences: ExperienceRecord[]): ExperienceRecord[] {
    return this.resumeWorkspaceService.saveBaselineExperiences(sourceId, experiences);
  }

  selectExperiences(sourceId: number, selectedIds: number[]): void {
    this.resumeWorkspaceService.selectExperiences(sourceId, selectedIds);
    this.factCompletionDecisionService.ensureSelectedStates(sourceId);
  }

  analyzeSelectedExperience(experienceId: number) {
    return this.factCompletionService.analyzeSelectedExperience(experienceId);
  }

  getFactCompletionSnapshot(experienceId: number) {
    return this.factCompletionService.getFactCompletionSnapshot(experienceId);
  }

  reviewFactCompletion(experienceId: number, payload: FactCompletionReviewPayload) {
    return this.factCompletionDecisionService.review(experienceId, payload);
  }

  getOverallCompletion(sourceId: number | null) {
    return this.factCompletionDecisionService.getOverallCompletion(sourceId);
  }

  submitFactCompletionAnswer(experienceId: number, answer: string) {
    return this.factCompletionService.submitFactCompletionAnswer(experienceId, answer);
  }

  streamFactCompletionAnswer(experienceId: number, answer: string) {
    return this.factCompletionService.streamFactCompletionAnswer(experienceId, answer);
  }

  listFactCompletionChat(experienceId: number) {
    return this.factCompletionService.listFactCompletionChat(experienceId);
  }

  shouldRevealFactCompletionGaps(experienceId: number): boolean {
    return this.factCompletionService.shouldRevealFactCompletionGaps(experienceId);
  }

  getFactCompletionPanelNote(experienceId: number): string {
    return this.factCompletionService.getFactCompletionPanelNote(experienceId);
  }

  getVisibleFactCompletionGaps(experienceId: number): EvidenceGap[] {
    return this.factCompletionService.getVisibleFactCompletionGaps(experienceId);
  }

  getFactCompletionEntryChoices(experienceId: number) {
    return this.factCompletionService.getFactCompletionEntryChoices(experienceId);
  }

  generateDossiersAndProfile(sourceId: number): { dossiers: CompanyDossier[]; profile: CandidateProfile } {
    return this.assetGenerationService.generateDossiersAndProfile(sourceId);
  }

  saveGoalSetup(sourceId: number, goalSetup: GoalSetupState): GoalSetupState {
    return this.assetGenerationService.saveGoalSetup(sourceId, goalSetup);
  }

  getGoalSetup(sourceId: number): GoalSetupState | null {
    return this.assetGenerationService.getGoalSetup(sourceId);
  }

  savePositioningDecision(sourceId: number, decision: PositioningDecisionState): PositioningDecisionState {
    return this.assetGenerationService.savePositioningDecision(sourceId, decision);
  }

  getPositioningDecision(sourceId: number): PositioningDecisionState | null {
    return this.assetGenerationService.getPositioningDecision(sourceId);
  }

  rewriteResume(sourceId: number): Promise<ResumeRewriteOutput> {
    return this.assetGenerationService.rewriteResume(sourceId);
  }

  saveResumeRewrite(sourceId: number, rewrite: ResumeRewriteOutput): ResumeRewriteOutput {
    return this.assetGenerationService.saveResumeRewrite(sourceId, rewrite);
  }

  getLatestProfile(sourceId: number): CandidateProfile | null {
    return this.assetGenerationService.getLatestProfile(sourceId);
  }

  getLatestDossiers(sourceId: number, experiences: ExperienceRecord[]): CompanyDossier[] {
    return this.assetGenerationService.getLatestDossiers(sourceId, experiences);
  }

  getLatestResumeRewrite(sourceId: number): ResumeRewriteOutput | null {
    return this.assetGenerationService.getLatestResumeRewrite(sourceId);
  }

  stepStatuses(sourceId: number | null): Record<string, boolean> {
    return this.draftWorkflowService.stepStatuses(sourceId);
  }
}
