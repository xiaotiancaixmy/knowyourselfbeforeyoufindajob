from __future__ import annotations

import math

import streamlit as st
import streamlit.components.v1 as components

from src.config import CONFIG
from src.models.domain import ExperienceRecord, StepKey
from src.services.fact_completion_composer_service import (
    build_fact_completion_composer_config,
    normalize_fact_completion_submission,
)
from src.services.deepseek_client import DeepSeekClient
from src.services.workflow_service import WorkflowService
from src.storage.repository import SQLiteRepository


STEP_TITLES = {
    StepKey.RESUME_IMPORT: "1. Resume Import",
    StepKey.BASELINE_REVIEW: "2. Baseline Review",
    StepKey.DEEP_DIVE_SELECTION: "3. Deep-Dive Selection",
    StepKey.FACT_COMPLETION: "4. Fact Completion",
    StepKey.DOSSIER_PROFILE: "5. Dossier & Profile",
    StepKey.RESUME_REWRITE: "6. Resume Rewrite",
}

REQUIRED_WORKFLOW_METHODS = (
    "should_reveal_fact_completion_gaps",
    "get_fact_completion_panel_note",
    "get_visible_fact_completion_gaps",
)


def get_workflow() -> WorkflowService:
    workflow = st.session_state.get("workflow_service")
    if workflow is None or any(not hasattr(workflow, method) for method in REQUIRED_WORKFLOW_METHODS):
        repository = SQLiteRepository(CONFIG.database_path)
        st.session_state.workflow_service = WorkflowService(repository, DeepSeekClient(CONFIG))
    return st.session_state.workflow_service


def get_active_source_id(workflow: WorkflowService) -> int | None:
    if "active_source_id" not in st.session_state:
        source = workflow.get_active_source()
        st.session_state.active_source_id = source.id if source else None
    return st.session_state.active_source_id


def set_step(step: StepKey) -> None:
    st.session_state.current_step = step


def text_list_to_string(values: list[str]) -> str:
    return "\n".join(values)


def string_to_text_list(value: str) -> list[str]:
    return [line.strip() for line in value.splitlines() if line.strip()]


def adaptive_text_area_height(value: str, *, min_lines: int = 4, max_lines: int = 30, wrap_width: int = 72) -> int:
    raw_lines = value.splitlines() or [""]
    visual_lines = 0
    for line in raw_lines:
        visual_lines += max(1, math.ceil(len(line) / wrap_width))
    clamped_lines = max(min_lines, min(visual_lines, max_lines))
    return clamped_lines * 24 + 24


def should_reveal_fact_completion_gaps(workflow: WorkflowService, experience_id: int) -> bool:
    if hasattr(workflow, "should_reveal_fact_completion_gaps"):
        return workflow.should_reveal_fact_completion_gaps(experience_id)
    turns = workflow.repository.list_chat_turns(StepKey.FACT_COMPLETION, experience_id)
    return any(turn["role"] == "user" for turn in turns)


def get_fact_completion_panel_note(workflow: WorkflowService, experience_id: int) -> str:
    if hasattr(workflow, "get_fact_completion_panel_note"):
        return workflow.get_fact_completion_panel_note(experience_id)
    if should_reveal_fact_completion_gaps(workflow, experience_id):
        return "我正在根据你刚刚的回忆，提炼已经出现的亮点，并补还不够站住的证据。"
    return "我会先陪你回到当时的工作场景，再慢慢整理这段经历里的主线、角色和结果线索。"


def get_visible_fact_completion_gaps(workflow: WorkflowService, experience_id: int):
    if hasattr(workflow, "get_visible_fact_completion_gaps"):
        return workflow.get_visible_fact_completion_gaps(experience_id)
    if not should_reveal_fact_completion_gaps(workflow, experience_id):
        return []
    return workflow.repository.list_evidence_gaps(experience_id)


