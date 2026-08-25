import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Archive,
  BriefcaseBusiness,
  CheckCircle2,
  FileSearch,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type { JobFitAnalysisDto, JobTargetDto, StepKey } from "@kys/shared";

import { api } from "../lib/api";

const DECISION_NOTICE = "这是基于当前 JD 与已确认事实的投递决策，不代表招聘结果。";
const DIRTY_CONFIRMATION = "当前修改尚未保存，放弃修改并继续吗？";

type UiMode = "empty" | "create" | "view" | "edit";
type OcrState =
  | { status: "idle" }
  | { status: "recognizing"; progress: number; completedFiles: number; fileCount: number }
  | { status: "success"; fileCount: number }
  | { status: "error"; message: string };

function signature(title: string, jdText: string): string {
  return `${title}\u0000${jdText}`;
}

function derivedTitle(jdText: string): string {
  const first = jdText.split("\n").map((line) => line.trim()).find(Boolean) ?? "未命名岗位";
  return first.replace(/^职位[:：\s]*/u, "").slice(0, 60) || "未命名岗位";
}

function analysisState(analysis: JobFitAnalysisDto | null) {
  if (!analysis) return "unanalyzed";
  if (analysis.validity === "stale") return "stale";
  if (analysis.runState === "failed") return "failure";
  if (analysis.decision === "insufficient") return `insufficient_${analysis.insufficientReason?.replace("_insufficient", "") ?? "both"}`;
  return analysis.decision ?? "unanalyzed";
}

