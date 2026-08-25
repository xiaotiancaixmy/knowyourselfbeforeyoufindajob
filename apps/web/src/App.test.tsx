import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App, { FactCompletionStatusText } from "./App";
import { resolveFactExperienceId } from "./lib/fact-completion";
import { useWorkflowStore } from "./store/workflow-store";

describe("App", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
    useWorkflowStore.setState({
      currentStep: "resume_import",
      activeSourceId: null,
      activeExperienceId: null,
    });
  });

  it("renders the cover screen when no workspace exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          activeSource: null,
          activeStatuses: {
            resume_import: false,
            baseline_review: false,
            deep_dive_selection: false,
            fact_completion: false,
            dossier_profile: false,
            resume_rewrite: false,
          },
          selectedExperienceIds: [],
          latestProfile: null,
          drafts: [],
        }),
        { status: 200 },
      ),
    );

    const queryClient = new QueryClient();

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "把真实经历，整理成更有说服力的求职材料" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "开始梳理" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "开始梳理" })).toBeInTheDocument();
    const processButton = screen.getByRole("button", { name: "查看接下来 5 个步骤" });
    expect(processButton).toHaveAttribute("aria-expanded", "false");
    expect(processButton).toHaveAttribute("aria-controls", "cover-process-panel");
    expect(screen.queryByRole("region", { name: "接下来怎么进行" })).not.toBeInTheDocument();

    fireEvent.click(processButton);

    const collapseButton = screen.getByRole("button", { name: "收起 5 个步骤" });
    expect(collapseButton).toHaveAttribute("aria-expanded", "true");
    const processRegion = screen.getByRole("region", { name: "接下来怎么进行" });
    expect(processRegion).toBeInTheDocument();
    expect(processRegion).toHaveTextContent("用 5 步把真实经历整理成可以继续修改的求职材料。");
    expect(processRegion).toHaveTextContent("明确求职目标");
    expect(processRegion).toHaveTextContent("导入现有简历");
    expect(processRegion).toHaveTextContent("选择重点经历");
    expect(processRegion).toHaveTextContent("补充关键事实");
    expect(processRegion).toHaveTextContent("确认定位并改写");

    fireEvent.click(collapseButton);

    expect(screen.getByRole("button", { name: "查看接下来 5 个步骤" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "接下来怎么进行" })).not.toBeInTheDocument();
    expect(screen.getByText("系统只使用你提供并确认过的内容；所有建议都可以修改或不采用。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "继续当前方案" })).not.toBeInTheDocument();
  });

  it("starts a new draft from the cover screen and opens step 0 before resume import", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/workspace" && !init?.method) {
        return new Response(
          JSON.stringify({
            activeSource: null,
            activeStatuses: {
              resume_import: false,
              baseline_review: false,
              deep_dive_selection: false,
              fact_completion: false,
              dossier_profile: false,
              resume_rewrite: false,
            },
            selectedExperienceIds: [],
            latestProfile: null,
            drafts: [],
          }),
          { status: 200 },
        );
      }
      if (url === "/api/workspace/start-new") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const queryClient = new QueryClient();

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "开始梳理" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "开始梳理" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "先明确这次求职目标" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "下一步：导入简历" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "导入简历" })).toBeInTheDocument();
    });
  });

  it("continues an existing draft from the cover screen", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/workspace" && !init?.method) {
        return new Response(
          JSON.stringify({
            activeSource: {
              id: 12,
              sourceType: "text",
              filename: null,
              rawText: "resume",
              createdAt: "2026-07-24T10:00:00.000Z",
              updatedAt: "2026-07-24T11:00:00.000Z",
              isActive: true,
            },
            activeStatuses: {
              resume_import: true,
              baseline_review: true,
              deep_dive_selection: false,
              fact_completion: false,
              dossier_profile: false,
              resume_rewrite: false,
            },
            selectedExperienceIds: [],
            latestProfile: null,
            drafts: [
              {
                source: {
                  id: 12,
                  sourceType: "text",
                  filename: null,
                  rawText: "resume",
                  createdAt: "2026-07-24T10:00:00.000Z",
                  updatedAt: "2026-07-24T11:00:00.000Z",
                  isActive: true,
                },
                statuses: {
                  resume_import: true,
                  baseline_review: true,
                  deep_dive_selection: false,
                  fact_completion: false,
                  dossier_profile: false,
                  resume_rewrite: false,
                },
                title: "杭州久痕科技有限公司 | 资深产品经理",
                subtitle: "已完成到：核对经历",
                updatedAt: "2026-07-24T11:00:00.000Z",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === "/api/workspace/activate") {
        return new Response(JSON.stringify({ source: { id: 12 } }), { status: 200 });
      }
      if (url === "/api/experiences?sourceId=12") {
        return new Response(
          JSON.stringify({
            experiences: [
              {
                id: 1,
                sourceId: 12,
                company: "杭州久痕科技有限公司",
                role: "资深产品经理",
                timeframe: "2024.08 - 2025.12",
                businessContext: "负责 remio 的产品规划",
                projects: ["remio"],
                responsibilities: ["主导核心产品能力落地"],
                outcomes: ["用户活跃提升"],
                evidenceNotes: [],
                selected: false,
                status: "draft",
              },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const queryClient = new QueryClient();

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "杭州久痕科技有限公司 | 资深产品经理", level: 2 })).toBeInTheDocument();
    });
    expect(screen.getAllByText("下一步：选择重点经历").length).toBeGreaterThan(0);
    expect(screen.getByText("方案进度 3/5")).toBeInTheDocument();
    expect(screen.getByText(/更新于/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续当前方案" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "核对经历" })).toBeInTheDocument();
    });
  });

  it("reveals all drafts and continues a historical draft", async () => {
    let activeSourceId = 12;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const statuses = {
        resume_import: true,
        baseline_review: true,
        deep_dive_selection: false,
        fact_completion: false,
        dossier_profile: false,
        resume_rewrite: false,
      };
      const sources = {
        12: {
          id: 12,
          sourceType: "text",
          filename: null,
          rawText: "current resume",
          createdAt: "2026-07-24T10:00:00.000Z",
          updatedAt: "2026-07-24T11:00:00.000Z",
          isActive: activeSourceId === 12,
        },
        13: {
          id: 13,
          sourceType: "text",
          filename: null,
          rawText: "historical resume",
          createdAt: "2026-07-20T10:00:00.000Z",
          updatedAt: "2026-07-20T11:00:00.000Z",
          isActive: activeSourceId === 13,
        },
      };

      if (url === "/api/workspace" && !init?.method) {
        return new Response(
          JSON.stringify({
            activeSource: sources[activeSourceId as keyof typeof sources],
            activeStatuses: statuses,
            selectedExperienceIds: [],
            latestProfile: null,
            activeGoalSetup: null,
            activePositioningDecision: null,
            drafts: [
              {
                source: sources[12],
                statuses,
                title: "当前 AI 产品画像",
                subtitle: "已完成到：核对经历",
                updatedAt: sources[12].updatedAt,
                isActive: activeSourceId === 12,
                goalSetup: null,
                positioningDecision: null,
              },
              {
                source: sources[13],
                statuses,
                title: "历史增长产品画像",
                subtitle: "已完成到：核对经历",
                updatedAt: sources[13].updatedAt,
                isActive: activeSourceId === 13,
                goalSetup: null,
                positioningDecision: null,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === "/api/workspace/activate" && init?.method === "POST") {
        activeSourceId = Number(JSON.parse(String(init.body)).sourceId);
        return new Response(JSON.stringify({ source: { id: activeSourceId } }), { status: 200 });
      }
      if (url.startsWith("/api/experiences?sourceId=")) {
        const sourceId = Number(new URL(url, "http://localhost").searchParams.get("sourceId"));
        return new Response(
          JSON.stringify({
            experiences: [
              {
                id: sourceId * 10,
                sourceId,
                company: sourceId === 13 ? "历史公司" : "当前公司",
                role: "产品经理",
                timeframe: "2024 - 2025",
                businessContext: "负责产品规划",
                projects: [],
                responsibilities: ["主导产品落地"],
                outcomes: [],
                evidenceNotes: [],
                selected: false,
                status: "draft",
              },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const queryClient = new QueryClient();

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "查看全部方案（2）" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "查看全部方案（2）" }));
    expect(screen.getByRole("heading", { name: "全部求职方案" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续方案：历史增长产品画像" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/workspace/activate",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ sourceId: 13 }),
        }),
      );
      expect(screen.getByRole("heading", { name: "核对经历" })).toBeInTheDocument();
    });
  });

  it("persists goal setup edits for an existing draft", async () => {
    let savedGoalSetup: Record<string, string> | null = null;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/workspace" && !init?.method) {
        return new Response(
          JSON.stringify({
            activeSource: {
              id: 12,
              sourceType: "text",
              filename: null,
              rawText: "resume",
              createdAt: "2026-07-24T10:00:00.000Z",
              updatedAt: "2026-07-24T11:00:00.000Z",
              isActive: true,
            },
            activeStatuses: {
              resume_import: true,
              baseline_review: true,
              deep_dive_selection: false,
              fact_completion: false,
              dossier_profile: false,
              resume_rewrite: false,
            },
            selectedExperienceIds: [],
            latestProfile: null,
            activeGoalSetup: {
              targetRole: "AI 产品经理",
              mainSellingPoint: "AI workflow",
              biggestQuestion: "怎么讲清楚主导度",
              doNotOversell: "不要硬卖管理跨度",
            },
            activePositioningDecision: null,
            drafts: [
              {
                source: {
                  id: 12,
                  sourceType: "text",
                  filename: null,
                  rawText: "resume",
                  createdAt: "2026-07-24T10:00:00.000Z",
                  updatedAt: "2026-07-24T11:00:00.000Z",
                  isActive: true,
                },
                statuses: {
                  resume_import: true,
                  baseline_review: true,
                  deep_dive_selection: false,
                  fact_completion: false,
                  dossier_profile: false,
                  resume_rewrite: false,
                },
                title: "杭州久痕科技有限公司 | 资深产品经理",
                subtitle: "已完成到：核对经历",
                updatedAt: "2026-07-24T11:00:00.000Z",
                isActive: true,
                goalSetup: {
                  targetRole: "AI 产品经理",
                  mainSellingPoint: "AI workflow",
                  biggestQuestion: "怎么讲清楚主导度",
                  doNotOversell: "不要硬卖管理跨度",
                },
                positioningDecision: null,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === "/api/workspace/activate") {
        return new Response(JSON.stringify({ source: { id: 12 } }), { status: 200 });
      }
      if (url === "/api/workspace/goal-setup" && init?.method === "PUT") {
        savedGoalSetup = JSON.parse(String(init.body));
        return new Response(JSON.stringify(savedGoalSetup), { status: 200 });
      }
      if (url === "/api/experiences?sourceId=12") {
        return new Response(
          JSON.stringify({
            experiences: [
              {
                id: 1,
                sourceId: 12,
                company: "杭州久痕科技有限公司",
                role: "资深产品经理",
                timeframe: "2024.08 - 2025.12",
                businessContext: "负责 remio 的产品规划",
                projects: ["remio"],
                responsibilities: ["主导核心产品能力落地"],
                outcomes: ["用户活跃提升"],
                evidenceNotes: [],
                selected: false,
                status: "draft",
              },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const queryClient = new QueryClient();

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "继续当前方案" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "继续当前方案" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "修改求职目标" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "修改求职目标" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "先明确这次求职目标" })).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText("这次想投的岗位或方向"), {
      target: { value: "AI Agent 产品经理" },
    });
    fireEvent.click(screen.getByRole("button", { name: "下一步：导入简历" }));

    await waitFor(() => {
      expect(savedGoalSetup).toMatchObject({
        targetRole: "AI Agent 产品经理",
      });
    });
  });

  it("does not let a legacy resume asset unlock Step 7", async () => {
    let legacyRewriteReads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/workspace" && !init?.method) {
        return new Response(
          JSON.stringify({
            activeSource: {
              id: 12,
              sourceType: "text",
              filename: null,
              rawText: "resume",
              createdAt: "2026-07-24T10:00:00.000Z",
              updatedAt: "2026-07-24T11:00:00.000Z",
              isActive: true,
            },
            activeStatuses: {
              resume_import: true,
              baseline_review: true,
              deep_dive_selection: true,
              fact_completion: true,
              dossier_profile: true,
              job_fit_decision: false,
              resume_rewrite: true,
            },
            selectedExperienceIds: [1],
            activePositioningDecision: {
              selectedOptionId: "ai-pm",
              confirmedOptionTitle: "AI 产品经理",
              keepFocus: "AI workflow",
              avoidEmphasis: "大团队管理",
              confirmationNote: "",
            },
            currentJobTarget: null,
            currentJobFitAnalysis: null,
            latestProfile: {
              careerArc: "AI workflow 产品主线",
              strongestThemes: ["AI workflow", "0 到 1"],
              weakSpots: ["管理跨度证据不足"],
              positioningBoundary: "不要硬卖大团队管理",
              recommendedMainLane: "AI 产品经理",
              conservativeTargetStrategy: "先投 AI 效率工具方向",
            },
            drafts: [
              {
                source: {
                  id: 12,
                  sourceType: "text",
                  filename: null,
                  rawText: "resume",
                  createdAt: "2026-07-24T10:00:00.000Z",
                  updatedAt: "2026-07-24T11:00:00.000Z",
                  isActive: true,
                },
                statuses: {
                  resume_import: true,
                  baseline_review: true,
                  deep_dive_selection: true,
                  fact_completion: true,
                  dossier_profile: true,
                  job_fit_decision: false,
                  resume_rewrite: true,
                },
                title: "杭州久痕科技有限公司 | 资深产品经理",
                subtitle: "已完成到：简历改写",
                updatedAt: "2026-07-24T11:00:00.000Z",
                isActive: true,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === "/api/workspace/activate") {
        return new Response(JSON.stringify({ source: { id: 12 } }), { status: 200 });
      }
      if (url === "/api/experiences?sourceId=12") {
        return new Response(
          JSON.stringify({
            experiences: [
              {
                id: 1,
                sourceId: 12,
                company: "杭州久痕科技有限公司",
                role: "资深产品经理",
                timeframe: "2024.08 - 2025.12",
                businessContext: "负责 remio 的产品规划",
                projects: ["remio"],
                responsibilities: ["主导核心产品能力落地"],
                outcomes: ["用户活跃提升"],
                evidenceNotes: [],
                selected: true,
                status: "ready_for_dossier",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === "/api/resume-rewrite") {
        legacyRewriteReads += 1;
        return new Response(
          JSON.stringify({
            professionalSummary: "7 年 AI 产品经验，擅长 workflow 与信息管理。",
            experienceBulletsByExperienceId: {
              "1": ["主导 remio 核心能力落地", "推动活跃度提升"],
            },
          }),
          { status: 200 },
        );
      }
      if (url === "/api/job-targets?sourceId=12") {
        return new Response(JSON.stringify({ jobTargets: [] }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const queryClient = new QueryClient();

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "继续当前方案" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "继续当前方案" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /第 7 步\s*岗位版简历/u })).toBeDisabled();
    });
    expect(screen.queryByRole("heading", { name: "岗位版简历" })).not.toBeInTheDocument();
    expect(legacyRewriteReads).toBe(0);
  });

  it("updates review readiness from the stream and unlocks only after user confirmation", async () => {
    const experience = {
      id: 1,
      sourceId: 12,
      company: "Acme",
      role: "Product Manager",
      timeframe: "2022-2024",
      businessContext: "负责 onboarding 激活路径。",
      projects: ["onboarding 改版"],
      responsibilities: ["主导路径判断并推动设计和工程上线"],
      outcomes: ["activation 提升 18%"],
      evidenceNotes: ["关键判断：先处理最高流失节点"],
      selected: true,
      status: "in_progress",
    };
    const summary = {
      context: ["负责 onboarding 激活路径。"],
      ownership: ["主导路径判断并推动设计和工程上线"],
      outcome: ["activation 提升 18%"],
      depth: ["关键判断：先处理最高流失节点"],
    };
    const nextAction = {
      type: "request_review",
      label: "这段我已经讲得差不多了",
      prompt: null,
      experienceId: 1,
    };
    const initialOverall = {
      selectedExperienceIds: [1],
      items: [{ experienceId: 1, status: "collecting", quality: "standard", isTerminal: false }],
      completedCount: 0,
      totalCount: 1,
      hasStale: false,
      canProceed: false,
      nextAction: { ...nextAction, type: "switch_experience", label: "继续补全未完成的经历" },
    };
    const initialCompletion = {
      experienceId: 1,
      status: "collecting",
      factVersion: 1,
      quality: "standard",
      systemReady: true,
      isTerminal: false,
      canProceed: false,
      coverage: { context: true, ownership: true, outcome: true, depth: true, noBlockingClaims: true },
      factSummary: summary,
      gaps: [],
      claimRestrictions: [],
      nextAction,
      confirmedAt: null,
    };
    const workspace = {
      activeSource: {
        id: 12,
        sourceType: "text",
        filename: null,
        rawText: "resume",
        createdAt: "2026-07-24T10:00:00.000Z",
        updatedAt: "2026-07-24T11:00:00.000Z",
        isActive: true,
      },
      activeStatuses: {
        resume_import: true,
        baseline_review: true,
        deep_dive_selection: true,
        fact_completion: false,
        dossier_profile: false,
        resume_rewrite: false,
      },
      selectedExperienceIds: [1],
      latestProfile: null,
      activeGoalSetup: null,
      activePositioningDecision: null,
      overallCompletion: initialOverall,
      drafts: [{
        source: {
          id: 12,
          sourceType: "text",
          filename: null,
          rawText: "resume",
          createdAt: "2026-07-24T10:00:00.000Z",
          updatedAt: "2026-07-24T11:00:00.000Z",
          isActive: true,
        },
        statuses: {
          resume_import: true,
          baseline_review: true,
          deep_dive_selection: true,
          fact_completion: false,
          dossier_profile: false,
          resume_rewrite: false,
        },
        title: "Acme | Product Manager",
        subtitle: "已完成到：选择重点经历",
        updatedAt: "2026-07-24T11:00:00.000Z",
        isActive: true,
        goalSetup: null,
        positioningDecision: null,
      }],
    };
    let factSnapshotReads = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/workspace" && !init?.method) {
        return new Response(JSON.stringify(workspace), { status: 200 });
      }
      if (url === "/api/workspace/activate") {
        return new Response(JSON.stringify({ source: { id: 12 } }), { status: 200 });
      }
      if (url === "/api/experiences?sourceId=12") {
        return new Response(JSON.stringify({ experiences: [experience] }), { status: 200 });
      }
      if (url === "/api/fact-completion/1" && !init?.method) {
        factSnapshotReads += 1;
        return new Response(JSON.stringify({
          signal: "Acme 的经历",
          panelNote: "我们慢慢整理。",
          visibleGaps: [],
          conversation: [{ role: "assistant", content: "先从当时的场景说起。", createdAt: "2026-07-24T11:00:00.000Z" }],
          entryChoices: [],
          experience,
          completion: initialCompletion,
          overallCompletion: initialOverall,
        }), { status: 200 });
      }
      if (url === "/api/fact-completion/1/messages/stream") {
        const reviewCompletion = {
          ...initialCompletion,
          status: "review_ready",
          nextAction: { type: "confirm", label: "确认以上事实", prompt: null, experienceId: 1 },
        };
        const event = {
          type: "complete",
          assistantMessage: "这次你把关键判断和结果都讲清楚了。",
          experience,
          questions: [],
          gaps: [],
          conversation: [
            { role: "assistant", content: "先从当时的场景说起。", createdAt: "2026-07-24T11:00:00.000Z" },
            { role: "user", content: "我补充了关键判断。", createdAt: "2026-07-24T11:01:00.000Z" },
            { role: "assistant", content: "这次你把关键判断和结果都讲清楚了。", createdAt: "2026-07-24T11:02:00.000Z" },
          ],
          completion: reviewCompletion,
          overallCompletion: {
            ...initialOverall,
            items: [{ experienceId: 1, status: "review_ready", quality: "standard", isTerminal: false }],
          },
        };
        return new Response(`${JSON.stringify(event)}\n`, {
          status: 200,
          headers: { "Content-Type": "application/x-ndjson" },
        });
      }
      if (url === "/api/fact-completion/1/confirmation") {
        return new Response(JSON.stringify({
          completion: {
            ...initialCompletion,
            status: "completed",
            isTerminal: true,
            canProceed: true,
            nextAction: { type: "switch_experience", label: "换一段经历", prompt: null, experienceId: 1 },
            confirmedAt: "2026-07-24T11:03:00.000Z",
          },
          overallCompletion: {
            selectedExperienceIds: [1],
            items: [{ experienceId: 1, status: "completed", quality: "standard", isTerminal: true }],
            completedCount: 1,
            totalCount: 1,
            hasStale: false,
            canProceed: true,
            nextAction: {
              type: "proceed_to_dossier",
              label: "进入求职定位（1/1）",
              prompt: null,
              experienceId: null,
            },
          },
        }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const queryClient = new QueryClient();
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "继续当前方案" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "继续当前方案" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "补充关键事实" })).toBeInTheDocument());

    const readsBeforeStream = factSnapshotReads;
    fireEvent.change(screen.getByPlaceholderText(/从你记得的部分开始/u), {
      target: { value: "我补充了关键判断。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "确认以上事实" })).toBeInTheDocument());
    expect(factSnapshotReads).toBe(readsBeforeStream);
    const proceedBeforeConfirm = screen.getByRole("button", { name: "进入求职定位（0/1）" });
    expect(proceedBeforeConfirm).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "确认以上事实" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "进入求职定位（1/1）" })).toBeEnabled();
    });
    expect(screen.getAllByText("已确认").length).toBeGreaterThan(0);
  });

  it("falls back to the first selected experience when the stored fact completion id is stale", () => {
    expect(
      resolveFactExperienceId(16, [
        {
          id: 22,
          sourceId: 1,
          company: "杭州久痕科技有限公司",
          role: "资深产品经理",
          timeframe: "2024.08 - 2025.12",
          businessContext: "负责 remio 的产品规划",
          projects: ["remio"],
          responsibilities: ["主导核心产品能力落地"],
          outcomes: ["用户活跃提升"],
          evidenceNotes: [],
          selected: true,
          status: "selected",
        },
      ]),
    ).toBe(22);
  });

  it("re-recognizes experiences through a confirmation flow before applying changes", async () => {
    const source = {
      id: 12,
      sourceType: "text",
      filename: null,
      rawText: "resume",
      createdAt: "2026-07-24T10:00:00.000Z",
      updatedAt: "2026-07-24T11:00:00.000Z",
      isActive: true,
    };
    const statuses = {
      resume_import: true,
      baseline_review: true,
      deep_dive_selection: false,
      fact_completion: false,
      dossier_profile: false,
      resume_rewrite: false,
    };
    const experience = {
      id: 1,
      sourceId: 12,
      company: "旧公司名",
      role: "产品经理",
      timeframe: "2022-2024",
      businessContext: "负责产品规划",
      projects: [],
      responsibilities: [],
      outcomes: [],
      evidenceNotes: [],
      selected: false,
      status: "draft",
    };
    let appliedPayload: unknown = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/workspace" && !init?.method) {
        return new Response(JSON.stringify({
          activeSource: source,
          activeStatuses: statuses,
          selectedExperienceIds: [],
          latestProfile: null,
          drafts: [{
            source,
            statuses,
            title: "旧公司名 | 产品经理",
            subtitle: "已完成到：核对经历",
            updatedAt: source.updatedAt,
            isActive: true,
          }],
        }), { status: 200 });
      }
      if (url === "/api/workspace/activate") {
        return new Response(JSON.stringify({ source: { id: 12 } }), { status: 200 });
      }
      if (url === "/api/experiences?sourceId=12") {
        return new Response(JSON.stringify({ experiences: [experience] }), { status: 200 });
      }
      if (url === "/api/experiences/recognize") {
        return new Response(JSON.stringify({ experiences: [{ ...experience, company: "星河科技有限公司" }] }), { status: 200 });
      }
      if (url === "/api/experiences" && init?.method === "PUT") {
        appliedPayload = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ experiences: [{ ...experience, company: "星河科技有限公司", role: "高级产品经理" }] }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const queryClient = new QueryClient();
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "继续当前方案" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "继续当前方案" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "核对经历" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "重新识别当前简历" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "这是一段真实的工作经历吗？" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("角色"), { target: { value: "高级产品经理" } });
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    expect(await screen.findByRole("heading", { name: "应用这次识别结果" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "应用识别结果" }));
    await waitFor(() => expect(appliedPayload).toMatchObject({
      experiences: [{ company: "星河科技有限公司", role: "高级产品经理" }],
    }));
  });

  it("confirms before deleting the current draft and refreshes the cover", async () => {
    const source = {
      id: 12,
      sourceType: "text",
      filename: null,
      rawText: "resume",
      createdAt: "2026-07-24T10:00:00.000Z",
      updatedAt: "2026-07-24T11:00:00.000Z",
      isActive: true,
    };
    const statuses = {
      resume_import: true,
      baseline_review: true,
      deep_dive_selection: false,
      fact_completion: false,
      dossier_profile: false,
      resume_rewrite: false,
    };
    let deleted = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/workspace" && !init?.method) {
        return new Response(JSON.stringify({
          activeSource: deleted ? null : source,
          activeStatuses: deleted ? {
            resume_import: false,
            baseline_review: false,
            deep_dive_selection: false,
            fact_completion: false,
            dossier_profile: false,
            resume_rewrite: false,
          } : statuses,
          selectedExperienceIds: [],
          latestProfile: null,
          drafts: deleted ? [] : [{
            source,
            statuses,
            title: "星河科技有限公司 | 产品经理",
            subtitle: "已完成到：核对经历",
            updatedAt: source.updatedAt,
            isActive: true,
          }],
        }), { status: 200 });
      }
      if (url === "/api/workspace/drafts/12" && init?.method === "DELETE") {
        deleted = true;
        return new Response(JSON.stringify({ ok: true, deletedSourceId: 12 }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const queryClient = new QueryClient();
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "删除方案" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "删除方案" }));
    expect(screen.getByRole("dialog", { name: "删除这份求职方案？" })).toBeInTheDocument();
    expect(screen.getByText(/经历、对话、事实记录和生成内容都会永久删除/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认删除方案" }));
    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始梳理" })).toBeInTheDocument());
  });

  it("distinguishes limited-information review from limited completion", () => {
    const { rerender } = render(<FactCompletionStatusText status="limits_review" />);
    expect(screen.getByText("部分信息缺失，待确认")).toBeInTheDocument();
    expect(screen.queryByText("已确认，部分信息缺失")).not.toBeInTheDocument();

    rerender(<FactCompletionStatusText status="completed_with_limits" />);
    expect(screen.getByText("已确认，部分信息缺失")).toBeInTheDocument();
    expect(screen.queryByText("部分信息缺失，待确认")).not.toBeInTheDocument();
  });
});