def build_fact_completion_dictation_html(textarea_label: str, mic_button_id: str, status_id: str) -> str:
    return f"""
    <div id="{mic_button_id}-wrapper" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding-top:4px;">
      <button id="{mic_button_id}" type="button" title="语音听写"
        style="width:44px;height:44px;border-radius:999px;border:none;background:#1d4ed8;color:white;font-size:18px;cursor:pointer;">
        🎙️
      </button>
      <div id="{status_id}" style="font-size:12px;color:#9ca3af;text-align:center;">Mic off</div>
    </div>
    <script>
      const wrapper = document.getElementById("{mic_button_id}-wrapper");
      const button = document.getElementById("{mic_button_id}");
      const status = document.getElementById("{status_id}");
      const SpeechRecognition = window.parent.SpeechRecognition || window.parent.webkitSpeechRecognition;
      if (!SpeechRecognition) {{
        wrapper.style.display = "none";
      }} else {{
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "zh-CN";

        let isListening = false;
        let baseText = "";
        let finalTranscript = "";
        let interimTranscript = "";
        let applyingTranscript = false;

        const setStatus = (text) => {{
          status.textContent = text;
        }};

        const setButtonState = (listening) => {{
          button.style.background = listening ? "#dc2626" : "#1d4ed8";
          setStatus(listening ? "Listening..." : "Mic off");
        }};

        const getTextarea = () => window.parent.document.querySelector(`textarea[aria-label="{textarea_label}"]`);

        const setTextareaValue = (value) => {{
          const textarea = getTextarea();
          if (!textarea) return;
          const descriptor = Object.getOwnPropertyDescriptor(window.parent.HTMLTextAreaElement.prototype, "value");
          applyingTranscript = true;
          descriptor.set.call(textarea, value);
          textarea.dispatchEvent(new Event("input", {{ bubbles: true }}));
          textarea.dispatchEvent(new Event("change", {{ bubbles: true }}));
          applyingTranscript = false;
        }};

        const mergeText = (currentBase, transcript) => {{
          const cleanedTranscript = transcript.trim();
          if (!cleanedTranscript) return currentBase;
          if (!currentBase.trim()) return cleanedTranscript;
          return /[\\s\\n]$/.test(currentBase) ? currentBase + cleanedTranscript : currentBase + " " + cleanedTranscript;
        }};

        const syncTextarea = () => {{
          setTextareaValue(mergeText(baseText, `${{finalTranscript}}${{interimTranscript}}`));
        }};

        button.addEventListener("click", () => {{
          const textarea = getTextarea();
          if (!textarea) return;
          if (isListening) {{
            recognition.stop();
            return;
          }}
          baseText = textarea.value.trimEnd();
          finalTranscript = "";
          interimTranscript = "";
          recognition.start();
        }});

        recognition.onstart = () => {{
          isListening = true;
          setButtonState(true);
        }};

        recognition.onresult = (event) => {{
          interimTranscript = "";
          for (let index = event.resultIndex; index < event.results.length; index += 1) {{
            const chunk = event.results[index][0].transcript;
            if (event.results[index].isFinal) {{
              finalTranscript += chunk;
            }} else {{
              interimTranscript += chunk;
            }}
          }}
          syncTextarea();
        }};

        recognition.onerror = (event) => {{
          if (event.error === "not-allowed" || event.error === "service-not-allowed") {{
            wrapper.style.display = "none";
            return;
          }}
          setStatus("Mic unavailable");
        }};

        recognition.onend = () => {{
          isListening = false;
          finalTranscript = "";
          interimTranscript = "";
          setButtonState(false);
        }};

        const bindTextarea = () => {{
          const textarea = getTextarea();
          if (!textarea || textarea.dataset.dictationBound === "true") return;
          textarea.dataset.dictationBound = "true";
          textarea.addEventListener("input", () => {{
            if (!isListening || applyingTranscript) return;
            baseText = textarea.value;
            finalTranscript = "";
            interimTranscript = "";
          }});
        }};

        const observer = new MutationObserver(() => bindTextarea());
        observer.observe(window.parent.document.body, {{ childList: true, subtree: true }});
        bindTextarea();
      }}
    </script>
    """


def render_resume_import(workflow: WorkflowService) -> None:
    st.subheader("导入简历")
    st.caption("支持 PDF 上传和纯文本粘贴。导入后会重建当前单用户工作区。")

    tab_pdf, tab_text = st.tabs(["PDF 上传", "文本粘贴"])

    with tab_pdf:
        uploaded = st.file_uploader("上传 PDF 简历", type=["pdf"])
        if st.button("解析 PDF", use_container_width=True, disabled=uploaded is None):
            try:
                source = workflow.import_pdf_resume(uploaded.name, uploaded.getvalue())
                st.session_state.active_source_id = source.id
                st.session_state.current_step = StepKey.BASELINE_REVIEW
                st.success("PDF 已解析，已进入 Baseline Review。")
                st.rerun()
            except Exception as exc:
                st.error(str(exc))

    with tab_text:
        raw_text = st.text_area("粘贴简历文本", height=360, placeholder="把 Markdown / 纯文本简历粘贴到这里")
        if st.button("解析文本简历", use_container_width=True, disabled=not raw_text.strip()):
            try:
                source = workflow.import_text_resume(raw_text)
                st.session_state.active_source_id = source.id
                st.session_state.current_step = StepKey.BASELINE_REVIEW
                st.success("文本简历已解析，已进入 Baseline Review。")
                st.rerun()
            except Exception as exc:
                st.error(str(exc))


