import { z } from "zod";

export const stepKeySchema = z.enum([
  "resume_import",
  "baseline_review",
  "deep_dive_selection",
  "fact_completion",
  "dossier_profile",
  "job_fit_decision",
  "resume_rewrite",
]);

export type StepKey = z.infer<typeof stepKeySchema>;

export const candidateSourceSchema = z.object({
  id: z.number().int(),
  sourceType: z.enum(["text", "pdf"]),
  filename: z.string().nullable(),
  rawText: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  isActive: z.boolean(),
});

export const candidateSourceSummarySchema = candidateSourceSchema.omit({ rawText: true });

export const experienceRecordSchema = z.object({
  id: z.number().int(),
  sourceId: z.number().int(),
  company: z.string(),
  role: z.string(),
  timeframe: z.string(),
  businessContext: z.string(),
  projects: z.array(z.string()),
  responsibilities: z.array(z.string()),
  outcomes: z.array(z.string()),
  evidenceNotes: z.array(z.string()),
  selected: z.boolean(),
  status: z.string(),
});

export const evidenceGapSchema = z.object({
  id: z.number().int(),
  experienceId: z.number().int(),
  gapType: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  status: z.string(),
  rationale: z.string(),
  nextQuestion: z.string(),
});

export const factCompletionStateSchema = z.enum([
  "not_started",
  "collecting",
  "review_ready",
  "limits_review",
  "completed",
  "completed_with_limits",
  "stale",
]);

export const factCompletionQualitySchema = z.enum(["insufficient", "standard", "limited"]);

export const factCoverageSchema = z.object({
  context: z.boolean(),
  ownership: z.boolean(),
  outcome: z.boolean(),
  depth: z.boolean(),
  noBlockingClaims: z.boolean(),
});

export const factSummarySchema = z.object({
  context: z.array(z.string()),
  ownership: z.array(z.string()),
  outcome: z.array(z.string()),
  depth: z.array(z.string()),
});

export const claimRestrictionSchema = z.object({
  code: z.string(),
  description: z.string(),
});

export const factCompletionNextActionSchema = z.object({
  type: z.enum([
    "start",
    "continue",
    "request_review",
    "confirm",
    "continue_key_gap",
    "finish_with_limits",
    "switch_experience",
    "reconfirm",
    "proceed_to_dossier",
  ]),
  label: z.string(),
  prompt: z.string().nullable(),
  experienceId: z.number().int().nullable(),
});

export const factCompletionSchema = z.object({
  experienceId: z.number().int(),
  status: factCompletionStateSchema,
  factVersion: z.number().int().nonnegative(),
  quality: factCompletionQualitySchema,
  systemReady: z.boolean(),
  isTerminal: z.boolean(),
  canProceed: z.boolean(),
  coverage: factCoverageSchema,
  factSummary: factSummarySchema,
  gaps: z.array(evidenceGapSchema),
  claimRestrictions: z.array(claimRestrictionSchema),
  nextAction: factCompletionNextActionSchema,
  confirmedAt: z.string().nullable(),
});

export const overallCompletionItemSchema = z.object({
  experienceId: z.number().int(),
  status: factCompletionStateSchema,
  quality: factCompletionQualitySchema,
  isTerminal: z.boolean(),
});

export const overallCompletionSchema = z.object({
  selectedExperienceIds: z.array(z.number().int()),
  items: z.array(overallCompletionItemSchema),
  completedCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  hasStale: z.boolean(),
  canProceed: z.boolean(),
  nextAction: factCompletionNextActionSchema,
});

export const factCompletionEntryChoiceSchema = z.object({
  label: z.string(),
  draft: z.string(),
});

export const chatTurnSchema = z.object({
  role: z.enum(["assistant", "user"]),
  content: z.string(),
  createdAt: z.string(),
});

export const companyDossierSchema = z.object({
  experienceId: z.number().int(),
  factualRecord: z.string(),
  evaluativeJudgment: z.string(),
  reusableInterviewAssets: z.array(z.string()),
});

export const candidateProfileSchema = z.object({
  careerArc: z.string(),
  strongestThemes: z.array(z.string()),
  weakSpots: z.array(z.string()),
  positioningBoundary: z.string(),
  recommendedMainLane: z.string(),
  conservativeTargetStrategy: z.string(),
});

export const goalSetupStateSchema = z.object({
  targetRole: z.string(),
  mainSellingPoint: z.string(),
  biggestQuestion: z.string(),
  doNotOversell: z.string(),
});

