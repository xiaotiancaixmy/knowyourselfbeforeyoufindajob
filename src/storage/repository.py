from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from src.models.domain import CandidateSource, EvidenceGap, ExperienceRecord, StepKey


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SQLiteRepository:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _initialize(self) -> None:
        with self.connection() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS candidate_sources (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_type TEXT NOT NULL,
                    filename TEXT,
                    raw_text TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS experience_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_id INTEGER NOT NULL,
                    company TEXT NOT NULL,
                    role TEXT NOT NULL,
                    timeframe TEXT NOT NULL,
                    raw_summary_json TEXT NOT NULL,
                    selected INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'draft',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(source_id) REFERENCES candidate_sources(id)
                );

                CREATE TABLE IF NOT EXISTS chat_turns (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    step TEXT NOT NULL,
                    experience_id INTEGER,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(experience_id) REFERENCES experience_records(id)
                );

                CREATE TABLE IF NOT EXISTS evidence_gaps (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    experience_id INTEGER NOT NULL,
                    gap_type TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    status TEXT NOT NULL,
                    rationale TEXT NOT NULL,
                    next_question TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(experience_id) REFERENCES experience_records(id)
                );

                CREATE TABLE IF NOT EXISTS generated_assets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_id INTEGER,
                    asset_type TEXT NOT NULL,
                    experience_id INTEGER,
                    content_json TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(source_id) REFERENCES candidate_sources(id),
                    FOREIGN KEY(experience_id) REFERENCES experience_records(id)
                );
                """
            )

    def reset_candidate_workspace(self) -> None:
        with self.connection() as conn:
            conn.executescript(
                """
                DELETE FROM chat_turns;
                DELETE FROM evidence_gaps;
                DELETE FROM generated_assets;
                DELETE FROM experience_records;
                DELETE FROM candidate_sources;
                """
            )

    def create_candidate_source(self, source: CandidateSource) -> CandidateSource:
        now = utc_now()
        with self.connection() as conn:
            cur = conn.execute(
                """
                INSERT INTO candidate_sources (source_type, filename, raw_text, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (source.source_type, source.filename, source.raw_text, now),
            )
            source.id = int(cur.lastrowid)
            source.created_at = datetime.fromisoformat(now)
        return source

    def get_latest_candidate_source(self) -> CandidateSource | None:
        with self.connection() as conn:
            row = conn.execute(
                "SELECT * FROM candidate_sources ORDER BY id DESC LIMIT 1"
            ).fetchone()
        if row is None:
            return None
        return CandidateSource(
            id=row["id"],
            source_type=row["source_type"],
            filename=row["filename"],
            raw_text=row["raw_text"],
            created_at=datetime.fromisoformat(row["created_at"]),
        )

    def replace_experiences(self, source_id: int, experiences: list[ExperienceRecord]) -> list[ExperienceRecord]:
        now = utc_now()
        with self.connection() as conn:
            conn.execute("DELETE FROM experience_records WHERE source_id = ?", (source_id,))
            for experience in experiences:
                cur = conn.execute(
                    """
                    INSERT INTO experience_records (
                        source_id, company, role, timeframe, raw_summary_json, selected, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        source_id,
                        experience.company,
                        experience.role,
                        experience.timeframe,
                        json.dumps(experience.as_storage_dict(), ensure_ascii=False),
                        int(experience.selected),
                        experience.status,
                        now,
                        now,
                    ),
                )
                experience.id = int(cur.lastrowid)
                experience.source_id = source_id
        return experiences

    def list_experiences(self, source_id: int) -> list[ExperienceRecord]:
        with self.connection() as conn:
            rows = conn.execute(
                "SELECT * FROM experience_records WHERE source_id = ? ORDER BY id ASC",
                (source_id,),
            ).fetchall()
        return [self._row_to_experience(row) for row in rows]

    def get_experience(self, experience_id: int) -> ExperienceRecord | None:
        with self.connection() as conn:
            row = conn.execute(
                "SELECT * FROM experience_records WHERE id = ?",
                (experience_id,),
            ).fetchone()
        return self._row_to_experience(row) if row else None

    def update_experience(self, experience: ExperienceRecord) -> None:
        if experience.id is None:
            raise ValueError("experience.id is required")
        now = utc_now()
        with self.connection() as conn:
            conn.execute(
                """
                UPDATE experience_records
                SET company = ?, role = ?, timeframe = ?, raw_summary_json = ?, selected = ?, status = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    experience.company,
                    experience.role,
                    experience.timeframe,
                    json.dumps(experience.as_storage_dict(), ensure_ascii=False),
                    int(experience.selected),
                    experience.status,
                    now,
                    experience.id,
                ),
            )

    def set_selected_experiences(self, source_id: int, selected_ids: list[int]) -> None:
        selected_set = set(selected_ids)
        experiences = self.list_experiences(source_id)
        for experience in experiences:
            experience.selected = experience.id in selected_set
            experience.status = "selected" if experience.selected else "draft"
            self.update_experience(experience)

    def create_chat_turn(self, step: StepKey, role: str, content: str, experience_id: int | None = None) -> None:
        with self.connection() as conn:
            conn.execute(
                """
                INSERT INTO chat_turns (step, experience_id, role, content, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (step.value, experience_id, role, content, utc_now()),
            )

    def delete_chat_turns(self, step: StepKey, experience_id: int | None = None) -> None:
        query = "DELETE FROM chat_turns WHERE step = ?"
        params: list[object] = [step.value]
        if experience_id is None:
            query += " AND experience_id IS NULL"
        else:
            query += " AND experience_id = ?"
            params.append(experience_id)
        with self.connection() as conn:
            conn.execute(query, params)

    def list_chat_turns(self, step: StepKey, experience_id: int | None = None) -> list[dict[str, str]]:
        query = "SELECT role, content, created_at FROM chat_turns WHERE step = ?"
        params: list[object] = [step.value]
        if experience_id is None:
            query += " AND experience_id IS NULL"
        else:
            query += " AND experience_id = ?"
            params.append(experience_id)
        query += " ORDER BY id ASC"
        with self.connection() as conn:
            rows = conn.execute(query, params).fetchall()
        return [dict(row) for row in rows]

    def replace_evidence_gaps(self, experience_id: int, gaps: list[EvidenceGap]) -> list[EvidenceGap]:
        now = utc_now()
        with self.connection() as conn:
            conn.execute("DELETE FROM evidence_gaps WHERE experience_id = ?", (experience_id,))
            for gap in gaps:
                cur = conn.execute(
                    """
                    INSERT INTO evidence_gaps (
                        experience_id, gap_type, severity, status, rationale, next_question, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        experience_id,
                        gap.gap_type,
                        gap.severity,
                        gap.status,
                        gap.rationale,
                        gap.next_question,
                        now,
                        now,
                    ),
                )
                gap.id = int(cur.lastrowid)
        return gaps

    def list_evidence_gaps(self, experience_id: int) -> list[EvidenceGap]:
        with self.connection() as conn:
            rows = conn.execute(
                "SELECT * FROM evidence_gaps WHERE experience_id = ? ORDER BY id ASC",
                (experience_id,),
            ).fetchall()
        return [
            EvidenceGap(
                id=row["id"],
                experience_id=row["experience_id"],
                gap_type=row["gap_type"],
                severity=row["severity"],
                status=row["status"],
                rationale=row["rationale"],
                next_question=row["next_question"],
            )
            for row in rows
        ]

    def save_generated_asset(
        self,
        asset_type: str,
        content: dict | list | str,
        *,
        source_id: int | None = None,
        experience_id: int | None = None,
    ) -> int:
        with self.connection() as conn:
            row = conn.execute(
                """
                SELECT COALESCE(MAX(version), 0) AS version
                FROM generated_assets
                WHERE asset_type = ? AND source_id IS ? AND experience_id IS ?
                """,
                (asset_type, source_id, experience_id),
            ).fetchone()
            version = int(row["version"]) + 1
            cur = conn.execute(
                """
                INSERT INTO generated_assets (source_id, asset_type, experience_id, content_json, version, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    source_id,
                    asset_type,
                    experience_id,
                    json.dumps(content, ensure_ascii=False),
                    version,
                    utc_now(),
                ),
            )
        return int(cur.lastrowid)

    def get_latest_generated_asset(
        self,
        asset_type: str,
        *,
        source_id: int | None = None,
        experience_id: int | None = None,
    ) -> dict | list | str | None:
        with self.connection() as conn:
            row = conn.execute(
                """
                SELECT content_json
                FROM generated_assets
                WHERE asset_type = ? AND source_id IS ? AND experience_id IS ?
                ORDER BY version DESC
                LIMIT 1
                """,
                (asset_type, source_id, experience_id),
            ).fetchone()
        return json.loads(row["content_json"]) if row else None

    def invalidate_assets(self, asset_types: list[str], *, source_id: int | None = None) -> None:
        if not asset_types:
            return
        placeholders = ", ".join("?" for _ in asset_types)
        query = f"DELETE FROM generated_assets WHERE asset_type IN ({placeholders})"
        params: list[object] = list(asset_types)
        if source_id is None:
            query += " AND source_id IS NULL"
        else:
            query += " AND source_id = ?"
            params.append(source_id)
        with self.connection() as conn:
            conn.execute(query, params)

    def _row_to_experience(self, row: sqlite3.Row) -> ExperienceRecord:
        payload = json.loads(row["raw_summary_json"])
        return ExperienceRecord(
            id=row["id"],
            source_id=row["source_id"],
            company=row["company"],
            role=row["role"],
            timeframe=row["timeframe"],
            business_context=payload.get("business_context", ""),
            projects=payload.get("projects", []),
            responsibilities=payload.get("responsibilities", []),
            outcomes=payload.get("outcomes", []),
            evidence_notes=payload.get("evidence_notes", []),
            selected=bool(row["selected"]),
            status=row["status"],
        )
