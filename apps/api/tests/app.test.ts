import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const cleanups: Array<() => Promise<void> | void> = [];

const PDF_FIXTURE_BASE64 = [
  "JVBERi0xLjMKJcTl8uXrp/Og0MTGCjMgMCBvYmoKPDwgL0ZpbHRlciAvRmxhdGVEZWNvZGUgL0xlbmd0aCA1NTIgPj4Kc3RyZWFtCngBzZpNa9tAEIbv/hVz",
  "KaSHOjv7IcnHJvgQaKGhKj0r8tYoiSRn5ZoE+uO7idoQNgtxd6G8Psgaa2f0gPcFPcZ3dEl3dHo+MbUTCZpaX7I/Ef7IxbLwJ21PZzWJpRCCqW6J5Xz98a0s",
  "1FJWmup+cVrXvoXqH3TyfXQ3tL7fWdfZobWU+3q/qK9pXT+x/guc4T9w9Ay3OPnY9pZ+0Vc7dKOjL27c/Gz39LkZmq11/oIUUn7wB30kdSqcWkXgPtkNjcPV",
  "2LhNN2zJ2Y2duu1wJMrrZalwsozAXfQ7Nx48YdPuu0Oz78aBrh6Iq3evb3zMJ6lwbCJwa/81zkjH3PrtNalw4m8gXu659X3T724tfRu6g3VTt3942mhcPW40",
  "+TZMuCIRrljFAhEOz61T4cpYIHJhwv5UuCIWiHB4bp0KZ2KByIUJ+1PhdCwQ4fDcOhVOIQeCkQMhgANhVsCBMBVwIEwJHAhjgANhNHIgFHIgJHIgGDgQegUc",
  "CF0BB0KXwIHQz1L90iFyH5HC/sRHJh2V6nB4bp0KF5XqXJiwPxUuKtXh8Nw6FS4q1bkwYX8qXFSqw+G5dSKcQpZqhSzVClmqFbJUK2SpVshSrZClWiFLtUSW",
  "aoks1RJZqiWyVEtkqZbIUi2RpVoiSzUjSzUjSzUjSzUjSzUjSzUjSzUjSzUjSzUjS/Xs1EL6P5YA/gY2SzUq3WzVqHSzVqPSzV6NSjeL9X+ku/wNQWVl0Qpl",
  "bmRzdHJlYW0KZW5kb2JqCjEgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvUmVzb3VyY2VzIDQgMCBSIC9Db250ZW50cyAzIDAgUiA+Pgpl",
  "bmRvYmoKNCAwIG9iago8PCAvUHJvY1NldCBbIC9QREYgL1RleHQgXSAvQ29sb3JTcGFjZSA8PCAvQ3MxIDUgMCBSID4+IC9Gb250IDw8IC9UVDEgNiAwIFIK",
  "Pj4gPj4KZW5kb2JqCjcgMCBvYmoKPDwgL04gMSAvQWx0ZXJuYXRlIC9EZXZpY2VHcmF5IC9MZW5ndGggMzM4NSAvRmlsdGVyIC9GbGF0ZURlY29kZSA+Pgpz",
  "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",
  "WiQ6khzJ2Xzz/OL8q1InaaW0a67v3PVzB2RRsvoCrGBmQXOhHvxT2iF3kH8u7y4KKKotej0vZd7hYu1iSXFHiWPJspLHpWGlX88n5vPnt5VZli0p617AWbBj",
  "IbZwzsK2RdaLKhb1LA5fvGeJ6pKcJT+Vs8vXlP/5WepnrRVmFYsrHn0e/vm+SmalrPLWUr+l278gvhB/cWnZxGWblr2vElT9WM2urql+t5y//Mcv3b7c+OWH",
  "FZkrLq30XLltFW2VZNXN1YGr96zRXlO65tHaqWub1rHWVa37c/3s9RdqJtVs36C6Qb6ha2P0xuZNNptWbXq3WbS5s3ZK7YEtpluWbXm1VbD12ragbY3bzbZX",
  "b3/7lfir2zvCdzTV2dXV7KTtLNr5666UXe1fe3/dUG9SX13/127J7q49CXvONng1NOw13btyH2WffF/f/hn7r3wT8k1zo0vjjgMGB6oPooPyg0++zfj25qGo",
  "Q22HvQ83fmf73ZYjukeqmrCmkqaBo6KjXc1pzVdbIlvaWv1aj3zv+v3uY5bHao/rH195QvVExYkPJ0tPDp6Snuo/nXX6Udvstntnpp25cTb+7KVzUefO/xD2",
  "w5l2TvvJ8/7nj13wvdDyo/ePRy96Xmzq8Og48pPHT0cueV5quux1ufmKz5XWq5OvnrgWeO309ZDrP9zg3rjYGdN59Wbyzdu3Ztzqui243Xsn987zu0V3h+4t",
  "hot91QOtBzUPTR/W/Wv8vw50eXYd7w7p7vg58ed7j/iPnv5S8Mu7nopfNX6teWzxuKHXvfdYX1jflSfTn/Q8lT4d6q/8Tfu3Lc8cnn33e9DvHQPTBnqey55/",
  "+GP5C+MXu/+c9GfbYNzgw5d5L4deVb02fr3njfeb9repbx8PzXtHf7fxr/F/tb6Pen//Q96HD/8GCQ/4YgplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKWyAv",
  "SUNDQmFzZWQgNyAwIFIgXQplbmRvYmoKMiAwIG9iago8PCAvVHlwZSAvUGFnZXMgL01lZGlhQm94IFswIDAgNjEyIDc5Ml0gL0NvdW50IDEgL0tpZHMgWyAx",
  "IDAgUiBdID4+CmVuZG9iago4IDAgb2JqCjw8IC9UeXBlIC9DYXRhbG9nIC9QYWdlcyAyIDAgUiA+PgplbmRvYmoKOSAwIG9iago8PCAvQ3JlYXRpb25EYXRl",
  "IChEOjIwMjYwODAyMTMwNjU0WjAwJzAwJykgL1Byb2R1Y2VyIChtYWNPUyBWZXJzaW9uIDI2LjUgXChCdWlsZCAyNUY3MVwpIFF1YXJ0eiBQREZDb250ZXh0",
  "KQovTW9kRGF0ZSAoRDoyMDI2MDgwMjEzMDY1NFowMCcwMCcpID4+CmVuZG9iago2IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UcnVlVHlwZSAv",
  "QmFzZUZvbnQgL0FBQUFBQitNb25hY28gL0ZvbnREZXNjcmlwdG9yCjEwIDAgUiAvRW5jb2RpbmcgL01hY1JvbWFuRW5jb2RpbmcgL0ZpcnN0Q2hhciAzMiAv",
  "TGFzdENoYXIgMTI0IC9XaWR0aHMgWyA2MDAKMCAwIDAgMCA2MDAgMCAwIDAgMCAwIDAgMCA2MDAgMCAwIDYwMCA2MDAgNjAwIDAgNjAwIDAgMCAwIDYwMCAw",
  "IDAgMCAwIDAgMAowIDAgNjAwIDAgMCAwIDYwMCAwIDAgMCA2MDAgMCAwIDYwMCA2MDAgMCAwIDYwMCAwIDAgNjAwIDAgNjAwIDAgNjAwIDAgMCAwCjAgMCAw",
  "IDAgMCAwIDYwMCA2MDAgNjAwIDYwMCA2MDAgMCA2MDAgMCA2MDAgMCA2MDAgNjAwIDYwMCA2MDAgNjAwIDYwMCAwIDYwMAo2MDAgNjAwIDYwMCA2MDAgMCA2",
  "MDAgNjAwIDAgMCA2MDAgXSA+PgplbmRvYmoKMTAgMCBvYmoKPDwgL1R5cGUgL0ZvbnREZXNjcmlwdG9yIC9Gb250TmFtZSAvQUFBQUFCK01vbmFjbyAvRmxh",
  "Z3MgMzIgL0ZvbnRCQm94IFstNjEwIC00MjEgODA0IDEyMjNdCi9JdGFsaWNBbmdsZSAwIC9Bc2NlbnQgMTAwMCAvRGVzY2VudCAtMjUwIC9DYXBIZWlnaHQg",
  "NzU4IC9TdGVtViA5OSAvTGVhZGluZwo4MyAvWEhlaWdodCA1NDUgL1N0ZW1IIDc2IC9BdmdXaWR0aCA2MDAgL01heFdpZHRoIDYwNiAvRm9udEZpbGUyIDEx",
  "IDAgUiA+PgplbmRvYmoKMTEgMCBvYmoKPDwgL0xlbmd0aDEgMTQ5MDggL0xlbmd0aCAxMDc3MSAvRmlsdGVyIC9GbGF0ZURlY29kZSA+PgpzdHJlYW0KeAGV",
  "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",
  "gY8tORAzcIzDcGwTVhCNFcUIwQ/4FjmIGThpr9montqohzbNHSc2YZPh385qQOF2BEV9xHzLgKhkyP0BXoSXNYXsTHHLKnrO3W3htSLnBFsAHy06pawm3EgL",
  "Xdh4Lp5PEHrxk+Fsawozm57NbKJ2U7vZN7g3+Eb2MHeIP82eZ7/V/sbf1Lr8bHd2CjWZ/R21hN3Jfk59J4iADZw4YA6cWMQzohbxtIaDr4RkOMWCHo1sFkWG",
  "5zg4OeDgsAdOsDQa8A+AQKBb9W+TwJuu3WKCk6orxdI35GsE+CxFtZDUdBlbqIaC28+njHCFTxR9fkBY/fODUPscvxua/BP2Y/dfQ/PxuZ9De+GLZWtoBX6q",
  "NdS6Ax9V9583lKKuqRl9qtStgI+P30Cf0wwajIrQClRLr2JWsCvMm9AmeiO3kX+D3su8wTbSh5hD7GnmNHuBucDaRDAG1IUmBKQps5nRmQ3ta40kmuLgHE+G",
  "bwngqwJEm9sX3KyBsIjRDHjDoR/OYYexj7NPsmtYlnVZdfCPIXDiURhe9SvFvaRvisM0KCTbgNCBhMPJGZ0BDukEckrHLjhJYm7kVE7IIimxpNWYWQcTEAcM",
  "wkDZuAccDrScgw+Uxx0ODVvx28kxAwrzx6+a40hm0uBcLP/uP0Lvnjdud+Q39AOEKFvbx1QjCUcjWTHSf4V/ZqEjod3JrPpEldMd+zM9jQW5Qdm2pXIVt+Fj",
  "KWKDqVfbfmJj/ocrDtogKAvff4W/8yLfOcXAN9hJ8KV9GnzvlAlfcPVGuSgP5YPlPwi+s38IDYWvxoejEfBfSqPUr8fHonGwUI+gR9Hj8DQMFg/sMbg48pVZ",
  "P3L1Tyx88onSiU+S3o5rOxRIWOs4wEcAFwGuhwdgCXIvQBqAAjAcoASgEqAGoA7gFYAgwHGAjwAuAlwPI0xJkHsB0gAUgOEAJQCVADUAdQCvAAQBjgN8BHAR",
  "4DohRlv7heC6V8bI26ke26me3Kme1qme3qnetVOd/D/f/e8DufBAvV+nel6n+uBO9Yc61Qs71Yd3qo/qVFdVyX34j+3UX9qpPqFTfWKn+qRO9bJO9Smd6tM6",
  "1ad3qs/oVK/oVH+iUx2Y7wF6Vnaqz+pUn92prv6f5H30UF2c++pVncY/3akO/vkD759P6v8PP/NFWQplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCAxMgowMDAw",
  "MDAwMDAwIDY1NTM1IGYgCjAwMDAwMDA2NDYgMDAwMDAgbiAKMDAwMDAwNDM0NCAwMDAwMCBuIAowMDAwMDAwMDIyIDAwMDAwIG4gCjAwMDAwMDA3MjYgMDAw",
  "MDAgbiAKMDAwMDAwNDMwOSAwMDAwMCBuIAowMDAwMDA0NjM3IDAwMDAwIG4gCjAwMDAwMDA4MjMgMDAwMDAgbiAKMDAwMDAwNDQyNyAwMDAwMCBuIAowMDAw",
  "MDA0NDc2IDAwMDAwIG4gCjAwMDAwMDUwNjcgMDAwMDAgbiAKMDAwMDAwNTMyNSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDEyIC9Sb290IDggMCBSIC9J",
  "bmZvIDkgMCBSIC9JRCBbIDxkNGQ3YjM2ODcwZDg5Yjk0NzU0ZGMzZmFlZTk4YWE0Mz4KPGQ0ZDdiMzY4NzBkODliOTQ3NTRkYzNmYWVlOThhYTQzPiBdID4+",
  "CnN0YXJ0eHJlZgoxNjE4NgolJUVPRgo=",
].join("");