export const positioningDecisionStateSchema = z.object({
  selectedOptionId: z.string().nullable(),
  confirmedOptionTitle: z.string(),
  keepFocus: z.string(),
  avoidEmphasis: z.string(),
  confirmationNote: z.string(),
});

export const resumeRewriteOutputSchema = z.object({
  professionalSummary: z.string(),
  experienceBulletsByExperienceId: z.record(z.string(), z.array(z.string())),
});

export const saveResumeRewritePayloadSchema = resumeRewriteOutputSchema;

export const jobTargetStatusSchema = z.enum(["current", "archived"]);
export const jobFitRunStateSchema = z.enum(["idle", "pending", "succeeded", "failed"]);
export const jobFitDecisionSchema = z.enum(["apply", "conditional", "no_go", "insufficient"]);
export const jobFitValiditySchema = z.enum(["current", "stale", "superseded"]);
export const jobFitInsufficientReasonSchema = z.enum(["jd_insufficient", "facts_insufficient", "both"]);
export const remediationTargetSchema = z.enum(["step_3", "step_4"]);

export const jobFitEvidenceSchema = z.object({
  requirement: z.string().min(1),
  confirmedFact: z.string().min(1),
  experienceId: z.number().int().positive(),
  company: z.string().min(1),
  role: z.string().min(1),
  factVersion: z.number().int().nonnegative(),
}).strict();

export const jobFitGapSchema = z.object({
  requirement: z.string().min(1),
  reason: z.string().min(1),
  importance: z.enum(["hard", "preferred"]),
  remediationTarget: remediationTargetSchema,
  targetExperienceId: z.number().int().positive().nullable(),
  returnAnalysisId: z.number().int().positive(),
}).strict();

export const jobFitCriticalMismatchSchema = z.object({
  requirement: z.string().min(1),
  reason: z.string().min(1),
}).strict();

export const jobFitRecommendedExperienceSchema = z.object({
  experienceId: z.number().int().positive(),
  company: z.string().min(1),
  role: z.string().min(1),
  factVersion: z.number().int().nonnegative(),
  rationale: z.string().min(1),
}).strict();

export const jobFitFactSnapshotSchema = z.object({
  experienceId: z.number().int().positive(),
  company: z.string(),
  role: z.string(),
  factVersion: z.number().int().nonnegative(),
  factSummary: factSummarySchema,
  claimRestrictions: z.array(claimRestrictionSchema),
  factSummaryHash: z.string().min(1),
  claimRestrictionsHash: z.string().min(1),
}).strict();

export const jobFitInputSnapshotSchema = z.object({
  jdId: z.number().int().positive(),
  jdRevision: z.number().int().positive(),
  sourceId: z.number().int().positive(),
  positioningVersion: z.number().int().nonnegative(),
  positioningFingerprint: z.string(),
  selectedExperienceIds: z.array(z.number().int().positive()).max(3),
  experiences: z.array(jobFitFactSnapshotSchema).max(3),
  createdAt: z.string(),
}).strict();

export const jobFitAnalysisSchema = z.object({
  id: z.number().int().positive(),
  jobTargetId: z.number().int().positive(),
  version: z.number().int().positive(),
  runState: jobFitRunStateSchema,
  decision: jobFitDecisionSchema.nullable(),
  validity: jobFitValiditySchema,
  insufficientReason: jobFitInsufficientReasonSchema.nullable(),
  summary: z.string(),
  evidence: z.array(jobFitEvidenceSchema).max(3),
  gaps: z.array(jobFitGapSchema).max(3),
  criticalMismatches: z.array(jobFitCriticalMismatchSchema).max(3),
  recommendedExperiences: z.array(jobFitRecommendedExperienceSchema).max(3),
  claimRestrictions: z.array(claimRestrictionSchema),
  inputSnapshot: jobFitInputSnapshotSchema,
  inputFingerprint: z.string().min(1),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
}).strict().superRefine((analysis, context) => {
  if (analysis.runState === "succeeded" && analysis.decision === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["decision"], message: "成功分析必须包含业务结论。" });
  }
  if (analysis.runState !== "succeeded" && analysis.decision !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["decision"], message: "未成功的分析不得包含业务结论。" });
  }
  if (analysis.decision === "apply" && analysis.evidence.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence"], message: "建议投递必须有已确认事实依据。" });
  }
  if (analysis.decision === "conditional" && analysis.gaps.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["gaps"], message: "补充后再判断必须给出精准补充项。" });
  }
  if (analysis.decision === "no_go" && analysis.criticalMismatches.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["criticalMismatches"], message: "暂不建议投递必须给出关键不匹配。" });
  }
  if (analysis.decision === "insufficient" && analysis.insufficientReason === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["insufficientReason"], message: "信息不足必须提供结构化原因。" });
  }
  if (analysis.decision !== "insufficient" && analysis.insufficientReason !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["insufficientReason"], message: "仅信息不足结论可以包含该原因。" });
  }
});

