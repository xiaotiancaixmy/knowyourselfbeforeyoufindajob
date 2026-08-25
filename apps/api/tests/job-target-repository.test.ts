import { describe, expect, it } from "vitest";

import { createDatabase } from "../src/db/client.js";
import { JobTargetRepository } from "../src/repositories/job-target-repository.js";
import { WorkspaceRepository } from "../src/repositories/workspace-repository.js";

describe("JobTargetRepository", () => {
  it("keeps a newer analysis current when an older request finishes later", () => {
    const { db, sqlite } = createDatabase(":memory:");
    const workspace = new WorkspaceRepository(db);
    const targets = new JobTargetRepository(db);
    const source = workspace.createSource({ sourceType: "text", filename: null, rawText: "resume" });
    const target = targets.create(source.id, "AI 产品经理", "岗位职责与任职要求");
    const baseSnapshot = {
      jdId: target.id,
      jdRevision: 1,
      sourceId: source.id,
      positioningVersion: 1,
      positioningFingerprint: "positioning-v1",
      selectedExperienceIds: [],
      experiences: [],
      createdAt: "2026-08-25T00:00:00.000Z",
    };
    const older = targets.createPendingAnalysis(target.id, "older", baseSnapshot);
    const newer = targets.createPendingAnalysis(target.id, "newer", {
      ...baseSnapshot,
      positioningVersion: 2,
      positioningFingerprint: "positioning-v2",
    });

    targets.completeAnalysis(newer.id, "apply", null, { decision: "apply" });
    targets.completeAnalysis(older.id, "conditional", null, { decision: "conditional" });

    expect(targets.getAnalysisByVersion(target.id, newer.version)).toMatchObject({
      runState: "succeeded",
      validity: "current",
      decision: "apply",
    });
    expect(targets.getAnalysisByVersion(target.id, older.version)).toMatchObject({
      runState: "succeeded",
      validity: "superseded",
      decision: "conditional",
    });
    sqlite.close();
  });
});
