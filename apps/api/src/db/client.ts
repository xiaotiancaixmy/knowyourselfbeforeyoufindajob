import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import {
  candidateSources,
  chatTurns,
  evidenceGaps,
  experienceRecords,
  factCompletionStates,
  generatedAssets,
  jobFitAnalyses,
  jobTargetResumeRewrites,
  jobTargets,
} from "./schema.js";
import { runMigrations } from "./migrations.js";

export function createDatabase(databasePath: string) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  if (databasePath !== ":memory:") {
    fs.chmodSync(databasePath, 0o600);
  }
  sqlite.pragma("foreign_keys = ON");
  runMigrations(sqlite);
  const db = drizzle(sqlite, {
    schema: {
      candidateSources,
      experienceRecords,
      chatTurns,
      evidenceGaps,
      factCompletionStates,
      generatedAssets,
      jobTargets,
      jobFitAnalyses,
      jobTargetResumeRewrites,
    },
  });

  return { sqlite, db };
}
