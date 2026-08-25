import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const candidateSources = sqliteTable("candidate_sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceType: text("source_type").notNull(),
  filename: text("filename"),
  rawText: text("raw_text").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
});

export const experienceRecords = sqliteTable("experience_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: integer("source_id").notNull(),
  company: text("company").notNull(),
  role: text("role").notNull(),
  timeframe: text("timeframe").notNull(),
  rawSummaryJson: text("raw_summary_json").notNull(),
  selected: integer("selected", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("draft"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const chatTurns = sqliteTable("chat_turns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  step: text("step").notNull(),
  experienceId: integer("experience_id"),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
});

export const evidenceGaps = sqliteTable("evidence_gaps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  experienceId: integer("experience_id").notNull(),
  gapType: text("gap_type").notNull(),
  severity: text("severity").notNull(),
  status: text("status").notNull(),
  rationale: text("rationale").notNull(),
  nextQuestion: text("next_question").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const factCompletionStates = sqliteTable("fact_completion_states", {
  experienceId: integer("experience_id").primaryKey(),
  status: text("status").notNull().default("not_started"),
  factVersion: integer("fact_version").notNull().default(0),
  factFingerprint: text("fact_fingerprint").notNull().default(""),
  confirmedSummaryJson: text("confirmed_summary_json"),
  claimRestrictionsJson: text("claim_restrictions_json").notNull().default("[]"),
  confirmedAt: text("confirmed_at"),
  updatedAt: text("updated_at").notNull(),
});

export const generatedAssets = sqliteTable("generated_assets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: integer("source_id"),
  assetType: text("asset_type").notNull(),
  experienceId: integer("experience_id"),
  contentJson: text("content_json").notNull(),
  version: integer("version").notNull(),
  createdAt: text("created_at").notNull(),
});

export const jobTargets = sqliteTable("job_targets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: integer("source_id").notNull().references(() => candidateSources.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  jdText: text("jd_text").notNull().default(""),
  revision: integer("revision").notNull().default(1),
  status: text("status").notNull().default("current"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const jobFitAnalyses = sqliteTable("job_fit_analyses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobTargetId: integer("job_target_id").notNull().references(() => jobTargets.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  runState: text("run_state").notNull(),
  decision: text("decision"),
  validity: text("validity").notNull(),
  insufficientReason: text("insufficient_reason"),
  inputFingerprint: text("input_fingerprint").notNull(),
  inputSnapshotJson: text("input_snapshot_json").notNull(),
  outputJson: text("output_json"),
  errorMessage: text("error_message"),
  diagnosticsJson: text("diagnostics_json"),
  createdAt: text("created_at").notNull(),
});

export const jobTargetResumeRewrites = sqliteTable("job_target_resume_rewrites", {
  jobTargetId: integer("job_target_id").primaryKey().references(() => jobTargets.id, { onDelete: "cascade" }),
  analysisVersion: integer("analysis_version").notNull(),
  revision: integer("revision").notNull().default(1),
  contentJson: text("content_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
