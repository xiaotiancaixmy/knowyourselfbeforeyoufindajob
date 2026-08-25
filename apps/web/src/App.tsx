import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowLeft,
  Bot,
  BookOpenText,
  CheckCircle2,
  BriefcaseBusiness,
  ChevronDown,
  Clock3,
  Compass,
  ExternalLink,
  FilePenLine,
  FileSearch,
  FileUp,
  FolderKanban,
  ClipboardCheck,
  LoaderCircle,
  MessagesSquare,
  Mic,
  MicOff,
  ShieldAlert,
  ShieldCheck,
  RotateCcw,
  SkipForward,
  Sparkles,
  Target,
  Trash2,
  UserRound,
} from "lucide-react";
import type {
  ChatTurnDto,
  CompanyDossierDto,
  DraftSummaryDto,
  ExperienceRecordDto,
  FactCompletionReviewPayloadDto,
  FactCompletionState,
  FactSummaryDto,
  GoalSetupStateDto,
  PositioningDecisionStateDto,
  ResumeRewriteOutputDto,
  StepKey,
  WorkspaceSnapshotDto,
  JobFitAnalysisDto,
  JobTargetDto,
} from "@kys/shared";

import { api } from "./lib/api";
import { resolveFactExperienceId } from "./lib/fact-completion";
import { useWorkflowStore } from "./store/workflow-store";
import { JobFitDecisionStep } from "./components/JobFitDecisionStep";

const STEP_TITLES: Record<StepKey, string> = {
  resume_import: "1. 导入简历",
  baseline_review: "2. 核对经历",
  deep_dive_selection: "3. 选择重点经历",
  fact_completion: "4. 补充关键事实",
  dossier_profile: "5. 确认求职定位",
  job_fit_decision: "6. 岗位适配决策",
  resume_rewrite: "7. 岗位版简历",
};

const STEP_ICONS: Record<StepKey, typeof FileUp> = {
  resume_import: FileUp,
  baseline_review: FilePenLine,
  deep_dive_selection: FileSearch,
  fact_completion: MessagesSquare,
  dossier_profile: FolderKanban,
  job_fit_decision: ClipboardCheck,
  resume_rewrite: Sparkles,
};

const KNOWLEDGE_BASE_LINKS = [
  {
    title: "简历修改参考资料",
    description: "用于对照外部材料，继续优化职业总结、简历要点和整体呈现。",
    href: "https://gte09oerz5.feishu.cn/wiki/E5UxwObpMiwyfVk6j0BcsMS7nGc",
    source: "飞书知识库",
  },
];

const GOAL_SETUP_PENDING_KEY = "kys.goal-setup.pending";
type GoalSetupState = GoalSetupStateDto;
type PositioningDecisionState = PositioningDecisionStateDto;
type PdfImportStatus = "idle" | "parsing" | "success" | "failure";
type RecognitionCandidate = ExperienceRecordDto & {
  included: boolean;
  reviewed: boolean;
};

interface PositioningOption {
  id: string;
  label: string;
  title: string;
  summary: string;
  supportingEvidence: string[];
  risk: string;
}

const EMPTY_GOAL_SETUP: GoalSetupState = {
  targetRole: "",
  mainSellingPoint: "",
  biggestQuestion: "",
  doNotOversell: "",
};

const EMPTY_POSITIONING_DECISION: PositioningDecisionState = {
  selectedOptionId: null,
  confirmedOptionTitle: "",
  keepFocus: "",
  avoidEmphasis: "",
  confirmationNote: "",
};

function autoHeight(value: string, minLines = 4, maxLines = 30, wrapWidth = 72): number {
  const visual = Math.max(
    minLines,
    Math.min(
      value.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil((line.length || 1) / wrapWidth)), 0),
      maxLines,
    ),
  );
  return visual * 24 + 28;
}

function readStorageJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined" || typeof window.localStorage?.getItem !== "function") {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function writeStorageJson(key: string, value: unknown) {
  if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

function clearStorageKey(key: string) {
  if (typeof window === "undefined" || typeof window.localStorage?.removeItem !== "function") {
    return;
  }
  window.localStorage.removeItem(key);
}

const GAP_TYPE_LABELS: Record<string, string> = {
  result: "实际结果",
  ownership: "个人贡献",
  scope: "影响范围",
  decision: "关键判断",
  tradeoff: "关键取舍",
  failure: "问题与调整",
  influence: "协作推进",
  overclaim: "可能夸大",
  contradiction: "需要核对",
};

const SEVERITY_LABELS: Record<string, string> = {
  low: "可补",
  medium: "建议",
  high: "优先",
};

const FACT_COMPLETION_STATUS_LABELS: Record<FactCompletionState, string> = {
  not_started: "未开始",
  collecting: "正在补充",
  review_ready: "待确认",
  limits_review: "部分信息缺失，待确认",
  completed: "已确认",
  completed_with_limits: "已确认，部分信息缺失",
  stale: "内容有变化，待确认",
};

export function FactCompletionStatusText({ status }: { status: FactCompletionState }) {
  return <>{FACT_COMPLETION_STATUS_LABELS[status]}</>;
}

function formatGapType(type: string) {
  return GAP_TYPE_LABELS[type] ?? type;
}

function formatSeverity(severity: string) {
  return SEVERITY_LABELS[severity] ?? severity;
}

function hasGoalSetupContent(goalSetup: GoalSetupState) {
  return Boolean(
    goalSetup.targetRole.trim() ||
    goalSetup.mainSellingPoint.trim() ||
    goalSetup.biggestQuestion.trim() ||
    goalSetup.doNotOversell.trim(),
  );
}

