import { createHash } from "node:crypto";

import type { JobFitInputSnapshotDto, PositioningDecisionStateDto } from "@kys/shared";

import type { JobTarget } from "../domain.js";
import { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { utcNow } from "../lib/time.js";
import type { ConfirmedFactCandidate } from "./job-fit-claim-validator.js";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function fingerprintJobFitSnapshot(snapshot: JobFitInputSnapshotDto): string {
  const { createdAt: _createdAt, ...immutableInputs } = snapshot;
  return hash(immutableInputs);
}

export class JobFitEvidenceAssembler {
  constructor(private readonly repository: WorkspaceRepository) {}

  assemble(target: JobTarget): { snapshot: JobFitInputSnapshotDto; facts: ConfirmedFactCandidate[] } {
    const selected = this.repository.listExperiences(target.sourceId)
      .filter((experience) => experience.selected)
      .sort((left, right) => left.id - right.id)
      .slice(0, 3);
    const positioning = this.repository.getLatestGeneratedAsset<PositioningDecisionStateDto>(
      "positioning_decision",
      target.sourceId,
      null,
    );
    const experiences = selected.flatMap((experience) => {
      const state = this.repository.getFactCompletionState(experience.id);
      if (!state?.confirmedSummary || !["completed", "completed_with_limits"].includes(state.status)) return [];
      return [{
        experienceId: experience.id,
        company: experience.company,
        role: experience.role,
        factVersion: state.factVersion,
        factSummary: state.confirmedSummary,
        claimRestrictions: state.claimRestrictions,
        factSummaryHash: hash(state.confirmedSummary),
        claimRestrictionsHash: hash(state.claimRestrictions),
      }];
    });
    const facts: ConfirmedFactCandidate[] = experiences.flatMap((experience) =>
      (Object.entries(experience.factSummary) as Array<[keyof typeof experience.factSummary, string[]]>).flatMap(
        ([category, values]) => values.map((fact) => ({
          category,
          fact,
          experienceId: experience.experienceId,
          company: experience.company,
          role: experience.role,
          factVersion: experience.factVersion,
          restrictions: experience.claimRestrictions,
        })),
      ),
    );
    return {
      snapshot: {
        jdId: target.id,
        jdRevision: target.revision,
        sourceId: target.sourceId,
        positioningVersion: this.repository.getLatestGeneratedAssetVersion("positioning_decision", target.sourceId, null),
        positioningFingerprint: positioning ? hash(positioning) : "",
        selectedExperienceIds: selected.map((experience) => experience.id),
        experiences,
        createdAt: utcNow(),
      },
      facts,
    };
  }
}
