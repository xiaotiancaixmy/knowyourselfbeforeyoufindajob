import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import {
  DeepSeekClient,
  ModelCallError,
  type JsonCompletionResult,
} from "../src/lib/deepseek-client.js";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
  vi.restoreAllMocks();
});

async function setup(withApiKey = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kys-job-fit-"));
  const databasePath = path.join(directory, "app.db");
  const app = await buildApp({
    port: 0,
    databasePath,
    deepseekBaseUrl: "https://api.deepseek.com",
    deepseekModel: "deepseek-chat",
    deepseekApiKey: withApiKey ? "test-key" : undefined,
  });
  cleanups.push(async () => {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const sqlite = new Database(databasePath);
  const now = "2026-08-03T00:00:00.000Z";
  const source = sqlite.prepare(`INSERT INTO candidate_sources (source_type, filename, raw_text, created_at, updated_at, is_active) VALUES ('text', NULL, 'resume', ?, ?, 1)`).run(now, now);
  const sourceId = Number(source.lastInsertRowid);
  const experiencePayload = { businessContext: "AI 产品", projects: ["AI 助手"], responsibilities: ["负责 AI 产品从需求到上线"], outcomes: ["完成核心版本上线"], evidenceNotes: ["协调设计与工程"] };
  const experience = sqlite.prepare(`INSERT INTO experience_records (source_id, company, role, timeframe, raw_summary_json, selected, status, created_at, updated_at) VALUES (?, 'Acme', 'AI 产品经理', '2023-2026', ?, 1, 'ready_for_dossier', ?, ?)`).run(
    sourceId,
    JSON.stringify(experiencePayload),
    now,
    now,
  );
  const experienceId = Number(experience.lastInsertRowid);
  const summary = { context: ["负责 AI 产品业务"], ownership: ["负责 AI 产品从需求到上线"], outcome: ["完成核心版本上线"], depth: ["协调设计与工程"] };
  const factFingerprint = createHash("sha256").update(JSON.stringify({ company: "Acme", role: "AI 产品经理", timeframe: "2023-2026", ...experiencePayload })).digest("hex");
  sqlite.prepare(`INSERT INTO fact_completion_states (experience_id, status, fact_version, fact_fingerprint, confirmed_summary_json, claim_restrictions_json, confirmed_at, updated_at) VALUES (?, 'completed', 2, ?, ?, '[]', ?, ?)`).run(experienceId, factFingerprint, JSON.stringify(summary), now, now);
  const assets = [
    ["positioning_decision", null, { selectedOptionId: "ai-pm", confirmedOptionTitle: "AI 产品经理", keepFocus: "AI 产品落地", avoidEmphasis: "大团队管理", confirmationNote: "" }],
    ["goal_setup", null, { targetRole: "AI 产品经理", mainSellingPoint: "AI 产品落地", biggestQuestion: "岗位适配", doNotOversell: "管理规模" }],
    ["candidate_profile", null, { careerArc: "AI 产品", strongestThemes: ["AI 产品"], weakSpots: [], positioningBoundary: "不夸大管理职责", recommendedMainLane: "AI 产品经理", conservativeTargetStrategy: "基于事实投递" }],
    ["company_dossier", experienceId, { experienceId, factualRecord: "负责 AI 产品从需求到上线", evaluativeJudgment: "有产品落地经验", reusableInterviewAssets: ["AI 产品上线"] }],
  ] as const;
  for (const [assetType, assetExperienceId, content] of assets) {
    sqlite.prepare(`INSERT INTO generated_assets (source_id, asset_type, experience_id, content_json, version, created_at) VALUES (?, ?, ?, ?, 1, ?)`).run(sourceId, assetType, assetExperienceId, JSON.stringify(content), now);
  }
  sqlite.close();
  return { app, databasePath, sourceId, experienceId };
}

describe("job target API", () => {
  it("supports isolated JDs, revision control, idempotent history, stale detection, cascade, and Step 7 gates", async () => {
    const { app, databasePath, sourceId, experienceId } = await setup();
    const created = await app.inject({
      method: "POST",
      url: "/api/job-targets",
      payload: { sourceId, title: "AI 产品经理", jdText: "岗位职责：负责 AI 产品从需求到上线。任职要求：必须具备 AI 产品落地经验。" },
    });
    expect(created.statusCode).toBe(201);
    const target = created.json();

    const second = await app.inject({
      method: "POST",
      url: "/api/job-targets",
      payload: { sourceId, title: "商业化产品经理", jdText: "岗位职责：负责商业化产品的策略设计与跨团队落地。任职要求：必须有完整的商业化定价与收入增长经验。" },
    });
    expect(second.statusCode).toBe(201);
    const listed = await app.inject({ method: "GET", url: `/api/job-targets?sourceId=${sourceId}` });
    expect(listed.json().jobTargets).toHaveLength(2);

    const conflict = await app.inject({
      method: "PUT",
      url: `/api/job-targets/${target.id}`,
      payload: { expectedRevision: 99, title: target.title, jdText: target.jdText },
    });
    expect(conflict.statusCode).toBe(409);

    const firstAnalysis = await app.inject({
      method: "POST",
      url: `/api/job-targets/${target.id}/analyses`,
      payload: { expectedRevision: 1 },
    });
    expect(firstAnalysis.statusCode).toBe(200);
    expect(firstAnalysis.json()).toMatchObject({ version: 1, runState: "succeeded", decision: "apply", validity: "current" });
    expect(firstAnalysis.json()).not.toHaveProperty("score");
    const completedWorkspace = await app.inject({ method: "GET", url: "/api/workspace" });
    expect(completedWorkspace.json().activeStatuses.job_fit_decision).toBe(true);

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/job-targets/${target.id}/analyses`,
      payload: { expectedRevision: 1 },
    });
    expect(duplicate.json().id).toBe(firstAnalysis.json().id);
    expect(duplicate.json().version).toBe(1);

    const generated = await app.inject({
      method: "POST",
      url: `/api/job-targets/${target.id}/resume-rewrite/generate`,
      payload: { analysisVersion: 1 },
    });
    expect(generated.statusCode).toBe(200);
    expect(generated.json()).toMatchObject({ jobTargetId: target.id, analysisVersion: 1, revision: 1 });

    const updated = await app.inject({
      method: "PUT",
      url: `/api/job-targets/${target.id}`,
      payload: { expectedRevision: 1, title: target.title, jdText: `${target.jdText}\n加分项：有海外项目经验优先。` },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().revision).toBe(2);
    expect(updated.json().latestAnalysis.validity).toBe("stale");

    const staleGenerate = await app.inject({
      method: "POST",
      url: `/api/job-targets/${target.id}/resume-rewrite/generate`,
      payload: { analysisVersion: 1 },
    });
    expect(staleGenerate.statusCode).toBe(409);

    const secondAnalysis = await app.inject({
      method: "POST",
      url: `/api/job-targets/${target.id}/analyses`,
      payload: { expectedRevision: 2 },
    });
    expect(secondAnalysis.json()).toMatchObject({ version: 2, decision: "apply" });
    const historical = await app.inject({ method: "GET", url: `/api/job-targets/${target.id}/analyses/1` });
    expect(historical.json().validity).toBe("superseded");

    const conditionalTarget = second.json();
    const conditional = await app.inject({
      method: "POST",
      url: `/api/job-targets/${conditionalTarget.id}/analyses`,
      payload: { expectedRevision: 1 },
    });
    expect(conditional.json()).toMatchObject({ decision: "conditional" });
    const conditionalGate = await app.inject({
      method: "POST",
      url: `/api/job-targets/${conditionalTarget.id}/resume-rewrite/generate`,
      payload: { analysisVersion: 1 },
    });
    expect(conditionalGate.statusCode).toBe(409);

    const sqlite = new Database(databasePath);
    sqlite.prepare("UPDATE fact_completion_states SET claim_restrictions_json = ?, fact_version = 3 WHERE experience_id = ?")
      .run(JSON.stringify([{ code: "ownership_limited", description: "只能表达参与，不得表达负责或主导。" }]), experienceId);
    sqlite.close();
    const conditionalStale = await app.inject({ method: "GET", url: `/api/job-targets/${conditionalTarget.id}/analyses/1` });
    expect(conditionalStale.json().validity).toBe("stale");
    const conditionalReanalysis = await app.inject({ method: "POST", url: `/api/job-targets/${conditionalTarget.id}/analyses`, payload: { expectedRevision: 1 } });
    expect(conditionalReanalysis.json()).toMatchObject({ version: 2, validity: "current" });
    const noGoTarget = await app.inject({
      method: "POST",
      url: "/api/job-targets",
      payload: { sourceId, title: "负责人", jdText: "岗位职责：管理产品团队。任职要求：必须负责 AI 产品从需求到上线。" },
    });
    const noGo = await app.inject({
      method: "POST",
      url: `/api/job-targets/${noGoTarget.json().id}/analyses`,
      payload: { expectedRevision: 1 },
    });
    expect(noGo.json()).toMatchObject({ decision: "no_go" });
    expect(noGo.json().criticalMismatches.length).toBeGreaterThan(0);
    const noGoGate = await app.inject({
      method: "POST",
      url: `/api/job-targets/${noGoTarget.json().id}/resume-rewrite/generate`,
      payload: { analysisVersion: 1 },
    });
    expect(noGoGate.statusCode).toBe(409);

    const deleted = await app.inject({ method: "DELETE", url: `/api/workspace/drafts/${sourceId}` });
    expect(deleted.statusCode).toBe(200);
    const gone = await app.inject({ method: "GET", url: `/api/job-targets/${target.id}` });
    expect(gone.statusCode).toBe(404);
  });

  it("returns structured insufficient reasons", async () => {
    const { app, sourceId } = await setup();
    const created = await app.inject({ method: "POST", url: "/api/job-targets", payload: { sourceId, title: "信息很少", jdText: "产品经理" } });
    const analysis = await app.inject({ method: "POST", url: `/api/job-targets/${created.json().id}/analyses`, payload: { expectedRevision: 1 } });
    expect(analysis.json()).toMatchObject({ decision: "insufficient", insufficientReason: "jd_insufficient" });
  });

  it("keeps the JD and stores redacted diagnostics when model mapping times out", async () => {
    vi.spyOn(DeepSeekClient.prototype, "completeJsonWithDiagnostics").mockImplementation(
      async (_systemPrompt, _userPrompt, attempt) => {
        throw new ModelCallError({
          failureStage: "timeout",
          statusCode: null,
          errorCode: "MODEL_TIMEOUT",
          elapsedMs: 30_001,
          attempt,
          schemaIssues: [],
        });
      },
    );
    const { app, databasePath, sourceId } = await setup(true);
    const created = await app.inject({
      method: "POST",
      url: "/api/job-targets",
      payload: { sourceId, title: "AI 平台产品经理", jdText: "岗位职责：负责 AI 平台产品设计与落地。任职要求：必须具备复杂产品交付经验。" },
    });
    const failed = await app.inject({ method: "POST", url: `/api/job-targets/${created.json().id}/analyses`, payload: { expectedRevision: 1 } });
    expect(failed.statusCode).toBe(503);
    const restored = await app.inject({ method: "GET", url: `/api/job-targets/${created.json().id}` });
    expect(restored.json()).toMatchObject({
      jdText: "岗位职责：负责 AI 平台产品设计与落地。任职要求：必须具备复杂产品交付经验。",
      latestAnalysis: { runState: "failed", decision: null },
    });
    expect(restored.json().latestAnalysis.evidence).toEqual([]);
    const workspace = await app.inject({ method: "GET", url: "/api/workspace" });
    expect(workspace.json().activeStatuses.job_fit_decision).toBe(false);

    const sqlite = new Database(databasePath, { readonly: true });
    const row = sqlite.prepare(
      "SELECT error_message, diagnostics_json FROM job_fit_analyses WHERE job_target_id = ?",
    ).get(created.json().id) as { error_message: string; diagnostics_json: string };
    sqlite.close();
    expect(row.error_message).toBe("岗位分析请求超时，请稍后重试。");
    expect(JSON.parse(row.diagnostics_json)).toMatchObject({
      failureStage: "timeout",
      errorCode: "MODEL_TIMEOUT",
      attempt: 2,
      schemaIssues: [],
    });
    expect(JSON.parse(row.diagnostics_json).attempts).toHaveLength(2);
  });

  it("stores schema issue paths without persisting model output", async () => {
    vi.spyOn(DeepSeekClient.prototype, "completeJsonWithDiagnostics").mockResolvedValue({
      value: { requirements: [] },
      elapsedMs: 18,
    });
    const { app, databasePath, sourceId } = await setup(true);
    const created = await app.inject({
      method: "POST",
      url: "/api/job-targets",
      payload: { sourceId, title: "AI 平台产品经理", jdText: "岗位职责：负责 AI 平台产品设计与落地。任职要求：必须具备复杂产品交付经验。" },
    });

    const failed = await app.inject({
      method: "POST",
      url: `/api/job-targets/${created.json().id}/analyses`,
      payload: { expectedRevision: 1 },
    });

    expect(failed.statusCode).toBe(503);
    const sqlite = new Database(databasePath, { readonly: true });
    const row = sqlite.prepare(
      "SELECT diagnostics_json, output_json FROM job_fit_analyses WHERE job_target_id = ?",
    ).get(created.json().id) as { diagnostics_json: string; output_json: string | null };
    sqlite.close();
    expect(JSON.parse(row.diagnostics_json)).toMatchObject({
      failureStage: "schema_validation",
      errorCode: "MODEL_SCHEMA_INVALID",
      attempt: 2,
    });
    expect(JSON.parse(row.diagnostics_json).schemaIssues).toContain("requirements:too_small");
    expect(row.output_json).toBeNull();
  });

  it("does not mark a pending analysis as a completed job-fit step", async () => {
    let releaseModel!: () => void;
    const pendingModel = new Promise<JsonCompletionResult>((resolve) => {
      releaseModel = () => resolve({ value: { requirements: [] }, elapsedMs: 1 });
    });
    vi.spyOn(DeepSeekClient.prototype, "completeJsonWithDiagnostics").mockReturnValue(pendingModel);
    const { app, databasePath, sourceId } = await setup(true);
    const created = await app.inject({
      method: "POST",
      url: "/api/job-targets",
      payload: {
        sourceId,
        title: "AI 平台产品经理",
        jdText: "岗位职责：负责 AI 平台产品设计与落地。任职要求：必须具备复杂产品交付经验。",
      },
    });

    const analysisRequest = app.inject({
      method: "POST",
      url: `/api/job-targets/${created.json().id}/analyses`,
      payload: { expectedRevision: 1 },
    });
    await vi.waitFor(() => {
      const sqlite = new Database(databasePath, { readonly: true });
      const row = sqlite.prepare("SELECT run_state FROM job_fit_analyses WHERE job_target_id = ?").get(created.json().id) as { run_state?: string } | undefined;
      sqlite.close();
      expect(row?.run_state).toBe("pending");
    });

    const workspace = await app.inject({ method: "GET", url: "/api/workspace" });
    expect(workspace.json().currentJobFitAnalysis).toMatchObject({ runState: "pending", validity: "current", decision: null });
    expect(workspace.json().activeStatuses.job_fit_decision).toBe(false);

    releaseModel();
    expect((await analysisRequest).statusCode).toBe(503);
  });

  it("recovers interrupted pending analyses when the API restarts", async () => {
    const { app, databasePath, sourceId } = await setup();
    const created = await app.inject({
      method: "POST",
      url: "/api/job-targets",
      payload: {
        sourceId,
        title: "AI 平台产品经理",
        jdText: "岗位职责：负责 AI 平台产品设计与落地。任职要求：必须具备复杂产品交付经验。",
      },
    });
    const targetId = created.json().id as number;
    const initialAnalysis = await app.inject({
      method: "POST",
      url: `/api/job-targets/${targetId}/analyses`,
      payload: { expectedRevision: 1 },
    });
    expect(initialAnalysis.statusCode).toBe(200);
    const sqlite = new Database(databasePath);
    sqlite.prepare(`
      UPDATE job_fit_analyses
      SET run_state = 'pending', decision = NULL, output_json = NULL,
          error_message = NULL, diagnostics_json = NULL
      WHERE job_target_id = ?
    `).run(targetId);
    sqlite.close();
    await app.close();

    const restarted = await buildApp({
      port: 0,
      databasePath,
      deepseekBaseUrl: "https://api.deepseek.com",
      deepseekModel: "deepseek-chat",
    });
    cleanups.push(() => restarted.close());
    const restored = await restarted.inject({ method: "GET", url: `/api/job-targets/${targetId}` });

    expect(restored.json().latestAnalysis).toMatchObject({
      runState: "failed",
      decision: null,
      errorMessage: "上次岗位分析因服务中断而未完成，请重试。",
    });
    const diagnosticsDb = new Database(databasePath, { readonly: true });
    const row = diagnosticsDb.prepare("SELECT diagnostics_json FROM job_fit_analyses WHERE job_target_id = ?")
      .get(targetId) as { diagnostics_json: string };
    diagnosticsDb.close();
    expect(JSON.parse(row.diagnostics_json)).toMatchObject({
      failureStage: "interrupted",
      errorCode: "ANALYSIS_INTERRUPTED",
    });
  });
});