function buildSimplePdf(): Buffer {
  return Buffer.from(PDF_FIXTURE_BASE64, "base64");
}
function buildPdfMultipart(filename: string, fileBytes: Buffer) {
  const boundary = "----kys-pdf-boundary";
  return {
    boundary,
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
      fileBytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

describe("API app", () => {
  it("imports text resume through REST and exposes workspace state", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kys-app-"));
    const app = await buildApp({
      port: 0,
      databasePath: path.join(directory, "app.db"),
      deepseekBaseUrl: "https://api.deepseek.com",
      deepseekModel: "deepseek-chat",
    });
    cleanups.push(async () => {
      await app.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const importResponse = await app.inject({
      method: "POST",
      url: "/api/sources/text",
      payload: {
        rawText: `
Acme | Senior Product Manager | 2022-2024
- Led onboarding redesign
- Improved activation by 18%
        `.trim(),
      },
    });

    expect(importResponse.statusCode).toBe(201);

    const workspaceResponse = await app.inject({
      method: "GET",
      url: "/api/workspace",
    });

    expect(workspaceResponse.statusCode).toBe(200);
    expect(workspaceResponse.json().activeSource.sourceType).toBe("text");
    expect(workspaceResponse.json().drafts).toHaveLength(1);
    expect(workspaceResponse.json().activeStatuses.baseline_review).toBe(true);
  });

  it("deletes a draft through REST and removes it from the workspace", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kys-app-"));
    const app = await buildApp({
      port: 0,
      databasePath: path.join(directory, "app.db"),
      deepseekBaseUrl: "https://api.deepseek.com",
      deepseekModel: "deepseek-chat",
    });
    cleanups.push(async () => {
      await app.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const imported = await app.inject({
      method: "POST",
      url: "/api/sources/text",
      payload: { rawText: "Acme | Product Manager | 2022-2024\n- Led onboarding redesign" },
    });
    const sourceId = imported.json().source.id as number;
    const deleted = await app.inject({ method: "DELETE", url: `/api/workspace/drafts/${sourceId}` });
    const workspace = await app.inject({ method: "GET", url: "/api/workspace" });

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ ok: true, deletedSourceId: sourceId });
    expect(workspace.json().activeSource).toBeNull();
    expect(workspace.json().drafts).toHaveLength(0);
  });

  it("imports a PDF through multipart and parses its work experience", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kys-app-"));
    const app = await buildApp({
      port: 0,
      databasePath: path.join(directory, "app.db"),
      deepseekBaseUrl: "https://api.deepseek.com",
      deepseekModel: "deepseek-chat",
    });
    cleanups.push(async () => {
      await app.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });
    const pdfBytes = buildSimplePdf();
    const multipart = buildPdfMultipart("resume.pdf", pdfBytes);

    const response = await app.inject({
      method: "POST",
      url: "/api/sources/pdf",
      headers: {
        "content-type": `multipart/form-data; boundary=${multipart.boundary}`,
      },
      payload: multipart.payload,
    });

    if (response.statusCode !== 201) {
      throw new Error(`[DEBUG-pdf-import] ${response.body}`);
    }
    expect(response.statusCode).toBe(201);
    expect(response.json().source.sourceType).toBe("pdf");
    expect(response.json().experiences).toHaveLength(1);
    expect(response.json().experiences[0].company).toBe("Acme");
  });

  it("returns an understandable 400 without creating a draft for non-experience text", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kys-app-"));
    const app = await buildApp({
      port: 0,
      databasePath: path.join(directory, "app.db"),
      deepseekBaseUrl: "https://api.deepseek.com",
      deepseekModel: "deepseek-chat",
    });
    cleanups.push(async () => {
      await app.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/sources/text",
      payload: { rawText: "个人总结\n热爱产品，善于沟通。\n技能\nFigma、SQL" },
    });
    const workspace = await app.inject({ method: "GET", url: "/api/workspace" });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("公司、岗位和任职时间");
    expect(workspace.json().drafts).toHaveLength(0);
  });

  it("streams fact completion deltas and a final persisted snapshot", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kys-app-"));
    const app = await buildApp({
      port: 0,
      databasePath: path.join(directory, "app.db"),
      deepseekBaseUrl: "https://api.deepseek.com",
      deepseekModel: "deepseek-chat",
    });
    cleanups.push(async () => {
      await app.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const importResponse = await app.inject({
      method: "POST",
      url: "/api/sources/text",
      payload: {
        rawText: "Acme | Senior Product Manager | 2022-2024\n- Led onboarding redesign\n- Improved activation by 18%",
      },
    });
    const experienceId = importResponse.json().experiences[0].id as number;
    await app.inject({
      method: "POST",
      url: "/api/experiences/select",
      payload: { selectedIds: [experienceId] },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/fact-completion/${experienceId}/messages/stream`,
      payload: { answer: "我负责梳理 onboarding 关键路径，并推动设计和工程共同上线。" },
    });
    const events = response.body.trim().split("\n").map((line) => JSON.parse(line) as {
      type: string;
      conversation?: unknown[];
      completion?: { status: string; factVersion: number };
      overallCompletion?: { canProceed: boolean };
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/x-ndjson");
    expect(events.some((event) => event.type === "delta")).toBe(true);
    expect(events.at(-1)?.type).toBe("complete");
    expect(events.at(-1)?.conversation?.length).toBeGreaterThanOrEqual(3);
    expect(events.at(-1)?.completion?.status).toMatch(/collecting|review_ready/u);
    expect(events.at(-1)?.overallCompletion?.canProceed).toBe(false);

    const snapshot = await app.inject({
      method: "GET",
      url: `/api/fact-completion/${experienceId}`,
    });
    expect(snapshot.json().completion).toEqual(events.at(-1)?.completion);
    expect(snapshot.json().overallCompletion.canProceed).toBe(false);
  });

  it("uses one canonical decision for confirmation, workspace, and dossier generation", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kys-app-"));
    const app = await buildApp({
      port: 0,
      databasePath: path.join(directory, "app.db"),
      deepseekBaseUrl: "https://api.deepseek.com",
      deepseekModel: "deepseek-chat",
    });
    cleanups.push(async () => {
      await app.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const imported = await app.inject({
      method: "POST",
      url: "/api/sources/text",
      payload: { rawText: "Acme | Product Manager | 2022-2024\n- 参与内部工具优化" },
    });
    const experienceId = imported.json().experiences[0].id as number;
    await app.inject({
      method: "POST",
      url: "/api/experiences/select",
      payload: { selectedIds: [experienceId] },
    });

    const review = await app.inject({
      method: "POST",
      url: `/api/fact-completion/${experienceId}/confirmation`,
      payload: { action: "request_review", expectedFactVersion: 0 },
    });
    expect(review.statusCode).toBe(200);
    expect(review.json().completion.status).toBe("limits_review");

    const outdated = await app.inject({
      method: "POST",
      url: `/api/fact-completion/${experienceId}/confirmation`,
      payload: { action: "finish_with_limits", expectedFactVersion: 99 },
    });
    expect(outdated.statusCode).toBe(409);

    const finished = await app.inject({
      method: "POST",
      url: `/api/fact-completion/${experienceId}/confirmation`,
      payload: { action: "finish_with_limits", expectedFactVersion: 0 },
    });
    expect(finished.statusCode).toBe(200);
    expect(finished.json().completion.claimRestrictions.length).toBeGreaterThan(0);
    expect(finished.json().overallCompletion.canProceed).toBe(true);

    const workspace = await app.inject({ method: "GET", url: "/api/workspace" });
    expect(workspace.json().overallCompletion).toEqual(finished.json().overallCompletion);
    expect(workspace.json().activeStatuses.fact_completion).toBe(true);

    const dossiers = await app.inject({ method: "POST", url: "/api/dossiers/generate" });
    expect(dossiers.statusCode).toBe(200);
    expect(dossiers.json().overallCompletion).toEqual(finished.json().overallCompletion);
    expect(dossiers.json().dossiers[0].evaluativeJudgment).toContain("仅使用已确认事实");
  });

  it("creates a new draft without deleting the previous one", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kys-app-"));
    const app = await buildApp({
      port: 0,
      databasePath: path.join(directory, "app.db"),
      deepseekBaseUrl: "https://api.deepseek.com",
      deepseekModel: "deepseek-chat",
    });
    cleanups.push(async () => {
      await app.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    await app.inject({
      method: "POST",
      url: "/api/sources/text",
      payload: {
        rawText: "Acme | Senior Product Manager | 2022-2024\n- Led onboarding redesign",
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/workspace/start-new",
    });

    await app.inject({
      method: "POST",
      url: "/api/sources/text",
      payload: {
        rawText: "Beta | Product Lead | 2024-2026\n- Built an internal tool",
      },
    });

    const workspaceResponse = await app.inject({
      method: "GET",
      url: "/api/workspace",
    });

    expect(workspaceResponse.statusCode).toBe(200);
    expect(workspaceResponse.json().drafts).toHaveLength(2);
    expect(workspaceResponse.json().activeSource.id).toBe(workspaceResponse.json().drafts[0].source.id);
  });

  it("returns 404 when activating a draft that does not exist", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kys-app-"));
    const app = await buildApp({
      port: 0,
      databasePath: path.join(directory, "app.db"),
      deepseekBaseUrl: "https://api.deepseek.com",
      deepseekModel: "deepseek-chat",
    });
    cleanups.push(async () => {
      await app.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/workspace/activate",
      payload: { sourceId: 9999 },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toContain("没有找到");
  });

  it("saves goal setup through REST and exposes it from workspace", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kys-app-"));
    const app = await buildApp({
      port: 0,
      databasePath: path.join(directory, "app.db"),
      deepseekBaseUrl: "https://api.deepseek.com",
      deepseekModel: "deepseek-chat",
    });
    cleanups.push(async () => {
      await app.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    await app.inject({
      method: "POST",
      url: "/api/sources/text",
      payload: {
        rawText: "Acme | Senior Product Manager | 2022-2024\n- Led onboarding redesign",
      },
    });

    const saveResponse = await app.inject({
      method: "PUT",
      url: "/api/workspace/goal-setup",
      payload: {
        targetRole: "AI Agent 产品经理",
        mainSellingPoint: "AI workflow",
        biggestQuestion: "怎么讲清楚主导度",
        doNotOversell: "大团队管理",
      },
    });

    expect(saveResponse.statusCode).toBe(200);

    const workspaceResponse = await app.inject({
      method: "GET",
      url: "/api/workspace",
    });

    expect(workspaceResponse.statusCode).toBe(200);
    expect(workspaceResponse.json().activeGoalSetup.targetRole).toBe("AI Agent 产品经理");
    expect(workspaceResponse.json().drafts[0].goalSetup.mainSellingPoint).toBe("AI workflow");
  });

  it("rejects manual resume saves while fact completion cannot proceed", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kys-app-"));
    const app = await buildApp({
      port: 0,
      databasePath: path.join(directory, "app.db"),
      deepseekBaseUrl: "https://api.deepseek.com",
      deepseekModel: "deepseek-chat",
    });
    cleanups.push(async () => {
      await app.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const imported = await app.inject({
      method: "POST",
      url: "/api/sources/text",
      payload: { rawText: "Acme | Product Manager | 2022-2024\n- 协助内部工具测试" },
    });
    const experienceId = imported.json().experiences[0].id as number;
    await app.inject({
      method: "POST",
      url: "/api/experiences/select",
      payload: { selectedIds: [experienceId] },
    });

    const save = await app.inject({
      method: "PUT",
      url: "/api/resume-rewrite",
      payload: {
        professionalSummary: "具备内部工具测试协作经验。",
        experienceBulletsByExperienceId: {
          [String(experienceId)]: ["协助内部工具测试。"],
        },
      },
    });
    const workspace = await app.inject({ method: "GET", url: "/api/workspace" });

    expect(save.statusCode).toBe(409);
    expect(workspace.json().activeStatuses.fact_completion).toBe(false);
    expect(workspace.json().activeStatuses.resume_rewrite).toBe(false);
  });

  it("rejects manual resume saves when dossier and profile assets are missing", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kys-app-"));
    const app = await buildApp({
      port: 0,
      databasePath: path.join(directory, "app.db"),
      deepseekBaseUrl: "https://api.deepseek.com",
      deepseekModel: "deepseek-chat",
    });
    cleanups.push(async () => {
      await app.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const imported = await app.inject({
      method: "POST",
      url: "/api/sources/text",
      payload: { rawText: "Acme | Product Manager | 2022-2024\n- 协助内部工具测试" },
    });
    const experienceId = imported.json().experiences[0].id as number;
    await app.inject({
      method: "POST",
      url: "/api/experiences/select",
      payload: { selectedIds: [experienceId] },
    });
    await app.inject({
      method: "POST",
      url: `/api/fact-completion/${experienceId}/confirmation`,
      payload: { action: "request_review", expectedFactVersion: 0 },
    });
    await app.inject({
      method: "POST",
      url: `/api/fact-completion/${experienceId}/confirmation`,
      payload: { action: "finish_with_limits", expectedFactVersion: 0 },
    });

    const save = await app.inject({
      method: "PUT",
      url: "/api/resume-rewrite",
      payload: {
        professionalSummary: "具备内部工具测试协作经验。",
        experienceBulletsByExperienceId: {
          [String(experienceId)]: ["协助内部工具测试。"],
        },
      },
    });

    expect(save.statusCode).toBe(409);
  });

  it("attributes professional summary numbers to the explicitly named experience", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kys-app-"));
    const app = await buildApp({
      port: 0,
      databasePath: path.join(directory, "app.db"),
      deepseekBaseUrl: "https://api.deepseek.com",
      deepseekModel: "deepseek-chat",
    });
    cleanups.push(async () => {
      await app.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const imported = await app.inject({
      method: "POST",
      url: "/api/sources/text",
      payload: {
        rawText: `
Acme | Product Manager | 2020-2022
- 协助内部工具测试并整理反馈

Beta | Product Manager | 2022-2024
- 参与增长实验测试，转化率提升 35%
        `.trim(),
      },
    });
    const experiences = imported.json().experiences as Array<{ id: number; company: string }>;
    await app.inject({
      method: "POST",
      url: "/api/experiences/select",
      payload: { selectedIds: experiences.map((experience) => experience.id) },
    });
    for (const experience of experiences) {
      const review = await app.inject({
        method: "POST",
        url: `/api/fact-completion/${experience.id}/confirmation`,
        payload: { action: "request_review", expectedFactVersion: 0 },
      });
      await app.inject({
        method: "POST",
        url: `/api/fact-completion/${experience.id}/confirmation`,
        payload: {
          action: "finish_with_limits",
          expectedFactVersion: review.json().completion.factVersion,
        },
      });
    }
    const generated = await app.inject({ method: "POST", url: "/api/dossiers/generate" });
    await app.inject({
      method: "PUT",
      url: "/api/workspace/positioning-decision",
      payload: {
        selectedOptionId: "recommended-main-lane",
        confirmedOptionTitle: generated.json().profile.recommendedMainLane,
        keepFocus: "内部工具与增长实验协作",
        avoidEmphasis: "端到端 ownership",
        confirmationNote: "",
      },
    });

    const bullets = Object.fromEntries(experiences.map((experience) => [
      String(experience.id),
      experience.company === "Acme"
        ? ["协助内部工具测试并整理反馈。"]
        : ["参与增长实验测试，转化率提升 35%。"],
    ]));
    const misattributed = await app.inject({
      method: "PUT",
      url: "/api/resume-rewrite",
      payload: {
        professionalSummary: "在 Acme 协助内部工具测试，推动效率提升 35%。",
        experienceBulletsByExperienceId: bullets,
      },
    });
    expect(misattributed.statusCode).toBe(409);

    const ambiguousOverview = await app.inject({
      method: "PUT",
      url: "/api/resume-rewrite",
      payload: {
        professionalSummary: "具备内部工具与增长实验协作经验，推动效率提升 35%。",
        experienceBulletsByExperienceId: bullets,
      },
    });
    expect(ambiguousOverview.statusCode).toBe(409);

    const attributedToBeta = await app.inject({
      method: "PUT",
      url: "/api/resume-rewrite",
      payload: {
        professionalSummary: "在 Beta 参与增长实验测试，转化率提升 35%。",
        experienceBulletsByExperienceId: bullets,
      },
    });
    expect(attributedToBeta.statusCode).toBe(200);

    const safeWithoutNumbers = await app.inject({
      method: "PUT",
      url: "/api/resume-rewrite",
      payload: {
        professionalSummary: "具备 Acme 内部工具与 Beta 增长实验协作经验。",
        experienceBulletsByExperienceId: bullets,
      },
    });
    expect(safeWithoutNumbers.statusCode).toBe(200);
  });

  it("rejects stale manual resume saves and never reports rewrite complete", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kys-app-"));
    const app = await buildApp({
      port: 0,
      databasePath: path.join(directory, "app.db"),
      deepseekBaseUrl: "https://api.deepseek.com",
      deepseekModel: "deepseek-chat",
    });
    cleanups.push(async () => {
      await app.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const imported = await app.inject({
      method: "POST",
      url: "/api/sources/text",
      payload: { rawText: "Acme | Product Manager | 2022-2024\n- 协助内部工具测试" },
    });
    const experienceId = imported.json().experiences[0].id as number;
    await app.inject({
      method: "POST",
      url: "/api/experiences/select",
      payload: { selectedIds: [experienceId] },
    });
    await app.inject({
      method: "POST",
      url: `/api/fact-completion/${experienceId}/confirmation`,
      payload: { action: "request_review", expectedFactVersion: 0 },
    });
    await app.inject({
      method: "POST",
      url: `/api/fact-completion/${experienceId}/confirmation`,
      payload: { action: "finish_with_limits", expectedFactVersion: 0 },
    });
    const generated = await app.inject({ method: "POST", url: "/api/dossiers/generate" });
    await app.inject({
      method: "PUT",
      url: "/api/workspace/positioning-decision",
      payload: {
        selectedOptionId: "recommended-main-lane",
        confirmedOptionTitle: generated.json().profile.recommendedMainLane,
        keepFocus: "内部工具测试协作",
        avoidEmphasis: "端到端 ownership",
        confirmationNote: "",
      },
    });
    const safeRewrite = {
      professionalSummary: "具备内部工具测试协作经验。",
      experienceBulletsByExperienceId: {
        [String(experienceId)]: ["协助内部工具测试。"],
      },
    };
    const firstSave = await app.inject({
      method: "PUT",
      url: "/api/resume-rewrite",
      payload: safeRewrite,
    });
    expect(firstSave.statusCode).toBe(200);

    const experiences = await app.inject({ method: "GET", url: "/api/experiences" });
    await app.inject({
      method: "PUT",
      url: "/api/experiences",
      payload: {
        experiences: [
          {
            ...experiences.json().experiences[0],
            responsibilities: ["协助内部工具测试并整理反馈"],
          },
        ],
      },
    });

    const staleSave = await app.inject({
      method: "PUT",
      url: "/api/resume-rewrite",
      payload: safeRewrite,
    });
    const workspace = await app.inject({ method: "GET", url: "/api/workspace" });

    expect(staleSave.statusCode).toBe(409);
    expect(workspace.json().overallCompletion.hasStale).toBe(true);
    expect(workspace.json().overallCompletion.canProceed).toBe(false);
    expect(workspace.json().activeStatuses.fact_completion).toBe(false);
    expect(workspace.json().activeStatuses.resume_rewrite).toBe(false);
  });
});
