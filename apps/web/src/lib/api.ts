import type {
  DossiersSnapshotDto,
  FactCompletionDto,
  FactCompletionReviewPayloadDto,
  FactCompletionSnapshotDto,
  GoalSetupStateDto,
  PositioningDecisionStateDto,
  ResumeRewriteOutputDto,
  SaveResumeRewritePayloadDto,
  WorkspaceSnapshotDto,
  ExperienceRecordDto,
  OverallCompletionDto,
  JobFitAnalysisDto,
  JobTargetDto,
  JobTargetResumeRewriteDto,
} from "@kys/shared";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const shouldSendJsonHeader = init?.body !== undefined && !(init.body instanceof FormData);
  const response = await fetch(url, {
    headers: shouldSendJsonHeader
      ? {
          "Content-Type": "application/json",
          ...init?.headers,
        }
      : init?.headers,
    ...init,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: "操作未完成，请稍后重试。" }));
    throw new Error(payload.message ?? "操作未完成，请稍后重试。");
  }
  return response.json() as Promise<T>;
}

type FactCompletionStreamResult = {
  assistantMessage: string;
  experience: ExperienceRecordDto;
  gaps: FactCompletionSnapshotDto["visibleGaps"];
  conversation: FactCompletionSnapshotDto["conversation"];
  completion: FactCompletionDto;
  overallCompletion: OverallCompletionDto;
};

type FactCompletionStreamEvent =
  | { type: "delta"; delta: string }
  | ({ type: "complete" } & FactCompletionStreamResult)
  | { type: "error"; message: string };