def render_baseline_review(workflow: WorkflowService, source_id: int) -> None:
    st.subheader("Baseline Review")
    st.caption("确认并编辑结构化经历。这里的修改会清掉下游资产，避免旧结论污染后续判断。")
    experiences = workflow.get_experiences(source_id)
    updated_experiences: list[ExperienceRecord] = []

    for experience in experiences:
        with st.expander(f"{experience.company} | {experience.role}", expanded=True):
            company = st.text_input("Company", value=experience.company, key=f"company-{experience.id}")
            role = st.text_input("Role", value=experience.role, key=f"role-{experience.id}")
            timeframe = st.text_input("Timeframe", value=experience.timeframe, key=f"timeframe-{experience.id}")
            business_context = st.text_area(
                "Business Context",
                value=experience.business_context,
                key=f"context-{experience.id}",
                height=adaptive_text_area_height(experience.business_context, min_lines=4),
            )
            projects_value = text_list_to_string(experience.projects)
            projects = st.text_area(
                "Projects (one per line)",
                value=projects_value,
                key=f"projects-{experience.id}",
                height=adaptive_text_area_height(projects_value, min_lines=6),
            )
            responsibilities_value = text_list_to_string(experience.responsibilities)
            responsibilities = st.text_area(
                "Responsibilities (one per line)",
                value=responsibilities_value,
                key=f"responsibilities-{experience.id}",
                height=adaptive_text_area_height(responsibilities_value, min_lines=6),
            )
            outcomes_value = text_list_to_string(experience.outcomes)
            outcomes = st.text_area(
                "Outcomes (one per line)",
                value=outcomes_value,
                key=f"outcomes-{experience.id}",
                height=adaptive_text_area_height(outcomes_value, min_lines=5),
            )
            evidence_notes_value = text_list_to_string(experience.evidence_notes)
            evidence_notes = st.text_area(
                "Evidence Notes (one per line)",
                value=evidence_notes_value,
                key=f"notes-{experience.id}",
                height=adaptive_text_area_height(evidence_notes_value, min_lines=4),
            )
            updated_experiences.append(
                ExperienceRecord(
                    id=experience.id,
                    source_id=experience.source_id,
                    company=company.strip() or experience.company,
                    role=role.strip() or experience.role,
                    timeframe=timeframe.strip() or experience.timeframe,
                    business_context=business_context.strip(),
                    projects=string_to_text_list(projects),
                    responsibilities=string_to_text_list(responsibilities),
                    outcomes=string_to_text_list(outcomes),
                    evidence_notes=string_to_text_list(evidence_notes),
                    selected=experience.selected,
                    status=experience.status,
                )
            )

    if st.button("保存 baseline 并继续", type="primary", use_container_width=True):
        try:
            workflow.save_baseline_experiences(source_id, updated_experiences)
            st.session_state.current_step = StepKey.DEEP_DIVE_SELECTION
            st.success("Baseline 已保存。")
            st.rerun()
        except Exception as exc:
            st.error(str(exc))


def render_deep_dive_selection(workflow: WorkflowService, source_id: int) -> None:
    st.subheader("Deep-Dive Selection")
    st.caption("手动选择 1-3 段最值得讲的经历。MVP 只会对这些经历做重点补证据。")
    experiences = workflow.get_experiences(source_id)
    options = {f"{experience.company} | {experience.role}": experience.id for experience in experiences}
    default_values = [
        label for label, experience_id in options.items()
        if any(exp.id == experience_id and exp.selected for exp in experiences)
    ]
    selected_labels = st.multiselect(
        "选择要 deep dive 的经历",
        list(options.keys()),
        default=default_values,
        max_selections=3,
    )
    if st.button("确认选择并进入 Fact Completion", type="primary", use_container_width=True):
        try:
            workflow.select_experiences(source_id, [options[label] for label in selected_labels])
            selected_ids = [options[label] for label in selected_labels]
            if selected_ids:
                st.session_state.active_experience_id = selected_ids[0]
            st.session_state.current_step = StepKey.FACT_COMPLETION
            st.success("已更新 deep dive 选择。")
            st.rerun()
        except Exception as exc:
            st.error(str(exc))


