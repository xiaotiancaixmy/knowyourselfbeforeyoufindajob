from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class StepKey(StrEnum):
    RESUME_IMPORT = "resume_import"
    BASELINE_REVIEW = "baseline_review"
    DEEP_DIVE_SELECTION = "deep_dive_selection"
    FACT_COMPLETION = "fact_completion"
    DOSSIER_PROFILE = "dossier_profile"
    RESUME_REWRITE = "resume_rewrite"


class CandidateSource(BaseModel):
    id: int | None = None
    source_type: str
    filename: str | None = None
    raw_text: str
    created_at: datetime | None = None


class ExperienceRecord(BaseModel):
    id: int | None = None
    source_id: int | None = None
    company: str
    role: str
    timeframe: str
    business_context: str = ""
    projects: list[str] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)
    outcomes: list[str] = Field(default_factory=list)
    evidence_notes: list[str] = Field(default_factory=list)
    selected: bool = False
    status: str = "draft"

    def as_storage_dict(self) -> dict[str, object]:
        return {
            "company": self.company,
            "role": self.role,
            "timeframe": self.timeframe,
            "business_context": self.business_context,
            "projects": self.projects,
            "responsibilities": self.responsibilities,
            "outcomes": self.outcomes,
            "evidence_notes": self.evidence_notes,
        }


class EvidenceGap(BaseModel):
    id: int | None = None
    experience_id: int
    gap_type: str
    severity: str
    status: str = "open"
    rationale: str
    next_question: str


class CompanyDossier(BaseModel):
    experience_id: int
    factual_record: str
    evaluative_judgment: str
    reusable_interview_assets: list[str]


class CandidateProfile(BaseModel):
    career_arc: str
    strongest_themes: list[str]
    weak_spots: list[str]
    positioning_boundary: str
    recommended_main_lane: str
    conservative_target_strategy: str


class ResumeRewriteOutput(BaseModel):
    professional_summary: str
    experience_bullets_by_experience_id: dict[int, list[str]]