function App() {
  const queryClient = useQueryClient();
  const { currentStep, setCurrentStep, activeSourceId, setActiveSourceId, activeExperienceId, setActiveExperienceId } = useWorkflowStore();
  const [viewMode, setViewMode] = useState<"cover" | "workflow">("cover");
  const [workflowMode, setWorkflowMode] = useState<"goal_setup" | "steps">("steps");
  const [textResume, setTextResume] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pdfImportStatus, setPdfImportStatus] = useState<PdfImportStatus>("idle");
  const [draftExperiences, setDraftExperiences] = useState<ExperienceRecordDto[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [factDraft, setFactDraft] = useState("");
  const [pendingFactMessage, setPendingFactMessage] = useState<string | null>(null);
  const [streamingAssistantMessage, setStreamingAssistantMessage] = useState("");
  const [rewriteDraft, setRewriteDraft] = useState<ResumeRewriteOutputDto | null>(null);
  const [goalSetupDraft, setGoalSetupDraft] = useState<GoalSetupState>(EMPTY_GOAL_SETUP);
  const [positioningDecision, setPositioningDecision] = useState<PositioningDecisionState>(EMPTY_POSITIONING_DECISION);
  const [activeJobTarget, setActiveJobTarget] = useState<JobTargetDto | null>(null);
  const [activeJobAnalysis, setActiveJobAnalysis] = useState<JobFitAnalysisDto | null>(null);
  const [jobRewriteRevision, setJobRewriteRevision] = useState(0);
  const [expandedExperienceIds, setExpandedExperienceIds] = useState<number[]>([]);
  const [recognitionCandidates, setRecognitionCandidates] = useState<RecognitionCandidate[] | null>(null);
  const [recognitionIndex, setRecognitionIndex] = useState(0);
  const [recognitionSummaryVisible, setRecognitionSummaryVisible] = useState(false);
  const [dictating, setDictating] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const factDraftRef = useRef("");
  const factTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const factSubmitLockRef = useRef(false);
  const shouldKeepDictatingRef = useRef(false);
  const restartTimeoutRef = useRef<number | null>(null);
  const goalSetupReturnStepRef = useRef<StepKey>("resume_import");
  const lastWorkspaceSourceIdRef = useRef<number | null | undefined>(undefined);

  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: api.getWorkspace,
    refetchOnWindowFocus: false,
  });

  const experiencesQuery = useQuery({
    queryKey: ["experiences", activeSourceId],
    queryFn: () => api.getExperiences(activeSourceId),
    enabled: activeSourceId !== null,
    refetchOnWindowFocus: false,
  });

  const selectedExperiences = useMemo(
    () => (experiencesQuery.data?.experiences ?? []).filter((experience) => experience.selected),
    [experiencesQuery.data],
  );

  const factExperienceId = resolveFactExperienceId(activeExperienceId, selectedExperiences);
  const validActiveExperienceId = factExperienceId === activeExperienceId ? activeExperienceId : null;
  const factQuery = useQuery({
    queryKey: ["fact-completion", factExperienceId],
    queryFn: () => api.getFactCompletion(factExperienceId!),
    enabled: factExperienceId !== null && currentStep === "fact_completion",
  });

  const dossiersQuery = useQuery({
    queryKey: ["dossiers"],
    queryFn: api.getDossiers,
    enabled: currentStep === "dossier_profile" && activeSourceId !== null,
  });

  const rewriteQuery = useQuery({
    queryKey: ["resume-rewrite", activeJobTarget?.id, activeJobAnalysis?.version],
    queryFn: async () => {
      if (!activeJobTarget || !activeJobAnalysis) throw new Error("请先完成有效的岗位适配决策。");
      const result = await api.getJobResumeRewrite(activeJobTarget.id, activeJobAnalysis.version);
      return result ? { content: result.content, revision: result.revision } : null;
    },
    enabled: currentStep === "resume_rewrite" && activeSourceId !== null && activeJobTarget !== null && activeJobAnalysis !== null,
  });

  const hasConfirmedPositioning = Boolean(positioningDecision.selectedOptionId && positioningDecision.confirmedOptionTitle);

  useEffect(() => {
    const snapshot = workspaceQuery.data;
    if (!snapshot) return;
    const snapshotSourceId = snapshot.activeSource?.id ?? null;
    const sourceChanged = lastWorkspaceSourceIdRef.current !== snapshotSourceId;
    lastWorkspaceSourceIdRef.current = snapshotSourceId;
    setActiveSourceId(snapshot.activeSource?.id ?? null);
    if (!snapshot.activeSource) {
      setActiveExperienceId(null);
      setPositioningDecision(EMPTY_POSITIONING_DECISION);
      setActiveJobTarget(null);
      setActiveJobAnalysis(null);
      if (workflowMode !== "goal_setup") {
        setCurrentStep("resume_import");
      }
      return;
    }
    const savedGoalSetup = snapshot.activeGoalSetup ?? EMPTY_GOAL_SETUP;
    const savedDecision = snapshot.activePositioningDecision ?? EMPTY_POSITIONING_DECISION;
    setGoalSetupDraft(savedGoalSetup);
    setPositioningDecision(savedDecision);
    setActiveJobTarget(snapshot.currentJobTarget ?? null);
    setActiveJobAnalysis(snapshot.currentJobFitAnalysis ?? null);
    if (snapshot.selectedExperienceIds.length > 0 && !activeExperienceId) {
      setActiveExperienceId(snapshot.selectedExperienceIds[0]!);
    }
    if (workflowMode !== "goal_setup" && sourceChanged) {
      setWorkflowMode("steps");
      setCurrentStep(
        getSuggestedStep(
          snapshot.activeStatuses,
          true,
          Boolean(savedDecision.selectedOptionId && savedDecision.confirmedOptionTitle),
          isLatestCurrentApply(snapshot.currentJobTarget ?? null, snapshot.currentJobFitAnalysis ?? null),
        ),
      );
    }
  }, [workspaceQuery.data, setActiveSourceId, setCurrentStep, activeExperienceId, setActiveExperienceId, workflowMode]);

  useEffect(() => {
    if (experiencesQuery.data?.experiences) {
      setDraftExperiences(experiencesQuery.data.experiences);
      setSelectedIds(experiencesQuery.data.experiences.filter((experience) => experience.selected).map((experience) => experience.id));
      setExpandedExperienceIds((current) => current.length ? current : experiencesQuery.data.experiences.slice(0, 1).map((experience) => experience.id));
      return;
    }
    setDraftExperiences([]);
    setSelectedIds([]);
    setExpandedExperienceIds([]);
  }, [experiencesQuery.data]);

  useEffect(() => {
    factDraftRef.current = factDraft;
  }, [factDraft]);

  useEffect(() => {
    setRewriteDraft(rewriteQuery.data?.content ?? null);
    setJobRewriteRevision(rewriteQuery.data?.revision ?? 0);
  }, [rewriteQuery.data]);

  const refreshWorkspace = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workspace"] }),
      queryClient.invalidateQueries({ queryKey: ["experiences"] }),
      queryClient.invalidateQueries({ queryKey: ["fact-completion"] }),
      queryClient.invalidateQueries({ queryKey: ["dossiers"] }),
      queryClient.invalidateQueries({ queryKey: ["resume-rewrite"] }),
    ]);
  };

  const textImportMutation = useMutation({
    mutationFn: () => api.importTextResume(textResume),
    onSuccess: async (payload) => {
      if (hasGoalSetupContent(goalSetupDraft)) {
        await api.saveGoalSetup(goalSetupDraft);
      }
      clearStorageKey(GOAL_SETUP_PENDING_KEY);
      setViewMode("workflow");
      setWorkflowMode("steps");
      setActiveSourceId(payload.source.id);
      setCurrentStep("baseline_review");
      await refreshWorkspace();
    },
  });

  const pdfImportMutation = useMutation({
    mutationFn: () => api.importPdfResume(selectedFile!),
    onMutate: () => {
      setPdfImportStatus("parsing");
    },
    onSuccess: async (payload) => {
      if (hasGoalSetupContent(goalSetupDraft)) {
        await api.saveGoalSetup(goalSetupDraft);
      }
      clearStorageKey(GOAL_SETUP_PENDING_KEY);
      setPdfImportStatus("success");
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      setViewMode("workflow");
      setWorkflowMode("steps");
      setActiveSourceId(payload.source.id);
      setCurrentStep("baseline_review");
      await refreshWorkspace();
    },
    onError: () => {
      setPdfImportStatus("failure");
    },
  });

  const startNewDraftMutation = useMutation({
    mutationFn: api.startNewWorkspace,
    onSuccess: async () => {
      setViewMode("workflow");
      setWorkflowMode("goal_setup");
      setActiveSourceId(null);
      setActiveExperienceId(null);
      setCurrentStep("resume_import");
      setTextResume("");
      setSelectedFile(null);
      setPdfImportStatus("idle");
      setFactDraft("");
      setRewriteDraft(null);
      setGoalSetupDraft(readStorageJson(GOAL_SETUP_PENDING_KEY, EMPTY_GOAL_SETUP));
      setPositioningDecision(EMPTY_POSITIONING_DECISION);
      await refreshWorkspace();
    },
  });

  const reimportResumeMutation = useMutation({
    mutationFn: api.startNewWorkspace,
    onSuccess: async () => {
      setWorkflowMode("steps");
      setActiveSourceId(null);
      setActiveExperienceId(null);
      setCurrentStep("resume_import");
      setTextResume("");
      setSelectedFile(null);
      setPdfImportStatus("idle");
      setRecognitionCandidates(null);
      setRecognitionSummaryVisible(false);
      await refreshWorkspace();
    },
  });

  const recognizeExperiencesMutation = useMutation({
    mutationFn: api.recognizeExperiences,
    onSuccess: ({ experiences }) => {
      setRecognitionCandidates(experiences.map((experience) => ({
        ...experience,
        included: true,
        reviewed: false,
      })));
      setRecognitionIndex(0);
      setRecognitionSummaryVisible(false);
    },
  });

  const applyRecognitionMutation = useMutation({
    mutationFn: (candidates: RecognitionCandidate[]) => api.saveExperiences(
      candidates
        .filter((candidate) => candidate.included)
        .map(({ included: _included, reviewed: _reviewed, ...experience }) => experience),
    ),
    onSuccess: async ({ experiences }) => {
      setDraftExperiences(experiences);
      setRecognitionCandidates(null);
      setRecognitionSummaryVisible(false);
      setExpandedExperienceIds(experiences.slice(0, 1).map((experience) => experience.id));
      await refreshWorkspace();
    },
  });

  const activateDraftMutation = useMutation({
    mutationFn: (sourceId: number) => api.activateWorkspace(sourceId),
    onSuccess: async (payload) => {
      setViewMode("workflow");
      setWorkflowMode("steps");
      setActiveSourceId(payload.source.id);
      await refreshWorkspace();
    },
  });

  const deleteDraftMutation = useMutation({
    mutationFn: (sourceId: number) => api.deleteWorkspace(sourceId),
    onSuccess: async ({ deletedSourceId }) => {
      if (activeSourceId === deletedSourceId) {
        setActiveSourceId(null);
        setActiveExperienceId(null);
        setCurrentStep("resume_import");
      }
      await refreshWorkspace();
    },
  });

  const saveGoalSetupMutation = useMutation({
    mutationFn: (payload: GoalSetupState) => api.saveGoalSetup(payload),
    onSuccess: async (payload) => {
      setGoalSetupDraft(payload);
      await refreshWorkspace();
    },
  });

  const savePositioningDecisionMutation = useMutation({
    mutationFn: (payload: PositioningDecisionState) => api.savePositioningDecision(payload),
    onSuccess: async (payload) => {
      setPositioningDecision(payload);
      await refreshWorkspace();
    },
  });

  const saveBaselineMutation = useMutation({
    mutationFn: () => api.saveExperiences(draftExperiences),
    onSuccess: async () => {
      setCurrentStep("deep_dive_selection");
      await refreshWorkspace();
    },
  });

  const selectDeepDiveMutation = useMutation({
    mutationFn: () => api.selectExperiences(selectedIds),
    onSuccess: async () => {
      setActiveExperienceId(selectedIds[0] ?? null);
      setCurrentStep("fact_completion");
      await refreshWorkspace();
    },
  });

  const submitFactMutation = useMutation({
    mutationFn: ({ experienceId, answer }: { experienceId: number; answer: string }) =>
      api.streamFactCompletionMessage(experienceId, answer, (delta) => {
        setStreamingAssistantMessage((current) => current + delta);
      }),
    onMutate: ({ answer }) => {
      setPendingFactMessage(answer);
      setStreamingAssistantMessage("");
      setFactDraft("");
    },
    onSuccess: async (payload, variables) => {
      queryClient.setQueryData(["fact-completion", variables.experienceId], (current: typeof factQuery.data) =>
        current
          ? {
              ...current,
              conversation: payload.conversation,
              visibleGaps: payload.gaps,
              experience: payload.experience,
              completion: payload.completion,
              overallCompletion: payload.overallCompletion,
            }
          : current,
      );
      queryClient.setQueryData<WorkspaceSnapshotDto>(["workspace"], (current) => current
        ? {
            ...current,
            overallCompletion: payload.overallCompletion,
            activeStatuses: {
              ...current.activeStatuses,
              fact_completion: payload.overallCompletion.canProceed,
            },
          }
        : current);
      setPendingFactMessage(null);
      setStreamingAssistantMessage("");
    },
    onError: (_error, variables) => {
      setFactDraft((current) => current || variables.answer);
    },
    onSettled: () => {
      factSubmitLockRef.current = false;
      setPendingFactMessage(null);
      setStreamingAssistantMessage("");
    },
  });

  const reviewFactMutation = useMutation({
    mutationFn: ({
      experienceId,
      payload,
    }: {
      experienceId: number;
      payload: FactCompletionReviewPayloadDto;
    }) => api.reviewFactCompletion(experienceId, payload),
    onSuccess: (result, variables) => {
      queryClient.setQueryData(["fact-completion", variables.experienceId], (current: typeof factQuery.data) =>
        current
          ? {
              ...current,
              completion: result.completion,
              overallCompletion: result.overallCompletion,
              visibleGaps: result.completion.gaps,
            }
          : current,
      );
      queryClient.setQueryData<WorkspaceSnapshotDto>(["workspace"], (current) => current
        ? {
            ...current,
            overallCompletion: result.overallCompletion,
            activeStatuses: {
              ...current.activeStatuses,
              fact_completion: result.overallCompletion.canProceed,
            },
          }
        : current);
    },
  });

  const generateDossiersMutation = useMutation({
    mutationFn: api.generateDossiers,
    onSuccess: async () => {
      await refreshWorkspace();
      await queryClient.invalidateQueries({ queryKey: ["dossiers"] });
    },
  });

  const generateRewriteMutation = useMutation({
    mutationFn: async () => {
      if (!activeJobTarget || !activeJobAnalysis) throw new Error("请先完成有效的岗位适配决策。");
      const result = await api.generateJobResumeRewrite(activeJobTarget.id, activeJobAnalysis.version);
      setJobRewriteRevision(result.revision);
      return result.content;
    },
    onSuccess: async () => {
      await refreshWorkspace();
      await queryClient.invalidateQueries({ queryKey: ["resume-rewrite"] });
    },
  });

  const saveRewriteMutation = useMutation({
    mutationFn: async (payload: ResumeRewriteOutputDto) => {
      if (!activeJobTarget || !activeJobAnalysis) throw new Error("请先完成有效的岗位适配决策。");
      const result = await api.saveJobResumeRewrite(activeJobTarget.id, {
        analysisVersion: activeJobAnalysis.version,
        expectedRevision: jobRewriteRevision,
        content: payload,
      });
      return { content: result.content, revision: result.revision };
    },
    onSuccess: async (payload) => {
      setRewriteDraft(payload.content);
      setJobRewriteRevision(payload.revision);
      await refreshWorkspace();
      await queryClient.invalidateQueries({ queryKey: ["resume-rewrite"] });
    },
  });

  const statuses = workspaceQuery.data?.activeStatuses ?? {
    resume_import: false,
    baseline_review: false,
    deep_dive_selection: false,
    fact_completion: false,
    dossier_profile: false,
    job_fit_decision: false,
    resume_rewrite: false,
  };
  const hasActiveSource = Boolean(workspaceQuery.data?.activeSource);
  const hasCurrentApply = isLatestCurrentApply(activeJobTarget, activeJobAnalysis);
  const resolvedStep = getResolvedStep(currentStep, statuses, hasActiveSource, hasConfirmedPositioning, hasCurrentApply);

  const errorMessage =
    textImportMutation.error?.message ??
    startNewDraftMutation.error?.message ??
    activateDraftMutation.error?.message ??
    deleteDraftMutation.error?.message ??
    saveGoalSetupMutation.error?.message ??
    savePositioningDecisionMutation.error?.message ??
    reimportResumeMutation.error?.message ??
    recognizeExperiencesMutation.error?.message ??
    applyRecognitionMutation.error?.message ??
    saveBaselineMutation.error?.message ??
    selectDeepDiveMutation.error?.message ??
    submitFactMutation.error?.message ??
    reviewFactMutation.error?.message ??
    generateDossiersMutation.error?.message ??
    generateRewriteMutation.error?.message ??
    saveRewriteMutation.error?.message ??
    workspaceQuery.error?.message ??
    experiencesQuery.error?.message ??
    factQuery.error?.message ??
    dossiersQuery.error?.message ??
    rewriteQuery.error?.message;

  const showFactEntryChoices = (factQuery.data?.conversation ?? []).every((turn) => turn.role !== "user");
  const completion = factQuery.data?.completion;
  const overallCompletion = factQuery.data?.overallCompletion ?? workspaceQuery.data?.overallCompletion;
  const completedSelectedCount = overallCompletion?.completedCount ?? 0;
  const totalSelectedCount = overallCompletion?.totalCount ?? selectedExperiences.length;
  const factCanProceed = overallCompletion?.canProceed ?? statuses.fact_completion;
  const factComposerError = submitFactMutation.error?.message ?? reviewFactMutation.error?.message ?? factQuery.error?.message;
  const drafts = workspaceQuery.data?.drafts ?? [];
  const positioningOptions = buildPositioningOptions(dossiersQuery.data?.profile ?? null, dossiersQuery.data?.dossiers ?? [], draftExperiences);
  const selectedPositioningOption = positioningOptions.find((option) => option.id === positioningDecision.selectedOptionId) ?? null;
  const decoratedDrafts = drafts.map((draft) => {
    const savedGoal = draft.goalSetup ?? EMPTY_GOAL_SETUP;
    const enrichedTitle = savedGoal.targetRole ? `${savedGoal.targetRole} · ${draft.title}` : draft.title;
    const enrichedSubtitle = savedGoal.mainSellingPoint ? `${draft.subtitle} · 主打：${savedGoal.mainSellingPoint}` : draft.subtitle;
    return {
      ...draft,
      title: enrichedTitle,
      subtitle: enrichedSubtitle,
    };
  });

  useEffect(() => {
    if (resolvedStep !== currentStep) {
      setCurrentStep(resolvedStep);
    }
  }, [resolvedStep, currentStep, setCurrentStep]);

  useEffect(() => {
    if (resolvedStep !== "fact_completion") return;
    if (!selectedExperiences.length) return;
    if (validActiveExperienceId) return;
    setActiveExperienceId(selectedExperiences[0]!.id);
  }, [resolvedStep, selectedExperiences, validActiveExperienceId, setActiveExperienceId]);

  useEffect(() => {
    if (submitFactMutation.isPending) return;
    factSubmitLockRef.current = false;
    setPendingFactMessage(null);
    setStreamingAssistantMessage("");
    submitFactMutation.reset();
  }, [factExperienceId]); // Clear stale composer state after switching to another experience.

  useEffect(() => () => {
    shouldKeepDictatingRef.current = false;
    if (restartTimeoutRef.current !== null) {
      window.clearTimeout(restartTimeoutRef.current);
    }
    recognitionRef.current?.stop();
  }, []);

  const toggleDictation = () => {
    const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;
    if (!recognitionRef.current) {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = "zh-CN";
      recognition.continuous = true;
      recognition.interimResults = true;
      let baseText = "";
      let finalTranscript = "";
      recognition.onstart = () => {
        baseText = factDraftRef.current.trimEnd();
        finalTranscript = "";
        setDictating(true);
      };
      recognition.onresult = (event) => {
        let interim = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const chunk = event.results[index]?.[0]?.transcript ?? "";
          if (event.results[index]?.isFinal) {
            finalTranscript += chunk;
          } else {
            interim += chunk;
          }
        }
        const merged = [baseText, `${finalTranscript}${interim}`.trim()].filter(Boolean).join(baseText.endsWith(" ") ? "" : " ");
        setFactDraft(merged.trim());
      };
      recognition.onend = () => {
        if (shouldKeepDictatingRef.current) {
          restartTimeoutRef.current = window.setTimeout(() => {
            recognitionRef.current?.start();
          }, 180);
          return;
        }
        setDictating(false);
      };
      recognition.onerror = (event) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          shouldKeepDictatingRef.current = false;
          setDictating(false);
        }
      };
      recognitionRef.current = recognition;
    }

    if (dictating) {
      shouldKeepDictatingRef.current = false;
      recognitionRef.current?.stop();
    } else {
      shouldKeepDictatingRef.current = true;
      recognitionRef.current?.start();
    }
  };

  const handleSubmitFact = () => {
    const answer = factDraft.trim();
    if (!answer || factSubmitLockRef.current || submitFactMutation.isPending || !factExperienceId) {
      return;
    }
    factSubmitLockRef.current = true;
    if (dictating) {
      shouldKeepDictatingRef.current = false;
      recognitionRef.current?.stop();
    }
    submitFactMutation.mutate({ experienceId: factExperienceId, answer });
  };

  const handleFactReview = (action: FactCompletionReviewPayloadDto["action"]) => {
    if (!factExperienceId || !completion || reviewFactMutation.isPending) return;
    reviewFactMutation.mutate({
      experienceId: factExperienceId,
      payload: {
        action,
        expectedFactVersion: completion.factVersion,
      },
    });
  };

  const focusNextFactGap = () => {
    const prompt = completion?.nextAction.prompt;
    if (prompt && !factDraft.trim()) {
      setFactDraft(prompt);
    }
    window.setTimeout(() => factTextareaRef.current?.focus(), 0);
  };

  const switchFactExperience = () => {
    if (!factExperienceId || selectedExperiences.length < 2) return;
    const currentIndex = selectedExperiences.findIndex((experience) => experience.id === factExperienceId);
    const next = selectedExperiences[(currentIndex + 1) % selectedExperiences.length];
    setActiveExperienceId(next?.id ?? selectedExperiences[0]!.id);
  };

  const handleGoalSetupContinue = async () => {
    writeStorageJson(GOAL_SETUP_PENDING_KEY, goalSetupDraft);
    if (activeSourceId) {
      await saveGoalSetupMutation.mutateAsync(goalSetupDraft);
    }
    setWorkflowMode("steps");
    setCurrentStep(activeSourceId ? goalSetupReturnStepRef.current : "resume_import");
  };

  const handleConfirmPositioning = async () => {
    if (!activeSourceId || !selectedPositioningOption) {
      return;
    }
    const nextDecision: PositioningDecisionState = {
      ...positioningDecision,
      selectedOptionId: selectedPositioningOption.id,
      confirmedOptionTitle: selectedPositioningOption.title,
    };
    await savePositioningDecisionMutation.mutateAsync(nextDecision);
    setCurrentStep("job_fit_decision");
  };

  if (viewMode === "cover") {
    return (
      <>
      <CoverScreen
        drafts={decoratedDrafts}
        loading={workspaceQuery.isLoading}
        errorMessage={errorMessage}
        onStartNew={() => startNewDraftMutation.mutate()}
        onContinue={(sourceId) => activateDraftMutation.mutate(sourceId)}
        onDelete={(sourceId) => deleteDraftMutation.mutateAsync(sourceId).then(() => undefined)}
        creatingNew={startNewDraftMutation.isPending}
        activatingSourceId={activateDraftMutation.isPending ? activateDraftMutation.variables : null}
        deletingSourceId={deleteDraftMutation.isPending ? deleteDraftMutation.variables : null}
      />
      </>
    );
  }

  if (workflowMode === "goal_setup") {
    return (
      <>
      <GoalSetupScreen
        draft={goalSetupDraft}
        onChange={setGoalSetupDraft}
        onContinue={handleGoalSetupContinue}
        onBack={() => setViewMode("cover")}
      />
      </>
    );
  }

  return (
    <>
    <div className="min-h-screen px-5 py-8 md:px-10">
      <div className="mx-auto max-w-7xl rounded-[32px] border border-white/70 bg-white/80 p-6 shadow-[0_24px_80px_rgba(17,24,39,0.08)] backdrop-blur">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight leading-tight text-ink sm:text-4xl">找工作之前，先认识你自己</h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-600 sm:text-base">
            工作台会围绕你的求职定位、关键经历和简历表达，陪你一步步整理清楚。
          </p>
        </header>

        {errorMessage ? <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div> : null}

        <section className="mb-6 rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-[220px] flex-1">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">本次求职重点</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <InfoChip icon={BriefcaseBusiness} label={goalSetupDraft.targetRole || "目标岗位待补充"} tone="ink" />
                <InfoChip icon={Target} label={goalSetupDraft.mainSellingPoint || "重点优势待补充"} tone="emerald" />
                <InfoChip icon={Compass} label={goalSetupDraft.biggestQuestion || "想解决的问题待补充"} tone="sky" />
                <InfoChip icon={ShieldAlert} label={goalSetupDraft.doNotOversell || "不想夸大的内容待补充"} tone="amber" />
              </div>
            </div>
            <button
              onClick={() => {
                goalSetupReturnStepRef.current = resolvedStep;
                setWorkflowMode("goal_setup");
              }}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
            >
              修改求职目标
            </button>
          </div>
        </section>

        <section className="mb-6 rounded-3xl border border-slate-200 bg-white px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">流程进度</h2>
              <p className="mt-1 text-xs text-slate-500">按步骤完成当前求职方案</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-7">
              {Object.entries(STEP_TITLES).map(([step, title], index, list) => {
                const stepKey = step as StepKey;
                const enabled = canAccessStep(stepKey, statuses, hasActiveSource, hasConfirmedPositioning, hasCurrentApply);
                const done = statuses[stepKey];
                const active = resolvedStep === step;
                const StepIcon = STEP_ICONS[stepKey];
                const stepTitle = title.replace(/^\d+\.\s*/, "");

                return (
                  <div key={step} className="min-w-0">
                    <button
                      disabled={!enabled}
                      aria-current={active ? "step" : undefined}
                      onClick={() => setCurrentStep(stepKey)}
                      className={`group w-full min-w-0 rounded-2xl border px-3 py-3 text-left transition disabled:cursor-not-allowed ${
                        active
                          ? "border-coral/30 bg-coral/5 shadow-[0_8px_24px_rgba(255,107,107,0.12)]"
                          : done
                            ? "border-emerald-200 bg-emerald-50/80"
                            : enabled
                              ? "border-slate-200 bg-slate-50 hover:border-slate-300"
                              : "border-slate-200 bg-slate-50/60 opacity-70"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${
                            active
                              ? "border-coral bg-coral text-white"
                              : done
                                ? "border-emerald-500 bg-emerald-500 text-white"
                                : enabled
                                  ? "border-slate-300 bg-white text-slate-700 group-hover:border-slate-500"
                                  : "border-slate-200 bg-slate-100 text-slate-300"
                          }`}
                        >
                          {done ? <CheckCircle2 className="h-5 w-5" strokeWidth={2.4} /> : <StepIcon className="h-5 w-5" strokeWidth={2.2} />}
                        </span>
                        <div className="min-w-0">
                          <div className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${active ? "text-coral" : done ? "text-emerald-600" : "text-slate-400"}`}>
                            第 {index + 1} 步
                          </div>
                          <div className={`mt-0.5 text-sm font-medium leading-snug ${active ? "text-ink" : enabled ? "text-slate-700" : "text-slate-400"}`}>
                            {stepTitle}
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">

          <main className="space-y-6">
            {resolvedStep === "resume_import" ? (
              <section className="rounded-3xl border border-slate-200 bg-white p-6">
                <h2 className="text-3xl font-semibold">导入简历</h2>
                <p className="mt-2 text-sm text-slate-600">先导入现有简历。系统会整理出主要经历，之后再逐步核对，不需要一次补齐所有细节。</p>
                <div className="mt-5 grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">为什么现在做这个</div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">先把现有简历整理成清晰的经历清单，后面才能判断哪些经历最值得重点讲、还缺哪些事实。</p>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-800">做完你会得到什么</div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">一份可以直接核对的经历总览，不用从空白表单开始填写。</p>
                  </div>
                </div>
                <div className="mt-6 grid gap-6 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <h3 className="text-lg font-semibold">文本粘贴</h3>
                    <textarea
                      value={textResume}
                      onChange={(event) => setTextResume(event.target.value)}
                      className="mt-3 h-72 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                      placeholder="把 Markdown 或纯文本简历粘贴到这里"
                    />
                    <button
                      onClick={() => textImportMutation.mutate()}
                      disabled={!textResume.trim() || textImportMutation.isPending}
                      className="mt-4 rounded-2xl bg-coral px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      解析并导入文本简历
                    </button>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <h3 className="text-lg font-semibold">PDF 上传</h3>
                    <label
                      className={`mt-3 flex h-40 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-5 text-center text-sm text-slate-500 ${
                        pdfImportStatus === "parsing" || pdfImportStatus === "success" ? "cursor-not-allowed opacity-70" : "cursor-pointer"
                      }`}
                    >
                      <input
                        type="file"
                        accept=".pdf"
                        aria-label="选择 PDF 简历"
                        className="hidden"
                        disabled={pdfImportStatus === "parsing" || pdfImportStatus === "success"}
                        onChange={(event) => {
                          setSelectedFile(event.target.files?.[0] ?? null);
                          setPdfImportStatus("idle");
                          pdfImportMutation.reset();
                        }}
                      />
                      {selectedFile ? selectedFile.name : "选择 PDF 简历"}
                    </label>
                    {pdfImportStatus === "parsing" ? (
                      <div role="status" className="mt-3 flex items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                        <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
                        <div>
                          <div className="font-semibold">正在解析 PDF</div>
                          <div className="mt-0.5 text-xs text-sky-700">正在提取简历内容并识别工作经历，请稍候。</div>
                        </div>
                      </div>
                    ) : null}
                    {pdfImportStatus === "success" ? (
                      <div role="status" className="mt-3 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                        <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                        <div>
                          <div className="font-semibold">PDF 解析成功</div>
                          <div className="mt-0.5 text-xs text-emerald-700">正在进入经历梳理。</div>
                        </div>
                      </div>
                    ) : null}
                    {pdfImportStatus === "failure" ? (
                      <div role="alert" className="mt-3 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                        <div>
                          <div className="font-semibold">PDF 解析失败</div>
                          <div className="mt-0.5 text-xs leading-5 text-red-700">{pdfImportMutation.error?.message ?? "请检查文件后重新尝试。"}</div>
                        </div>
                      </div>
                    ) : null}
                    <button
                      onClick={() => pdfImportMutation.mutate()}
                      disabled={!selectedFile || pdfImportStatus === "parsing" || pdfImportStatus === "success"}
                      className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-ink px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {pdfImportStatus === "parsing" ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                      {pdfImportStatus === "parsing"
                        ? "正在解析 PDF"
                        : pdfImportStatus === "failure"
                          ? "重新解析 PDF"
                          : pdfImportStatus === "success"
                            ? "解析成功"
                            : "解析并导入 PDF 简历"}
                    </button>
                  </div>
                </div>
              </section>
            ) : null}

            {resolvedStep === "baseline_review" ? (
              <section className="rounded-3xl border border-slate-200 bg-white p-6">
                <h2 className="text-3xl font-semibold">核对经历</h2>
                <p className="mt-2 text-sm text-slate-600">先核对系统整理出的经历，改正遗漏或错误，再决定哪些地方需要补充。不用现在重写整份简历。</p>
                <div className="mt-5 grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">为什么现在做这个</div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">先确认经历的基本信息和主线是否准确，避免后面围绕错误内容继续补充。</p>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-800">做完你会得到什么</div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">一份更准确的经历底稿，以及每段经历下一步最值得补充的方向。</p>
                  </div>
                </div>
                {!recognitionCandidates ? (
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">识别结果不准确？</div>
                      <p className="mt-1 text-sm text-slate-600">可以重新识别当前简历并逐段确认，也可以重新导入一份简历。当前草稿会保留。</p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() => reimportResumeMutation.mutate()}
                        disabled={reimportResumeMutation.isPending}
                        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50"
                      >
                        {reimportResumeMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileUp className="h-4 w-4" aria-hidden="true" />}
                        重新导入简历
                      </button>
                      <button
                        onClick={() => recognizeExperiencesMutation.mutate()}
                        disabled={recognizeExperiencesMutation.isPending}
                        className="inline-flex items-center gap-2 rounded-2xl bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {recognizeExperiencesMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
                        {recognizeExperiencesMutation.isPending ? "正在重新识别" : "重新识别当前简历"}
                      </button>
                    </div>
                  </div>
                ) : null}
                {recognitionCandidates ? (() => {
                  const candidate = recognitionCandidates[recognitionIndex];
                  const includedCandidates = recognitionCandidates.filter((item) => item.included);
                  if (!candidate) return null;
                  if (recognitionSummaryVisible) {
                    return (
                      <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-coral">确认完成</div>
                            <h3 className="mt-2 text-2xl font-semibold">应用这次识别结果</h3>
                            <p className="mt-2 text-sm leading-6 text-slate-600">将保留 {includedCandidates.length} 段工作经历。保存后才会替换当前核对页的内容，并清除依赖旧经历的后续结果。</p>
                          </div>
                          <button
                            onClick={() => setRecognitionCandidates(null)}
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                          >
                            取消重新识别
                          </button>
                        </div>
                        <div className="mt-5 space-y-3">
                          {includedCandidates.map((item) => (
                            <div key={item.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                              <div className="font-semibold text-slate-800">{item.company} | {item.role}</div>
                              <div className="mt-1 text-sm text-slate-500">{item.timeframe}</div>
                            </div>
                          ))}
                        </div>
                        {includedCandidates.length === 0 ? (
                          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">至少需要保留一段工作经历。</div>
                        ) : null}
                        <div className="mt-5 flex flex-wrap justify-between gap-3">
                          <button
                            onClick={() => {
                              setRecognitionSummaryVisible(false);
                              setRecognitionIndex(Math.max(0, recognitionCandidates.length - 1));
                            }}
                            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
                          >
                            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                            返回修改
                          </button>
                          <button
                            onClick={() => applyRecognitionMutation.mutate(recognitionCandidates)}
                            disabled={includedCandidates.length === 0 || applyRecognitionMutation.isPending}
                            className="inline-flex items-center gap-2 rounded-2xl bg-coral px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            {applyRecognitionMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                            {applyRecognitionMutation.isPending ? "正在保存" : "应用识别结果"}
                          </button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-coral">逐段确认 {recognitionIndex + 1} / {recognitionCandidates.length}</div>
                          <h3 className="mt-2 text-2xl font-semibold">这是一段真实的工作经历吗？</h3>
                          <p className="mt-2 text-sm leading-6 text-slate-600">先确认公司、角色和时间。你可以直接修改，全部确认完成前不会覆盖现有内容。</p>
                        </div>
                        <button
                          onClick={() => setRecognitionCandidates(null)}
                          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                        >
                          退出确认
                        </button>
                      </div>
                      <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-coral transition-all" style={{ width: `${((recognitionIndex + 1) / recognitionCandidates.length) * 100}%` }} />
                      </div>
                      <div className="mt-5 grid gap-3 md:grid-cols-3">
                        <TextInput
                          label="公司"
                          value={candidate.company}
                          onChange={(value) => setRecognitionCandidates((current) => current?.map((item, index) => index === recognitionIndex ? { ...item, company: value } : item) ?? null)}
                        />
                        <TextInput
                          label="角色"
                          value={candidate.role}
                          onChange={(value) => setRecognitionCandidates((current) => current?.map((item, index) => index === recognitionIndex ? { ...item, role: value } : item) ?? null)}
                        />
                        <TextInput
                          label="时间"
                          value={candidate.timeframe}
                          onChange={(value) => setRecognitionCandidates((current) => current?.map((item, index) => index === recognitionIndex ? { ...item, timeframe: value } : item) ?? null)}
                        />
                      </div>
                      <TextArea
                        label="这段经历主要在做什么"
                        value={candidate.businessContext}
                        onChange={(value) => setRecognitionCandidates((current) => current?.map((item, index) => index === recognitionIndex ? { ...item, businessContext: value } : item) ?? null)}
                      />
                      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                        <button
                          onClick={() => setRecognitionIndex((index) => Math.max(0, index - 1))}
                          disabled={recognitionIndex === 0}
                          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-40"
                        >
                          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                          上一段
                        </button>
                        <div className="flex flex-wrap gap-3">
                          <button
                            onClick={() => {
                              setRecognitionCandidates((current) => current?.map((item, index) => index === recognitionIndex ? { ...item, included: false, reviewed: true } : item) ?? null);
                              if (recognitionIndex === recognitionCandidates.length - 1) setRecognitionSummaryVisible(true);
                              else setRecognitionIndex((index) => index + 1);
                            }}
                            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
                          >
                            <SkipForward className="h-4 w-4" aria-hidden="true" />
                            这不是工作经历
                          </button>
                          <button
                            onClick={() => {
                              setRecognitionCandidates((current) => current?.map((item, index) => index === recognitionIndex ? { ...item, included: true, reviewed: true } : item) ?? null);
                              if (recognitionIndex === recognitionCandidates.length - 1) setRecognitionSummaryVisible(true);
                              else setRecognitionIndex((index) => index + 1);
                            }}
                            disabled={!candidate.company.trim() || !candidate.role.trim() || !candidate.timeframe.trim()}
                            className="inline-flex items-center gap-2 rounded-2xl bg-coral px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            确认并继续
                            <ArrowRight className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })() : (
                  <>
                <div className="mt-6 space-y-5">
                  {draftExperiences.map((experience, index) => (
                    <article key={experience.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-lg font-semibold">{experience.company} | {experience.role}</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <InfoChip icon={Clock3} label={experience.timeframe || "时间待补充"} tone="slate" />
                            <InfoChip icon={FileSearch} label={experience.outcomes.length ? `结果 ${experience.outcomes.length} 条` : "结果待补充"} tone={experience.outcomes.length ? "emerald" : "amber"} />
                            <InfoChip icon={MessagesSquare} label={experience.evidenceNotes.length ? `事实依据 ${experience.evidenceNotes.length} 条` : "事实依据待补充"} tone={experience.evidenceNotes.length ? "sky" : "amber"} />
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            setExpandedExperienceIds((current) =>
                              current.includes(experience.id)
                                ? current.filter((id) => id !== experience.id)
                                : [...current, experience.id],
                            )
                          }
                          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                        >
                          {expandedExperienceIds.includes(experience.id) ? "收起编辑" : "展开编辑"}
                        </button>
                      </div>
                      <p className="mt-4 text-sm leading-6 text-slate-600">{experience.businessContext || experience.responsibilities[0] || "这段经历还缺一个清晰的背景摘要。"}</p>
                      {expandedExperienceIds.includes(experience.id) ? (
                        <>
                          <div className="mt-5 grid gap-3 md:grid-cols-3">
                            <TextInput label="公司" value={experience.company} onChange={(value) => updateExperience(index, { company: value }, setDraftExperiences)} />
                            <TextInput label="角色" value={experience.role} onChange={(value) => updateExperience(index, { role: value }, setDraftExperiences)} />
                            <TextInput label="时间" value={experience.timeframe} onChange={(value) => updateExperience(index, { timeframe: value }, setDraftExperiences)} />
                          </div>
                          <TextArea
                            label="业务背景"
                            value={experience.businessContext}
                            onChange={(value) => updateExperience(index, { businessContext: value }, setDraftExperiences)}
                          />
                          <TextArea
                            label="项目（每行一条）"
                            value={experience.projects.join("\n")}
                            onChange={(value) => updateExperience(index, { projects: toLines(value) }, setDraftExperiences)}
                          />
                          <TextArea
                            label="职责（每行一条）"
                            value={experience.responsibilities.join("\n")}
                            onChange={(value) => updateExperience(index, { responsibilities: toLines(value) }, setDraftExperiences)}
                          />
                          <TextArea
                            label="结果（每行一条）"
                            value={experience.outcomes.join("\n")}
                            onChange={(value) => updateExperience(index, { outcomes: toLines(value) }, setDraftExperiences)}
                          />
                          <TextArea
                            label="事实依据（每行一条）"
                            value={experience.evidenceNotes.join("\n")}
                            onChange={(value) => updateExperience(index, { evidenceNotes: toLines(value) }, setDraftExperiences)}
                          />
                        </>
                      ) : null}
                    </article>
                  ))}
                </div>
                <button onClick={() => saveBaselineMutation.mutate()} className="mt-6 rounded-2xl bg-coral px-6 py-3 text-sm font-semibold text-white">
                  保存并选择重点经历
                </button>
                  </>
                )}
              </section>
            ) : null}

            {resolvedStep === "deep_dive_selection" ? (
              <section className="rounded-3xl border border-slate-200 bg-white p-6">
                <h2 className="text-3xl font-semibold">选择重点经历</h2>
                <p className="mt-2 text-sm text-slate-600">选择 1–3 段最能支持目标岗位的经历。后续会围绕这些经历补充事实并确认求职定位。</p>
                <div className="mt-5 flex flex-wrap items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <InfoChip icon={Target} label={`已选 ${selectedIds.length} / 3`} tone="coral" />
                  <span className="text-sm text-slate-600">优先选择结果较明确、个人贡献较清楚，并且与目标岗位相关的经历。</span>
                </div>
                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  {draftExperiences.map((experience) => {
                    const checked = selectedIds.includes(experience.id);
                    return (
                      <button
                        key={experience.id}
                        onClick={() => {
                          setSelectedIds((current) => {
                            if (checked) return current.filter((id) => id !== experience.id);
                            if (current.length >= 3) return current;
                            return [...current, experience.id];
                          });
                        }}
                        className={`rounded-3xl border p-5 text-left transition ${
                          checked ? "border-coral bg-[#fff1f1]" : "border-slate-200 bg-slate-50"
                        }`}
                      >
                        <div className="text-lg font-semibold">{experience.company}</div>
                        <div className="mt-1 text-sm text-slate-600">{experience.role}</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {getExperienceSelectionBadges(experience).map((badge) => (
                            <span key={badge} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600">
                              {badge}
                            </span>
                          ))}
                        </div>
                        <div className="mt-4 line-clamp-2 text-sm text-slate-500">{experience.businessContext || experience.responsibilities[0] || "等待补充背景"}</div>
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => selectDeepDiveMutation.mutate()}
                  disabled={selectedIds.length === 0 || selectDeepDiveMutation.isPending}
                  className="mt-6 rounded-2xl bg-coral px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                >
                  确认选择并补充事实
                </button>
              </section>
            ) : null}

            {resolvedStep === "fact_completion" ? (
              <section className="rounded-3xl border border-slate-200 bg-white p-6">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-3xl font-semibold">补充关键事实</h2>
                    <p className="mt-2 text-sm text-slate-600">先从你记得的部分开始。可以自由讲，也可以选一个提示，求职顾问会帮你逐步整理，不会替你补写经历。</p>
                    {completion ? (
                      <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
                        <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                        {FACT_COMPLETION_STATUS_LABELS[completion.status]}
                      </div>
                    ) : null}
                  </div>
                  <select
                    value={factExperienceId ?? ""}
                    onChange={(event) => setActiveExperienceId(Number(event.target.value))}
                    disabled={submitFactMutation.isPending}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {selectedExperiences.map((experience) => {
                      const item = overallCompletion?.items.find((completionItem) => completionItem.experienceId === experience.id);
                      return (
                        <option key={experience.id} value={experience.id}>
                          {experience.company} | {experience.role}{item ? ` · ${FACT_COMPLETION_STATUS_LABELS[item.status]}` : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                    {factQuery.data?.signal ?? "先从你记得的部分开始。"}
                  </div>

                  <div className="mt-4 space-y-4">
                    {factQuery.data?.conversation.map((turn, index) => (
                      <ChatBubble key={`${turn.createdAt}-${index}`} role={turn.role} content={turn.content} />
                    ))}
                    {pendingFactMessage ? <ChatBubble role="user" content={pendingFactMessage} /> : null}
                    {submitFactMutation.isPending && pendingFactMessage ? (
                      <ChatBubble role="assistant" content={streamingAssistantMessage} streaming />
                    ) : null}
                  </div>

                  {completion && ["review_ready", "limits_review", "completed", "completed_with_limits", "stale"].includes(completion.status) ? (
                    <div className="mt-5 rounded-[28px] border border-slate-200 bg-white p-5">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                        已整理的事实摘要
                      </div>
                      <FactSummary summary={completion.factSummary} />
                      {completion.status === "limits_review" && completion.gaps.length > 0 ? (
                        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                          <div className="text-sm font-semibold text-amber-900">目前还缺这些信息</div>
                          <ul className="mt-2 space-y-1 text-sm text-amber-800">
                            {completion.gaps.slice(0, 4).map((gap) => (
                              <li key={`${gap.gapType}-${gap.rationale}`}>{gap.rationale}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {completion.claimRestrictions.length > 0 ? (
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                            后续写作注意事项
                          </div>
                          <ul className="mt-2 space-y-1 text-sm text-slate-600">
                            {completion.claimRestrictions.map((restriction) => (
                              <li key={restriction.code}>{restriction.description}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-5 rounded-[28px] border border-slate-200 bg-white p-4">
                    {showFactEntryChoices ? (
                      <>
                        <div className="text-sm font-medium text-slate-600">如果一时不知道怎么开口，可以先选一个提示。</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {factQuery.data?.entryChoices.map((choice) => (
                            <button
                              key={choice.label}
                              onClick={() => setFactDraft(choice.draft)}
                              disabled={submitFactMutation.isPending}
                              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-left text-sm leading-snug text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50 whitespace-normal break-words"
                            >
                              {choice.label}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                    <div className="mt-4 flex items-end gap-3">
                      <textarea
                        ref={factTextareaRef}
                        value={factDraft}
                        onChange={(event) => setFactDraft(event.target.value)}
                        disabled={submitFactMutation.isPending}
                        onKeyDown={(event) => {
                          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                            event.preventDefault();
                            handleSubmitFact();
                          }
                        }}
                        style={{ height: 140 }}
                        className="min-h-[140px] flex-1 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                        placeholder="从你记得的部分开始，或选择上面的提示。求职顾问会先帮你理清事实，再提炼适合求职表达的内容。"
                      />
                      <button
                        onClick={toggleDictation}
                        disabled={submitFactMutation.isPending}
                        className={`h-14 w-14 shrink-0 rounded-full text-lg font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${dictating ? "bg-red-500" : "bg-ink"}`}
                        aria-label={dictating ? "停止语音听写" : "开始语音听写"}
                      >
                        {dictating ? <MicOff className="mx-auto h-5 w-5" strokeWidth={2.25} /> : <Mic className="mx-auto h-5 w-5" strokeWidth={2.25} />}
                      </button>
                    </div>
                    {factComposerError ? (
                      <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {factComposerError}
                      </div>
                    ) : null}
                    <div className="mt-4 flex justify-end">
                      <button
                        onClick={handleSubmitFact}
                        disabled={!factDraft.trim() || submitFactMutation.isPending}
                        className="inline-flex items-center gap-2 rounded-2xl bg-coral px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {submitFactMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                        {submitFactMutation.isPending ? "求职顾问正在回复" : "发送"}
                      </button>
                    </div>
                    {completion && ["not_started", "collecting", "stale"].includes(completion.status) ? (
                      <div className="mt-3 flex justify-end">
                        <button
                          onClick={() => handleFactReview("request_review")}
                          disabled={submitFactMutation.isPending || reviewFactMutation.isPending}
                          className="rounded-2xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {completion.nextAction.label}
                        </button>
                      </div>
                    ) : null}
                    {completion?.status === "review_ready" ? (
                      <div className="mt-4 flex justify-end">
                        <button
                          onClick={() => handleFactReview("confirm")}
                          disabled={reviewFactMutation.isPending}
                          className="inline-flex items-center gap-2 rounded-2xl bg-coral px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          {completion.nextAction.label}
                        </button>
                      </div>
                    ) : null}
                    {completion?.status === "limits_review" ? (
                      <div className="mt-4 flex flex-wrap justify-end gap-2">
                        <button
                          onClick={focusNextFactGap}
                          className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-500"
                      >
                        再补充一个关键点
                        </button>
                        <button
                          onClick={() => handleFactReview("finish_with_limits")}
                          disabled={reviewFactMutation.isPending}
                          className="rounded-2xl bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {completion.nextAction.label}
                        </button>
                        <button
                          onClick={switchFactExperience}
                          disabled={selectedExperiences.length < 2}
                          className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          换一段经历
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-5 rounded-3xl border border-slate-200 bg-white px-5 py-4">
                  <div className="text-sm font-semibold text-slate-800">每段经历的确认状态</div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {selectedExperiences.map((experience) => {
                      const item = overallCompletion?.items.find((completionItem) => completionItem.experienceId === experience.id);
                      return (
                        <button
                          key={experience.id}
                          onClick={() => setActiveExperienceId(experience.id)}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left"
                        >
                          <span className="min-w-0 truncate text-sm font-medium text-slate-700">{experience.company}</span>
                          <span className="shrink-0 text-xs font-semibold text-slate-500">
                            {item ? <FactCompletionStatusText status={item.status} /> : "未开始"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-slate-500">
                      已确认 {completedSelectedCount}/{totalSelectedCount} 段。有些细节想不起来也可以继续，后续只会使用你确认过的内容。
                    </p>
                    <button
                      onClick={() => setCurrentStep("dossier_profile")}
                      disabled={!factCanProceed}
                      className="rounded-2xl bg-coral px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                    >
                      {factCanProceed && overallCompletion
                        ? overallCompletion.nextAction.label
                        : `进入求职定位（${completedSelectedCount}/${totalSelectedCount}）`}
                    </button>
                  </div>
                </div>
              </section>
            ) : null}

            {resolvedStep === "dossier_profile" ? (
              <section className="rounded-3xl border border-slate-200 bg-white p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-3xl font-semibold">求职定位与经历分析</h2>
                    <p className="mt-2 text-sm text-slate-600">根据已确认的经历，选择这次求职要重点突出的方向，并明确哪些内容不宜夸大。</p>
                  </div>
                  <button
                    onClick={() => generateDossiersMutation.mutate()}
                    disabled={!factCanProceed || generateDossiersMutation.isPending}
                    className="rounded-2xl bg-coral px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                  >
                    生成定位与经历分析
                  </button>
                </div>
                <div className="mt-6 space-y-4">
                  {dossiersQuery.data?.dossiers.map((dossier) => <DossierCard key={dossier.experienceId} dossier={dossier} experiences={draftExperiences} />)}
                </div>
                {dossiersQuery.data?.profile ? (
                  <>
                    <PositioningDecisionPanel
                      goalSetupDraft={goalSetupDraft}
                      options={positioningOptions}
                      decision={positioningDecision}
                      selectedOption={selectedPositioningOption}
                      confirming={savePositioningDecisionMutation.isPending}
                      onChange={(patch) => {
                        const next = { ...positioningDecision, ...patch };
                        setPositioningDecision(next);
                      }}
                      onConfirm={handleConfirmPositioning}
                    />
                    <div className="mt-6 grid gap-4 md:grid-cols-2">
                      <ProfileCard title="经历主线" content={dossiersQuery.data.profile.careerArc} />
                      <ProfileCard title="建议主攻方向" content={dossiersQuery.data.profile.recommendedMainLane} />
                      <ProfileCard title="表达注意事项" content={dossiersQuery.data.profile.positioningBoundary} />
                      <ProfileCard title="稳妥投递策略" content={dossiersQuery.data.profile.conservativeTargetStrategy} />
                      <ProfileListCard title="最突出的能力" items={dossiersQuery.data.profile.strongestThemes} />
                      <ProfileListCard title="还需补强" items={dossiersQuery.data.profile.weakSpots} />
                    </div>
                  </>
                ) : (
                  <div className="mt-6 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-sm text-slate-500">
                    先生成定位与经历分析。这里会同时展示建议方向、事实依据和注意事项，方便你理解每条建议从哪里来。
                  </div>
                )}
              </section>
            ) : null}

            {resolvedStep === "job_fit_decision" && activeSourceId ? (
              <JobFitDecisionStep
                sourceId={activeSourceId}
                onUseAnalysis={(target, analysis) => {
                  setActiveJobTarget(target);
                  setActiveJobAnalysis(analysis);
                  setCurrentStep("resume_rewrite");
                }}
                onRoute={(step, experienceId) => {
                  if (experienceId) setActiveExperienceId(experienceId);
                  setCurrentStep(step);
                }}
              />
            ) : null}

            {resolvedStep === "resume_rewrite" ? (
              <section className="rounded-3xl border border-slate-200 bg-white p-6">
                {activeJobAnalysis && (activeJobAnalysis.validity !== "current" || activeJobAnalysis.decision !== "apply") ? (
                  <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
                    <div className="flex items-center gap-2 font-semibold text-amber-950"><ShieldAlert className="h-5 w-5" />结论已过期</div>
                    <p className="mt-2 text-sm text-amber-900">输入已变化，需要重新分析。岗位版简历暂时不能生成或保存。</p>
                    <button type="button" onClick={() => setCurrentStep("job_fit_decision")} className="mt-4 min-h-11 rounded-2xl bg-coral px-5 text-sm font-semibold text-white">回到岗位适配决策</button>
                  </div>
                ) : (
                <>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-3xl font-semibold">岗位版简历</h2>
                    <p className="mt-2 text-sm text-slate-600">只基于当前岗位、有效的投递结论和已确认事实生成。</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {rewriteDraft ? (
                      <button
                        onClick={() => rewriteDraft && saveRewriteMutation.mutate(rewriteDraft)}
                        disabled={!rewriteDraft || saveRewriteMutation.isPending}
                        className="rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {saveRewriteMutation.isPending ? "正在保存..." : "保存当前版本"}
                      </button>
                    ) : null}
                    <button
                      onClick={() => generateRewriteMutation.mutate()}
                      disabled={!activeJobTarget || !activeJobAnalysis || activeJobAnalysis.validity !== "current" || activeJobAnalysis.decision !== "apply" || generateRewriteMutation.isPending}
                      className="rounded-2xl bg-coral px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                    >
                      {rewriteDraft ? (generateRewriteMutation.isPending ? "正在重新生成..." : "重新生成") : generateRewriteMutation.isPending ? "正在生成..." : "生成简历初稿"}
                    </button>
                  </div>
                </div>
                {activeJobTarget && activeJobAnalysis ? (
                  <div className="mt-5 grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
                    <InfoChip icon={BriefcaseBusiness} label={activeJobTarget.title} tone="ink" />
                    <InfoChip icon={FileSearch} label={`JD revision ${activeJobTarget.revision}`} tone="sky" />
                    <InfoChip icon={ClipboardCheck} label={`analysis v${activeJobAnalysis.version}`} tone="emerald" />
                    <InfoChip icon={ShieldCheck} label={`${activeJobAnalysis.inputSnapshot.experiences.length} 段事实快照`} tone="amber" />
                  </div>
                ) : null}
                {activeJobAnalysis ? (
                  <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-5">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><ShieldAlert className="h-4 w-4" />表达限制</div>
                    <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                      {activeJobAnalysis.inputSnapshot.experiences.flatMap((item) => item.claimRestrictions).length > 0
                        ? activeJobAnalysis.inputSnapshot.experiences.flatMap((item) => item.claimRestrictions).map((item) => <li key={`${item.code}-${item.description}`}>{item.description}</li>)
                        : <li>仅使用事实快照中的已确认内容，不补写未确认的职责、数据或结果。</li>}
                    </ul>
                  </div>
                ) : null}
                <RewriteIntentPanel
                  hasConfirmedPositioning={hasConfirmedPositioning}
                  decision={positioningDecision}
                  selectedOption={selectedPositioningOption}
                  onGoBack={() => setCurrentStep("dossier_profile")}
                />
                <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <BookOpenText className="h-4 w-4" strokeWidth={2.2} />
                    参考知识库
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    修改时如需参考，可以打开下面的资料。
                  </p>
                  <div className="mt-4 space-y-3">
                    {KNOWLEDGE_BASE_LINKS.map((item) => (
                      <a
                        key={item.href}
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4 transition hover:border-slate-300"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                          <div className="mt-1 text-sm leading-6 text-slate-600">{item.description}</div>
                          <div className="mt-2 text-xs uppercase tracking-[0.14em] text-slate-400">{item.source}</div>
                        </div>
                        <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" strokeWidth={2.2} />
                      </a>
                    ))}
                  </div>
                </div>
                {rewriteDraft ? (
                  <EditableRewriteResult output={rewriteDraft} experiences={draftExperiences} onChange={setRewriteDraft} />
                ) : (
                  <div className="mt-6 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-sm text-slate-500">
                    生成后，这里会出现职业总结和经历要点。你可以逐条修改，再保存当前版本。
                  </div>
                )}
                </>
                )}
              </section>
            ) : null}
          </main>

          <aside className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-5">
              <h2 className="text-2xl font-semibold">当前提示</h2>
              <p className="mt-2 text-sm text-slate-600">这里只显示与当前步骤有关的提示和待补内容。</p>
              {resolvedStep === "fact_completion" ? (
                <div className="mt-5 space-y-4">
                  <div className="rounded-2xl bg-sky px-4 py-4 text-sm text-blue-950">
                    {factQuery.data?.panelNote ?? "我会先陪你回到当时的工作场景，再慢慢整理这段经历里的主线、角色和结果线索。"}
                  </div>
                  {factQuery.data?.visibleGaps?.length ? (
                    <div>
                      <div className="mb-2 text-sm font-semibold text-slate-700">还可以补充</div>
                      <div className="space-y-2">
                        {factQuery.data.visibleGaps.map((gap) => (
                          <div key={`${gap.gapType}-${gap.id}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                            <span className="mr-2 inline-block rounded-full bg-slate-200 px-2 py-0.5 text-xs uppercase tracking-wide">{formatSeverity(gap.severity)}</span>
                            {formatGapType(gap.gapType)}：{gap.rationale}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">等你讲出一些内容后，求职顾问会提示还值得补充的部分。</p>
                  )}
                </div>
              ) : (
                <div className="mt-5 rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  到“补充关键事实”阶段，这里会显示已整理的亮点、待补内容和下一条提示。
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
    </>
  );
}

function canAccessStep(
  step: StepKey,
  statuses: WorkspaceSnapshotDto["activeStatuses"],
  hasActiveSource: boolean,
  hasConfirmedPositioning = false,
  hasCurrentApply = false,
) {
  if (step === "resume_import") return true;
  if (!hasActiveSource) return false;
  switch (step) {
    case "baseline_review":
      return statuses.resume_import;
    case "deep_dive_selection":
      return statuses.baseline_review;
    case "fact_completion":
      return statuses.deep_dive_selection;
    case "dossier_profile":
      return statuses.fact_completion;
    case "job_fit_decision":
      return statuses.dossier_profile && hasConfirmedPositioning;
    case "resume_rewrite":
      return hasCurrentApply;
    default:
      return false;
  }
}

function getResolvedStep(
  step: StepKey,
  statuses: WorkspaceSnapshotDto["activeStatuses"],
  hasActiveSource: boolean,
  hasConfirmedPositioning = false,
  hasCurrentApply = false,
): StepKey {
  if (canAccessStep(step, statuses, hasActiveSource, hasConfirmedPositioning, hasCurrentApply)) {
    return step;
  }
  if (step === "resume_rewrite" && statuses.dossier_profile && hasConfirmedPositioning) {
    return "job_fit_decision";
  }
  return "resume_import";
}

function getSuggestedStep(
  statuses: WorkspaceSnapshotDto["activeStatuses"],
  hasActiveSource: boolean,
  hasConfirmedPositioning = false,
  hasCurrentApply = false,
): StepKey {
  if (!hasActiveSource) return "resume_import";
  if (hasCurrentApply) return hasConfirmedPositioning ? "resume_rewrite" : "dossier_profile";
  if (statuses.dossier_profile) return hasConfirmedPositioning ? "job_fit_decision" : "dossier_profile";
  if (statuses.fact_completion) return "dossier_profile";
  if (statuses.deep_dive_selection) return "fact_completion";
  return "baseline_review";
}

function isLatestCurrentApply(target: JobTargetDto | null, analysis: JobFitAnalysisDto | null): boolean {
  return Boolean(
    target
    && analysis
    && target.status === "current"
    && analysis.jobTargetId === target.id
    && target.latestAnalysis?.id === analysis.id
    && target.latestAnalysis.version === analysis.version
    && analysis.validity === "current"
    && analysis.runState === "succeeded"
    && analysis.decision === "apply",
  );
}

function formatDateTime(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function toLines(value: string) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function updateExperience(
  index: number,
  patch: Partial<ExperienceRecordDto>,
  setter: React.Dispatch<React.SetStateAction<ExperienceRecordDto[]>>,
) {
  setter((current) => current.map((experience, cursor) => (cursor === index ? { ...experience, ...patch } : experience)));
}

function buildPositioningOptions(
  profile: WorkspaceSnapshotDto["latestProfile"],
  dossiers: CompanyDossierDto[],
  experiences: ExperienceRecordDto[],
): PositioningOption[] {
  if (!profile) {
    return [];
  }

  const strongestEvidence = dossiers
    .slice(0, 2)
    .flatMap((dossier) => dossier.reusableInterviewAssets.slice(0, 2));
  const selectedExperienceNames = experiences.filter((experience) => experience.selected).map((experience) => `${experience.company} | ${experience.role}`);

  return [
    {
      id: "recommended-main-lane",
      label: "建议方向",
      title: profile.recommendedMainLane,
      summary: `根据现有经历，建议这次简历和自我介绍重点围绕「${profile.recommendedMainLane}」展开。`,
      supportingEvidence: [...profile.strongestThemes.slice(0, 2), ...strongestEvidence].slice(0, 4),
      risk: `需要注意：${profile.positioningBoundary}`,
    },
    {
      id: "strongest-themes",
      label: "突出优势",
      title: `围绕 ${profile.strongestThemes.slice(0, 2).join(" / ")} 讲一条更集中的主线`,
      summary: "如果希望招聘方更快记住你，可以减少次要信息，重点讲已经有事实支持的优势。",
      supportingEvidence: [...profile.strongestThemes, ...selectedExperienceNames].slice(0, 4),
      risk: `需要注意：这个方向更集中，也更需要把「${profile.strongestThemes[0] ?? "核心优势"}」讲具体。`,
    },
    {
      id: "conservative-boundary",
      label: "稳妥方向",
      title: profile.conservativeTargetStrategy,
      summary: "如果你更重视岗位要求，可以先突出最有事实支持的能力，不必把所有优势都放进同一版简历。",
      supportingEvidence: selectedExperienceNames.slice(0, 3),
      risk: "需要注意：表达会更稳妥，但个人特色可能没有前两个方向鲜明。",
    },
  ];
}

function GoalSetupSummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</div>
      <div className="mt-2 text-sm leading-6 text-slate-700">{value}</div>
    </div>
  );
}