def render_fact_completion(workflow: WorkflowService, source_id: int) -> None:
    st.subheader("Fact Completion")
    selected = [experience for experience in workflow.get_experiences(source_id) if experience.selected]
    if not selected:
        st.info("请先在上一阶段选择至少一段经历。")
        return

    option_map = {f"{experience.company} | {experience.role}": experience.id for experience in selected}
    current_id = st.session_state.get("active_experience_id") or selected[0].id
    current_label = next(
        (label for label, value in option_map.items() if value == current_id),
        next(iter(option_map)),
    )
    chosen_label = st.selectbox("当前要补证据的经历", list(option_map.keys()), index=list(option_map.keys()).index(current_label))
    experience_id = option_map[chosen_label]
    st.session_state.active_experience_id = experience_id

    signal, _ = workflow.analyze_selected_experience(experience_id)
    composer = build_fact_completion_composer_config(experience_id)
    if composer.draft_key not in st.session_state:
        st.session_state[composer.draft_key] = ""
    chat_history = workflow.list_fact_completion_chat(experience_id)
    with st.container(border=True):
        st.markdown("#### Conversation")
        if should_reveal_fact_completion_gaps(workflow, experience_id):
            st.caption(signal)
        else:
            st.caption("进入回忆模式。你先像跟招聘官复盘项目一样，把当时的场景讲出来，我来帮你整理亮点和缺口。")
        st.markdown("---")
        for turn in chat_history:
            with st.chat_message(turn["role"]):
                st.write(turn["content"])
    with st.container(border=True):
        st.markdown("#### Reply")
        with st.form(f"fact-completion-composer-{experience_id}", clear_on_submit=False):
            input_col, mic_col = st.columns([8.8, 1.2], gap="small", vertical_alignment="bottom")
            with input_col:
                st.text_area(
                    composer.textarea_label,
                    key=composer.draft_key,
                    height=120,
                    label_visibility="collapsed",
                    placeholder="先回忆一下当时发生了什么，你可以随便讲，我来帮你整理。",
                )
            with mic_col:
                components.html(
                    build_fact_completion_dictation_html(
                        composer.textarea_label,
                        composer.mic_button_id,
                        composer.status_id,
                    ),
                    height=72,
                )
            submitted = st.form_submit_button("发送", use_container_width=True, type="primary")
        if submitted:
            answer = normalize_fact_completion_submission(st.session_state.get(composer.draft_key, ""))
            if not answer:
                st.info("先说一点内容，或者输入几句再发送。")
            else:
                try:
                    _, _, _ = workflow.submit_fact_completion_answer(experience_id, answer)
                    st.session_state[composer.draft_key] = ""
                    st.rerun()
                except Exception as exc:
                    st.error(str(exc))


def render_dossier_profile(workflow: WorkflowService, source_id: int) -> None:
    st.subheader("Dossier & Profile")
    if st.button("生成 company dossiers 和 candidate profile", type="primary", use_container_width=True):
        try:
            workflow.generate_dossiers_and_profile(source_id)
            st.success("Dossier 和 profile 已生成。")
            st.rerun()
        except Exception as exc:
            st.error(str(exc))

    selected = [experience for experience in workflow.get_experiences(source_id) if experience.selected]
    dossiers = workflow.get_latest_dossiers(source_id, selected)
    profile = workflow.get_latest_profile(source_id)

    for dossier in dossiers:
        matching = next((experience for experience in selected if experience.id == dossier.experience_id), None)
        title = f"{matching.company} | {matching.role}" if matching else f"Experience #{dossier.experience_id}"
        with st.expander(title, expanded=True):
            st.markdown("**Factual Record**")
            st.text(dossier.factual_record)
            st.markdown("**Evaluative Judgment**")
            st.text(dossier.evaluative_judgment)
            st.markdown("**Reusable Interview Assets**")
            for item in dossier.reusable_interview_assets:
                st.write(f"- {item}")

    if profile:
        st.markdown("---")
        st.markdown("### Candidate Profile")
        st.write(f"**Career Arc**: {profile.career_arc}")
        st.write(f"**Recommended Main Lane**: {profile.recommended_main_lane}")
        st.write(f"**Positioning Boundary**: {profile.positioning_boundary}")
        st.write(f"**Conservative Target Strategy**: {profile.conservative_target_strategy}")
        st.write("**Strongest Themes**")
        for item in profile.strongest_themes:
            st.write(f"- {item}")
        st.write("**Weak Spots**")
        for item in profile.weak_spots:
            st.write(f"- {item}")


