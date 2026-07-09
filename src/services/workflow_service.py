from __future__ import annotations

from collections import defaultdict

from src.models.domain import CandidateProfile, CandidateSource, CompanyDossier, ExperienceRecord, ResumeRewriteOutput, StepKey
from src.services.deepseek_client import DeepSeekClient
from src.services.dossier_generation_service import DossierGenerationService
from src.services.evidence_gap_service import EvidenceGapService
from src.services.experience_parser_service import ExperienceParserService
from src.services.followup_question_service import FollowupQuestionService
from src.services.hiring_judgment_service import HiringJudgmentService
from src.services.profile_generation_service import ProfileGenerationService
from src.services.resume_ingestion_service import ResumeIngestionService
from src.services.resume_rewrite_service import ResumeRewriteService
from src.storage.repository import SQLiteRepository


DOWNSTREAM_ASSETS = [
    "fact_completion_notes",
    "company_dossier",
    "candidate_profile",
    "resume_summary",
    "resume_bullets",
]


class WorkflowService:
    LEGACY_FACT_COMPLETION_MARKERS = (
        "为什么不是另一个方案",
        "有没有哪里一开始没做对",
        "我继续追问几个关键问题",
    )

    def __init__(self, repository: SQLiteRepository, llm: DeepSeekClient):
        self.repository = repository
        self.ingestion_service = ResumeIngestionService()
        self.parser_service = ExperienceParserService(llm)
        self.followup_question_service = FollowupQuestionService()
        self.evidence_gap_service = EvidenceGapService()
        self.hiring_judgment_service = HiringJudgmentService()
        self.dossier_service = DossierGenerationService(self.hiring_judgment_service)
        self.profile_service = ProfileGenerationService(self.hiring_judgment_service)
        self.rewrite_service = ResumeRewriteService()

    def import_text_resume(self, raw_text: str) -> CandidateSource:
        cleaned = self.ingestion_service.extract_from_text(raw_text)
        return self._replace_workspace_with_source("text", None, cleaned)

    def import_pdf_resume(self, filename: str, file_bytes: bytes) -> CandidateSource:
        cleaned = self.ingestion_service.extract_from_pdf(file_bytes)
        return self._replace_workspace_with_source("pdf", filename, cleaned)

    def get_active_source(self) -> CandidateSource | None:
        return self.repository.get_latest_candidate_source()

    def get_experiences(self, source_id: int) -> list[ExperienceRecord]:
        return self.repository.list_experiences(source_id)

    def save_baseline_experiences(self, source_id: int, experiences: list[ExperienceRecord]) -> list[ExperienceRecord]:
        self.repository.replace_experiences(source_id, experiences)
        self.repository.save_generated_asset(
            "baseline_experience_list",
            [experience.model_dump(mode="json") for experience in experiences],
            source_id=source_id,
        )
        self.repository.invalidate_assets(DOWNSTREAM_ASSETS, source_id=source_id)
        return self.repository.list_experiences(source_id)

    def select_experiences(self, source_id: int, selected_ids: list[int]) -> None:
        if not selected_ids:
            raise ValueError("至少选择 1 段经历进入 deep dive。")
        if len(selected_ids) > 3:
            raise ValueError("MVP 只支持同时 deep dive 1-3 段经历。")
        self.repository.set_selected_experiences(source_id, selected_ids)
        self.repository.invalidate_assets(DOWNSTREAM_ASSETS, source_id=source_id)

    def analyze_selected_experience(self, experience_id: int) -> tuple[str, list[str]]:
        experience = self._require_experience(experience_id)
        gaps = self.evidence_gap_service.analyze(experience)
        self.repository.replace_evidence_gaps(experience_id, gaps)
        signal = self.followup_question_service.build_light_signal(experience, gaps)
        questions = self.followup_question_service.build_targeted_questions(gaps)
        self._ensure_fact_completion_chat_seed(experience)
        return signal, questions

    def submit_fact_completion_answer(self, experience_id: int, answer: str) -> tuple[ExperienceRecord, str, list[str]]:
        experience = self._require_experience(experience_id)
        self.repository.create_chat_turn(StepKey.FACT_COMPLETION, "user", answer, experience_id)
        updated = self.parser_service.merge_fact_answer(experience, answer)
        updated.status = "in_progress"
        self.repository.update_experience(updated)

        gaps = self.evidence_gap_service.analyze(updated)
        self.repository.replace_evidence_gaps(experience_id, gaps)
        signal = self.followup_question_service.build_light_signal(updated, gaps)
        questions = self.followup_question_service.build_targeted_questions(gaps)
        if self.evidence_gap_service.ready_for_dossier(updated, gaps):
            updated.status = "ready_for_dossier"
            self.repository.update_experience(updated)
            assistant_message = (
                self.followup_question_service.build_reflection(updated)
                + "\n\n"
                + "从 hiring 视角看，这段核心证据已经到达 MVP 需要的最低阈值，可以继续生成 dossier。"
            )
            self.repository.save_generated_asset(
                "fact_completion_notes",
                {"experience_id": experience_id, "notes": updated.evidence_notes},
                source_id=updated.source_id,
                experience_id=experience_id,
            )
        else:
            assistant_message = self.followup_question_service.build_reflection(updated)
            if self._looks_vague(answer):
                assistant_message += "\n\n" + self.followup_question_service.build_sentence_scaffold()
            elif questions:
                assistant_message += "\n\n下一步我只想轻轻补一个点：\n- " + questions[0]
            assistant_message += "\n\n" + self.followup_question_service.build_gap_reveal(gaps)
        self.repository.create_chat_turn(StepKey.FACT_COMPLETION, "assistant", assistant_message, experience_id)
        self.repository.invalidate_assets(["company_dossier", "candidate_profile", "resume_summary", "resume_bullets"], source_id=updated.source_id)
        return updated, assistant_message, questions

    def list_fact_completion_chat(self, experience_id: int) -> list[dict[str, str]]:
        return self.repository.list_chat_turns(StepKey.FACT_COMPLETION, experience_id)

    def should_reveal_fact_completion_gaps(self, experience_id: int) -> bool:
        turns = self.repository.list_chat_turns(StepKey.FACT_COMPLETION, experience_id)
        return any(turn["role"] == "user" for turn in turns)

    def get_fact_completion_panel_note(self, experience_id: int) -> str:
        if self.should_reveal_fact_completion_gaps(experience_id):
            return "我正在根据你刚刚的回忆，提炼已经出现的亮点，并补还不够站住的证据。"
        return "我会先陪你回到当时的工作场景，再慢慢整理这段经历里的主线、角色和结果线索。"

    def get_visible_fact_completion_gaps(self, experience_id: int) -> list[EvidenceGap]:
        if not self.should_reveal_fact_completion_gaps(experience_id):
            return []
        return self.repository.list_evidence_gaps(experience_id)

    def generate_dossiers_and_profile(self, source_id: int) -> tuple[list[CompanyDossier], CandidateProfile]:
        experiences = [experience for experience in self.repository.list_experiences(source_id) if experience.selected]
        if not experiences:
            raise ValueError("请先选择至少一段经历。")
        dossiers: list[CompanyDossier] = []
        gaps_by_experience_id = defaultdict(list)
        for experience in experiences:
            gaps = self.repository.list_evidence_gaps(experience.id or -1) or self.evidence_gap_service.analyze(experience)
            if not self.evidence_gap_service.ready_for_dossier(experience, gaps):
                raise ValueError(f"{experience.company} 这段经历的证据还不够，请先补完关键问题。")
            gaps_by_experience_id[experience.id or -1] = gaps
            dossier = self.dossier_service.generate(experience, gaps)
            dossiers.append(dossier)
            self.repository.save_generated_asset(
                "company_dossier",
                dossier.model_dump(mode="json"),
                source_id=source_id,
                experience_id=experience.id,
            )

        profile = self.profile_service.generate(experiences, dossiers, gaps_by_experience_id)
        self.repository.save_generated_asset(
            "candidate_profile",
            profile.model_dump(mode="json"),
            source_id=source_id,
        )
        return dossiers, profile

    def rewrite_resume(self, source_id: int) -> ResumeRewriteOutput:
        experiences = [experience for experience in self.repository.list_experiences(source_id) if experience.selected]
        profile_payload = self.repository.get_latest_generated_asset("candidate_profile", source_id=source_id)
        if not profile_payload:
            raise ValueError("请先生成 candidate profile。")
        profile = CandidateProfile.model_validate(profile_payload)
        rewrite = self.rewrite_service.rewrite(experiences, profile)
        self.repository.save_generated_asset(
            "resume_summary",
            {"professional_summary": rewrite.professional_summary},
            source_id=source_id,
        )
        self.repository.save_generated_asset(
            "resume_bullets",
            rewrite.experience_bullets_by_experience_id,
            source_id=source_id,
        )
        return rewrite

    def get_latest_profile(self, source_id: int) -> CandidateProfile | None:
        payload = self.repository.get_latest_generated_asset("candidate_profile", source_id=source_id)
        return CandidateProfile.model_validate(payload) if payload else None

    def get_latest_dossiers(self, source_id: int, experiences: list[ExperienceRecord]) -> list[CompanyDossier]:
        dossiers: list[CompanyDossier] = []
        for experience in experiences:
            payload = self.repository.get_latest_generated_asset(
                "company_dossier",
                source_id=source_id,
                experience_id=experience.id,
            )
            if payload:
                dossiers.append(CompanyDossier.model_validate(payload))
        return dossiers

    def get_latest_resume_rewrite(self, source_id: int) -> ResumeRewriteOutput | None:
        summary = self.repository.get_latest_generated_asset("resume_summary", source_id=source_id)
        bullets = self.repository.get_latest_generated_asset("resume_bullets", source_id=source_id)
        if not summary or not bullets:
            return None
        normalized = {int(key): value for key, value in dict(bullets).items()}
        return ResumeRewriteOutput(
            professional_summary=summary["professional_summary"],
            experience_bullets_by_experience_id=normalized,
        )

    def step_statuses(self, source_id: int | None) -> dict[StepKey, bool]:
        statuses = {step: False for step in StepKey}
        if source_id is None:
            return statuses

        experiences = self.repository.list_experiences(source_id)
        statuses[StepKey.RESUME_IMPORT] = bool(experiences)
        statuses[StepKey.BASELINE_REVIEW] = bool(experiences)
        selected = [experience for experience in experiences if experience.selected]
        statuses[StepKey.DEEP_DIVE_SELECTION] = bool(selected)
        statuses[StepKey.FACT_COMPLETION] = bool(selected) and all(
            experience.status == "ready_for_dossier" for experience in selected
        )
        statuses[StepKey.DOSSIER_PROFILE] = self.get_latest_profile(source_id) is not None
        statuses[StepKey.RESUME_REWRITE] = self.get_latest_resume_rewrite(source_id) is not None
        return statuses

    def _replace_workspace_with_source(self, source_type: str, filename: str | None, raw_text: str) -> CandidateSource:
        self.repository.reset_candidate_workspace()
        source = self.repository.create_candidate_source(
            CandidateSource(source_type=source_type, filename=filename, raw_text=raw_text)
        )
        experiences = self.parser_service.parse(raw_text)
        self.repository.replace_experiences(source.id or -1, experiences)
        self.repository.save_generated_asset(
            "baseline_experience_list",
            [experience.model_dump(mode="json") for experience in experiences],
            source_id=source.id,
        )
        return source

    def _require_experience(self, experience_id: int) -> ExperienceRecord:
        experience = self.repository.get_experience(experience_id)
        if not experience:
            raise ValueError("没有找到对应的经历记录。")
        return experience

    def _looks_vague(self, answer: str) -> bool:
        cleaned = answer.strip()
        if len(cleaned) < 24:
            return True
        vague_phrases = ["做一个项目", "推进一下", "差不多", "大概", "一些事情", "很多内容"]
        return any(phrase in cleaned for phrase in vague_phrases)

    def _ensure_fact_completion_chat_seed(self, experience: ExperienceRecord) -> None:
        if experience.id is None:
            return
        turns = self.repository.list_chat_turns(StepKey.FACT_COMPLETION, experience.id)
        if not turns:
            self.repository.create_chat_turn(
                StepKey.FACT_COMPLETION,
                "assistant",
                self.followup_question_service.build_warm_start(experience),
                experience.id,
            )
            return
        if self._is_legacy_fact_completion_chat(turns):
            self.repository.delete_chat_turns(StepKey.FACT_COMPLETION, experience.id)
            self.repository.create_chat_turn(
                StepKey.FACT_COMPLETION,
                "assistant",
                self.followup_question_service.build_warm_start(experience),
                experience.id,
            )

    def _is_legacy_fact_completion_chat(self, turns: list[dict[str, str]]) -> bool:
        if any(turn["role"] == "user" for turn in turns):
            return False
        if len(turns) > 1:
            return True
        first_message = turns[0]["content"] if turns else ""
        if "回到当时" in first_message:
            return False
        return any(marker in first_message for marker in self.LEGACY_FACT_COMPLETION_MARKERS)