function InfoChip({
  icon: Icon,
  label,
  tone,
}: {
  icon: typeof BriefcaseBusiness;
  label: string;
  tone: "ink" | "emerald" | "sky" | "amber" | "coral" | "slate";
}) {
  const toneClasses = {
    ink: "bg-slate-900 text-white",
    emerald: "bg-emerald-100 text-emerald-900",
    sky: "bg-sky-100 text-sky-900",
    amber: "bg-amber-100 text-amber-900",
    coral: "bg-[#ffe6e2] text-[#b84d3d]",
    slate: "bg-slate-100 text-slate-700",
  } satisfies Record<string, string>;

  return (
    <div className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold ${toneClasses[tone]}`}>
      <Icon className="h-3.5 w-3.5" strokeWidth={2.3} />
      <span>{label}</span>
    </div>
  );
}

function getExperienceSelectionBadges(experience: ExperienceRecordDto): string[] {
  const badges: string[] = [];
  if (experience.outcomes.length > 0) {
    badges.push("结果更明确");
  }
  if (experience.evidenceNotes.length > 0) {
    badges.push("事实依据较充分");
  }
  if (experience.responsibilities.length >= 3) {
    badges.push("个人贡献较清楚");
  }
  if (experience.businessContext.includes("AI") || experience.businessContext.includes("增长")) {
    badges.push("和目标方向更贴近");
  }
  return badges.length ? badges : ["建议补背景后再判断"];
}

function GoalSetupScreen({
  draft,
  onChange,
  onContinue,
  onBack,
}: {
  draft: GoalSetupState;
  onChange: (next: GoalSetupState) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <div className="min-h-screen px-5 py-8 md:px-10">
      <div className="mx-auto max-w-5xl rounded-[36px] border border-white/70 bg-white/90 p-8 shadow-[0_24px_80px_rgba(17,24,39,0.08)]">
        <div className="max-w-3xl">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-coral">开始前</div>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-ink">先明确这次求职目标</h1>
          <p className="mt-4 text-sm leading-7 text-slate-600">
            不用现在制定完整计划。先写下目标岗位、想突出的优势和不想夸大的内容，后续建议会更贴近你的需要。
          </p>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <TextArea
            label="这次想投的岗位或方向"
            placeholder="例如：AI 产品经理、海外产品经理、效率工具产品经理"
            value={draft.targetRole}
            onChange={(value) => onChange({ ...draft, targetRole: value })}
          />
          <TextArea
            label="最想突出的优势"
            placeholder="例如：从 0 到 1 产品经验、AI 工作流、海外用户增长"
            value={draft.mainSellingPoint}
            onChange={(value) => onChange({ ...draft, mainSellingPoint: value })}
          />
          <TextArea
            label="最想解决的问题"
            placeholder="例如：我更适合投什么岗位？简历应该重点突出哪段经历？"
            value={draft.biggestQuestion}
            onChange={(value) => onChange({ ...draft, biggestQuestion: value })}
          />
          <TextArea
            label="不想夸大的内容"
            placeholder="例如：不把大团队管理或商业化经验作为主要卖点"
            value={draft.doNotOversell}
            onChange={(value) => onChange({ ...draft, doNotOversell: value })}
          />
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button onClick={onContinue} className="rounded-2xl bg-coral px-6 py-3 text-sm font-semibold text-white">
            下一步：导入简历
          </button>
          <button onClick={onBack} className="rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700">
            返回封面
          </button>
        </div>
      </div>
    </div>
  );
}

function PositioningDecisionPanel({
  goalSetupDraft,
  options,
  decision,
  selectedOption,
  confirming,
  onChange,
  onConfirm,
}: {
  goalSetupDraft: GoalSetupState;
  options: PositioningOption[];
  decision: PositioningDecisionState;
  selectedOption: PositioningOption | null;
  confirming: boolean;
  onChange: (patch: Partial<PositioningDecisionState>) => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">求职方向确认</div>
          <h3 className="mt-2 text-2xl font-semibold text-ink">选择这次简历要重点突出的方向</h3>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
            你开始时填写的是「{goalSetupDraft.targetRole || "目标岗位待补充"} / {goalSetupDraft.mainSellingPoint || "重点优势待补充"}」。
          </p>
          <p className="mt-3 max-w-3xl rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-slate-700">
            操作方法：先点击下面一个方向。系统会自动带出简历重点和表达边界，你可以修改；确认后进入岗位匹配，不会立即改写简历。
          </p>
        </div>
        {decision.confirmedOptionTitle ? <div className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">已确认</div> : null}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {options.map((option) => {
          const active = decision.selectedOptionId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({
                selectedOptionId: option.id,
                confirmedOptionTitle: "",
                keepFocus: option.summary,
                avoidEmphasis: decision.avoidEmphasis || goalSetupDraft.doNotOversell || option.risk.replace(/^需要注意：/u, ""),
              })}
              className={`rounded-3xl border p-5 text-left ${active ? "border-coral bg-[#fff1f1]" : "border-slate-200 bg-white"}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{option.label}</div>
                {active ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-coral"><CheckCircle2 className="h-4 w-4" />已选择</span> : null}
              </div>
              <div className="mt-2 text-lg font-semibold text-ink">{option.title}</div>
              <div className="mt-2 text-sm leading-6 text-slate-600">{option.summary}</div>
              <ul className="mt-4 space-y-2 text-sm text-slate-700">
                {option.supportingEvidence.map((item) => <li key={item}>• {item}</li>)}
              </ul>
              <div className="mt-4 rounded-2xl bg-amber-50 px-3 py-3 text-sm text-amber-900">{option.risk}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <TextArea
          label="招聘方应该首先记住什么？"
          placeholder="例如：海外用户产品经验、从 0 到 1 搭建 AI 产品"
          value={decision.keepFocus}
          onChange={(value) => onChange({ keepFocus: value })}
        />
        <TextArea
          label="哪些内容需要谨慎表达？"
          placeholder="例如：没有数据支持的增长结果，不写成个人独立贡献"
          value={decision.avoidEmphasis}
          onChange={(value) => onChange({ avoidEmphasis: value })}
        />
      </div>
      <details className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">其他补充（可选）</summary>
        <TextArea
          label="还有什么需要这版简历特别注意？"
          placeholder="例如：这版简历优先用于海外 AI 产品岗位"
          value={decision.confirmationNote}
          onChange={(value) => onChange({ confirmationNote: value })}
        />
      </details>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-500">{selectedOption ? `已选择：${selectedOption.title}` : "尚未选择：请点击上方任一方向卡片。"}</div>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!selectedOption || confirming}
          className="rounded-2xl bg-coral px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
        >
          {confirming ? "正在保存方向..." : "确认方向，开始岗位匹配"}
        </button>
      </div>
    </div>
  );
}

function RewriteIntentPanel({
  hasConfirmedPositioning,
  decision,
  selectedOption,
  onGoBack,
}: {
  hasConfirmedPositioning: boolean;
  decision: PositioningDecisionState;
  selectedOption: PositioningOption | null;
  onGoBack: () => void;
}) {
  if (!hasConfirmedPositioning) {
    return (
      <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
        请先确认求职方向和不宜夸大的内容，再生成简历初稿。
        <button onClick={onGoBack} className="ml-3 rounded-xl border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-900">
          返回确认方向
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
      <div className="text-sm font-semibold uppercase tracking-[0.14em] text-emerald-800">本次改写依据</div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <GoalSetupSummaryCard label="重点方向" value={decision.confirmedOptionTitle || selectedOption?.title || "未确认"} />
        <GoalSetupSummaryCard label="重点突出" value={decision.keepFocus || "未填写"} />
        <GoalSetupSummaryCard label="不要夸大" value={decision.avoidEmphasis || "未填写"} />
      </div>
      {decision.confirmationNote ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm leading-6 text-slate-700">
          备注：{decision.confirmationNote}
        </div>
      ) : null}
    </div>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm font-medium text-slate-700">
      <div className="mb-2">{label}</div>
      <input value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none" />
    </label>
  );
}

function TextArea({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mt-4 block text-sm font-medium text-slate-700">
      <div className="mb-2">{label}</div>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        style={{ height: autoHeight(value) }}
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none placeholder:text-slate-400"
      />
    </label>
  );
}

function FactSummary({ summary }: { summary: FactSummaryDto }) {
  const sections = [
    { label: "背景", items: summary.context },
    { label: "你负责的部分", items: summary.ownership },
    { label: "结果", items: summary.outcome },
    { label: "关键判断与取舍", items: summary.depth },
  ].filter((section) => section.items.length > 0);

  if (sections.length === 0) {
    return <p className="mt-3 text-sm text-slate-500">目前还没有足够明确、可以确认的事实。</p>;
  }

  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      {sections.map((section) => (
        <div key={section.label} className="rounded-2xl bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{section.label}</div>
          <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-700">
            {section.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ChatBubble({ role, content, streaming = false }: ChatBubbleProps) {
  const SpeakerIcon = role === "assistant" ? Bot : UserRound;
  return (
    <div className={`max-w-[90%] rounded-3xl px-4 py-4 text-sm leading-7 ${role === "assistant" ? "bg-white" : "ml-auto bg-[#fff1f1]"}`}>
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
        <SpeakerIcon className="h-3.5 w-3.5" strokeWidth={2.25} />
        <span>{role === "assistant" ? "求职顾问" : "你"}</span>
      </div>
      {streaming && !content ? (
        <div className="flex items-center gap-2 text-slate-500">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>正在整理你的经历...</span>
        </div>
      ) : (
        <div className="whitespace-pre-wrap text-slate-700">
          {content}
          {streaming ? <span className="ml-1 inline-block h-4 w-1 animate-pulse rounded-full bg-coral align-middle" aria-hidden="true" /> : null}
        </div>
      )}
    </div>
  );
}

function DossierCard({ dossier, experiences }: { dossier: CompanyDossierDto; experiences: ExperienceRecordDto[] }) {
  const experience = experiences.find((item) => item.id === dossier.experienceId);
  return (
    <details className="rounded-3xl border border-slate-200 bg-slate-50 p-5" open>
      <summary className="cursor-pointer text-lg font-semibold">{experience ? `${experience.company} | ${experience.role}` : `经历 #${dossier.experienceId}`}</summary>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <PanelBlock title="经历事实" content={dossier.factualRecord} />
        <PanelBlock title="求职建议" content={dossier.evaluativeJudgment} />
        <ProfileListCard title="可用于面试的素材" items={dossier.reusableInterviewAssets} />
      </div>
    </details>
  );
}

function ProfileCard({ title, content }: { title: string; content: string }) {
  return <PanelBlock title={title} content={content} />;
}

function ProfileListCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
      <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <ul className="mt-3 space-y-2 text-sm text-slate-700">
        {items.map((item) => <li key={item}>• {item}</li>)}
      </ul>
    </div>
  );
}

function PanelBlock({ title, content }: { title: string; content: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5">
      <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">{content}</div>
    </div>
  );
}

function CoverScreen({
  drafts,
  loading,
  errorMessage,
  onStartNew,
  onContinue,
  onDelete,
  creatingNew,
  activatingSourceId,
  deletingSourceId,
}: {
  drafts: DraftSummaryDto[];
  loading: boolean;
  errorMessage?: string;
  onStartNew: () => void;
  onContinue: (sourceId: number) => void;
  onDelete: (sourceId: number) => Promise<void>;
  creatingNew: boolean;
  activatingSourceId: number | null;
  deletingSourceId: number | null;
}) {
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [processExpanded, setProcessExpanded] = useState(false);
  const [draftToDelete, setDraftToDelete] = useState<DraftSummaryDto | null>(null);
  const historyRef = useRef<HTMLElement | null>(null);
  const currentDraft = drafts.find((draft) => draft.isActive) ?? drafts[0] ?? null;

  const revealSection = (
    setter: React.Dispatch<React.SetStateAction<boolean>>,
    sectionRef: React.RefObject<HTMLElement | null>,
  ) => {
    setter(true);
    const scrollToSection = () => {
      sectionRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(scrollToSection);
    } else {
      scrollToSection();
    }
  };

  return (
    <div className="min-h-screen px-5 py-5 sm:px-6 sm:py-6 md:px-10 md:py-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="overflow-hidden rounded-[30px] border border-white/70 bg-[radial-gradient(circle_at_top_left,_rgba(255,107,107,0.16),_transparent_36%),linear-gradient(135deg,_rgba(255,255,255,0.96),_rgba(244,247,251,0.96))] p-5 shadow-[0_24px_80px_rgba(17,24,39,0.08)] backdrop-blur sm:p-7 md:rounded-[36px] md:p-9">
          <div className="max-w-4xl">
            <div className="text-[11px] font-semibold tracking-[0.13em] text-coral sm:text-xs">
              求职准备工作台
            </div>
            <h1 className="mt-3 max-w-4xl text-[38px] font-semibold leading-[1.08] tracking-[-0.035em] text-ink sm:text-5xl md:text-[52px]">
              把真实经历，整理成更有说服力的求职材料
            </h1>
            <p className="mt-4 max-w-3xl text-[15px] leading-6 text-slate-600 sm:text-base sm:leading-7">
              求职顾问会陪你核对经历、补充关键事实、确认求职方向，再整理成可以继续修改的简历和面试素材。不会替你编造经历，也不会把团队成果算成个人贡献。
            </p>
          </div>

          {errorMessage ? <div role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div> : null}

          <div className="mt-5 max-w-4xl rounded-[24px] border border-white bg-white/90 p-4 shadow-[0_16px_48px_rgba(17,24,39,0.07)] sm:p-5">
            {loading ? (
              <div className="flex min-h-24 items-center gap-3 text-sm font-medium text-slate-600" aria-live="polite">
                <LoaderCircle className="h-5 w-5 animate-spin text-coral" aria-hidden="true" />
                正在读取你的求职方案...
              </div>
            ) : currentDraft ? (
              <CurrentDraftAction
                draft={currentDraft}
                draftCount={drafts.length}
                activating={activatingSourceId === currentDraft.source.id}
                creatingNew={creatingNew}
                onContinue={() => onContinue(currentDraft.source.id)}
                onStartNew={onStartNew}
                onViewAll={() => revealSection(setHistoryExpanded, historyRef)}
                onDelete={() => setDraftToDelete(currentDraft)}
                deleting={deletingSourceId === currentDraft.source.id}
              />
            ) : (
              <div>
                <div className="text-xs font-semibold tracking-[0.12em] text-slate-500">从第一份求职方案开始</div>
                <div className="mt-1 text-lg font-semibold text-ink">先明确目标，再整理现有经历</div>
                <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
                  <button
                    onClick={onStartNew}
                    disabled={creatingNew}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-coral px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(255,90,95,0.24)] transition hover:bg-[#f34f55] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral disabled:opacity-50"
                  >
                    {creatingNew ? "正在创建..." : "开始梳理"}
                    {creatingNew ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" strokeWidth={2.3} aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setProcessExpanded((expanded) => !expanded)}
                    aria-expanded={processExpanded}
                    aria-controls="cover-process-panel"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                  >
                    {processExpanded ? "收起 5 个步骤" : "查看接下来 5 个步骤"}
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${processExpanded ? "rotate-180" : ""}`}
                      strokeWidth={2.2}
                      aria-hidden="true"
                    />
                  </button>
                </div>
                {processExpanded ? (
                  <div
                    id="cover-process-panel"
                    role="region"
                    aria-labelledby="cover-process-title"
                    className="mt-5 border-t border-slate-200 pt-5"
                  >
                    <h2 id="cover-process-title" className="text-lg font-semibold text-ink">接下来怎么进行</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-500">用 5 步把真实经历整理成可以继续修改的求职材料。</p>
                    <ol className="mt-4 grid gap-3 md:grid-cols-5">
                      {["明确求职目标", "导入现有简历", "选择重点经历", "补充关键事实", "确认定位并改写"].map((item, index) => (
                        <li key={item} className="flex gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 md:block">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-coral">{index + 1}</span>
                          <span className="md:mt-2 md:block">{item}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="mt-3 flex max-w-4xl items-start gap-2 text-xs leading-5 text-slate-500">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.2} aria-hidden="true" />
            <span>系统只使用你提供并确认过的内容；所有建议都可以修改或不采用。</span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <CoverValueCard icon={FileSearch} title="经历集中整理" description="把简历、项目和结果整理成一份清晰的经历底稿。" />
            <CoverValueCard icon={MessagesSquare} title="只写确认过的事实" description="逐步补充个人贡献、关键取舍和实际结果，不替你编造。" />
            <CoverValueCard icon={FilePenLine} title="求职材料随时可改" description="生成求职定位、简历要点和面试素材，随时继续完善。" />
          </div>
        </section>

        {drafts.length ? (
          <section ref={historyRef} id="draft-history" className="scroll-mt-5">
            <details
              open={historyExpanded}
              onToggle={(event) => setHistoryExpanded(event.currentTarget.open)}
              className="group rounded-[28px] border border-white/70 bg-white/85 px-5 py-4 shadow-[0_20px_64px_rgba(17,24,39,0.06)] backdrop-blur sm:px-6"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-500 [&::-webkit-details-marker]:hidden">
                <div>
                  <h2 className="text-lg font-semibold text-ink">全部求职方案</h2>
                  <p className="mt-1 text-sm text-slate-500">共 {drafts.length} 份，选择一份继续。</p>
                </div>
                <ChevronDown className="h-5 w-5 shrink-0 text-slate-500 transition group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                {drafts.map((draft) => (
                  <DraftHistoryCard
                    key={draft.source.id}
                    draft={draft}
                    activating={activatingSourceId === draft.source.id}
                    onContinue={() => onContinue(draft.source.id)}
                    deleting={deletingSourceId === draft.source.id}
                    onDelete={() => setDraftToDelete(draft)}
                  />
                ))}
              </div>
            </details>
          </section>
        ) : null}
      </div>
      {draftToDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-5 py-8" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-draft-title"
            className="w-full max-w-md rounded-[28px] border border-white bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.24)]"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-50 text-red-600">
              <Trash2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 id="delete-draft-title" className="mt-4 text-2xl font-semibold text-ink">删除这份求职方案？</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              “{draftToDelete.title}”中的经历、对话、事实记录和生成内容都会永久删除，无法恢复。
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDraftToDelete(null)}
                disabled={deletingSourceId === draftToDelete.source.id}
                className="min-h-11 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await onDelete(draftToDelete.source.id);
                    setDraftToDelete(null);
                  } catch {
                    // The mutation keeps the dialog open so the user can retry safely.
                  }
                }}
                disabled={deletingSourceId === draftToDelete.source.id}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {deletingSourceId === draftToDelete.source.id ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                {deletingSourceId === draftToDelete.source.id ? "正在删除" : "确认删除方案"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CurrentDraftAction({
  draft,
  draftCount,
  activating,
  creatingNew,
  onContinue,
  onStartNew,
  onViewAll,
  onDelete,
  deleting,
}: {
  draft: DraftSummaryDto;
  draftCount: number;
  activating: boolean;
  creatingNew: boolean;
  onContinue: () => void;
  onStartNew: () => void;
  onViewAll: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const progress = getDraftProgress(draft);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold tracking-[0.12em] text-emerald-700">{draftCount > 1 ? `当前方案 · 共 ${draftCount} 份` : "继续上次进度"}</div>
          <h2 className="mt-1 truncate text-lg font-semibold text-ink">{draft.title}</h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
          <Clock3 className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
          更新于 {formatDateTime(draft.updatedAt)}
        </span>
      </div>

      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
            <span>方案进度 {progress.completed}/{progress.total}</span>
            <span className="font-medium text-slate-700">下一步：{progress.nextStep}</span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-label="方案进度"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.completed}
          >
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress.percentage}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          onClick={onContinue}
          disabled={activating}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-coral px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(255,90,95,0.24)] transition hover:bg-[#f34f55] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral disabled:opacity-50"
        >
          {activating ? "正在打开..." : "继续当前方案"}
          {activating ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" strokeWidth={2.3} aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={onStartNew}
          disabled={creatingNew}
          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:opacity-50"
        >
          {creatingNew ? "正在创建..." : "新建方案"}
        </button>
        <button
          type="button"
          onClick={onViewAll}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-2xl px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
          aria-controls="draft-history"
        >
          查看全部方案（{draftCount}）
          <ChevronDown className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          删除方案
        </button>
      </div>
    </div>
  );
}

function DraftHistoryCard({
  draft,
  activating,
  onContinue,
  deleting,
  onDelete,
}: {
  draft: DraftSummaryDto;
  activating: boolean;
  onContinue: () => void;
  deleting: boolean;
  onDelete: () => void;
}) {
  const progress = getDraftProgress(draft);

  return (
    <article className="rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink">{draft.title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">下一步：{progress.nextStep}</p>
        </div>
        {draft.isActive ? <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">当前方案</span> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
        <span className="rounded-full bg-white px-3 py-1">进度 {progress.completed}/{progress.total}</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1">
          <Clock3 className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
          {formatDateTime(draft.updatedAt)}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onContinue}
          disabled={activating || deleting}
          aria-label={`继续方案：${draft.title}`}
          className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:opacity-50"
        >
          {activating ? "正在打开..." : "继续这份方案"}
          <ArrowRight className="h-4 w-4" strokeWidth={2.3} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting || activating}
          aria-label={`删除方案：${draft.title}`}
          className="inline-flex min-h-11 items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:opacity-50"
        >
          {deleting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
          {deleting ? "正在删除" : "删除"}
        </button>
      </div>
    </article>
  );
}

function getDraftProgress(draft: DraftSummaryDto) {
  const currentStage = !draft.statuses.resume_import
    ? 1
    : !draft.statuses.baseline_review
      ? 2
      : !draft.statuses.deep_dive_selection || !draft.statuses.fact_completion
        ? 3
        : !draft.statuses.dossier_profile
          ? 4
          : 5;
  const nextStep = !draft.statuses.resume_import
    ? "导入简历"
    : !draft.statuses.baseline_review
      ? "梳理经历"
      : !draft.statuses.deep_dive_selection
        ? "选择重点经历"
        : !draft.statuses.fact_completion
          ? "补充关键事实"
          : !draft.statuses.dossier_profile
            ? "确认求职定位"
            : !draft.statuses.resume_rewrite
              ? "确认定位并改写简历"
              : "继续完善简历与面试素材";
  const total = 5;

  return {
    completed: currentStage,
    total,
    nextStep,
    percentage: Math.round((currentStage / total) * 100),
  };
}

function CoverValueCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof FileUp;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/75 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
          <Icon className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />
        </span>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-600">{description}</p>
    </div>
  );
}

function EditableRewriteResult({
  output,
  experiences,
  onChange,
}: {
  output: ResumeRewriteOutputDto;
  experiences: ExperienceRecordDto[];
  onChange: (next: ResumeRewriteOutputDto) => void;
}) {
  return (
    <div className="mt-6 space-y-6">
      <label className="block rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">职业总结</div>
        <textarea
          value={output.professionalSummary}
          onChange={(event) => onChange({ ...output, professionalSummary: event.target.value })}
          style={{ height: autoHeight(output.professionalSummary, 5, 18, 56) }}
          className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-700 outline-none"
        />
      </label>
      {Object.entries(output.experienceBulletsByExperienceId).map(([experienceId, bullets]) => {
        const experience = experiences.find((item) => String(item.id) === experienceId);
        return (
          <label key={experienceId} className="block rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="text-lg font-semibold">{experience ? `${experience.company} | ${experience.role}` : `第 ${experienceId} 段经历`}</div>
            <div className="mt-2 text-xs text-slate-500">每行一条简历要点，保存后会保留当前版本。</div>
            <textarea
              value={bullets.join("\n")}
              onChange={(event) =>
                onChange({
                  ...output,
                  experienceBulletsByExperienceId: {
                    ...output.experienceBulletsByExperienceId,
                    [experienceId]: toLines(event.target.value),
                  },
                })}
              style={{ height: autoHeight(bullets.join("\n"), 5, 24, 64) }}
              className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-700 outline-none"
            />
          </label>
        );
      })}
    </div>
  );
}

interface ChatBubbleProps {
  role: ChatTurnDto["role"];
  content: string;
  streaming?: boolean;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
}

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

export default App;