async function streamFactCompletionMessage(
  experienceId: number,
  answer: string,
  onDelta: (delta: string) => void,
): Promise<FactCompletionStreamResult> {
  const response = await fetch(`/api/fact-completion/${experienceId}/messages/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: "暂时无法获取求职顾问的回复，请稍后重试。" }));
    throw new Error(payload.message ?? "暂时无法获取求职顾问的回复，请稍后重试。");
  }
  if (!response.body) {
    throw new Error("暂时无法接收求职顾问的回复，请稍后重试。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: FactCompletionStreamResult | null = null;

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as FactCompletionStreamEvent;
    if (event.type === "delta") {
      onDelta(event.delta);
    } else if (event.type === "error") {
      throw new Error(event.message);
    } else {
      completed = {
        assistantMessage: event.assistantMessage,
        experience: event.experience,
        gaps: event.gaps,
        conversation: event.conversation,
        completion: event.completion,
        overallCompletion: event.overallCompletion,
      };
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(consumeLine);
    if (done) break;
  }
  consumeLine(buffer);

  if (!completed) {
    throw new Error("回复没有完整生成，请重新发送。");
  }
  return completed;
}

export const api = {
  getWorkspace: () => request<WorkspaceSnapshotDto>("/api/workspace"),
  startNewWorkspace: () => request<{ ok: true }>("/api/workspace/start-new", { method: "POST" }),
  activateWorkspace: (sourceId: number) => request<{ source: { id: number } }>("/api/workspace/activate", {
    method: "POST",
    body: JSON.stringify({ sourceId }),
  }),
  deleteWorkspace: (sourceId: number) => request<{ ok: true; deletedSourceId: number }>(`/api/workspace/drafts/${sourceId}`, {
    method: "DELETE",
  }),
  saveGoalSetup: (payload: GoalSetupStateDto) => request<GoalSetupStateDto>("/api/workspace/goal-setup", {
    method: "PUT",
    body: JSON.stringify(payload),
  }),
  savePositioningDecision: (payload: PositioningDecisionStateDto) => request<PositioningDecisionStateDto>("/api/workspace/positioning-decision", {
    method: "PUT",
    body: JSON.stringify(payload),
  }),
  importTextResume: (rawText: string) => request<{ source: { id: number }; experiences: ExperienceRecordDto[] }>("/api/sources/text", {
    method: "POST",
    body: JSON.stringify({ rawText }),
  }),
  importPdfResume: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return request<{ source: { id: number }; experiences: ExperienceRecordDto[] }>("/api/sources/pdf", {
      method: "POST",
      body: formData,
    });
  },
  getExperiences: (sourceId?: number | null) => request<{ experiences: ExperienceRecordDto[] }>(`/api/experiences${sourceId ? `?sourceId=${sourceId}` : ""}`),
  recognizeExperiences: () => request<{ experiences: ExperienceRecordDto[] }>("/api/experiences/recognize", {
    method: "POST",
  }),
  saveExperiences: (experiences: ExperienceRecordDto[]) => request<{ experiences: ExperienceRecordDto[] }>("/api/experiences", {
    method: "PUT",
    body: JSON.stringify({ experiences }),
  }),
  selectExperiences: (selectedIds: number[]) => request<{ ok: true }>("/api/experiences/select", {
    method: "POST",
    body: JSON.stringify({ selectedIds }),
  }),
  getFactCompletion: (experienceId: number) => request<FactCompletionSnapshotDto>(`/api/fact-completion/${experienceId}`),
  reviewFactCompletion: (experienceId: number, payload: FactCompletionReviewPayloadDto) =>
    request<{ completion: FactCompletionDto; overallCompletion: OverallCompletionDto }>(
      `/api/fact-completion/${experienceId}/confirmation`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
  postFactCompletionMessage: (experienceId: number, answer: string) =>
    request<FactCompletionStreamResult>(
      `/api/fact-completion/${experienceId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ answer }),
      },
    ),
  streamFactCompletionMessage,
  generateDossiers: () => request<DossiersSnapshotDto>("/api/dossiers/generate", { method: "POST" }),
  getDossiers: () => request<DossiersSnapshotDto>("/api/dossiers"),
  generateResumeRewrite: () => request<ResumeRewriteOutputDto>("/api/resume-rewrite/generate", { method: "POST" }),
  getResumeRewrite: () => request<ResumeRewriteOutputDto | null>("/api/resume-rewrite"),
  saveResumeRewrite: (payload: SaveResumeRewritePayloadDto) => request<ResumeRewriteOutputDto>("/api/resume-rewrite", {
    method: "PUT",
    body: JSON.stringify(payload),
  }),
  getJobTargets: (sourceId: number) => request<{ jobTargets: JobTargetDto[] }>(`/api/job-targets?sourceId=${sourceId}`),
  createJobTarget: (payload: { sourceId: number; title: string; jdText: string }) => request<JobTargetDto>("/api/job-targets", {
    method: "POST",
    body: JSON.stringify(payload),
  }),
  updateJobTarget: (id: number, payload: { expectedRevision: number; title: string; jdText: string }) => request<JobTargetDto>(`/api/job-targets/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  }),
  updateJobTargetStatus: (id: number, payload: { expectedRevision: number; status: "current" | "archived" }) => request<JobTargetDto>(`/api/job-targets/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  }),
  analyzeJobTarget: (id: number, expectedRevision: number) => request<JobFitAnalysisDto>(`/api/job-targets/${id}/analyses`, {
    method: "POST",
    body: JSON.stringify({ expectedRevision }),
  }),
  getJobAnalysis: (id: number, version: number) => request<JobFitAnalysisDto>(`/api/job-targets/${id}/analyses/${version}`),
  generateJobResumeRewrite: (id: number, analysisVersion: number) => request<JobTargetResumeRewriteDto>(`/api/job-targets/${id}/resume-rewrite/generate`, {
    method: "POST",
    body: JSON.stringify({ analysisVersion }),
  }),
  getJobResumeRewrite: (id: number, analysisVersion: number) => request<JobTargetResumeRewriteDto | null>(`/api/job-targets/${id}/resume-rewrite?analysisVersion=${analysisVersion}`),
  saveJobResumeRewrite: (id: number, payload: { analysisVersion: number; expectedRevision: number; content: ResumeRewriteOutputDto }) => request<JobTargetResumeRewriteDto>(`/api/job-targets/${id}/resume-rewrite`, {
    method: "PUT",
    body: JSON.stringify(payload),
  }),
};
