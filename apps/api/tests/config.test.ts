import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { defaultDatabasePath, envFilePath, loadConfig, projectRootPath } from "../src/config.js";

describe("config paths", () => {
  it("resolves project files from repo root instead of process cwd", () => {
    expect(fs.existsSync(path.join(projectRootPath, "pnpm-workspace.yaml"))).toBe(true);
    expect(envFilePath).toBe(path.join(projectRootPath, ".env"));
    expect(defaultDatabasePath).toBe(path.join(projectRootPath, "app.db"));
  });

  it("binds the API to localhost and ignores the example placeholder key", () => {
    const previousHost = process.env.API_HOST;
    const previousKey = process.env.DEEPSEEK_API_KEY;
    delete process.env.API_HOST;
    process.env.DEEPSEEK_API_KEY = "your_deepseek_api_key_here";

    const config = loadConfig();

    expect(config.host).toBe("127.0.0.1");
    expect(config.deepseekApiKey).toBeUndefined();

    if (previousHost) process.env.API_HOST = previousHost;
    else delete process.env.API_HOST;
    if (previousKey) process.env.DEEPSEEK_API_KEY = previousKey;
    else delete process.env.DEEPSEEK_API_KEY;
  });

  it("uses the repo-root database path by default", () => {
    const previous = process.env.DATABASE_PATH;
    const previousTimeout = process.env.DEEPSEEK_TIMEOUT_MS;
    delete process.env.DATABASE_PATH;
    delete process.env.DEEPSEEK_TIMEOUT_MS;

    const config = loadConfig();

    expect(config.databasePath).toBe(defaultDatabasePath);
    expect(config.deepseekTimeoutMs).toBe(30_000);

    if (previous) {
      process.env.DATABASE_PATH = previous;
    } else {
      delete process.env.DATABASE_PATH;
    }
    if (previousTimeout) {
      process.env.DEEPSEEK_TIMEOUT_MS = previousTimeout;
    } else {
      delete process.env.DEEPSEEK_TIMEOUT_MS;
    }
  });

  it("accepts a dedicated model timeout", () => {
    const previous = process.env.DEEPSEEK_TIMEOUT_MS;
    process.env.DEEPSEEK_TIMEOUT_MS = "45000";

    expect(loadConfig().deepseekTimeoutMs).toBe(45_000);

    if (previous) {
      process.env.DEEPSEEK_TIMEOUT_MS = previous;
    } else {
      delete process.env.DEEPSEEK_TIMEOUT_MS;
    }
  });

  it("resolves a relative database path from the repository root", () => {
    const previous = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = "data/demo.db";

    expect(loadConfig().databasePath).toBe(path.join(projectRootPath, "data/demo.db"));

    if (previous) {
      process.env.DATABASE_PATH = previous;
    } else {
      delete process.env.DATABASE_PATH;
    }
  });
});
