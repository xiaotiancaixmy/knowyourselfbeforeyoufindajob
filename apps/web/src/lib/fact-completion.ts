import type { ExperienceRecordDto } from "@kys/shared";

export function resolveFactExperienceId(activeExperienceId: number | null, selectedExperiences: ExperienceRecordDto[]) {
  if (activeExperienceId !== null && selectedExperiences.some((experience) => experience.id === activeExperienceId)) {
    return activeExperienceId;
  }
  return selectedExperiences[0]?.id ?? null;
}
