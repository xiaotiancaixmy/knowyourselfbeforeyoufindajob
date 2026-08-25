import type { PositioningDecisionStateDto } from "@kys/shared";

import type { JobTarget } from "../domain.js";
import { ConflictError, NotFoundError } from "../lib/app-error.js";
import { WorkspaceRepository } from "../repositories/workspace-repository.js";

export class JobFitPrerequisite {
  constructor(private readonly repository: WorkspaceRepository) {}

  require(target: JobTarget | null): JobTarget {
    if (!target || !this.repository.getSource(target.sourceId)) {
      throw new NotFoundError("没有找到这个岗位记录。");
    }
    const positioning = this.repository.getLatestGeneratedAsset<PositioningDecisionStateDto>(
      "positioning_decision",
      target.sourceId,
      null,
    );
    if (!positioning?.selectedOptionId || !positioning.confirmedOptionTitle.trim()) {
      throw new ConflictError("请先完成第 5 步并确认求职定位，再分析岗位。");
    }
    return target;
  }
}
