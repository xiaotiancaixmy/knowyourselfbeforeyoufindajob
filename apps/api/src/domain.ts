import type {
  CandidateProfileDto,
  CandidateSourceDto,
  CompanyDossierDto,
  DraftSummaryDto,
  EvidenceGapDto,
  ExperienceRecordDto,
  FactCompletionDto,
  FactCompletionReviewPayloadDto,
  FactCompletionState,
  FactSummaryDto,
  ClaimRestrictionDto,
  OverallCompletionDto,
  GoalSetupStateDto,
  PositioningDecisionStateDto,
  ResumeRewriteOutputDto,
  StepKey,
  JobFitAnalysisDto,
  JobTargetDto,
  JobTargetResumeRewriteDto,
} from "@kys/shared";

export type CandidateSource = CandidateSourceDto;
export type ExperienceRecord = ExperienceRecordDto;
export type EvidenceGap = EvidenceGapDto;
export type FactCompletion = FactCompletionDto;
export type FactCompletionReviewPayload = FactCompletionReviewPayloadDto;
export type FactCompletionStatus = FactCompletionState;
export type FactSummary = FactSummaryDto;
export type ClaimRestriction = ClaimRestrictionDto;
export type OverallCompletion = OverallCompletionDto;
export type CompanyDossier = CompanyDossierDto;
export type CandidateProfile = CandidateProfileDto;
export type GoalSetupState = GoalSetupStateDto;
export type PositioningDecisionState = PositioningDecisionStateDto;
export type ResumeRewriteOutput = ResumeRewriteOutputDto;
export type DraftSummary = DraftSummaryDto;
export type JobTarget = JobTargetDto;
export type JobFitAnalysis = JobFitAnalysisDto;
export type JobTargetResumeRewrite = JobTargetResumeRewriteDto;

export interface ChatTurn {
  role: "assistant" | "user";
  content: string;
  createdAt: string;
}

export interface GeneratedAssetRecord {
  id: number;
  sourceId: number | null;
  assetType: string;
  experienceId: number | null;
  contentJson: string;
  version: number;
  createdAt: string;
}

export interface FactCompletionStateRecord {
  experienceId: number;
  status: FactCompletionStatus;
  factVersion: number;
  factFingerprint: string;
  confirmedSummary: FactSummary | null;
  claimRestrictions: ClaimRestriction[];
  confirmedAt: string | null;
  updatedAt: string;
}

export const STEP_KEYS: StepKey[] = [
  "resume_import",
  "baseline_review",
  "deep_dive_selection",
  "fact_completion",
  "dossier_profile",
  "job_fit_decision",
  "resume_rewrite",
];
