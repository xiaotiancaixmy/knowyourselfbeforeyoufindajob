import type Database from "better-sqlite3";

interface Migration {
  version: number;
  name: string;
  up: (sqlite: Database.Database) => void;
}

function ensureColumn(sqlite: Database.Database, tableName: string, columnName: string, definition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === columnName)) {
    sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
  }
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "init_workspace_schema",
    up: (sqlite) => {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS candidate_sources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_type TEXT NOT NULL,
          filename TEXT,
          raw_text TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 0
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
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chat_turns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          step TEXT NOT NULL,
          experience_id INTEGER,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL
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
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS generated_assets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id INTEGER,
          asset_type TEXT NOT NULL,
          experience_id INTEGER,
          content_json TEXT NOT NULL,
          version INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
      `);

      ensureColumn(sqlite, "candidate_sources", "updated_at", "TEXT NOT NULL DEFAULT ''");
      ensureColumn(sqlite, "candidate_sources", "is_active", "INTEGER NOT NULL DEFAULT 0");

      sqlite.exec(`
        UPDATE candidate_sources
        SET updated_at = CASE
          WHEN updated_at IS NULL OR updated_at = '' THEN created_at
          ELSE updated_at
        END;

        CREATE INDEX IF NOT EXISTS idx_candidate_sources_active_updated
          ON candidate_sources(is_active, updated_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_experience_records_source
          ON experience_records(source_id, id);
        CREATE INDEX IF NOT EXISTS idx_chat_turns_step_experience
          ON chat_turns(step, experience_id, id);
        CREATE INDEX IF NOT EXISTS idx_evidence_gaps_experience
          ON evidence_gaps(experience_id, id);
        CREATE INDEX IF NOT EXISTS idx_generated_assets_lookup
          ON generated_assets(source_id, asset_type, experience_id, version DESC);
      `);
    },
  },
  {
    version: 2,
    name: "add_canonical_fact_completion_states",
    up: (sqlite) => {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS fact_completion_states (
          experience_id INTEGER PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'not_started',
          fact_version INTEGER NOT NULL DEFAULT 0,
          fact_fingerprint TEXT NOT NULL DEFAULT '',
          confirmed_summary_json TEXT,
          claim_restrictions_json TEXT NOT NULL DEFAULT '[]',
          confirmed_at TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_fact_completion_states_status
          ON fact_completion_states(status, updated_at DESC);
      `);
    },
  },
  {
    version: 3,
    name: "add_job_fit_decision_workspace",
    up: (sqlite) => {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS job_targets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id INTEGER NOT NULL REFERENCES candidate_sources(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          jd_text TEXT NOT NULL DEFAULT '',
          revision INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'current',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS job_fit_analyses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_target_id INTEGER NOT NULL REFERENCES job_targets(id) ON DELETE CASCADE,
          version INTEGER NOT NULL,
          run_state TEXT NOT NULL,
          decision TEXT,
          validity TEXT NOT NULL,
          insufficient_reason TEXT,
          input_fingerprint TEXT NOT NULL,
          input_snapshot_json TEXT NOT NULL,
          output_json TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL,
          UNIQUE(job_target_id, version),
          UNIQUE(job_target_id, input_fingerprint)
        );
        CREATE TABLE IF NOT EXISTS job_target_resume_rewrites (
          job_target_id INTEGER PRIMARY KEY REFERENCES job_targets(id) ON DELETE CASCADE,
          analysis_version INTEGER NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1,
          content_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_job_targets_source_status
          ON job_targets(source_id, status, updated_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_job_fit_analyses_target_version
          ON job_fit_analyses(job_target_id, version DESC);
      `);
    },
  },
  {
    version: 4,
    name: "add_job_fit_failure_diagnostics",
    up: (sqlite) => {
      ensureColumn(sqlite, "job_fit_analyses", "diagnostics_json", "TEXT");
    },
  },
];

export function runMigrations(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (
      sqlite
        .prepare("SELECT version FROM schema_migrations ORDER BY version ASC")
        .all() as Array<{ version: number }>
    ).map((row) => row.version),
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      continue;
    }
    const apply = sqlite.transaction(() => {
      migration.up(sqlite);
      sqlite
        .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, new Date().toISOString());
    });
    apply();
  }
}