export const jobTargetSchema = z.object({
  id: z.number().int().positive(),
  sourceId: z.number().int().positive(),
  title: z.string().min(1),
  jdText: z.string(),
  revision: z.number().int().positive(),
  status: jobTargetStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  latestAnalysis: jobFitAnalysisSchema.nullable().optional(),
}).strict();

export const createJobTargetPayloadSchema = z.object({
  sourceId: z.number().int().positive().optional(),
  title: z.string().trim().min(1).max(120),
  jdText: z.string().max(50_000).default(""),
}).strict();

export const updateJobTargetPayloadSchema = z.object({
  expectedRevision: z.number().int().positive(),
  title: z.string().trim().min(1).max(120),
  jdText: z.string().max(50_000),
}).strict();

export const updateJobTargetStatusPayloadSchema = z.object({
  expectedRevision: z.number().int().positive(),
  status: jobTargetStatusSchema,
}).strict();

export const createJobFitAnalysisPayloadSchema = z.object({
  expectedRevision: z.number().int().positive(),
}).strict();

export const jobTargetResumeRewriteSchema = z.object({
  jobTargetId: z.number().int().positive(),
  analysisVersion: z.number().int().positive(),
  revision: z.number().int().positive(),
  content: resumeRewriteOutputSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

export const generateJobTargetResumeRewritePayloadSchema = z.object({
  analysisVersion: z.number().int().positive(),
}).strict();

export const saveJobTargetResumeRewritePayloadSchema = z.object({
  analysisVersion: z.number().int().positive(),
  expectedRevision: z.number().int().nonnegative(),
  content: resumeRewriteOutputSchema,
}).strict();

export const draftSummarySchema = z.object({
  source: candidateSourceSummarySchema,
  statuses: z.record(stepKeySchema, z.boolean()),
  title: z.string(),
  subtitle: z.string(),
  updatedAt: z.string(),
  isActive: z.boolean(),
  goalSetup: goalSetupStateSchema.nullable(),
  positioningDecision: positioningDecisionStateSchema.nullable(),
});

export const workspaceSnapshotSchema = z.object({
  activeSource: candidateSourceSummarySchema.nullable(),
  activeStatuses: z.record(stepKeySchema, z.boolean()),
  selectedExperienceIds: z.array(z.number().int()),
  latestProfile: candidateProfileSchema.nullable(),
  activeGoalSetup: goalSetupStateSchema.nullable(),
  activePositioningDecision: positioningDecisionStateSchema.nullable(),
  overallCompletion: overallCompletionSchema,
  drafts: z.array(draftSummarySchema),
  currentJobTarget: jobTargetSchema.nullable().optional(),
  currentJobFitAnalysis: jobFitAnalysisSchema.nullable().optional(),
});

export const importTextPayloadSchema = z.object({
  rawText: z.string().min(1).max(100_000),
});

export const updateExperiencesPayloadSchema = z.object({
  experiences: z.array(experienceRecordSchema),
});

export const selectExperiencesPayloadSchema = z.object({
  selectedIds: z.array(z.number().int()).min(1).max(3),
});

export const factCompletionMessagePayloadSchema = z.object({
  answer: z.string().min(1).max(20_000),
});

export const factCompletionReviewPayloadSchema = z.object({
  action: z.enum(["request_review", "confirm", "finish_with_limits"]),
  expectedFactVersion: z.number().int().nonnegative(),
});

export const activateDraftPayloadSchema = z.object({
  sourceId: z.number().int(),
});

export const saveGoalSetupPayloadSchema = goalSetupStateSchema;
export const savePositioningDecisionPayloadSchema = positioningDecisionStateSchema;

export const factCompletionSnapshotSchema = z.object({
  signal: z.string(),
  panelNote: z.string(),
  visibleGaps: z.array(evidenceGapSchema),
  conversation: z.array(chatTurnSchema),
  entryChoices: z.array(factCompletionEntryChoiceSchema),
  experience: experienceRecordSchema,
  completion: factCompletionSchema,
  overallCompletion: overallCompletionSchema,
});

export const dossiersSnapshotSchema = z.object({
  dossiers: z.array(companyDossierSchema),
  profile: candidateProfileSchema.nullable(),
  goalSetup: goalSetupStateSchema.nullable(),
  positioningDecision: positioningDecisionStateSchema.nullable(),
  overallCompletion: overallCompletionSchema,
});

export type CandidateSourceDto = z.infer<typeof candidateSourceSchema>;
export type CandidateSourceSummaryDto = z.infer<typeof candidateSourceSummarySchema>;
export type ExperienceRecordDto = z.infer<typeof experienceRecordSchema>;
export type EvidenceGapDto = z.infer<typeof evidenceGapSchema>;
export type FactCompletionState = z.infer<typeof factCompletionStateSchema>;
export type FactCompletionQuality = z.infer<typeof factCompletionQualitySchema>;
export type FactCoverageDto = z.infer<typeof factCoverageSchema>;
export type FactSummaryDto = z.infer<typeof factSummarySchema>;
export type ClaimRestrictionDto = z.infer<typeof claimRestrictionSchema>;
export type FactCompletionNextActionDto = z.infer<typeof factCompletionNextActionSchema>;
export type FactCompletionDto = z.infer<typeof factCompletionSchema>;
export type OverallCompletionDto = z.infer<typeof overallCompletionSchema>;
export type FactCompletionEntryChoiceDto = z.infer<typeof factCompletionEntryChoiceSchema>;
export type ChatTurnDto = z.infer<typeof chatTurnSchema>;
export type CompanyDossierDto = z.infer<typeof companyDossierSchema>;
export type CandidateProfileDto = z.infer<typeof candidateProfileSchema>;
export type GoalSetupStateDto = z.infer<typeof goalSetupStateSchema>;
export type PositioningDecisionStateDto = z.infer<typeof positioningDecisionStateSchema>;
export type ResumeRewriteOutputDto = z.infer<typeof resumeRewriteOutputSchema>;
export type SaveResumeRewritePayloadDto = z.infer<typeof saveResumeRewritePayloadSchema>;
export type JobTargetStatus = z.infer<typeof jobTargetStatusSchema>;
export type JobFitRunState = z.infer<typeof jobFitRunStateSchema>;
export type JobFitDecision = z.infer<typeof jobFitDecisionSchema>;
export type JobFitValidity = z.infer<typeof jobFitValiditySchema>;
export type JobFitInsufficientReason = z.infer<typeof jobFitInsufficientReasonSchema>;
export type JobFitEvidenceDto = z.infer<typeof jobFitEvidenceSchema>;
export type JobFitGapDto = z.infer<typeof jobFitGapSchema>;
export type JobFitCriticalMismatchDto = z.infer<typeof jobFitCriticalMismatchSchema>;
export type JobFitRecommendedExperienceDto = z.infer<typeof jobFitRecommendedExperienceSchema>;
export type JobFitInputSnapshotDto = z.infer<typeof jobFitInputSnapshotSchema>;
export type JobFitAnalysisDto = z.infer<typeof jobFitAnalysisSchema>;
export type JobTargetDto = z.infer<typeof jobTargetSchema>;
export type JobTargetResumeRewriteDto = z.infer<typeof jobTargetResumeRewriteSchema>;
export type CreateJobTargetPayloadDto = z.infer<typeof createJobTargetPayloadSchema>;
export type UpdateJobTargetPayloadDto = z.infer<typeof updateJobTargetPayloadSchema>;
export type SaveJobTargetResumeRewritePayloadDto = z.infer<typeof saveJobTargetResumeRewritePayloadSchema>;
export type DraftSummaryDto = z.infer<typeof draftSummarySchema>;
export type WorkspaceSnapshotDto = z.infer<typeof workspaceSnapshotSchema>;
export type FactCompletionSnapshotDto = z.infer<typeof factCompletionSnapshotSchema>;
export type DossiersSnapshotDto = z.infer<typeof dossiersSnapshotSchema>;
export type FactCompletionReviewPayloadDto = z.infer<typeof factCompletionReviewPayloadSchema>;
