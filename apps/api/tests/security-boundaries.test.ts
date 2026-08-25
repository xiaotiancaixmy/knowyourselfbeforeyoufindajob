import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kys-security-"));
  const app = await buildApp({
    port: 0,
    databasePath: path.join(directory, "app.db"),
    webOrigin: "http://localhost:8501",
    deepseekBaseUrl: "https://api.deepseek.com",
    deepseekModel: "deepseek-chat",
  });
  cleanups.push(async () => {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return app;
}

describe("local release security boundaries", () => {
  it("does not allow an unlisted browser origin", async () => {
    const app = await setup();
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "https://attacker.example" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not return raw resume text in workspace or import responses", async () => {
    const app = await setup();
    const rawText = "Acme | Product Manager | 2022-2024\n- private resume detail";
    const imported = await app.inject({
      method: "POST",
      url: "/api/sources/text",
      payload: { rawText },
    });
    const workspace = await app.inject({ method: "GET", url: "/api/workspace" });

    expect(imported.statusCode).toBe(201);
    expect(imported.json().source).not.toHaveProperty("rawText");
    expect(workspace.json().activeSource).not.toHaveProperty("rawText");
    expect(workspace.json().drafts[0].source).not.toHaveProperty("rawText");
    expect(workspace.body).not.toContain("private resume detail");
  });
});
