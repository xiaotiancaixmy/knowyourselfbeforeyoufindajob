import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDatabase } from "../src/db/client.js";
import { DeepSeekClient } from "../src/lib/deepseek-client.js";
import { WorkspaceRepository } from "../src/repositories/workspace-repository.js";
import { ResumeWorkspaceService } from "../src/services/resume-workspace-service.js";
import { ResumeIngestionService } from "../src/services/resume-ingestion-service.js";
import { WorkflowService } from "../src/services/workflow-service.js";

function createWorkflow(llm?: DeepSeekClient) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kys-api-"));
  const databasePath = path.join(directory, "workflow.db");
  const { db, sqlite } = createDatabase(databasePath);
  const repository = new WorkspaceRepository(db);
  const workflow = new WorkflowService(
    repository,
    llm ?? new DeepSeekClient({
      port: 0,
      databasePath,
      deepseekBaseUrl: "https://api.deepseek.com",
      deepseekModel: "deepseek-chat",
    }),
  );
  return { workflow, repository, sqlite, directory };
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

describe("WorkflowService", () => {
  it("imports text resume and returns baseline experiences", async () => {
    const { workflow, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Senior Product Manager | 2022-2024
- Led onboarding redesign for a workflow product
- Improved activation by 18%
    `.trim());

    const experiences = workflow.getExperiences(source.id);

    expect(experiences).toHaveLength(1);
    expect(experiences[0]?.company).toBe("Acme");
    expect(experiences[0]?.outcomes).toContain("Improved activation by 18%");
  });

  it("re-recognizes the stored resume without overwriting the reviewed baseline", async () => {
    const { workflow, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
工作经历
星河科技有限公司 | 高级产品经理 | 2022年03月 - 2024年08月
- 主导企业知识库产品从 0 到 1 上线
    `.trim());
    const current = workflow.getExperiences(source.id);
    workflow.saveBaselineExperiences(source.id, [{
      ...current[0]!,
      company: "用户暂时修改的公司名",
    }]);

    const recognized = await workflow.recognizeExperiences(source.id);

    expect(recognized).toHaveLength(1);
    expect(recognized[0]?.company).toBe("星河科技有限公司");
    expect(recognized[0]?.sourceId).toBe(source.id);
    expect(workflow.getExperiences(source.id)[0]?.company).toBe("用户暂时修改的公司名");
  });

  it("deletes a draft and all source- and experience-level data without affecting other drafts", async () => {
    const { workflow, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const sourceToDelete = await workflow.importTextResume(
      "Acme | Product Manager | 2022-2024\n- Led onboarding redesign\n- Improved activation by 18%",
    );
    const experienceId = workflow.getExperiences(sourceToDelete.id)[0]!.id;
    workflow.selectExperiences(sourceToDelete.id, [experienceId]);
    workflow.analyzeSelectedExperience(experienceId);
    const sourceToKeep = await workflow.importTextResume(
      "Beta | Senior Product Manager | 2024-2026\n- Led product strategy",
    );

    workflow.deleteDraft(sourceToDelete.id);

    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM candidate_sources WHERE id = ?").get(sourceToDelete.id)).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM experience_records WHERE source_id = ?").get(sourceToDelete.id)).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM generated_assets WHERE source_id = ? OR experience_id = ?").get(sourceToDelete.id, experienceId)).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM chat_turns WHERE experience_id = ?").get(experienceId)).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM evidence_gaps WHERE experience_id = ?").get(experienceId)).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM fact_completion_states WHERE experience_id = ?").get(experienceId)).toEqual({ count: 0 });
    expect(workflow.getActiveSource()?.id).toBe(sourceToKeep.id);
    expect(workflow.listDrafts()).toHaveLength(1);
  });

  it("excludes summary sections and parses multiple Chinese work experiences with joined headers", async () => {
    const { workflow, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
个人总结
8 年 SaaS 与 AI 产品经验，擅长从 0 到 1 搭建产品与增长闭环。
工作经历
星河科技有限公司2022年03月 - 2024年08月
高级产品经理杭州
主导企业知识库产品从 0 到 1 上线，推动设计与研发协作。
业务效果：客户激活率提升 25%。
远山智能
产品负责人
2020年01月 - 2022年02月
负责智能客服产品规划与交付。
教育经历
浙江大学2016年09月 - 2020年06月
计算机科学 本科
技能
Figma、SQL、Python
    `.trim());

    const experiences = workflow.getExperiences(source.id);

    expect(experiences.map((experience) => experience.company)).toEqual([
      "星河科技有限公司",
      "远山智能",
    ]);
    expect(experiences.map((experience) => experience.role)).toEqual([
      "高级产品经理",
      "产品负责人",
    ]);
    expect(experiences.map((experience) => experience.timeframe)).toEqual([
      "2022年03月 - 2024年08月",
      "2020年01月 - 2022年02月",
    ]);
    expect(experiences.every((experience) => experience.timeframe !== "Unknown timeframe")).toBe(true);
    expect(experiences.some((experience) => experience.company.includes("个人总结"))).toBe(false);
    expect(experiences.some((experience) => experience.company.includes("浙江大学"))).toBe(false);
  });

  it("parses real PDF-style line breaks without treating the summary as employment", async () => {
    const { workflow, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
个人总结
11年海外背景的增长型 AI 产品负责人，7年深耕 SaaS 与 AI 效率赛道。
工作经历
计算美学2025年12月 - 2026年03月
AI 产品经理杭州
主导跨模态内容生成引擎研发，迭代周期从 14 天压缩至 7 天。
久痕科技有限公司2024年08月 - 2025年12月
资深产品经理杭州
主导 remio 核心功能从 0 到 1 规划与落地，DAU 增长 30%。
Porsche Digital China2024年03月 - 2024年08月
商业数据分析 产品研发上海
通过 cohort 分析定位影响留存的关键环节。
Foodhwy Canada Inc （后被 Steer Technologies Inc 收购）2019年06月 - 2023年06月
产品经理 R&D多伦多
主导骑手侧调度与接单系统设计。
教育经历
多伦多大学2015年09月 - 2019年06月
金融 本科
    `.trim());

    const experiences = workflow.getExperiences(source.id);

    expect(experiences.map((experience) => experience.company)).toEqual([
      "计算美学",
      "久痕科技有限公司",
      "Porsche Digital China",
      "Foodhwy Canada Inc (后被 Steer Technologies Inc 收购)",
    ]);
    expect(experiences.map((experience) => experience.timeframe)).toEqual([
      "2025年12月 - 2026年03月",
      "2024年08月 - 2025年12月",
      "2024年03月 - 2024年08月",
      "2019年06月 - 2023年06月",
    ]);
    expect(experiences.some((experience) => experience.company === "个人总结")).toBe(false);
    expect(experiences.some((experience) => experience.company.includes("多伦多大学"))).toBe(false);
  });

  it("rejects invalid LLM experiences and falls back to source-grounded work records", async () => {
    const llm = {
      enabled: true,
      completeText: vi.fn(),
      completeJson: vi.fn().mockResolvedValue({
        experiences: [
          {
            company: "个人总结",
            role: "8 年 SaaS 与 AI 产品经验，擅长从 0 到 1 搭建产品与增长闭环。",
            timeframe: "Unknown timeframe",
            business_context: "个人总结",
            projects: [],
            responsibilities: [],
            outcomes: [],
          },
        ],
      }),
    } as unknown as DeepSeekClient;
    const { workflow, sqlite, directory } = createWorkflow(llm);
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
职业概述
8 年 SaaS 与 AI 产品经验。
工作经验
甲方科技2021.04-2023.06
产品经理 北京
负责企业协作产品。
乙方智能2023.07-至今
高级产品经理 上海
主导 AI 助手产品。
项目经历
企业知识库升级
    `.trim());

    expect(workflow.getExperiences(source.id).map((experience) => experience.company)).toEqual([
      "甲方科技",
      "乙方智能",
    ]);
  });

  it("does not fabricate an experience when work signals are insufficient", async () => {
    const { workflow, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    await expect(
      workflow.importTextResume("个人总结\n热爱产品，善于沟通。\n技能\nFigma、SQL"),
    ).rejects.toThrow("公司、岗位和任职时间");
  });

  it("starts fact completion with warm recall and entry choices", async () => {
    const { workflow, repository, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Senior Product Manager | 2022-2024
- Led onboarding redesign for a workflow product
- Improved activation by 18%
    `.trim());
    const [experience] = workflow.getExperiences(source.id);
    workflow.selectExperiences(source.id, [experience!.id]);

    const snapshot = workflow.getFactCompletionSnapshot(experience!.id);
    const turns = workflow.listFactCompletionChat(experience!.id);
    const entryChoices = workflow.getFactCompletionEntryChoices(experience!.id);

    expect(snapshot.signal).toContain("Acme");
    expect(snapshot.conversation[0]?.content).toContain("我们先回忆");
    expect(turns).toHaveLength(0);
    expect(repository.listEvidenceGaps(experience!.id)).toHaveLength(0);
    expect(entryChoices.length).toBeGreaterThanOrEqual(2);
    expect(entryChoices[0]?.label).toBeTruthy();
    expect(entryChoices.some((choice) => choice.label.includes("Led onboarding redesign for a workflow product"))).toBe(true);
  });

  it("filters lifecycle claims from legacy assistant turns without dropping user messages or facts", async () => {
    const { workflow, repository, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Product Manager | 2022-2024
- 参与内部工具优化
    `.trim());
    const [experience] = workflow.getExperiences(source.id);
    workflow.selectExperiences(source.id, [experience!.id]);
    repository.createChatTurn(
      "fact_completion",
      "assistant",
      "已记录你参与内部工具测试的事实，这段已经完成用户研究访谈。现在可以进入下一步。",
      experience!.id,
    );
    repository.createChatTurn(
      "fact_completion",
      "user",
      "我当时主要是协助测试，并整理反馈，没有负责整体方案。",
      experience!.id,
    );
    repository.createChatTurn(
      "fact_completion",
      "assistant",
      "事实边界是参与测试和整理反馈，后续流程已经解锁。",
      experience!.id,
    );

    const snapshot = workflow.getFactCompletionSnapshot(experience!.id);
    const listed = workflow.listFactCompletionChat(experience!.id);

    expect(snapshot.conversation).toEqual(listed);
    expect(snapshot.conversation.find((turn) => turn.role === "user")?.content).toBe(
      "我当时主要是协助测试，并整理反馈，没有负责整体方案。",
    );
    expect(snapshot.conversation.map((turn) => turn.content).join("\n")).toContain(
      "已记录你参与内部工具测试的事实",
    );
    expect(snapshot.conversation.map((turn) => turn.content).join("\n")).toContain(
      "这段已经完成用户研究访谈",
    );
    expect(snapshot.conversation.map((turn) => turn.content).join("\n")).toContain(
      "事实边界是参与测试和整理反馈",
    );
    expect(snapshot.conversation.map((turn) => turn.content).join("\n")).not.toMatch(
      /可以进入下一步|流程已经解锁/u,
    );
  });

  it("streams one fact completion reply at a time for each experience", async () => {
    const { workflow, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Senior Product Manager | 2022-2024
- Led onboarding redesign for a workflow product
- Improved activation by 18%
    `.trim());
    const [experience] = workflow.getExperiences(source.id);
    workflow.selectExperiences(source.id, [experience!.id]);

    const firstStream = workflow.streamFactCompletionAnswer(experience!.id, "我负责梳理 onboarding 的关键路径，并协调设计和工程上线。");
    const firstEvent = await firstStream.next();
    expect(firstEvent.value?.type).toBe("delta");

    const duplicateStream = workflow.streamFactCompletionAnswer(experience!.id, "重复发送的内容");
    await expect(duplicateStream.next()).rejects.toThrow("上一条内容仍在处理中");

    await firstStream.return(undefined);
  });

  it("does not loop on the same decision question after the user answers it", async () => {
    const { workflow, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Senior Product Manager | 2022-2024
- Led onboarding redesign for a workflow product
- Improved activation by 18%
- Coordinated design and engineering to ship the new flow
    `.trim());
    const [experience] = workflow.getExperiences(source.id);
    workflow.selectExperiences(source.id, [experience!.id]);

    workflow.getFactCompletionSnapshot(experience!.id);
    await workflow.submitFactCompletionAnswer(
      experience!.id,
      "我当时主要负责的是重新梳理 onboarding 路径，和设计、工程一起把关键流失点找出来。",
    );

    const result = await workflow.submitFactCompletionAnswer(
      experience!.id,
      "最先抓住的重点是先验证用户路径里哪一步最容易流失，再决定先改哪一段 onboarding。",
    );

    expect(result.gaps.some((gap) => gap.gapType === "decision")).toBe(false);
    expect(result.assistantMessage).not.toContain("当时你最先抓住、最想优先处理的重点是什么？");
  });

  it("uses chat model output during fact completion when DeepSeek is available", async () => {
    const llm = {
      enabled: true,
      completeText: vi.fn(),
      completeJson: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          businessContext: "负责 remio onboarding 关键路径优化，目标是降低激活流失。",
          responsibilities: ["主导 onboarding 关键流失节点诊断与改版方案收敛"],
          outcomes: ["激活路径判断更清晰，先锁定最高流失步骤再推进改版"],
          evidenceNotes: ["关键判断：先找最高流失步骤，再决定先改哪一段 onboarding"],
          projects: ["onboarding 关键路径优化"],
          assistantMessage: "这次你已经把关键判断讲清楚了。用招聘视角看，这里开始有比较成立的 judgment 和 ownership。下一步我想再轻轻补一个点：当时为了先改哪一段，你主要平衡了什么？",
        }),
    } as unknown as DeepSeekClient;

    const { workflow, sqlite, directory } = createWorkflow(llm);
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Senior Product Manager | 2022-2024
- Led onboarding redesign for a workflow product
- Improved activation by 18%
    `.trim());
    const [experience] = workflow.getExperiences(source.id);
    workflow.selectExperiences(source.id, [experience!.id]);
    workflow.getFactCompletionSnapshot(experience!.id);

    const result = await workflow.submitFactCompletionAnswer(
      experience!.id,
      "最先抓住的重点是先验证用户路径里哪一步最容易流失，再决定先改哪一段 onboarding。",
    );

    expect(result.experience.evidenceNotes.some((note) => note.includes("关键判断"))).toBe(true);
    expect(result.experience.responsibilities).toContain("主导 onboarding 关键流失节点诊断与改版方案收敛");
    expect(result.assistantMessage).toContain("judgment");
    expect(result.assistantMessage).toContain("下一步我想再轻轻补一个点");
  });

  it("keeps multiple drafts and can switch the active draft", async () => {
    const { workflow, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const first = await workflow.importTextResume(`
Acme | Senior Product Manager | 2022-2024
- Led onboarding redesign
    `.trim());
    workflow.startNewDraft();
    const second = await workflow.importTextResume(`
Beta | Product Lead | 2024-2026
- Built a new internal tool
    `.trim());

    const drafts = workflow.listDrafts();
    expect(drafts).toHaveLength(2);
    expect(workflow.getActiveSource()?.id).toBe(second.id);

    workflow.activateDraft(first.id);
    expect(workflow.getActiveSource()?.id).toBe(first.id);
    expect(workflow.getExperiences(first.id)[0]?.company).toBe("Acme");
  });

  it("does not leave a partial draft behind when parsing fails", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kys-api-"));
    const databasePath = path.join(directory, "workflow.db");
    const { db, sqlite } = createDatabase(databasePath);
    const repository = new WorkspaceRepository(db);
    const service = new ResumeWorkspaceService(
      repository,
      {
        parse: vi.fn().mockRejectedValue(new Error("parser failed")),
      } as never,
      new ResumeIngestionService(),
    );
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    await expect(service.importTextResume("broken resume")).rejects.toThrow("parser failed");
    expect(repository.listSources()).toHaveLength(0);
    expect(repository.getActiveSource()).toBeNull();
  });

  it("marks a confirmed experience stale when baseline facts change", async () => {
    const { workflow, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Senior Product Manager | 2022-2024
- Led onboarding redesign for a workflow product
- Improved activation by 18%
    `.trim());
    const [experience] = workflow.saveBaselineExperiences(source.id, [
      {
        ...workflow.getExperiences(source.id)[0]!,
        businessContext: "负责 onboarding 激活路径。",
        responsibilities: ["主导路径判断并推动上线"],
        outcomes: ["activation 提升 18%"],
        evidenceNotes: ["关键判断：先处理最高流失节点"],
      },
    ]);
    workflow.selectExperiences(source.id, [experience!.id]);
    const review = workflow.reviewFactCompletion(experience!.id, {
      action: "request_review",
      expectedFactVersion: 0,
    });
    workflow.reviewFactCompletion(experience!.id, {
      action: "confirm",
      expectedFactVersion: review.completion.factVersion,
    });

    const [updated] = workflow.saveBaselineExperiences(source.id, [
      {
        ...workflow.getExperiences(source.id)[0]!,
        company: "Acme Updated",
      },
    ]);

    expect(updated!.id).toBe(experience!.id);
    expect(workflow.getFactCompletionSnapshot(experience!.id).completion.status).toBe("stale");
    expect(workflow.getOverallCompletion(source.id).canProceed).toBe(false);
  });

  it("records applied schema migrations on database bootstrap", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kys-api-"));
    const databasePath = path.join(directory, "workflow.db");
    const { sqlite } = createDatabase(databasePath);
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const migrations = sqlite.prepare("SELECT version, name FROM schema_migrations ORDER BY version ASC").all() as Array<{
      version: number;
      name: string;
    }>;

    expect(migrations).toEqual([
      { version: 1, name: "init_workspace_schema" },
      { version: 2, name: "add_canonical_fact_completion_states" },
      { version: 3, name: "add_job_fit_decision_workspace" },
      { version: 4, name: "add_job_fit_failure_diagnostics" },
    ]);
  });

  it("adds canonical completion state without losing legacy multi-draft data", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kys-api-legacy-"));
    const databasePath = path.join(directory, "workflow.db");
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (1, 'init_workspace_schema', '2026-07-01T00:00:00.000Z');
      CREATE TABLE candidate_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL,
        filename TEXT,
        raw_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO candidate_sources
        (source_type, filename, raw_text, created_at, updated_at, is_active)
      VALUES
        ('text', NULL, 'draft one', '2026-07-01', '2026-07-01', 0),
        ('text', NULL, 'draft two', '2026-07-02', '2026-07-02', 1);
    `);
    legacy.close();

    const { sqlite } = createDatabase(databasePath);
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const drafts = sqlite.prepare("SELECT raw_text FROM candidate_sources ORDER BY id").all();
    const completionTable = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'fact_completion_states'")
      .get();
    expect(drafts).toEqual([{ raw_text: "draft one" }, { raw_text: "draft two" }]);
    expect(completionTable).toEqual({ name: "fact_completion_states" });
  });

  it("uses saved goal setup and positioning decision in profile and rewrite generation", async () => {
    const { workflow, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Senior Product Manager | 2022-2024
- Led onboarding redesign for a workflow product
- Improved activation by 18%
    `.trim());

    const [experience] = workflow.saveBaselineExperiences(source.id, [
      {
        ...workflow.getExperiences(source.id)[0]!,
        businessContext: "负责 AI workflow onboarding 关键路径优化，目标是降低激活流失。",
        projects: ["AI workflow onboarding"],
        responsibilities: [
          "主导判断先改最高流失节点，并推动设计、工程和运营协调上线",
          "负责 onboarding 方案收敛与 stakeholder alignment",
        ],
        outcomes: ["activation 提升 18%"],
        evidenceNotes: [
          "tradeoff: 在速度、质量和资源优先级之间反复平衡",
          "问题: 上线前遇到阻力，后来调整方案并复盘",
        ],
        selected: false,
        status: "draft",
      },
    ]);

    workflow.saveGoalSetup(source.id, {
      targetRole: "AI Agent 产品经理",
      mainSellingPoint: "AI workflow 与关键判断",
      biggestQuestion: "怎么把主导度讲得更成立",
      doNotOversell: "大团队管理",
    });

    workflow.selectExperiences(source.id, [experience!.id]);
    const firstReview = workflow.reviewFactCompletion(experience!.id, {
      action: "request_review",
      expectedFactVersion: 0,
    });
    workflow.reviewFactCompletion(experience!.id, {
      action: "confirm",
      expectedFactVersion: firstReview.completion.factVersion,
    });
    const generated = workflow.generateDossiersAndProfile(source.id);

    expect(generated.profile.careerArc).toContain("AI Agent 产品经理");
    expect(generated.profile.positioningBoundary).toContain("大团队管理");

    workflow.savePositioningDecision(source.id, {
      selectedOptionId: "recommended-main-lane",
      confirmedOptionTitle: "AI Agent 产品经理",
      keepFocus: "AI workflow 与关键判断",
      avoidEmphasis: "大团队管理",
      confirmationNote: "",
    });

    const rewrite = await workflow.rewriteResume(source.id);
    expect(rewrite.professionalSummary).toContain("AI Agent 产品经理");
    expect(rewrite.professionalSummary).toContain("大团队管理");
    expect(rewrite.professionalSummary).toContain("AI workflow 与关键判断");
    expect(generated.dossiers[0]?.evaluativeJudgment).toContain("目标方向");
  });

  it("treats re-submitting the same selected id set as a no-op", async () => {
    const { workflow, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Product Manager | 2020-2022
- 参与内部工具优化

Beta | Product Manager | 2022-2024
- 协助增长项目测试
    `.trim());
    const experiences = workflow.getExperiences(source.id);
    workflow.selectExperiences(source.id, experiences.map((experience) => experience.id));
    for (const experience of experiences) {
      const review = workflow.reviewFactCompletion(experience.id, {
        action: "request_review",
        expectedFactVersion: 0,
      });
      workflow.reviewFactCompletion(experience.id, {
        action: "finish_with_limits",
        expectedFactVersion: review.completion.factVersion,
      });
    }

    const generated = workflow.generateDossiersAndProfile(source.id);
    const positioning = workflow.savePositioningDecision(source.id, {
      selectedOptionId: "recommended-main-lane",
      confirmedOptionTitle: generated.profile.recommendedMainLane,
      keepFocus: "有限信息下的真实项目参与",
      avoidEmphasis: "端到端 ownership",
      confirmationNote: "",
    });
    const rewrite = await workflow.rewriteResume(source.id);

    workflow.selectExperiences(source.id, [...experiences].reverse().map((experience) => experience.id));

    expect(workflow.getLatestDossiers(source.id, workflow.getExperiences(source.id))).toEqual(generated.dossiers);
    expect(workflow.getLatestProfile(source.id)).toEqual(generated.profile);
    expect(workflow.getPositioningDecision(source.id)).toEqual(positioning);
    expect(workflow.getLatestResumeRewrite(source.id)).toEqual(rewrite);

    workflow.selectExperiences(source.id, [experiences[0]!.id]);
    expect(workflow.getLatestDossiers(source.id, workflow.getExperiences(source.id))).toEqual([]);
    expect(workflow.getLatestProfile(source.id)).toBeNull();
    expect(workflow.getPositioningDecision(source.id)).toBeNull();
    expect(workflow.getLatestResumeRewrite(source.id)).toBeNull();
  });

  it("uses chat model output during resume rewrite when DeepSeek is available", async () => {
    const llmCompleteJson = vi
      .fn()
      .mockResolvedValueOnce(null);

    const llm = {
      enabled: true,
      completeText: vi.fn(),
      completeJson: llmCompleteJson,
    } as unknown as DeepSeekClient;

    const { workflow, sqlite, directory } = createWorkflow(llm);
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Senior Product Manager | 2022-2024
- Led onboarding redesign for a workflow product
- Improved activation by 18%
    `.trim());

    const [experience] = workflow.saveBaselineExperiences(source.id, [
      {
        ...workflow.getExperiences(source.id)[0]!,
        businessContext: "负责 AI workflow onboarding 关键路径优化，目标是降低激活流失。",
        projects: ["AI workflow onboarding"],
        responsibilities: ["主导 onboarding 方案收敛", "推动设计与工程协同上线"],
        outcomes: ["activation 提升 18%"],
        evidenceNotes: ["tradeoff: 在速度、质量和资源优先级之间平衡"],
        selected: false,
        status: "draft",
      },
    ]);

    workflow.saveGoalSetup(source.id, {
      targetRole: "AI Agent 产品经理",
      mainSellingPoint: "AI workflow 与关键判断",
      biggestQuestion: "怎么把主导度讲得更成立",
      doNotOversell: "大团队管理",
    });
    workflow.selectExperiences(source.id, [experience!.id]);
    const secondReview = workflow.reviewFactCompletion(experience!.id, {
      action: "request_review",
      expectedFactVersion: 0,
    });
    workflow.reviewFactCompletion(experience!.id, {
      action: "confirm",
      expectedFactVersion: secondReview.completion.factVersion,
    });
    workflow.generateDossiersAndProfile(source.id);
    workflow.savePositioningDecision(source.id, {
      selectedOptionId: "recommended-main-lane",
      confirmedOptionTitle: "AI Agent 产品经理",
      keepFocus: "AI workflow 与关键判断",
      avoidEmphasis: "大团队管理",
      confirmationNote: "",
    });

    llmCompleteJson.mockResolvedValueOnce({
      professionalSummary: "AI Agent 产品经理方向，主打 AI workflow 与关键判断，强调可验证结果与真实 ownership。",
      experienceBulletsByExperienceId: {
        [String(experience!.id)]: [
          "主导 AI workflow onboarding 关键路径判断，先锁定最高流失节点，再推动设计与工程快速落地。",
          "围绕 activation 提升目标收敛方案，在速度、质量和资源优先级之间做取舍。",
        ],
      },
    });

    const rewrite = await workflow.rewriteResume(source.id);
    const rewritePrompt = llmCompleteJson.mock.calls.at(-1)?.[0] ?? "";
    expect(rewrite.professionalSummary).toContain("AI Agent 产品经理");
    expect(rewrite.experienceBulletsByExperienceId[String(experience!.id)]?.[0]).toContain("关键路径判断");
    expect(rewritePrompt).toContain("符合中国招聘市场的阅读习惯");
    expect(rewritePrompt).toContain("不强行套用 STAR、CAR 等固定结构");
    expect(rewritePrompt).toContain("不直接暴露“能力边界”“保守定位”等内部判断");
  });

  it("requires user confirmation after the system marks an experience review ready", async () => {
    const { workflow, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Senior Product Manager | 2022-2024
- Led onboarding redesign for a workflow product
- Improved activation by 18%
    `.trim());
    const [experience] = workflow.saveBaselineExperiences(source.id, [
      {
        ...workflow.getExperiences(source.id)[0]!,
        businessContext: "负责 workflow 产品的 onboarding 激活路径。",
        projects: ["onboarding 改版"],
        responsibilities: ["主导关键路径判断并推动设计和工程上线"],
        outcomes: ["activation 提升 18%"],
        evidenceNotes: ["关键判断：先验证最高流失节点，再决定改版优先级"],
      },
    ]);
    workflow.selectExperiences(source.id, [experience!.id]);

    const review = workflow.reviewFactCompletion(experience!.id, {
      action: "request_review",
      expectedFactVersion: 0,
    });

    expect(review.completion.status).toBe("review_ready");
    expect(review.overallCompletion.canProceed).toBe(false);
    expect(workflow.stepStatuses(source.id).fact_completion).toBe(false);

    const confirmed = workflow.reviewFactCompletion(experience!.id, {
      action: "confirm",
      expectedFactVersion: review.completion.factVersion,
    });

    expect(confirmed.completion.status).toBe("completed");
    expect(confirmed.overallCompletion.canProceed).toBe(true);
    expect(workflow.stepStatuses(source.id).fact_completion).toBe(true);
  });

  it("finishes with explicit claim restrictions when facts remain limited", async () => {
    const { workflow, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Product Manager | 2022-2024
- 参与内部工具优化
    `.trim());
    const [experience] = workflow.getExperiences(source.id);
    workflow.selectExperiences(source.id, [experience!.id]);

    const limitsReview = workflow.reviewFactCompletion(experience!.id, {
      action: "request_review",
      expectedFactVersion: 0,
    });
    expect(limitsReview.completion.status).toBe("limits_review");

    const limited = workflow.reviewFactCompletion(experience!.id, {
      action: "finish_with_limits",
      expectedFactVersion: limitsReview.completion.factVersion,
    });

    expect(limited.completion.status).toBe("completed_with_limits");
    expect(limited.completion.claimRestrictions.map((item) => item.code)).toContain("outcome_unverified");
    expect(limited.completion.claimRestrictions.map((item) => item.code)).toContain("ownership_limited");
    expect(limited.overallCompletion.canProceed).toBe(true);

    const generated = workflow.generateDossiersAndProfile(source.id);
    expect(generated.dossiers[0]?.reusableInterviewAssets.join("\n")).toContain("参与内部工具优化");
    expect(generated.dossiers[0]?.reusableInterviewAssets.join("\n")).not.toMatch(/我负责|主导\s*\/\s*负责/u);
    expect(generated.profile.positioningBoundary).toContain("只保留参与或协助口径");

    workflow.savePositioningDecision(source.id, {
      selectedOptionId: "recommended-main-lane",
      confirmedOptionTitle: generated.profile.recommendedMainLane,
      keepFocus: "内部工具项目经验",
      avoidEmphasis: "端到端 ownership",
      confirmationNote: "",
    });
    const rewrite = await workflow.rewriteResume(source.id);
    const rewriteText = JSON.stringify(rewrite);
    expect(rewriteText).toContain("参与内部工具优化");
    expect(rewriteText).not.toMatch(/主导|牵头|统筹|负责/u);
  });

  it("rejects LLM rewrite claims that upgrade limited ownership", async () => {
    const llmCompleteJson = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        professionalSummary: "核心操盘内部工具产品，全程推进方案落地。",
        experienceBulletsByExperienceId: {
          "1": ["独立设计内部工具方案并推动落地。"],
        },
      });
    const llm = {
      enabled: true,
      completeText: vi.fn(),
      completeJson: llmCompleteJson,
    } as unknown as DeepSeekClient;
    const { workflow, sqlite, directory } = createWorkflow(llm);
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Product Manager | 2022-2024
- 协助内部工具测试
    `.trim());
    const [experience] = workflow.getExperiences(source.id);
    workflow.selectExperiences(source.id, [experience!.id]);
    const review = workflow.reviewFactCompletion(experience!.id, {
      action: "request_review",
      expectedFactVersion: 0,
    });
    workflow.reviewFactCompletion(experience!.id, {
      action: "finish_with_limits",
      expectedFactVersion: review.completion.factVersion,
    });
    const generated = workflow.generateDossiersAndProfile(source.id);
    workflow.savePositioningDecision(source.id, {
      selectedOptionId: "recommended-main-lane",
      confirmedOptionTitle: generated.profile.recommendedMainLane,
      keepFocus: "内部工具项目经验",
      avoidEmphasis: "端到端 ownership",
      confirmationNote: "",
    });

    const rewrite = await workflow.rewriteResume(source.id);
    const rewriteText = JSON.stringify(rewrite);
    const rewritePrompt = llmCompleteJson.mock.calls.at(-1)?.join("\n") ?? "";

    expect(rewritePrompt).toContain("各段经历的写作限制");
    expect(rewritePrompt).toContain("ownership_limited");
    expect(rewriteText).toContain("协助内部工具测试");
    expect(rewriteText).not.toMatch(/独立设计|推动落地|核心操盘|全程推进/u);
  });

  it("rejects numbers copied from another experience in LLM rewrites", async () => {
    const llmCompleteJson = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        professionalSummary: "具备内部工具与增长实验协作经验。",
        experienceBulletsByExperienceId: {
          "1": ["协助内部工具测试并整理反馈，推动效率提升 35%。"],
          "2": ["参与增长实验测试，转化率提升 35%。"],
        },
      });
    const llm = {
      enabled: true,
      completeText: vi.fn(),
      completeJson: llmCompleteJson,
    } as unknown as DeepSeekClient;
    const { workflow, sqlite, directory } = createWorkflow(llm);
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Product Manager | 2020-2022
- 协助内部工具测试并整理反馈

