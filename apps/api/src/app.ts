import { Readable } from "node:stream";

import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import {
  activateDraftPayloadSchema,
  factCompletionMessagePayloadSchema,
  factCompletionReviewPayloadSchema,
  importTextPayloadSchema,
  saveGoalSetupPayloadSchema,
  savePositioningDecisionPayloadSchema,
  saveResumeRewritePayloadSchema,
  selectExperiencesPayloadSchema,
  updateExperiencesPayloadSchema,
  createJobFitAnalysisPayloadSchema,
  createJobTargetPayloadSchema,
  generateJobTargetResumeRewritePayloadSchema,
  saveJobTargetResumeRewritePayloadSchema,
  updateJobTargetPayloadSchema,
  updateJobTargetStatusPayloadSchema,
} from "@kys/shared";

import type { AppConfig } from "./config.js";
import type { CandidateSource } from "./domain.js";
import { createDatabase } from "./db/client.js";
import { AppError, BadRequestError } from "./lib/app-error.js";
import { DeepSeekClient } from "./lib/deepseek-client.js";
import { WorkspaceRepository } from "./repositories/workspace-repository.js";
import { JobTargetRepository } from "./repositories/job-target-repository.js";
import { JobFitService } from "./services/job-fit-service.js";
import { WorkflowService } from "./services/workflow-service.js";

