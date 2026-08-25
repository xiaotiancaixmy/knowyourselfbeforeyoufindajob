import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { config as loadEnv } from "dotenv";

const srcDir = path.dirname(fileURLToPath(import.meta.url));

function findProjectRoot(startPath: string): string {
  let currentPath = startPath;
  while (true) {
    if (fs.existsSync(path.join(currentPath, "pnpm-workspace.yaml"))) {
      return currentPath;
    }
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return process.cwd();
    }
    currentPath = parentPath;
  }
}

export const projectRootPath = findProjectRoot(srcDir);
export const envFilePath = path.join(projectRootPath, ".env");
export const defaultDatabasePath = path.join(projectRootPath, "app.db");

loadEnv({ path: envFilePath });

export interface AppConfig {
  port: number;
  host?: string;
  databasePath: string;
  webOrigin?: string;
  deepseekApiKey?: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  deepseekTimeoutMs?: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(): AppConfig {
  const configuredDatabasePath = process.env.DATABASE_PATH?.trim();
  const configuredApiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const deepseekApiKey = configuredApiKey === "your_deepseek_api_key_here"
    ? undefined
    : configuredApiKey || undefined;
  return {
    port: Number(process.env.API_PORT ?? 3001),
    host: process.env.API_HOST?.trim() || "127.0.0.1",
    databasePath: configuredDatabasePath
      ? path.isAbsolute(configuredDatabasePath)
        ? configuredDatabasePath
        : path.resolve(projectRootPath, configuredDatabasePath)
      : defaultDatabasePath,
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:8501,http://127.0.0.1:8501",
    deepseekApiKey,
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    deepseekTimeoutMs: positiveInteger(process.env.DEEPSEEK_TIMEOUT_MS, 30_000),
  };
}