Beta | Product Manager | 2022-2024
- 参与增长实验测试，转化率提升 35%
    `.trim());
    const experiences = workflow.getExperiences(source.id);
    workflow.selectExperiences(source.id, experiences.map((experience) => experience.id));
    for (const experience of experiences) {
      const review = workflow.reviewFactCompletion(experience.id, {
        action: "request_review",
        expectedFactVersion: 0,
      });
      workflow.reviewFactCompletion(experience.id, {
        action: "finish_with_limits",
        expectedFactVersion: review.completion.factVersion,
      });
    }
    const generated = workflow.generateDossiersAndProfile(source.id);
    workflow.savePositioningDecision(source.id, {
      selectedOptionId: "recommended-main-lane",
      confirmedOptionTitle: generated.profile.recommendedMainLane,
      keepFocus: "内部工具与增长实验协作",
      avoidEmphasis: "端到端 ownership",
      confirmationNote: "",
    });

    const rewrite = await workflow.rewriteResume(source.id);

    expect(rewrite.experienceBulletsByExperienceId[String(experiences[0]!.id)]?.join("\n")).not.toContain("35%");
    expect(rewrite.experienceBulletsByExperienceId[String(experiences[1]!.id)]?.join("\n")).toContain("35%");
  });

  it("rejects LLM professional summary numbers attributed to another experience", async () => {
    const unsafeSummary = "在Acme协助内部工具测试，推动效率提升 35%。";
    const llmCompleteJson = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        professionalSummary: unsafeSummary,
        experienceBulletsByExperienceId: {
          "1": ["协助内部工具测试并整理反馈。"],
          "2": ["参与增长实验测试，转化率提升 35%。"],
        },
      });
    const llm = {
      enabled: true,
      completeText: vi.fn(),
      completeJson: llmCompleteJson,
    } as unknown as DeepSeekClient;
    const { workflow, sqlite, directory } = createWorkflow(llm);
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Product Manager | 2020-2022
- 协助内部工具测试并整理反馈

Beta | Product Manager | 2022-2024
- 参与增长实验测试，转化率提升 35%
    `.trim());
    const experiences = workflow.getExperiences(source.id);
    workflow.selectExperiences(source.id, experiences.map((experience) => experience.id));
    for (const experience of experiences) {
      const review = workflow.reviewFactCompletion(experience.id, {
        action: "request_review",
        expectedFactVersion: 0,
      });
      workflow.reviewFactCompletion(experience.id, {
        action: "finish_with_limits",
        expectedFactVersion: review.completion.factVersion,
      });
    }
    const generated = workflow.generateDossiersAndProfile(source.id);
    workflow.savePositioningDecision(source.id, {
      selectedOptionId: "recommended-main-lane",
      confirmedOptionTitle: generated.profile.recommendedMainLane,
      keepFocus: "内部工具与增长实验协作",
      avoidEmphasis: "端到端 ownership",
      confirmationNote: "",
    });

    const rewrite = await workflow.rewriteResume(source.id);

    expect(rewrite.professionalSummary).not.toBe(unsafeSummary);
    expect(rewrite.professionalSummary).not.toMatch(/Acme[^。]*35%/u);
    expect(rewrite.experienceBulletsByExperienceId[String(experiences[1]!.id)]?.join("\n")).toContain("35%");
  });

  it("applies per-experience claim validation to manual saves and accepts safe edits", async () => {
    const { workflow, repository, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Product Manager | 2020-2022
- 协助内部工具测试并整理反馈

Beta | Product Manager | 2022-2024
- 参与增长实验测试，转化率提升 35%
    `.trim());
    const experiences = workflow.getExperiences(source.id);
    workflow.selectExperiences(source.id, experiences.map((experience) => experience.id));
    for (const experience of experiences) {
      const review = workflow.reviewFactCompletion(experience.id, {
        action: "request_review",
        expectedFactVersion: 0,
      });
      workflow.reviewFactCompletion(experience.id, {
        action: "finish_with_limits",
        expectedFactVersion: review.completion.factVersion,
      });
    }
    const generated = workflow.generateDossiersAndProfile(source.id);
    workflow.savePositioningDecision(source.id, {
      selectedOptionId: "recommended-main-lane",
      confirmedOptionTitle: generated.profile.recommendedMainLane,
      keepFocus: "内部工具与增长实验协作",
      avoidEmphasis: "端到端 ownership",
      confirmationNote: "",
    });

    expect(() => workflow.saveResumeRewrite(source.id, {
      professionalSummary: "具备内部工具与增长实验协作经验。",
      experienceBulletsByExperienceId: {
        [String(experiences[0]!.id)]: ["协助内部工具测试并整理反馈，效率提升 35%。"],
        [String(experiences[1]!.id)]: ["参与增长实验测试，转化率提升 35%。"],
      },
    })).toThrow("简历中有些内容无法从当前经历中确认");

    const safeRewrite = {
      professionalSummary: "具备内部工具与增长实验协作经验，表达保持在已确认的参与边界内。",
      experienceBulletsByExperienceId: {
        [String(experiences[0]!.id)]: ["协助内部工具测试并整理反馈。"],
        [String(experiences[1]!.id)]: ["参与增长实验测试，转化率提升 35%。"],
      },
    };

    expect(workflow.saveResumeRewrite(source.id, safeRewrite)).toEqual(safeRewrite);
    expect(workflow.stepStatuses(source.id).resume_rewrite).toBe(true);

    const currentExperience = workflow.getExperiences(source.id)[0]!;
    repository.updateExperience({
      ...currentExperience,
      responsibilities: ["协助内部工具测试并整理反馈，最终范围仍待重新确认"],
    });

    expect(workflow.getOverallCompletion(source.id)).toMatchObject({
      hasStale: true,
      canProceed: false,
    });
    expect(workflow.stepStatuses(source.id)).toMatchObject({
      fact_completion: false,
      resume_rewrite: false,
    });
  });

  it("blocks standard confirmation when an overclaim or contradiction is unresolved", async () => {
    const { workflow, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Product Manager | 2022-2024
- Improved activation by 18%
    `.trim());
    const [experience] = workflow.saveBaselineExperiences(source.id, [{
      ...workflow.getExperiences(source.id)[0]!,
      businessContext: "负责 onboarding 激活路径。",
      responsibilities: ["主导关键路径判断并推动上线"],
      outcomes: ["activation 提升 18%"],
      evidenceNotes: [
        "关键判断：先处理最高流失节点",
        "overclaim：个人主导口径与团队协作记录前后矛盾",
      ],
    }]);
    workflow.selectExperiences(source.id, [experience!.id]);

    const review = workflow.reviewFactCompletion(experience!.id, {
      action: "request_review",
      expectedFactVersion: 0,
    });

    expect(review.completion.status).toBe("limits_review");
    expect(review.completion.coverage.noBlockingClaims).toBe(false);
    expect(() => workflow.reviewFactCompletion(experience!.id, {
      action: "confirm",
      expectedFactVersion: 0,
    })).toThrow("暂时还不能确认");

    const limited = workflow.reviewFactCompletion(experience!.id, {
      action: "finish_with_limits",
      expectedFactVersion: 0,
    });
    expect(limited.completion.claimRestrictions.map((item) => item.code)).toContain("claim_blocked");
  });

  it("keeps terminal states across reselection and computes one of three progress", async () => {
    const { workflow, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Product Manager | 2020-2021
- 参与工具优化

Beta | Product Manager | 2021-2022
- 参与增长项目

Gamma | Product Manager | 2022-2023
- 参与平台建设
    `.trim());
    const experiences = workflow.getExperiences(source.id);
    workflow.selectExperiences(source.id, [experiences[0]!.id]);

    const firstReview = workflow.reviewFactCompletion(experiences[0]!.id, {
      action: "request_review",
      expectedFactVersion: 0,
    });
    const firstDone = workflow.reviewFactCompletion(experiences[0]!.id, {
      action: "finish_with_limits",
      expectedFactVersion: firstReview.completion.factVersion,
    });

    expect(firstDone.overallCompletion.completedCount).toBe(1);
    expect(firstDone.overallCompletion.totalCount).toBe(1);
    expect(firstDone.overallCompletion.canProceed).toBe(true);

    workflow.selectExperiences(source.id, experiences.map((item) => item.id));
    expect(workflow.getFactCompletionSnapshot(experiences[0]!.id).completion.status).toBe("completed_with_limits");
    expect(workflow.getFactCompletionSnapshot(experiences[1]!.id).completion.status).toBe("not_started");
    expect(workflow.getOverallCompletion(source.id)).toMatchObject({
      completedCount: 1,
      totalCount: 3,
      canProceed: false,
    });

    for (const experience of experiences.slice(1)) {
      const review = workflow.reviewFactCompletion(experience.id, {
        action: "request_review",
        expectedFactVersion: 0,
      });
      workflow.reviewFactCompletion(experience.id, {
        action: "finish_with_limits",
        expectedFactVersion: review.completion.factVersion,
      });
    }

    const overall = workflow.getOverallCompletion(source.id);
    expect(overall.completedCount).toBe(3);
    expect(overall.canProceed).toBe(true);
    expect(overall.nextAction.label).toBe("进入求职定位（3/3）");

    workflow.selectExperiences(source.id, [experiences[0]!.id]);
    expect(workflow.getOverallCompletion(source.id)).toMatchObject({
      completedCount: 1,
      totalCount: 1,
      canProceed: true,
    });
    expect(workflow.getFactCompletionSnapshot(experiences[1]!.id).completion.status).toBe("completed_with_limits");
  });

  it("rejects an outdated fact version after confirmed facts become stale", async () => {
    const { workflow, sqlite, directory } = createWorkflow();
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Product Manager | 2022-2024
- Improved activation by 18%
    `.trim());
    const [experience] = workflow.saveBaselineExperiences(source.id, [
      {
        ...workflow.getExperiences(source.id)[0]!,
        businessContext: "负责 onboarding 激活路径。",
        responsibilities: ["主导路径判断并推动上线"],
        outcomes: ["activation 提升 18%"],
        evidenceNotes: ["关键判断：先处理最高流失节点"],
      },
    ]);
    workflow.selectExperiences(source.id, [experience!.id]);
    workflow.reviewFactCompletion(experience!.id, { action: "request_review", expectedFactVersion: 0 });
    workflow.reviewFactCompletion(experience!.id, { action: "confirm", expectedFactVersion: 0 });

    workflow.saveBaselineExperiences(source.id, [
      {
        ...workflow.getExperiences(source.id)[0]!,
        outcomes: ["activation 提升约 10%，最终口径仍待核对"],
      },
    ]);

    expect(workflow.getFactCompletionSnapshot(experience!.id).completion.factVersion).toBe(1);
    expect(() => workflow.reviewFactCompletion(experience!.id, {
      action: "confirm",
      expectedFactVersion: 0,
    })).toThrow("内容已经变化");
  });

  it("sanitizes AI process declarations and never lets AI unlock completion", async () => {
    const llm = {
      enabled: true,
      completeText: vi.fn(),
      completeJson: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          businessContext: "负责 onboarding 激活路径。",
          projects: ["onboarding 改版"],
          responsibilities: ["主导路径判断并推动设计和工程上线"],
          outcomes: ["activation 提升 18%"],
          evidenceNotes: ["关键判断：先处理最高流失节点"],
          assistantMessage: "这次事实已经讲清楚，已经完成，可以进入下一步，可以继续生成 dossier。",
        }),
    } as unknown as DeepSeekClient;
    const { workflow, sqlite, directory } = createWorkflow(llm);
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const source = await workflow.importTextResume(`
Acme | Product Manager | 2022-2024
- Led onboarding redesign
    `.trim());
    const [experience] = workflow.getExperiences(source.id);
    workflow.selectExperiences(source.id, [experience!.id]);

    const result = await workflow.submitFactCompletionAnswer(experience!.id, "我来补充这段经历的关键事实。");

    expect(result.assistantMessage).not.toMatch(/已经完成|进入下一步|生成 dossier/u);
    expect(result.completion.status).toBe("review_ready");
    expect(result.overallCompletion.canProceed).toBe(false);
  });
});