export async function buildApp(config: AppConfig) {
  const app = Fastify({ logger: true });
  const allowedOrigins = new Set(
    (config.webOrigin ?? "http://localhost:8501,http://127.0.0.1:8501")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  });
  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 10 * 1024 * 1024,
    },
  });

  const summarizeSource = (source: CandidateSource) => ({
    id: source.id,
    sourceType: source.sourceType,
    filename: source.filename,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    isActive: source.isActive,
  });

  const { sqlite, db } = createDatabase(config.databasePath);
  app.addHook("onClose", async () => sqlite.close());
  const workspaceRepository = new WorkspaceRepository(db);
  const llm = new DeepSeekClient(config);
  const workflow = new WorkflowService(workspaceRepository, llm);
  const jobTargetRepository = new JobTargetRepository(db);
  const recoveredAnalysisCount = jobTargetRepository.recoverInterruptedAnalyses();
  if (recoveredAnalysisCount > 0) {
    app.log.warn({
      event: "job_fit_analyses_recovered",
      recoveredAnalysisCount,
      failureStage: "interrupted",
      errorCode: "ANALYSIS_INTERRUPTED",
    }, "Recovered interrupted job fit analyses");
  }
  const jobFit = new JobFitService(
    jobTargetRepository,
    workspaceRepository,
    llm,
    (sourceId) => workflow.rewriteResume(sourceId),
    (sourceId, content) => workflow.saveResumeRewrite(sourceId, content),
    app.log,
  );

  app.get("/api/health", async () => {
    sqlite.prepare("SELECT 1").get();
    return { ok: true };
  });

  app.get("/api/workspace", async () => {
    const activeSource = workflow.getActiveSource();
    const experiences = activeSource ? workflow.getExperiences(activeSource.id) : [];
    const jobFitContext = activeSource ? jobFit.getCurrentContext(activeSource.id) : { target: null, analysis: null };
    const activeStatuses = workflow.stepStatuses(activeSource?.id ?? null);
    activeStatuses.job_fit_decision = Boolean(
      jobFitContext.analysis?.validity === "current"
      && jobFitContext.analysis.runState === "succeeded"
      && jobFitContext.analysis.decision !== null,
    );
    return {
      activeSource: activeSource ? summarizeSource(activeSource) : null,
      activeStatuses,
      selectedExperienceIds: experiences.filter((experience) => experience.selected).map((experience) => experience.id),
      latestProfile: activeSource ? workflow.getLatestProfile(activeSource.id) : null,
      activeGoalSetup: activeSource ? workflow.getGoalSetup(activeSource.id) : null,
      activePositioningDecision: activeSource ? workflow.getPositioningDecision(activeSource.id) : null,
      overallCompletion: workflow.getOverallCompletion(activeSource?.id ?? null),
      drafts: workflow.listDrafts(),
      currentJobTarget: jobFitContext.target,
      currentJobFitAnalysis: jobFitContext.analysis,
    };
  });

  app.post("/api/job-targets", async (request, reply) => {
    const payload = createJobTargetPayloadSchema.parse(request.body);
    const sourceId = payload.sourceId ?? workflow.getActiveSource()?.id;
    if (!sourceId) throw new BadRequestError("请先导入简历，再保存岗位 JD。");
    reply.code(201);
    return jobFit.create(sourceId, payload.title, payload.jdText);
  });

  app.get("/api/job-targets", async (request) => {
    const rawSourceId = (request.query as { sourceId?: string }).sourceId;
    const sourceId = Number(rawSourceId ?? workflow.getActiveSource()?.id);
    if (!sourceId || !Number.isInteger(sourceId)) {
      if (rawSourceId) throw new BadRequestError("求职方案编号格式不正确。");
      return { jobTargets: [] };
    }
    return { jobTargets: jobFit.list(sourceId) };
  });

  app.get("/api/job-targets/:id", async (request) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestError("岗位编号格式不正确。");
    return jobFit.get(id);
  });

  app.put("/api/job-targets/:id", async (request) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestError("岗位编号格式不正确。");
    const payload = updateJobTargetPayloadSchema.parse(request.body);
    return jobFit.update(id, payload.expectedRevision, payload.title, payload.jdText);
  });

  app.patch("/api/job-targets/:id/status", async (request) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestError("岗位编号格式不正确。");
    const payload = updateJobTargetStatusPayloadSchema.parse(request.body);
    return jobFit.setStatus(id, payload.expectedRevision, payload.status);
  });

  app.post("/api/job-targets/:id/analyses", async (request) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestError("岗位编号格式不正确。");
    const payload = createJobFitAnalysisPayloadSchema.parse(request.body);
    return jobFit.analyze(id, payload.expectedRevision);
  });

  app.get("/api/job-targets/:id/analyses/:version", async (request) => {
    const { id: rawId, version: rawVersion } = request.params as { id: string; version: string };
    const id = Number(rawId);
    const version = Number(rawVersion);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(version) || version <= 0) {
      throw new BadRequestError("岗位或分析版本格式不正确。");
    }
    return jobFit.getAnalysis(id, version);
  });

  app.post("/api/job-targets/:id/resume-rewrite/generate", async (request) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestError("岗位编号格式不正确。");
    const payload = generateJobTargetResumeRewritePayloadSchema.parse(request.body);
    return jobFit.generateResumeRewrite(id, payload.analysisVersion);
  });

  app.get("/api/job-targets/:id/resume-rewrite", async (request) => {
    const id = Number((request.params as { id: string }).id);
    const rawVersion = (request.query as { analysisVersion?: string }).analysisVersion;
    const analysisVersion = rawVersion ? Number(rawVersion) : undefined;
    if (!Number.isInteger(id) || id <= 0 || (rawVersion && (!Number.isInteger(analysisVersion) || analysisVersion! <= 0))) {
      throw new BadRequestError("岗位或分析版本格式不正确。");
    }
    return jobFit.getResumeRewrite(id, analysisVersion);
  });

  app.put("/api/job-targets/:id/resume-rewrite", async (request) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestError("岗位编号格式不正确。");
    const payload = saveJobTargetResumeRewritePayloadSchema.parse(request.body);
    return jobFit.saveResumeRewrite(id, payload.analysisVersion, payload.expectedRevision, payload.content);
  });

  app.post("/api/workspace/start-new", async () => {
    workflow.startNewDraft();
    return { ok: true };
  });

  app.post("/api/workspace/activate", async (request) => {
    const payload = activateDraftPayloadSchema.parse(request.body);
    const source = workflow.activateDraft(payload.sourceId);
    return { source: summarizeSource(source) };
  });

  app.delete("/api/workspace/drafts/:sourceId", async (request) => {
    const sourceId = Number((request.params as { sourceId: string }).sourceId);
    if (!Number.isInteger(sourceId) || sourceId <= 0) {
      throw new BadRequestError("求职方案编号格式不正确。");
    }
    const source = workflow.deleteDraft(sourceId);
    return { ok: true, deletedSourceId: source.id };
  });

  app.put("/api/workspace/goal-setup", async (request) => {
    const activeSource = workflow.getActiveSource();
    if (!activeSource) throw new BadRequestError("请先导入简历，再保存这轮求职判断。");
    const payload = saveGoalSetupPayloadSchema.parse(request.body);
    return workflow.saveGoalSetup(activeSource.id, payload);
  });

  app.put("/api/workspace/positioning-decision", async (request) => {
    const activeSource = workflow.getActiveSource();
    if (!activeSource) throw new BadRequestError("请先导入简历，再确认这轮定位。");
    const payload = savePositioningDecisionPayloadSchema.parse(request.body);
    return workflow.savePositioningDecision(activeSource.id, payload);
  });

  app.post("/api/sources/text", async (request, reply) => {
    const payload = importTextPayloadSchema.parse(request.body);
    const source = await workflow.importTextResume(payload.rawText);
    reply.code(201);
    return { source: summarizeSource(source), experiences: workflow.getExperiences(source.id) };
  });

  app.post("/api/sources/pdf", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      reply.code(400);
      return { message: "请上传 PDF 文件。" };
    }
    const bytes = await file.toBuffer();
    const source = await workflow.importPdfResume(file.filename, bytes);
    reply.code(201);
    return { source: summarizeSource(source), experiences: workflow.getExperiences(source.id) };
  });

  app.get("/api/experiences", async (request) => {
    const rawSourceId = (request.query as { sourceId?: string }).sourceId;
    const sourceId = Number(rawSourceId ?? workflow.getActiveSource()?.id);
    if (rawSourceId !== undefined && Number.isNaN(sourceId)) {
      throw new BadRequestError("简历记录编号格式不正确。");
    }
    if (!sourceId) return { experiences: [] };
    return { experiences: workflow.getExperiences(sourceId) };
  });

  app.post("/api/experiences/recognize", async () => {
    const activeSource = workflow.getActiveSource();
    if (!activeSource) throw new BadRequestError("请先导入简历。");
    return { experiences: await workflow.recognizeExperiences(activeSource.id) };
  });

  app.put("/api/experiences", async (request) => {
    const activeSource = workflow.getActiveSource();
    if (!activeSource) throw new BadRequestError("请先导入简历。");
    const payload = updateExperiencesPayloadSchema.parse(request.body);
    return { experiences: workflow.saveBaselineExperiences(activeSource.id, payload.experiences) };
  });

  app.post("/api/experiences/select", async (request) => {
    const activeSource = workflow.getActiveSource();
    if (!activeSource) throw new BadRequestError("请先导入简历。");
    const payload = selectExperiencesPayloadSchema.parse(request.body);
    workflow.selectExperiences(activeSource.id, payload.selectedIds);
    return { ok: true };
  });

  app.get("/api/fact-completion/:experienceId", async (request) => {
    const experienceId = Number((request.params as { experienceId: string }).experienceId);
    if (Number.isNaN(experienceId)) {
      throw new BadRequestError("经历编号格式不正确。");
    }
    return workflow.getFactCompletionSnapshot(experienceId);
  });

  app.post("/api/fact-completion/:experienceId/messages", async (request) => {
    const experienceId = Number((request.params as { experienceId: string }).experienceId);
    if (Number.isNaN(experienceId)) {
      throw new BadRequestError("经历编号格式不正确。");
    }
    const payload = factCompletionMessagePayloadSchema.parse(request.body);
    const result = await workflow.submitFactCompletionAnswer(experienceId, payload.answer);
    return {
      assistantMessage: result.assistantMessage,
      experience: result.experience,
      gaps: result.gaps,
      conversation: workflow.listFactCompletionChat(experienceId),
      completion: result.completion,
      overallCompletion: result.overallCompletion,
    };
  });

  app.post("/api/fact-completion/:experienceId/confirmation", async (request) => {
    const experienceId = Number((request.params as { experienceId: string }).experienceId);
    if (Number.isNaN(experienceId)) {
      throw new BadRequestError("经历编号格式不正确。");
    }
    const payload = factCompletionReviewPayloadSchema.parse(request.body);
    return workflow.reviewFactCompletion(experienceId, payload);
  });

  app.post("/api/fact-completion/:experienceId/messages/stream", async (request, reply) => {
    const experienceId = Number((request.params as { experienceId: string }).experienceId);
    if (Number.isNaN(experienceId)) {
      throw new BadRequestError("经历编号格式不正确。");
    }
    const payload = factCompletionMessagePayloadSchema.parse(request.body);
    const eventStream = async function* () {
      try {
        for await (const event of workflow.streamFactCompletionAnswer(experienceId, payload.answer)) {
          yield `${JSON.stringify(event)}\n`;
        }
      } catch (error) {
        yield `${JSON.stringify({
          type: "error",
          message: error instanceof AppError ? error.message : "暂时无法获取求职顾问的回复，请稍后重试。",
        })}\n`;
      }
    };

    reply
      .type("application/x-ndjson; charset=utf-8")
      .header("Cache-Control", "no-cache, no-transform")
      .header("X-Accel-Buffering", "no");
    return reply.send(Readable.from(eventStream()));
  });

  app.post("/api/dossiers/generate", async () => {
    const activeSource = workflow.getActiveSource();
    if (!activeSource) throw new BadRequestError("请先导入简历。");
    return {
      ...workflow.generateDossiersAndProfile(activeSource.id),
      goalSetup: workflow.getGoalSetup(activeSource.id),
      positioningDecision: workflow.getPositioningDecision(activeSource.id),
      overallCompletion: workflow.getOverallCompletion(activeSource.id),
    };
  });

  app.get("/api/dossiers", async () => {
    const activeSource = workflow.getActiveSource();
    if (!activeSource) {
      return {
        dossiers: [],
        profile: null,
        goalSetup: null,
        positioningDecision: null,
        overallCompletion: workflow.getOverallCompletion(null),
      };
    }
    const experiences = workflow.getExperiences(activeSource.id).filter((experience) => experience.selected);
    return {
      dossiers: workflow.getLatestDossiers(activeSource.id, experiences),
      profile: workflow.getLatestProfile(activeSource.id),
      goalSetup: workflow.getGoalSetup(activeSource.id),
      positioningDecision: workflow.getPositioningDecision(activeSource.id),
      overallCompletion: workflow.getOverallCompletion(activeSource.id),
    };
  });

  app.post("/api/resume-rewrite/generate", async () => {
    const activeSource = workflow.getActiveSource();
    if (!activeSource) throw new BadRequestError("请先导入简历。");
    return workflow.rewriteResume(activeSource.id);
  });

  app.get("/api/resume-rewrite", async () => {
    const activeSource = workflow.getActiveSource();
    if (!activeSource) return null;
    return workflow.getLatestResumeRewrite(activeSource.id);
  });

  app.put("/api/resume-rewrite", async (request) => {
    const activeSource = workflow.getActiveSource();
    if (!activeSource) throw new BadRequestError("请先导入简历。");
    const payload = saveResumeRewritePayloadSchema.parse(request.body);
    return workflow.saveResumeRewrite(activeSource.id, payload);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.code(error.statusCode).send({ message: error.message });
      return;
    }
    if (error instanceof ZodError) {
      reply.code(400).send({ message: "提交内容有误，请检查后重试。", issues: error.issues });
      return;
    }
    request.log.error({
      err: error,
      event: "unhandled_api_error",
      requestId: request.id,
    }, "Unhandled API error");
    reply.code(500).send({
      message: "服务暂时不可用，请稍后再试。",
      code: "INTERNAL_ERROR",
      requestId: request.id,
    });
  });

  return app;
}
