import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobFitAnalysisDto, JobTargetDto, StepKey } from "@kys/shared";

import { JobFitDecisionStep } from "./JobFitDecisionStep";
import { recognizeJobDescriptionImages } from "../lib/image-ocr";

vi.mock("../lib/image-ocr", () => ({
  recognizeJobDescriptionImages: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(recognizeJobDescriptionImages).mockReset();
});

function analysis(decision: JobFitAnalysisDto["decision"], overrides: Partial<JobFitAnalysisDto> = {}): JobFitAnalysisDto {
  return {
    id: 9,
    jobTargetId: 4,
    version: 2,
    runState: "succeeded",
    decision,
    validity: "current",
    insufficientReason: decision === "insufficient" ? "jd_insufficient" : null,
    summary: decision === "apply" ? "建议投递，可以进入岗位版简历。" : decision === "conditional" ? "先补齐指定信息，再决定是否投递。" : "当前岗位存在关键不匹配。",
    evidence: decision === "apply" ? [{ requirement: "AI 产品经验", confirmedFact: "负责 AI 产品上线", experienceId: 7, company: "Acme", role: "产品经理", factVersion: 3 }] : [],
    gaps: decision === "conditional" ? [{ requirement: "商业化经验", reason: "当前事实无法判断", importance: "hard", remediationTarget: "step_4", targetExperienceId: 7, returnAnalysisId: 9 }] : [],
    criticalMismatches: decision === "no_go" ? [{ requirement: "团队管理", reason: "表达限制与硬要求冲突" }] : [],
    recommendedExperiences: decision === "apply" ? [{ experienceId: 7, company: "Acme", role: "产品经理", factVersion: 3, rationale: "可直接支撑岗位要求" }] : [],
    claimRestrictions: [],
    inputSnapshot: {
      jdId: 4,
      jdRevision: 2,
      sourceId: 1,
      positioningVersion: 1,
      positioningFingerprint: "p",
      selectedExperienceIds: [7],
      experiences: [{ experienceId: 7, company: "Acme", role: "产品经理", factVersion: 3, factSummary: { context: ["AI 产品"], ownership: ["负责 AI 产品上线"], outcome: [], depth: [] }, claimRestrictions: [{ code: "number_unverified", description: "不要补写未确认数据。" }], factSummaryHash: "f", claimRestrictionsHash: "r" }],
      createdAt: "2026-08-03T00:00:00.000Z",
    },
    inputFingerprint: "fingerprint",
    errorMessage: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

function target(latestAnalysis: JobFitAnalysisDto | null, overrides: Partial<JobTargetDto> = {}): JobTargetDto {
  return {
    id: 4,
    sourceId: 1,
    title: "AI 产品经理",
    jdText: "岗位职责：负责 AI 产品。任职要求：必须具备 AI 产品落地经验。",
    revision: 2,
    status: "current",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    latestAnalysis,
    ...overrides,
  };
}

function renderStep(
  initial: JobTargetDto | JobTargetDto[],
  handlers?: { use?: (target: JobTargetDto, analysis: JobFitAnalysisDto) => void; route?: (step: StepKey, id?: number | null) => void },
) {
  let records = [...(Array.isArray(initial) ? initial : [initial])];
  const requests: Array<{ url: string; method: string; body: unknown }> = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (url === "/api/job-targets?sourceId=1" && method === "GET") {
      return new Response(JSON.stringify({ jobTargets: records }), { status: 200 });
    }
    if (url === "/api/job-targets" && method === "POST") {
      const created = target(null, {
        id: Math.max(10, ...records.map((item) => item.id + 1)),
        title: String(body?.title),
        jdText: String(body?.jdText),
        revision: 1,
      });
      records = [...records, created];
      return new Response(JSON.stringify(created), { status: 200 });
    }
    const idMatch = url.match(/^\/api\/job-targets\/(\d+)$/u);
    if (idMatch && method === "PUT") {
      const id = Number(idMatch[1]);
      const current = records.find((item) => item.id === id)!;
      const updated = { ...current, title: String(body?.title), jdText: String(body?.jdText), revision: current.revision + 1 };
      records = records.map((item) => item.id === id ? updated : item);
      return new Response(JSON.stringify(updated), { status: 200 });
    }
    const statusMatch = url.match(/^\/api\/job-targets\/(\d+)\/status$/u);
    if (statusMatch && method === "PATCH") {
      const id = Number(statusMatch[1]);
      const current = records.find((item) => item.id === id)!;
      const updated = { ...current, status: body?.status as JobTargetDto["status"], revision: current.revision + 1 };
      records = records.map((item) => item.id === id ? updated : item);
      return new Response(JSON.stringify(updated), { status: 200 });
    }
    const analysisMatch = url.match(/^\/api\/job-targets\/(\d+)\/analyses$/u);
    if (analysisMatch && method === "POST") {
      const id = Number(analysisMatch[1]);
      const current = records.find((item) => item.id === id)!;
      const result = current.latestAnalysis ?? analysis("apply", { jobTargetId: id });
      records = records.map((item) => item.id === id ? { ...item, latestAnalysis: result } : item);
      return new Response(JSON.stringify(result), { status: 200 });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <JobFitDecisionStep sourceId={1} onUseAnalysis={handlers?.use ?? vi.fn()} onRoute={handlers?.route ?? vi.fn()} />
    </QueryClientProvider>,
  );
  return { ...view, requests };
}

describe("JobFitDecisionStep", () => {
  it("renders a true empty state without editor or save metadata", async () => {
    renderStep([]);

    expect(await screen.findByRole("heading", { name: "还没有岗位" })).toBeInTheDocument();
    expect(screen.getByText("添加一个真实 JD，我们会用你已经确认的经历事实判断是否值得投递。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加第一个岗位" })).toBeInTheDocument();
    expect(screen.queryByLabelText("岗位名称")).not.toBeInTheDocument();
    expect(screen.queryByText(/JD revision/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/自动保存/u)).not.toBeInTheDocument();
  });

  it("enters create with a blank focused JD, supports cancel, and creates only after JD input", async () => {
    const { requests } = renderStep([]);
    fireEvent.click(await screen.findByRole("button", { name: "添加第一个岗位" }));

    expect(screen.getByRole("heading", { name: "新增岗位" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("例如：字节跳动｜AI 产品经理")).toHaveValue("");
    const editor = screen.getByLabelText("岗位 JD");
    expect(editor).toHaveValue("");
    await waitFor(() => expect(editor).toHaveFocus());
    expect(screen.getByText("粘贴 JD 后自动保存为新岗位")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消新增" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "分析这个岗位" })).toBeDisabled();
    expect(requests.filter((item) => item.method === "POST")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "取消新增" }));
    expect(await screen.findByRole("heading", { name: "还没有岗位" })).toBeInTheDocument();
    expect(requests.filter((item) => item.method === "POST")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "添加第一个岗位" }));
    fireEvent.change(screen.getByLabelText("岗位 JD"), { target: { value: "职位：AI 产品经理\n负责 AI 产品落地" } });
    fireEvent.click(screen.getByRole("button", { name: "分析这个岗位" }));
    await waitFor(() => expect(requests.some((item) => item.url === "/api/job-targets" && item.method === "POST")).toBe(true));
    expect(await screen.findByText("建议投递")).toBeInTheDocument();
  });

  it("recognizes job screenshots and fills the editable JD field", async () => {
    vi.mocked(recognizeJobDescriptionImages).mockImplementation(async (_files, onProgress) => {
      onProgress({ completedFiles: 0, fileCount: 1, progress: 0.6 });
      return "AI 产品经理\n岗位职责：负责 AI 产品从 0 到 1。";
    });
    renderStep([]);
    fireEvent.click(await screen.findByRole("button", { name: "添加第一个岗位" }));

    const screenshot = new File(["image"], "boss-job.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("选择职位截图"), { target: { files: [screenshot] } });

    expect(await screen.findByText("已识别 1 张截图，文字已填入下方，请核对后再分析。")).toBeInTheDocument();
    expect(screen.getByLabelText("岗位 JD")).toHaveValue("AI 产品经理\n岗位职责：负责 AI 产品从 0 到 1。");
    expect(recognizeJobDescriptionImages).toHaveBeenCalledWith([screenshot], expect.any(Function));
  });

  it("defaults existing targets to view and supports edit cancellation", async () => {
    const current = target(analysis("apply"));
    renderStep(current);

    expect(await screen.findByText("建议投递")).toBeInTheDocument();
    expect(screen.getByText(/负责 AI 产品上线/u)).toBeInTheDocument();
    expect(screen.queryByLabelText("岗位 JD")).not.toBeInTheDocument();
    expect(screen.getByText("查看 JD 原文")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "编辑 JD" }));
    expect(screen.getByRole("heading", { name: "编辑「AI 产品经理」" })).toBeInTheDocument();
    expect(screen.getByText("修改 JD 后，现有分析将过期，需要重新分析。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新增岗位" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("岗位 JD"), { target: { value: "尚未保存的修改" } });
    fireEvent.click(screen.getByRole("button", { name: "取消修改" }));

    expect(await screen.findByRole("heading", { name: "AI 产品经理" })).toBeInTheDocument();
    expect(screen.queryByLabelText("岗位 JD")).not.toBeInTheDocument();
  });

  it("guards dirty target switching and respects the user's choice", async () => {
    const second = target(null, { id: 5, title: "增长产品经理", revision: 1, jdText: "负责增长实验。" });
    renderStep([target(null), second]);
    await screen.findByRole("heading", { name: "AI 产品经理" });
    fireEvent.click(screen.getByRole("button", { name: "编辑 JD" }));
    fireEvent.change(screen.getByLabelText("岗位 JD"), { target: { value: "修改后但尚未保存的 JD" } });

    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: /增长产品经理/u }));
    expect(confirm).toHaveBeenCalledWith("当前修改尚未保存，放弃修改并继续吗？");
    expect(screen.getByRole("heading", { name: "编辑「AI 产品经理」" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /增长产品经理/u }));
    expect(await screen.findByRole("heading", { name: "增长产品经理" })).toBeInTheDocument();
    expect(screen.queryByLabelText("岗位 JD")).not.toBeInTheDocument();
  });

  it("keeps archived JD and history read-only and offers restore as the only target action", async () => {
    const archived = target(analysis("apply"), { status: "archived" });
    const { requests } = renderStep(archived);

    expect(await screen.findByText("建议投递")).toBeInTheDocument();
    expect(screen.getByText("恢复后可继续编辑和重新分析。")).toBeInTheDocument();
    expect(screen.queryByLabelText("岗位 JD")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "进入岗位版简历" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分析这个岗位" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑 JD" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "归档岗位" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "恢复岗位" }));
    await waitFor(() => expect(requests.some((item) => item.url.endsWith("/status") && item.method === "PATCH" && (item.body as { status?: string })?.status === "current")).toBe(true));
    expect(await screen.findByRole("button", { name: "归档岗位" })).toBeInTheDocument();
  });

  it("restores Apply with evidence, boundaries, and a single Step 7 CTA", async () => {
    const onUse = vi.fn();
    const current = target(analysis("apply"));
    renderStep(current, { use: onUse });
    expect(await screen.findByText("建议投递")).toBeInTheDocument();
    expect(screen.getByText(/负责 AI 产品上线/u)).toBeInTheDocument();
    expect(screen.getByText("不要补写未确认数据。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "进入岗位版简历" }));
    expect(onUse).toHaveBeenCalledWith(current, current.latestAnalysis);
  });

  it("routes Conditional to the precise fact-completion target", async () => {
    const onRoute = vi.fn();
    renderStep(target(analysis("conditional")), { route: onRoute });
    fireEvent.click(await screen.findByRole("button", { name: "补充指定事实" }));
    expect(onRoute).toHaveBeenCalledWith("fact_completion", 7);
    expect(screen.queryByRole("button", { name: "进入岗位版简历" })).not.toBeInTheDocument();
  });

  it("renders No-Go, insufficient, stale, and failure as distinct non-color-only states", async () => {
    const cases: Array<[JobFitAnalysisDto, string, string]> = [
      [analysis("no_go"), "暂不建议投递", "换一个 JD"],
      [analysis("insufficient", { insufficientReason: "jd_insufficient", summary: "JD 信息不足" }), "信息不足", "补充完整 JD"],
      [analysis("insufficient", { insufficientReason: "facts_insufficient", summary: "已确认事实不足" }), "信息不足", "去补充关键事实"],
      [analysis("insufficient", { insufficientReason: "both", summary: "JD 与事实均不足" }), "信息不足", "重新选择重点经历"],
      [analysis("apply", { validity: "stale" }), "结论已过期", "重新分析"],
      [analysis(null, { runState: "failed", summary: "分析失败", evidence: [], errorMessage: "JD 已保留，本次没有生成投递决策。你可以直接重试。" }), "分析失败", "重试分析"],
    ];
    for (const [item, heading, cta] of cases) {
      const view = renderStep(target(item));
      expect(await screen.findByText(heading)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: cta })).toBeInTheDocument();
      if (item.runState === "failed") expect(screen.queryByText("判断依据")).not.toBeInTheDocument();
      view.unmount();
      vi.restoreAllMocks();
    }
  });

  it("locks repeated analysis submissions synchronously", async () => {
    let resolveAnalysis!: (response: Response) => void;
    let posts = 0;
    const current = target(null);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/job-targets?sourceId=1" && !init?.method) return new Response(JSON.stringify({ jobTargets: [current] }), { status: 200 });
      if (url.endsWith("/analyses") && init?.method === "POST") {
        posts += 1;
        return new Promise<Response>((resolve) => { resolveAnalysis = resolve; });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <JobFitDecisionStep sourceId={1} onUseAnalysis={vi.fn()} onRoute={vi.fn()} />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "AI 产品经理" });
    const button = screen.getByRole("button", { name: "分析这个岗位" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(posts).toBe(1));
    resolveAnalysis(new Response(JSON.stringify(analysis("apply")), { status: 200 }));
  });
});