def render_resume_rewrite(workflow: WorkflowService, source_id: int) -> None:
    st.subheader("Resume Rewrite")
    if st.button("生成 professional summary 和 experience bullets", type="primary", use_container_width=True):
        try:
            workflow.rewrite_resume(source_id)
            st.success("Resume rewrite 已生成。")
            st.rerun()
        except Exception as exc:
            st.error(str(exc))

    output = workflow.get_latest_resume_rewrite(source_id)
    if output:
        st.markdown("### Professional Summary")
        st.write(output.professional_summary)
        st.markdown("### Experience Bullets")
        experiences = {experience.id: experience for experience in workflow.get_experiences(source_id)}
        for experience_id, bullets in output.experience_bullets_by_experience_id.items():
            experience = experiences.get(experience_id)
            title = f"{experience.company} | {experience.role}" if experience else f"Experience #{experience_id}"
            with st.expander(title, expanded=True):
                for bullet in bullets:
                    st.write(f"- {bullet}")


def render_right_panel(workflow: WorkflowService, source_id: int | None) -> None:
    st.markdown("### Agent Panel")
    st.caption("步骤驱动，chat 辅助。只有当前步骤相关的判断和追问会出现在这里。")
    if st.session_state.current_step == StepKey.FACT_COMPLETION and source_id:
        experience_id = st.session_state.get("active_experience_id")
        if experience_id:
            st.info(get_fact_completion_panel_note(workflow, experience_id))
            gaps = get_visible_fact_completion_gaps(workflow, experience_id)
            if not gaps:
                st.caption("等你先讲出一些内容后，我再帮你标出还可以继续补强的方向。")
                return
            st.markdown("**Can Still Be Strengthened**")
            for gap in gaps:
                st.write(f"- `{gap.severity}` {gap.gap_type}: {gap.rationale}")
        else:
            st.info("先选择当前要补证据的经历。")
    else:
        st.info(
            "这个面板在 `Fact Completion` 时会显示 step-specific 的招聘视角判断、证据缺口和追问线索。"
        )


def render_step_navigation(workflow: WorkflowService, source_id: int | None) -> None:
    st.markdown("### Progress")
    statuses = workflow.step_statuses(source_id)
    for step in StepKey:
        done = statuses[step]
        label = ("✅ " if done else "⬜ ") + STEP_TITLES[step]
        enabled = step == StepKey.RESUME_IMPORT or done or _previous_steps_done(step, statuses)
        if st.button(label, key=f"nav-{step.value}", disabled=not enabled, use_container_width=True):
            set_step(step)


def _previous_steps_done(step: StepKey, statuses: dict[StepKey, bool]) -> bool:
    steps = list(StepKey)
    index = steps.index(step)
    if index == 0:
        return True
    return all(statuses[previous] for previous in steps[:index])


def main() -> None:
    st.set_page_config(
        page_title="know yourself before you find a job",
        page_icon="🧭",
        layout="wide",
    )
    st.title("know yourself before you find a job")
    st.caption("A candidate development prototype that judges first, fills evidence gaps second, and rewrites last.")

    workflow = get_workflow()
    source_id = get_active_source_id(workflow)
    if "current_step" not in st.session_state:
        st.session_state.current_step = StepKey.RESUME_IMPORT if source_id is None else StepKey.BASELINE_REVIEW
    step = st.session_state.current_step

    if step == StepKey.BASELINE_REVIEW:
        left, center, right = st.columns([0.9, 3.5, 0.8], gap="medium")
    else:
        left, center, right = st.columns([1.0, 2.2, 1.2], gap="large")

    with left:
        render_step_navigation(workflow, source_id)
        st.markdown("---")
        st.write("**Product Logic**")
        st.write("- 先判断，再补证据，再改写")
        st.write("- 先服务招聘胜率，再服务主观期待")
        st.write("- 不顺着 overclaim 往下写")

    with center:
        if step == StepKey.RESUME_IMPORT:
            render_resume_import(workflow)
        elif source_id is None:
            st.warning("请先导入简历。")
        elif step == StepKey.BASELINE_REVIEW:
            render_baseline_review(workflow, source_id)
        elif step == StepKey.DEEP_DIVE_SELECTION:
            render_deep_dive_selection(workflow, source_id)
        elif step == StepKey.FACT_COMPLETION:
            render_fact_completion(workflow, source_id)
        elif step == StepKey.DOSSIER_PROFILE:
            render_dossier_profile(workflow, source_id)
        elif step == StepKey.RESUME_REWRITE:
            render_resume_rewrite(workflow, source_id)

    with right:
        render_right_panel(workflow, source_id)


if __name__ == "__main__":
    main()