export function JobFitDecisionStep({
  sourceId,
  onUseAnalysis,
  onRoute,
}: {
  sourceId: number;
  onUseAnalysis: (target: JobTargetDto, analysis: JobFitAnalysisDto) => void;
  onRoute: (step: StepKey, experienceId?: number | null) => void;
}) {
  const queryClient = useQueryClient();
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const submitLockRef = useRef(false);
  const createReturnIdRef = useRef<number | null>(null);
  const [mode, setMode] = useState<UiMode>("empty");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftJd, setDraftJd] = useState("");
  const [savedSignature, setSavedSignature] = useState(() => signature("", ""));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [ocrState, setOcrState] = useState<OcrState>({ status: "idle" });

  const targetsQuery = useQuery({
    queryKey: ["job-targets", sourceId],
    queryFn: () => api.getJobTargets(sourceId),
    refetchOnWindowFocus: false,
  });
  const targets = targetsQuery.data?.jobTargets ?? [];
  const target = targets.find((item) => item.id === selectedId) ?? null;
  const analysis = target?.latestAnalysis ?? null;
  const resultState = analysisState(analysis);

  useEffect(() => {
    if (targetsQuery.isPending || mode === "create") return;
    if (targets.length === 0) {
      setSelectedId(null);
      setMode("empty");
      return;
    }
    if (selectedId === null || !targets.some((item) => item.id === selectedId)) {
      const initial = targets.find((item) => item.status === "current") ?? targets[0]!;
      setSelectedId(initial.id);
      setMode("view");
      return;
    }
    if (mode === "empty") setMode("view");
  }, [mode, selectedId, targets, targetsQuery.isPending]);

  useEffect(() => {
    if (!target) return;
    setDraftTitle(target.title);
    setDraftJd(target.jdText);
    setSavedSignature(signature(target.title, target.jdText));
    setSaveError(null);
  }, [target?.id, target?.revision]);

  const createMutation = useMutation({
    mutationFn: (values: { title: string; jdText: string }) => api.createJobTarget({ sourceId, ...values }),
    onSuccess: async (created) => {
      setSelectedId(created.id);
      setSavedSignature(signature(created.title, created.jdText));
      setSaveError(null);
      await queryClient.invalidateQueries({ queryKey: ["job-targets", sourceId] });
    },
    onError: (error) => setSaveError(error.message),
  });
  const updateMutation = useMutation({
    mutationFn: ({ current, title, jdText }: { current: JobTargetDto; title: string; jdText: string }) => api.updateJobTarget(current.id, {
      expectedRevision: current.revision,
      title,
      jdText,
    }),
    onSuccess: async (updated) => {
      setSavedSignature(signature(updated.title, updated.jdText));
      setSaveError(null);
      await queryClient.invalidateQueries({ queryKey: ["job-targets", sourceId] });
    },
    onError: (error) => setSaveError(error.message),
  });
  const analyzeMutation = useMutation({
    mutationFn: ({ id, revision }: { id: number; revision: number }) => api.analyzeJobTarget(id, revision),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["job-targets", sourceId] });
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
    onSettled: () => { submitLockRef.current = false; },
  });
  const archiveMutation = useMutation({
    mutationFn: (current: JobTargetDto) => api.updateJobTargetStatus(current.id, {
      expectedRevision: current.revision,
      status: current.status === "archived" ? "current" : "archived",
    }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["job-targets", sourceId] }),
  });

  const currentSignature = signature(draftTitle, draftJd);
  const isDirty = currentSignature !== savedSignature;
  const saving = createMutation.isPending || updateMutation.isPending;
  const recognizingImages = ocrState.status === "recognizing";
  const busy = saving || analyzeMutation.isPending || archiveMutation.isPending || recognizingImages;

  useEffect(() => {
    if ((mode !== "create" && mode !== "edit") || !draftJd.trim() || !isDirty || busy) return;
    const timer = window.setTimeout(() => {
      const title = draftTitle.trim() || derivedTitle(draftJd);
      setDraftTitle(title);
      if (target) updateMutation.mutate({ current: target, title, jdText: draftJd });
      else createMutation.mutate({ title, jdText: draftJd });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [currentSignature, mode, target?.id, target?.revision, busy]);

  useEffect(() => {
    if (mode !== "create") return;
    const timer = window.setTimeout(() => editorRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [mode]);

  const restrictions = useMemo(() => analysis?.inputSnapshot.experiences.flatMap((item) => item.claimRestrictions) ?? [], [analysis]);

  const canLeaveDraft = () => !isDirty || window.confirm(DIRTY_CONFIRMATION);

  const startCreate = () => {
    if (busy || !canLeaveDraft()) return;
    createReturnIdRef.current = selectedId;
    setSelectedId(null);
    setDraftTitle("");
    setDraftJd("");
    setSavedSignature(signature("", ""));
    setSaveError(null);
    setOcrState({ status: "idle" });
    setMode("create");
  };

  const selectTarget = (id: number) => {
    if (busy || (mode === "view" && id === selectedId) || !canLeaveDraft()) return;
    setSelectedId(id);
    setSaveError(null);
    setMode("view");
  };

  const startEdit = () => {
    if (!target || target.status === "archived" || busy) return;
    setDraftTitle(target.title);
    setDraftJd(target.jdText);
    setSavedSignature(signature(target.title, target.jdText));
    setSaveError(null);
    setOcrState({ status: "idle" });
    setMode("edit");
  };

  const cancelCreate = () => {
    if (target) {
      setMode("view");
      return;
    }
    const returnTarget = targets.find((item) => item.id === createReturnIdRef.current)
      ?? targets.find((item) => item.status === "current")
      ?? targets[0]
      ?? null;
    if (returnTarget) {
      setSelectedId(returnTarget.id);
      setMode("view");
    } else {
      setSelectedId(null);
      setMode("empty");
    }
    setDraftTitle("");
    setDraftJd("");
    setSavedSignature(signature("", ""));
    setSaveError(null);
    setOcrState({ status: "idle" });
  };

  const cancelEdit = () => {
    if (!target) return;
    setDraftTitle(target.title);
    setDraftJd(target.jdText);
    setSavedSignature(signature(target.title, target.jdText));
    setSaveError(null);
    setOcrState({ status: "idle" });
    setMode("view");
  };

  const recognizeScreenshots = async (files: File[]) => {
    if (files.length === 0 || busy) return;
    setOcrState({ status: "recognizing", progress: 0, completedFiles: 0, fileCount: files.length });
    try {
      const { recognizeJobDescriptionImages } = await import("../lib/image-ocr");
      const text = await recognizeJobDescriptionImages(files, (progress) => {
        setOcrState({ status: "recognizing", ...progress });
      });
      setDraftJd((current) => [current.trim(), text].filter(Boolean).join("\n\n"));
      setOcrState({ status: "success", fileCount: files.length });
      window.setTimeout(() => editorRef.current?.focus(), 0);
    } catch (error) {
      setOcrState({ status: "error", message: error instanceof Error ? error.message : "图片识别失败，请重试。" });
    }
  };

  const saveNow = async (): Promise<JobTargetDto | null> => {
    const title = draftTitle.trim() || derivedTitle(draftJd);
    if (!draftJd.trim()) return target;
    if (!isDirty && target) return target;
    setDraftTitle(title);
    if (target) return updateMutation.mutateAsync({ current: target, title, jdText: draftJd });
    return createMutation.mutateAsync({ title, jdText: draftJd });
  };

  const analyze = async () => {
    if (submitLockRef.current || analyzeMutation.isPending || saving || !draftJd.trim()) return;
    submitLockRef.current = true;
    try {
      const saved = await saveNow();
      if (!saved) return;
      await analyzeMutation.mutateAsync({ id: saved.id, revision: saved.revision });
      setMode("view");
    } catch {
      // Mutation errors are rendered in context without discarding the draft.
    } finally {
      submitLockRef.current = false;
    }
  };

  const conditionalGap = analysis?.gaps[0] ?? null;
  const primaryAction = () => {
    if (resultState === "apply" && target && analysis) return onUseAnalysis(target, analysis);
    if (resultState === "conditional" && conditionalGap) return onRoute(
      conditionalGap.remediationTarget === "step_3" ? "deep_dive_selection" : "fact_completion",
      conditionalGap.targetExperienceId,
    );
    if (resultState === "no_go" || resultState === "insufficient_jd") {
      startEdit();
      window.setTimeout(() => {
        editorRef.current?.focus();
        editorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
      return;
    }
    if (resultState === "insufficient_facts") return onRoute("fact_completion", analysis?.inputSnapshot.selectedExperienceIds[0]);
    if (resultState === "insufficient_both") return onRoute("deep_dive_selection");
    void analyze();
  };

  const primaryLabel = resultState === "apply" ? "进入岗位版简历"
    : resultState === "conditional" ? (conditionalGap?.remediationTarget === "step_3" ? "调整重点经历" : "补充指定事实")
      : resultState === "no_go" ? "换一个 JD"
        : resultState === "insufficient_jd" ? "补充完整 JD"
          : resultState === "insufficient_facts" ? "去补充关键事实"
            : resultState === "insufficient_both" ? "重新选择重点经历"
              : resultState === "stale" ? "重新分析"
                : resultState === "failure" ? "重试分析"
                  : analyzeMutation.isPending ? "正在分析"
                    : "分析这个岗位";

  const editorTitle = mode === "create" ? "新增岗位" : `编辑「${target?.title ?? draftTitle}」`;
  const saveLabel = saving ? "正在自动保存"
    : saveError ? "保存失败，输入仍保留"
      : isDirty ? "等待自动保存"
        : target ? "已自动保存" : "尚未创建";

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-coral"><FileSearch className="h-4 w-4" />第 6 步</div>
          <h2 className="mt-2 text-3xl font-semibold text-ink">岗位适配决策</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">粘贴一个真实 JD，用已确认事实判断是否值得投入下一步。</p>
        </div>
        {mode === "view" && target?.status === "current" ? (
          <button type="button" onClick={startCreate} disabled={busy}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral">
            <Plus className="h-4 w-4" />新增岗位
          </button>
        ) : null}
      </div>

      {targets.length > 0 ? (
        <div className="mt-6 flex gap-2 overflow-x-auto pb-2" aria-label="岗位切换">
          {targets.map((item) => (
            <button key={item.id} type="button" onClick={() => selectTarget(item.id)} disabled={busy}
              aria-current={item.id === selectedId ? "true" : undefined}
              className={`min-h-11 shrink-0 rounded-2xl border px-4 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${item.id === selectedId ? "border-coral bg-red-50 text-ink" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
              <span className="font-semibold">{item.title}</span>
              <span className="ml-2 text-xs">v{item.revision}{item.status === "archived" ? " · 已归档" : ""}</span>
            </button>
          ))}
        </div>
      ) : null}

      {targetsQuery.isPending ? (
        <div className="mt-6 flex items-center gap-2 rounded-3xl bg-slate-50 p-5 text-sm text-slate-600" role="status">
          <LoaderCircle className="h-4 w-4 animate-spin" />正在读取岗位
        </div>
      ) : mode === "empty" ? (
        <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 sm:p-8">
          <h3 className="text-xl font-semibold text-ink">还没有岗位</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">添加一个真实 JD，我们会用你已经确认的经历事实判断是否值得投递。</p>
          <button type="button" onClick={startCreate}
            className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-coral px-5 text-sm font-semibold text-white shadow-lg shadow-red-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral">
            <Plus className="h-4 w-4" />添加第一个岗位
          </button>
        </div>
      ) : mode === "create" || mode === "edit" ? (
        <div className="mt-6">
          <h3 className="text-xl font-semibold text-ink">{editorTitle}</h3>
          <p className={`mt-2 text-sm leading-6 ${mode === "edit" ? "text-amber-700" : "text-slate-600"}`}>
            {mode === "create" ? "粘贴 JD 后自动保存为新岗位" : "修改 JD 后，现有分析将过期，需要重新分析。"}
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500" aria-live="polite">
            <span>{target ? `JD revision ${target.revision}${analysis ? ` · analysis v${analysis.version}` : ""}` : "JD 非空后创建记录"}</span>
            <span className="inline-flex items-center gap-1.5">
              {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : saveError ? <AlertCircle className="h-3.5 w-3.5 text-red-600" /> : <Save className="h-3.5 w-3.5" />}
              {saveLabel}
            </span>
          </div>
          {saveError ? <p className="mt-2 text-sm text-red-700" role="alert">{saveError}</p> : null}

          <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 font-semibold text-slate-800"><ImagePlus className="h-4 w-4" />从职位截图识别</div>
                <p className="mt-1 text-sm leading-6 text-slate-600">支持 BOSS 直聘等平台的 PNG、JPG、WebP 截图，最多 6 张。识别后仍可手动修改。</p>
                <p className="mt-1 text-xs text-slate-500">图片只在当前浏览器中识别，不会上传到服务器。</p>
              </div>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                aria-label="选择职位截图"
                className="sr-only"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  void recognizeScreenshots(files);
                }}
              />
              <button type="button" onClick={() => imageInputRef.current?.click()} disabled={busy}
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
                {recognizingImages ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                {recognizingImages ? "正在识别" : "上传职位截图"}
              </button>
            </div>
            {ocrState.status === "recognizing" ? (
              <div className="mt-4" role="status" aria-live="polite">
                <div className="flex justify-between text-xs text-slate-600">
                  <span>正在识别第 {Math.min(ocrState.completedFiles + 1, ocrState.fileCount)} / {ocrState.fileCount} 张</span>
                  <span>{Math.round(ocrState.progress * 100)}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-coral transition-[width]" style={{ width: `${Math.round(ocrState.progress * 100)}%` }} />
                </div>
              </div>
            ) : ocrState.status === "success" ? (
              <p className="mt-3 flex items-center gap-2 text-sm text-emerald-700" role="status"><CheckCircle2 className="h-4 w-4" />已识别 {ocrState.fileCount} 张截图，文字已填入下方，请核对后再分析。</p>
            ) : ocrState.status === "error" ? (
              <p className="mt-3 flex items-center gap-2 text-sm text-red-700" role="alert"><AlertCircle className="h-4 w-4" />{ocrState.message}</p>
            ) : null}
          </div>

          <label className="mt-5 block text-sm font-semibold text-slate-800" htmlFor="job-title">岗位名称</label>
          <input id="job-title" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)}
            placeholder="例如：字节跳动｜AI 产品经理"
            className="mt-2 min-h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-coral focus:ring-2 focus:ring-red-100" />
          <label className="mt-4 block text-sm font-semibold text-slate-800" htmlFor="job-description">岗位 JD</label>
          <textarea ref={editorRef} id="job-description" value={draftJd} onChange={(event) => setDraftJd(event.target.value)}
            placeholder="请粘贴完整的岗位职责、任职要求和加分项。"
            className="mt-2 min-h-[260px] w-full resize-y rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 outline-none focus:border-coral focus:ring-2 focus:ring-red-100" />
          {analyzeMutation.error ? <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{analyzeMutation.error.message}</div> : null}
        </div>
      ) : target ? (
        <div className="mt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-semibold text-ink">{target.title}</h3>
                {target.status === "archived" ? <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600">已归档</span> : null}
              </div>
              <p className="mt-2 text-xs text-slate-500">JD revision {target.revision}{analysis ? ` · analysis v${analysis.version}` : ""}</p>
            </div>
          </div>

          {target.status === "archived" ? (
            <p className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">恢复后可继续编辑和重新分析。</p>
          ) : null}

          {resultState === "failure" ? (
            <div className="mt-6 rounded-3xl border border-red-200 bg-red-50 p-5" role="alert">
              <div className="flex items-center gap-2 font-semibold text-red-900"><AlertCircle className="h-5 w-5" />分析失败</div>
              <p className="mt-2 text-sm leading-6 text-red-800">JD 已保留，本次没有生成投递决策。你可以直接重试。</p>
            </div>
          ) : analysis && resultState !== "unanalyzed" ? (
            <AnalysisResults analysis={analysis} resultState={resultState} restrictions={restrictions} />
          ) : (
            <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center gap-2 font-semibold text-slate-800"><FileSearch className="h-4 w-4" />还没有分析结论</div>
              <p className="mt-2 text-sm leading-6 text-slate-600">分析后会在这里优先展示投递建议、判断依据和表达边界。</p>
            </div>
          )}

          <details className="mt-5 rounded-3xl border border-slate-200 bg-white p-5">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral">查看 JD 原文</summary>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">{target.jdText}</p>
          </details>
          {archiveMutation.error ? <p className="mt-4 text-sm text-red-700" role="alert">{archiveMutation.error.message}</p> : null}
        </div>
      ) : null}

      {mode === "create" || mode === "edit" || (mode === "view" && target) ? (
        <>
          <div className="h-24 md:h-0" aria-hidden="true" />
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur md:static md:mt-6 md:border-0 md:bg-transparent md:p-0">
            <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 md:justify-end">
              {mode === "create" || mode === "edit" ? (
                <button type="button" onClick={mode === "create" ? cancelCreate : cancelEdit} disabled={busy}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
                  <XCircle className="h-4 w-4" />{mode === "create" ? "取消新增" : "取消修改"}
                </button>
              ) : target?.status === "archived" ? null : (
                <>
                  <button type="button" onClick={() => target && archiveMutation.mutate(target)} disabled={busy}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
                    <Archive className="h-4 w-4" />归档岗位
                  </button>
                  <button type="button" onClick={startEdit} disabled={busy}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
                    <Pencil className="h-4 w-4" />编辑 JD
                  </button>
                </>
              )}

              {mode === "view" && target?.status === "archived" ? (
                <button type="button" onClick={() => archiveMutation.mutate(target)} disabled={busy}
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-coral px-6 text-sm font-semibold text-white shadow-lg shadow-red-200 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none md:flex-none">
                  {archiveMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}恢复岗位
                </button>
              ) : (
                <button type="button" onClick={mode === "view" ? primaryAction : () => void analyze()}
                  disabled={!draftJd.trim() || busy}
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-coral px-6 text-sm font-semibold text-white shadow-lg shadow-red-200 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none md:flex-none">
                  {analyzeMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : resultState === "stale" || resultState === "failure" ? <RefreshCw className="h-4 w-4" /> : null}
                  {mode === "view" ? primaryLabel : analyzeMutation.isPending ? "正在分析" : "分析这个岗位"}
                </button>
              )}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

function AnalysisResults({
  analysis,
  resultState,
  restrictions,
}: {
  analysis: JobFitAnalysisDto;
  resultState: string;
  restrictions: JobFitAnalysisDto["inputSnapshot"]["experiences"][number]["claimRestrictions"];
}) {
  return (
    <div className="mt-6 space-y-5" aria-live="polite">
      <div className={`rounded-3xl border p-5 ${resultState === "apply" ? "border-emerald-200 bg-emerald-50" : resultState === "no_go" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
        <div className="flex items-center gap-2 text-lg font-semibold text-ink">
          {resultState === "apply" ? <CheckCircle2 className="h-5 w-5 text-emerald-700" /> : resultState === "no_go" ? <XCircle className="h-5 w-5 text-red-700" /> : <AlertCircle className="h-5 w-5 text-amber-700" />}
          {resultState === "apply" ? "建议投递" : resultState === "conditional" ? "补充后再判断" : resultState === "no_go" ? "暂不建议投递" : resultState === "stale" ? "结论已过期" : "信息不足"}
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-700">{resultState === "stale" ? "输入已变化，需要重新分析。" : analysis.summary}</p>
      </div>

      {resultState !== "stale" ? (
        <>
          {analysis.evidence.length > 0 ? <ResultList title="判断依据" icon={CheckCircle2} items={analysis.evidence.map((item) => `${item.requirement}｜${item.confirmedFact}（${item.company} · ${item.role} · fact v${item.factVersion}）`)} /> : null}
          {resultState === "conditional" ? <ResultList title="需要补充" icon={AlertCircle} items={analysis.gaps.map((item) => `${item.requirement}：${item.reason}`)} /> : null}
          {resultState === "no_go" ? <ResultList title="关键不匹配" icon={XCircle} items={analysis.criticalMismatches.map((item) => `${item.requirement}：${item.reason}`)} /> : null}
          {analysis.recommendedExperiences.length > 0 ? <ResultList title="推荐使用的经历" icon={BriefcaseBusiness} items={analysis.recommendedExperiences.map((item) => `${item.company} · ${item.role}：${item.rationale}`)} /> : null}
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex items-center gap-2 font-semibold text-slate-800"><ShieldAlert className="h-4 w-4" />表达边界</div>
            {restrictions.length > 0 ? <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">{restrictions.map((item) => <li key={`${item.code}-${item.description}`}>{item.description}</li>)}</ul> : <p className="mt-3 text-sm text-slate-600">仅使用本次快照中的已确认事实，不补写未确认的职责、数据或结果。</p>}
          </div>
          <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600">{DECISION_NOTICE}</p>
        </>
      ) : null}
    </div>
  );
}

function ResultList({ title, icon: Icon, items }: { title: string; icon: typeof CheckCircle2; items: string[] }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2 font-semibold text-slate-800"><Icon className="h-4 w-4" />{title}</div>
      <ul className="mt-3 space-y-3 text-sm leading-6 text-slate-600">{items.slice(0, 3).map((item) => <li key={item} className="rounded-2xl bg-slate-50 px-4 py-3">{item}</li>)}</ul>
    </div>
  );
}
